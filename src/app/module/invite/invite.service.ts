import { createHash, randomBytes } from "node:crypto";
import status from "http-status";
import { env } from "../../../config/env.js";
import { NotificationEvent, Role, UserStatus } from "../../../generated/prisma/enums.js";
import AppError from "../../errorHelpers/AppError.js";
import { IRequestUser } from "../../interfaces/requestUser.interface.js";
import { prisma } from "../../lib/prisma.js";
import { assertSeatAvailable } from "../../middleware/checkSubscription.js";
import { logActivity } from "../../shared/activity.js";
import { notify } from "../../shared/notify.js";
import { passwordUtils } from "../../utils/password.js";
import {
    IAcceptInvitePayload,
    ICreateInvitePayload,
    IRejectMemberPayload,
} from "./invite.validation.js";

/**
 * Joining a company as an operations member.
 *
 * Admin sends a link → the person sets their own name and password → they land
 * as `pending` → admin approves.
 *
 * Two admin actions rather than one, deliberately. A link that leaks does not
 * by itself let a stranger in, because admission is still a separate decision
 * taken after somebody can see who actually turned up.
 *
 * The token is hashed in the database, exactly like a password reset. This
 * table read from a backup would otherwise be a set of working keys into live
 * companies.
 */

const DEFAULT_EXPIRY_DAYS = 7;

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

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
 * Create an invite and return the link.
 *
 * The token is returned exactly once, here. Nothing can read it back
 * afterwards - only its hash is stored - so an admin who loses the link
 * revokes it and sends another rather than looking it up.
 */
const createInvite = async (payload: ICreateInvitePayload, user: IRequestUser) => {
    const email = payload.email.toLowerCase().trim();

    const existingUser = await prisma.user.findUnique({
        where: { email },
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

    const token = randomBytes(32).toString("hex");
    const days = payload.expires_in_days ?? DEFAULT_EXPIRY_DAYS;

    const invite = await prisma.teamInvite.create({
        data: {
            organization_id: user.organizationId,
            email,
            role: Role.operations,
            token_hash: hashToken(token),
            expires_at: new Date(Date.now() + days * 24 * 60 * 60 * 1000),
            created_by: user.userId,
        },
        select: INVITE_FIELDS,
    });

    return {
        invite,
        // The only time this exists in a response.
        join_url: `${env.FRONTEND_URL.split(",")[0]}/join/${token}`,
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
 * What the join page may know before anybody has signed in.
 *
 * The company name and the address the invite was sent to, and nothing else.
 * Enough to show "Join Bright Pixel" so the person knows they are in the right
 * place; not enough to enumerate customers by guessing tokens.
 */
const getInviteByToken = async (token: string) => {
    const invite = await prisma.teamInvite.findUnique({
        where: { token_hash: hashToken(token) },
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
    if (
        !invite ||
        invite.used_at ||
        invite.revoked_at ||
        invite.expires_at.getTime() < Date.now()
    ) {
        throw new AppError(
            status.NOT_FOUND,
            "That invite link is no longer valid. Ask an admin for a new one.",
        );
    }

    return { email: invite.email, organization_name: invite.organization.name };
};

/**
 * Accept an invite: create the account, pending.
 *
 * No tokens are issued and nothing is signed in. The person cannot get past
 * checkAuth until an admin approves, which is the point of the flow, so
 * handing them a session here would be a session that does nothing.
 */
const acceptInvite = async (token: string, payload: IAcceptInvitePayload) => {
    const tokenHash = hashToken(token);

    return prisma.$transaction(async (tx) => {
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

        if (
            !invite ||
            invite.used_at ||
            invite.revoked_at ||
            invite.expires_at.getTime() < Date.now()
        ) {
            throw new AppError(
                status.NOT_FOUND,
                "That invite link is no longer valid. Ask an admin for a new one.",
            );
        }

        // Between the link being sent and opened, somebody may have signed up
        // some other way.
        const taken = await tx.user.findUnique({
            where: { email: invite.email },
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
        await notify(
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

        return member;
    });
};

const findPendingMember = async (id: string, user: IRequestUser) => {
    const member = await prisma.user.findFirst({
        where: {
            id,
            organization_id: user.organizationId,
            deleted_at: null,
            status: UserStatus.pending,
        },
        select: { id: true, full_name: true, email: true, role: true },
    });

    if (!member) {
        throw new AppError(status.NOT_FOUND, "No pending request found for that person");
    }

    return member;
};

/**
 * Let somebody in.
 *
 * **This is where the seat is charged**, not at invite time. A pending person
 * has no access, so billing for them would be billing for nothing - and it
 * would let anybody holding a link exhaust the company's plan.
 */
const approveMember = async (id: string, user: IRequestUser) => {
    const member = await findPendingMember(id, user);

    await assertSeatAvailable(user.organizationId);

    return prisma.$transaction(async (tx) => {
        const approved = await tx.user.update({
            where: { id },
            data: { status: UserStatus.active },
            select: { id: true, full_name: true, email: true, role: true, status: true },
        });

        await logActivity(
            tx,
            {
                entityType: "user",
                entityId: id,
                action: "status_changed",
                summary: `Approved ${member.full_name} as ${member.role}`,
            },
            user,
        );

        return approved;
    });
};

/**
 * Turn somebody down.
 *
 * Soft-deleted and suspended together, the same as removing a member: a row
 * flagged deleted but still active would keep passing checkAuth. The account
 * is kept rather than erased so a second request from the same person is
 * visibly a second request.
 */
const rejectMember = async (id: string, payload: IRejectMemberPayload, user: IRequestUser) => {
    const member = await findPendingMember(id, user);

    await prisma.$transaction(async (tx) => {
        await tx.user.update({
            where: { id },
            data: {
                status: UserStatus.suspended,
                deleted_at: new Date(),
                deleted_by: user.userId,
            },
        });

        await logActivity(
            tx,
            {
                entityType: "user",
                entityId: id,
                action: "deleted",
                summary: payload.reason
                    ? `Turned down ${member.full_name}'s request: ${payload.reason}`
                    : `Turned down ${member.full_name}'s request to join`,
            },
            user,
        );
    });

    return { message: "Request turned down" };
};

export const InviteService = {
    createInvite,
    getInvites,
    revokeInvite,
    getInviteByToken,
    acceptInvite,
    approveMember,
    rejectMember,
};
