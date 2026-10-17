import status from "http-status";
import { NotificationEvent, Role, UserStatus } from "../../../generated/prisma/enums.js";
import AppError from "../../errorHelpers/AppError.js";
import { IRequestUser } from "../../interfaces/requestUser.interface.js";
import { sendMail, teamInviteMail } from "../../lib/mailer.js";
import { prisma } from "../../lib/prisma.js";
import { logActivity } from "../../shared/activity.js";
import { createLinkToken, hashLinkToken, isOpenInvite, webAppUrl } from "../../shared/oneTimeLink.js";
import { getBrand } from "../../shared/platformSettings.js";
import { notify, sendNotificationMail } from "../../shared/notify.js";
import { passwordUtils } from "../../utils/password.js";
import { IAcceptInvitePayload, ICreateInvitePayload } from "./invite.validation.js";
import { sameEmail } from "../../shared/emailField.js";

/**
 * Joining a company as an operations member: an admin sends a link, the person
 * sets their own name and password and lands `pending`, and an admin approves
 * (memberApproval.service.ts). Two admin steps, so a leaked link alone lets
 * nobody in. Only the token's hash is stored, like a password reset.
 */

const DEFAULT_EXPIRY_DAYS = 7;

const INVITE_FIELDS = {
    id: true,
    email: true,
    role: true,
    expires_at: true,
    used_at: true,
    revoked_at: true,
    created_at: true,
} as const;

/**
 * Create an invite and return the link - the only time the token is readable,
 * so a lost link is revoked and sent again, never looked up.
 */
const createInvite = async (payload: ICreateInvitePayload, user: IRequestUser) => {
    const email = payload.email.toLowerCase().trim();

    const existingUser = await prisma.user.findFirst({
        where: { email: sameEmail(email) },
        select: { id: true, organization_id: true },
    });

    if (existingUser) {
        throw new AppError(
            status.CONFLICT,
            existingUser.organization_id === user.organizationId
                ? "That person is already on your team."
                : // Deliberately vague about the other company. Which addresses
                  // belong to which customer is not something one customer gets
                  // to probe for.
                  "That email already has an account.",
        );
    }

    // The seat check is NOT here - see approveMember. A pending person has no
    // access, so an invite consuming a seat would let anyone with the link
    // exhaust a company's plan without ever signing in.

    // Retire anything outstanding for this address first. Two live links to
    // one person means the older still works after the newer has been spent.
    await prisma.teamInvite.updateMany({
        where: { organization_id: user.organizationId, email, used_at: null, revoked_at: null },
        data: { revoked_at: new Date() },
    });

    const token = createLinkToken();
    const days = payload.expires_in_days ?? DEFAULT_EXPIRY_DAYS;
    const joinUrl = webAppUrl(`/join/${token}`);
    const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);

    const invite = await prisma.teamInvite.create({
        data: {
            organization_id: user.organizationId,
            email,
            role: Role.operations,
            token_hash: hashLinkToken(token),
            expires_at: expiresAt,
            created_by: user.userId,
        },
        select: INVITE_FIELDS,
    });

    // Mailed after the invite exists, so a mail failure leaves a working link
    // rather than a sent mail pointing at nothing.
    const agency = await prisma.organization.findUnique({
        where: { id: user.organizationId },
        select: { name: true },
    });

    const mail = await sendMail({
        to: email,
        ...teamInviteMail(
            joinUrl,
            expiresAt,
            agency?.name ?? "the team",
            user.name,
            await getBrand()
        ),
    });

    return {
        invite,
        // Still returned when the mail goes out. Mail gets filtered, and an
        // unverified sending domain reaches nobody but the account owner - an
        // admin with no way to pass the link on is stuck waiting on somebody
        // else's spam folder.
        join_url: joinUrl,
        email: mail.delivered
            ? { delivered: true as const, reason: null }
            : { delivered: false as const, reason: mail.reason },
    };
};

const getInvites = async (user: IRequestUser) =>
    prisma.teamInvite.findMany({
        where: { organization_id: user.organizationId },
        select: INVITE_FIELDS,
        orderBy: { created_at: "desc" },
    });

