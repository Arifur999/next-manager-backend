import { createHash, randomBytes } from "node:crypto";
import status from "http-status";
import { env } from "../../../config/env.js";
import { Role, SubscriptionStatus, UserStatus } from "../../../generated/prisma/enums.js";
import AppError from "../../errorHelpers/AppError.js";
import { IRequestUser } from "../../interfaces/requestUser.interface.js";
import { agencyInviteMail, sendMail } from "../../lib/mailer.js";
import { prisma } from "../../lib/prisma.js";
import { seedLeadSources } from "../../shared/defaultLeadSources.js";
import { seedLeaveTypes } from "../../shared/defaultLeaveTypes.js";
import { seedRolePermissions } from "../../shared/defaultPermissions.js";
import { seedWorkflowStatuses } from "../../shared/defaultWorkflowStatuses.js";
import { logPlatformActivity } from "../../shared/platformActivity.js";
import { getBrand, getPlatformSettings } from "../../shared/platformSettings.js";
import { passwordUtils } from "../../utils/password.js";
import {
    IAcceptAgencyInvitePayload,
    ICreateAgencyInvitePayload,
} from "./platform.validation.js";

/**
 * Bringing an agency onto the platform.
 *
 * This is the whole job of the console: hand an agency owner a link, and they
 * arrive owning their own workspace. Everything after that happens inside their
 * agency - they add their own sales people, project managers and operations
 * team, and the platform never touches those accounts.
 *
 * Three deliberate differences from the two invites that already existed.
 *
 * **Nothing is created until the link is accepted.** An invite that is never
 * taken up would otherwise leave an empty agency on the customers list, in
 * every total, belonging to nobody.
 *
 * **The owner arrives active, not pending.** The other two invites land people
 * as `pending` because somebody already inside can vouch for them. Here there
 * is nobody inside - they are the first person in their own company - so a
 * pending owner would be waiting on an approver who does not exist. Sending the
 * invite is the vetting step.
 *
 * **They are never a platform operator.** The role is fixed to `admin` in code,
 * not taken from the request, so a link cannot be edited into one that hands
 * out the run of the platform.
 */

const DEFAULT_EXPIRY_DAYS = 14;

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

const INVITE_FIELDS = {
    id: true,
    email: true,
    company_name: true,
    trial_days: true,
    expires_at: true,
    used_at: true,
    revoked_at: true,
    created_at: true,
    plan: { select: { id: true, name: true, price_usd: true } },
} as const;

const createInvite = async (payload: ICreateAgencyInvitePayload, user: IRequestUser) => {
    const email = payload.email.toLowerCase().trim();

    const existing = await prisma.user.findUnique({
        where: { email },
        select: { id: true, role: true },
    });

    if (existing) {
        throw new AppError(
            status.CONFLICT,
            existing.role === Role.super_admin
                ? "That address belongs to somebody on your own team, so it cannot also own an agency."
                : "That address already has an account. One address cannot own two agencies."
        );
    }

    // Chosen, or whatever new sign-ups are put on. Null stays null: an agency
    // with no subscription shows up as unprovisioned rather than being quietly
    // put on the cheapest plan somebody never agreed to.
    const settings = await getPlatformSettings();
    const planId = payload.plan_id ?? settings.default_plan_id;

    if (planId) {
        const plan = await prisma.plan.findFirst({
            where: { id: planId, is_active: true },
            select: { id: true },
        });

        if (!plan) {
            throw new AppError(status.BAD_REQUEST, "That plan does not exist, or is not on sale");
        }
    }

    // Retire anything outstanding for this address. Two live links to one
    // person means the older still works after the newer is spent.
    await prisma.agencyInvite.updateMany({
        where: { email, used_at: null, revoked_at: null },
        data: { revoked_at: new Date() },
    });

    const token = randomBytes(32).toString("hex");
    const days = payload.expires_in_days ?? DEFAULT_EXPIRY_DAYS;
    const joinUrl = `${env.FRONTEND_URL.split(",")[0]}/agency-join/${token}`;
    const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
    const trialDays = payload.trial_days ?? settings.default_trial_days;

    const created = await prisma.$transaction(async (tx) => {
        const invite = await tx.agencyInvite.create({
            data: {
                email,
                company_name: payload.company_name?.trim() ?? "",
                plan_id: planId,
                trial_days: trialDays,
                token_hash: hashToken(token),
                expires_at: expiresAt,
                created_by: user.userId,
            },
            select: INVITE_FIELDS,
        });

        await logPlatformActivity(
            tx,
            {
                entityType: "company",
                entityId: invite.id,
                action: "invited",
                summary: `Invited ${email} to bring ${invite.company_name || "their agency"} onto ${invite.plan?.name ?? "no plan"}`,
            },
            user
        );

        return invite;
    });

    // Outside the transaction: mail is a call to somebody else's server and can
    // hang for as long as it likes. The invite existing without its email is
    // also the right failure - the link still works and can be sent by hand.
    const mail = await sendMail({
        to: email,
        ...agencyInviteMail(joinUrl, expiresAt, created.company_name, trialDays, await getBrand()),
    });

    return {
        invite: created,
        // Returned even when the mail went out. Mail gets filtered, and an
        // unverified sending domain reaches nobody but your own address.
        join_url: joinUrl,
        email: mail.delivered
            ? { delivered: true as const, reason: null }
            : { delivered: false as const, reason: mail.reason },
    };
};

