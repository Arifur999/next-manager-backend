import { createHash, randomBytes } from "node:crypto";
import status from "http-status";
import { env } from "../../../config/env.js";
import { Role, UserStatus } from "../../../generated/prisma/enums.js";
import AppError from "../../errorHelpers/AppError.js";
import { IRequestUser } from "../../interfaces/requestUser.interface.js";
import { prisma } from "../../lib/prisma.js";
import { logPlatformActivity } from "../../shared/platformActivity.js";
import { passwordUtils } from "../../utils/password.js";
import {
    IAcceptPlatformInvitePayload,
    ICreatePlatformInvitePayload,
} from "./platform.validation.js";

/**
 * Growing the platform team.
 *
 * The same shape as the operations join flow, and deliberately no looser: an
 * invite is sent, the person sets their own password, they land `pending`, and
 * an existing operator approves.
 *
 * The two-step matters more here, not less. A platform admin sees every
 * customer and can suspend any of them, so a link that leaks must not by
 * itself create somebody able to cut off a paying company. Approval is the
 * step that happens after you can see who actually turned up.
 */

const DEFAULT_EXPIRY_DAYS = 7;

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

const INVITE_FIELDS = {
    id: true,
    email: true,
    permissions: true,
    expires_at: true,
    used_at: true,
    revoked_at: true,
    created_at: true,
} as const;

const createInvite = async (payload: ICreatePlatformInvitePayload, user: IRequestUser) => {
    const email = payload.email.toLowerCase().trim();

    const existing = await prisma.user.findUnique({
        where: { email },
        select: { id: true, role: true },
    });

    if (existing) {
        throw new AppError(
            status.CONFLICT,
            existing.role === Role.super_admin
                ? "That person is already on the platform team."
                : "That email belongs to a customer account and cannot also be a platform operator.",
        );
    }

    // Retire anything outstanding for this address. Two live links to one
    // person means the older still works after the newer is spent.
    await prisma.platformInvite.updateMany({
        where: { email, used_at: null, revoked_at: null },
        data: { revoked_at: new Date() },
    });

    const token = randomBytes(32).toString("hex");
    const days = payload.expires_in_days ?? DEFAULT_EXPIRY_DAYS;

    return prisma.$transaction(async (tx) => {
        const invite = await tx.platformInvite.create({
            data: {
                email,
                permissions: payload.permissions ?? [],
                token_hash: hashToken(token),
                expires_at: new Date(Date.now() + days * 24 * 60 * 60 * 1000),
                created_by: user.userId,
            },
            select: INVITE_FIELDS,
        });

        await logPlatformActivity(
            tx,
            {
                entityType: "admin",
                entityId: invite.id,
                action: "invited",
                summary:
                    payload.permissions && payload.permissions.length > 0
                        ? `Invited ${email} to the platform team with: ${payload.permissions.join(", ")}`
                        : `Invited ${email} to the platform team with full access`,
            },
            user,
        );

        return {
            invite,
            // The only time this is readable. Nothing stores the token itself.
            join_url: `${env.FRONTEND_URL.split(",")[0]}/platform-join/${token}`,
        };
    });
};

const getInvites = async () =>
    prisma.platformInvite.findMany({ select: INVITE_FIELDS, orderBy: { created_at: "desc" } });

const revokeInvite = async (id: string, user: IRequestUser) => {
    const existing = await prisma.platformInvite.findUnique({
        where: { id },
        select: { id: true, email: true, used_at: true },
    });

    if (!existing) {
        throw new AppError(status.NOT_FOUND, "Invite not found");
    }

    if (existing.used_at) {
        throw new AppError(
            status.CONFLICT,
            "That invite has already been used. Remove the account instead.",
        );
    }

    return prisma.$transaction(async (tx) => {
        await tx.platformInvite.update({ where: { id }, data: { revoked_at: new Date() } });

        await logPlatformActivity(
            tx,
            {
                entityType: "admin",
                entityId: id,
                action: "deleted",
                summary: `Revoked the platform invite to ${existing.email}`,
            },
            user,
        );

        return { message: "Invite revoked" };
    });
};

/**
 * What the join page may know before anybody has signed in.
 *
 * The address it was sent to, and nothing else - not who sent it, not what
 * access it carries. Somebody guessing tokens learns only whether one was
 * right, which the single refusal message below already limits.
 */