const revokeInvite = async (id: string, user: IRequestUser) => {
    const existing = await prisma.teamInvite.findFirst({
        where: { id, organization_id: user.organizationId },
        select: { id: true, used_at: true },
    });

    if (!existing) {
        throw new AppError(status.NOT_FOUND, "Invite not found");
    }

    if (existing.used_at) {
        throw new AppError(
            status.CONFLICT,
            "That invite has already been used. Suspend the account instead.",
        );
    }

    await prisma.teamInvite.update({ where: { id }, data: { revoked_at: new Date() } });

    return { message: "Invite revoked" };
};

/**
 * What the join page may know before sign-in: the company name and the address
 * the invite was sent to, and nothing else.
 */
const getInviteByToken = async (token: string) => {
    const invite = await prisma.teamInvite.findUnique({
        where: { token_hash: hashLinkToken(token) },
        select: {
            email: true,
            expires_at: true,
            used_at: true,
            revoked_at: true,
            organization: { select: { name: true } },
        },
    });

    // One message for expired, spent, revoked and never-existed. Which kind of
    // wrong it is helps nobody legitimate and helps somebody guessing tokens.
    if (!isOpenInvite(invite)) {
        throw new AppError(
            status.NOT_FOUND,
            "That invite link is no longer valid. Ask an admin for a new one.",
        );
    }

    return { email: invite.email, organization_name: invite.organization.name };
};

/**
 * Accept an invite: create the account, pending. No session is issued, since
 * checkAuth refuses them until an admin approves.
 */
const acceptInvite = async (token: string, payload: IAcceptInvitePayload) => {
    const tokenHash = hashLinkToken(token);

    const { member, mail } = await prisma.$transaction(async (tx) => {
        const invite = await tx.teamInvite.findUnique({
            where: { token_hash: tokenHash },
            select: {
                id: true,
                email: true,
                role: true,
                organization_id: true,
                expires_at: true,
                used_at: true,
                revoked_at: true,
            },
        });

        if (!isOpenInvite(invite)) {
            throw new AppError(
                status.NOT_FOUND,
                "That invite link is no longer valid. Ask an admin for a new one.",
            );
        }

        // Between the link being sent and opened, somebody may have signed up
        // some other way.
        const taken = await tx.user.findFirst({
            where: { email: sameEmail(invite.email) },
            select: { id: true },
        });

        if (taken) {
            throw new AppError(status.CONFLICT, "An account already exists for that address.");
        }

        const member = await tx.user.create({
            data: {
                full_name: payload.full_name,
                // From the invite, never from the form.
                email: invite.email,
                password: await passwordUtils.hashPassword(payload.password),
                role: invite.role,
                organization_id: invite.organization_id,
                status: UserStatus.pending,
                email_verified: true,
            },
            select: { id: true, full_name: true, email: true, role: true, status: true },
        });

        await tx.teamInvite.update({ where: { id: invite.id }, data: { used_at: new Date() } });

        // Attributed to the person who just joined - there is no admin in this
        // request, and "who created this account" is answered honestly by
        // naming them rather than nobody.
        await logActivity(
            tx,
            {
                entityType: "user",
                entityId: member.id,
                action: "created",
                summary: `${member.full_name} joined from an invite and is waiting for approval`,
            },
            {
                userId: member.id,
                organizationId: invite.organization_id,
                role: member.role,
                email: member.email,
                name: member.full_name,
                tokenVersion: 0,
                permissions: [],
            },
        );

        // The person who just joined is the actor, so notify() excludes them
        // and this reaches whoever can actually approve it. Without it a
        // pending member is invisible until an admin happens to open the team
        // screen, and somebody who cannot sign in will not chase it.
        const mail = await notify(
            tx,
            {
                userId: member.id,
                organizationId: invite.organization_id,
                role: member.role,
                email: member.email,
                name: member.full_name,
                tokenVersion: 0,
                permissions: [],
            },
            {
                event: NotificationEvent.member_awaiting_approval,
                title: `${member.full_name} is waiting to join`,
                body: `${member.email} accepted an invite and cannot sign in until somebody approves them.`,
                entityType: "user",
                entityId: member.id,
            }
        );

        return { member, mail };
    });

    await sendNotificationMail(mail);
    return member;
};

export const InviteService = {
    createInvite,
    getInvites,
    revokeInvite,
    getInviteByToken,
    acceptInvite,
};