const getInvites = async () =>
    prisma.agencyInvite.findMany({ select: INVITE_FIELDS, orderBy: { created_at: "desc" } });

const revokeInvite = async (id: string, user: IRequestUser) => {
    const existing = await prisma.agencyInvite.findUnique({
        where: { id },
        select: { id: true, email: true, used_at: true },
    });

    if (!existing) {
        throw new AppError(status.NOT_FOUND, "Invite not found");
    }

    if (existing.used_at) {
        throw new AppError(
            status.CONFLICT,
            "That invite has already been used. Suspend the agency instead."
        );
    }

    return prisma.$transaction(async (tx) => {
        await tx.agencyInvite.update({ where: { id }, data: { revoked_at: new Date() } });

        await logPlatformActivity(
            tx,
            {
                entityType: "company",
                entityId: id,
                action: "deleted",
                summary: `Revoked the agency invite to ${existing.email}`,
            },
            user
        );

        return { message: "Invite revoked" };
    });
};

/**
 * What the join page may know before anybody has signed in.
 *
 * The address, the agency name if one was agreed, and what they are being put
 * on - because somebody about to create an account is entitled to know what
 * they are agreeing to. Not who invited them, and not the token.
 */
const getInviteByToken = async (token: string) => {
    const invite = await prisma.agencyInvite.findUnique({
        where: { token_hash: hashToken(token) },
        select: {
            email: true,
            company_name: true,
            trial_days: true,
            expires_at: true,
            used_at: true,
            revoked_at: true,
            plan: { select: { name: true, price_usd: true } },
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
            "That invite link is no longer valid. Ask for a new one."
        );
    }

    return {
        email: invite.email,
        company_name: invite.company_name,
        trial_days: invite.trial_days,
        plan: invite.plan,
    };
};

/**
 * Accept: the agency, its owner and its subscription, in one transaction.
 *
 * All three or none. An owner without a workspace cannot sign in anywhere, and
 * a workspace without an owner is one nobody can ever get into.
 */
const acceptInvite = async (token: string, payload: IAcceptAgencyInvitePayload) => {
    const tokenHash = hashToken(token);
    const hashedPassword = await passwordUtils.hashPassword(payload.password);

    return prisma.$transaction(async (tx) => {
        const invite = await tx.agencyInvite.findUnique({
            where: { token_hash: tokenHash },
            select: {
                id: true,
                email: true,
                company_name: true,
                plan_id: true,
                trial_days: true,
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
                "That invite link is no longer valid. Ask for a new one."
            );
        }

        const taken = await tx.user.findUnique({
            where: { email: invite.email },
            select: { id: true },
        });

        if (taken) {
            throw new AppError(status.CONFLICT, "An account already exists for that address.");
        }

        // The name on the invite wins when there is one: that is the agency the
        // deal was agreed with, and it should not change on the way in.
        const companyName = invite.company_name || payload.company_name?.trim() || "";

        if (!companyName) {
            throw new AppError(status.BAD_REQUEST, "Your agency needs a name");
        }

        const organization = await tx.organization.create({
            data: { name: companyName, email: invite.email },
        });

        await seedLeadSources(tx, organization.id);
        await seedWorkflowStatuses(tx, organization.id);
        await seedLeaveTypes(tx, organization.id);
        await seedRolePermissions(tx, organization.id);

        const owner = await tx.user.create({
            data: {
                full_name: payload.full_name,
                email: invite.email,
                password: hashedPassword,
                // Fixed in code, never taken from the request. The whole point
                // of this flow is that it produces an agency owner and can
                // never be edited into producing a platform operator.
                role: Role.admin,
                organization_id: organization.id,
                // Active, not pending. There is nobody inside this company to
                // approve them - they are the first person in it. Sending the
                // invite was the vetting step.
                status: UserStatus.active,
                email_verified: true,
            },
            select: {
                id: true,
                full_name: true,
                email: true,
                role: true,
                status: true,
                organization_id: true,
            },
        });

        if (invite.plan_id) {
            await tx.subscription.create({
                data: {
                    organization_id: organization.id,
                    plan_id: invite.plan_id,
                    // Zero days means no trial - they start paying. Different
                    // from a trial that ends today.
                    status:
                        invite.trial_days > 0
                            ? SubscriptionStatus.trialing
                            : SubscriptionStatus.active,
                    trial_ends_at:
                        invite.trial_days > 0
                            ? new Date(Date.now() + invite.trial_days * 24 * 60 * 60 * 1000)
                            : null,
                    notes: "Created from an agency invite.",
                },
            });
        }

        await tx.agencyInvite.update({ where: { id: invite.id }, data: { used_at: new Date() } });

        await logPlatformActivity(
            tx,
            {
                entityType: "company",
                entityId: organization.id,
                action: "created",
                summary: `${owner.full_name} accepted an invite and opened ${organization.name}`,
            },
            {
                userId: owner.id,
                organizationId: organization.id,
                role: owner.role,
                email: owner.email,
                name: owner.full_name,
                tokenVersion: 0,
                permissions: [],
            }
        );

        return { organization: { id: organization.id, name: organization.name }, owner };
    });
};

export const AgencyInviteService = {
    createInvite,
    getInvites,
    revokeInvite,
    getInviteByToken,
    acceptInvite,
};