const getInviteByToken = async (token: string) => {
    const invite = await prisma.platformInvite.findUnique({
        where: { token_hash: hashToken(token) },
        select: { email: true, expires_at: true, used_at: true, revoked_at: true },
    });

    if (
        !invite ||
        invite.used_at ||
        invite.revoked_at ||
        invite.expires_at.getTime() < Date.now()
    ) {
        throw new AppError(
            status.NOT_FOUND,
            "That invite link is no longer valid. Ask for a new one.",
        );
    }

    return { email: invite.email };
};

/**
 * Accept: create the operator, pending.
 *
 * No session is issued. They cannot pass checkAuth until approved, so handing
 * them tokens would hand them tokens that do nothing.
 */
const acceptInvite = async (token: string, payload: IAcceptPlatformInvitePayload) => {
    const tokenHash = hashToken(token);

    return prisma.$transaction(async (tx) => {
        const invite = await tx.platformInvite.findUnique({
            where: { token_hash: tokenHash },
            select: {
                id: true,
                email: true,
                permissions: true,
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
                "That invite link is no longer valid. Ask for a new one.",
            );
        }

        const taken = await tx.user.findUnique({
            where: { email: invite.email },
            select: { id: true },
        });

        if (taken) {
            throw new AppError(status.CONFLICT, "An account already exists for that address.");
        }

        const operator = await tx.user.create({
            data: {
                full_name: payload.full_name,
                email: invite.email,
                password: await passwordUtils.hashPassword(payload.password),
                role: Role.super_admin,
                // A platform operator belongs to no company. Same as the
                // seeded one.
                organization_id: null,
                permissions: invite.permissions,
                status: UserStatus.pending,
                email_verified: true,
            },
            select: { id: true, full_name: true, email: true, role: true, status: true },
        });

        await tx.platformInvite.update({ where: { id: invite.id }, data: { used_at: new Date() } });

        await logPlatformActivity(
            tx,
            {
                entityType: "admin",
                entityId: operator.id,
                action: "created",
                summary: `${operator.full_name} accepted a platform invite and is waiting for approval`,
            },
            {
                userId: operator.id,
                organizationId: "",
                role: operator.role,
                email: operator.email,
                name: operator.full_name,
                tokenVersion: 0,
                permissions: invite.permissions,
            },
        );

        return operator;
    });
};

const approveAdmin = async (id: string, user: IRequestUser) => {
    const pending = await prisma.user.findFirst({
        where: {
            id,
            role: Role.super_admin,
            status: UserStatus.pending,
            deleted_at: null,
        },
        select: { id: true, full_name: true, email: true },
    });

    if (!pending) {
        throw new AppError(status.NOT_FOUND, "No pending platform admin found");
    }

    return prisma.$transaction(async (tx) => {
        const approved = await tx.user.update({
            where: { id },
            data: { status: UserStatus.active },
            select: { id: true, full_name: true, email: true, status: true, permissions: true },
        });

        await logPlatformActivity(
            tx,
            {
                entityType: "admin",
                entityId: id,
                action: "status_changed",
                summary: `Approved ${pending.full_name} as a platform operator`,
            },
            user,
        );

        return approved;
    });
};

/**
 * Remove an operator.
 *
 * Two guards, both about not stranding the platform: nobody removes
 * themselves, and the last active operator cannot be removed at all. Either
 * would leave the console with no way in and the fix would be a database edit.
 */
const removeAdmin = async (id: string, user: IRequestUser) => {
    if (id === user.userId) {
        throw new AppError(status.CONFLICT, "You cannot remove your own account.");
    }

    const target = await prisma.user.findFirst({
        where: { id, role: Role.super_admin, deleted_at: null },
        select: { id: true, full_name: true, status: true },
    });

    if (!target) {
        throw new AppError(status.NOT_FOUND, "Platform admin not found");
    }

    const remaining = await prisma.user.count({
        where: {
            role: Role.super_admin,
            deleted_at: null,
            status: UserStatus.active,
            id: { not: id },
        },
    });

    if (remaining === 0) {
        throw new AppError(
            status.CONFLICT,
            "This is the last active platform operator. Removing it would leave nobody able to sign in.",
        );
    }

    return prisma.$transaction(async (tx) => {
        await tx.user.update({
            where: { id },
            data: {
                status: UserStatus.suspended,
                deleted_at: new Date(),
                deleted_by: user.userId,
            },
        });

        await logPlatformActivity(
            tx,
            {
                entityType: "admin",
                entityId: id,
                action: "deleted",
                summary: `Removed ${target.full_name} from the platform team`,
            },
            user,
        );

        return { message: "Platform admin removed" };
    });
};

export const PlatformInviteService = {
    createInvite,
    getInvites,
    revokeInvite,
    getInviteByToken,
    acceptInvite,
    approveAdmin,
    removeAdmin,
};
