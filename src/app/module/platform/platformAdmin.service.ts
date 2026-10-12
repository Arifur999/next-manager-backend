import status from "http-status";
import { Role, UserStatus } from "../../../generated/prisma/enums.js";
import AppError from "../../errorHelpers/AppError.js";
import { IRequestUser } from "../../interfaces/requestUser.interface.js";
import { prisma } from "../../lib/prisma.js";
import { logPlatformActivity } from "../../shared/platformActivity.js";
import { ISetPlatformPermissionsPayload } from "./platform.validation.js";

/**
 * What the platform team has been doing.
 *
 * Read-only, like the company audit log and for the same reason: a history
 * somebody can edit answers no question worth asking. There is no update and
 * no delete here, not even for the operator who wrote the entry.
 */
export const getActivity = async (
    filters: { entityType?: string; actorId?: string },
    { page, limit }: { page: number; limit: number }
) =>
    prisma.platformActivityLog.findMany({
        where: {
            ...(filters.entityType ? { entity_type: filters.entityType } : {}),
            ...(filters.actorId ? { actor_id: filters.actorId } : {}),
        },
        select: {
            id: true,
            entity_type: true,
            entity_id: true,
            action: true,
            summary: true,
            created_at: true,
            // Null once the operator is gone - the entry outlives them.
            actor: { select: { id: true, full_name: true, email: true } },
        },
        orderBy: { created_at: "desc" },
        skip: (page - 1) * limit,
        take: limit,
    });

// ---------------------------------------------------------------------------
// The platform team
// ---------------------------------------------------------------------------

export const ADMIN_FIELDS = {
    id: true,
    full_name: true,
    email: true,
    permissions: true,
    status: true,
    created_at: true,
} as const;

export const getAdmins = async () =>
    prisma.user.findMany({
        where: { role: Role.super_admin, deleted_at: null },
        select: ADMIN_FIELDS,
        orderBy: { created_at: "asc" },
    });

/**
 * Set what one operator may do.
 *
 * An empty list means "everything", not "nothing" - that is the hatch in
 * requirePermission, and it is what keeps the first operator from locking
 * themselves out on the day this shipped. The screen has to say so, because
 * the opposite reading is the obvious one.
 *
 * Two guards, both about not stranding the platform:
 */
export const setPermissions = async (
    id: string,
    payload: ISetPlatformPermissionsPayload,
    user: IRequestUser
) => {
    const target = await prisma.user.findFirst({
        where: { id, role: Role.super_admin, deleted_at: null },
        select: { id: true, full_name: true, email: true, permissions: true },
    });

    if (!target) {
        throw new AppError(status.NOT_FOUND, "Platform admin not found");
    }

    const nextGrantsAdminManage =
        payload.permissions.length === 0 || payload.permissions.includes("platform.admins.manage");

    if (!nextGrantsAdminManage) {
        // Somebody has to be able to hand permissions out. If this change would
        // leave nobody who can, the platform is stuck with whatever it has -
        // and the fix would be a database edit.
        const others = await prisma.user.count({
            where: {
                role: Role.super_admin,
                deleted_at: null,
                // Active only. A suspended operator cannot sign in, so counting
                // one as somebody who can hand permissions out would strand the
                // platform behind an account nobody can use.
                status: UserStatus.active,
                id: { not: id },
                OR: [
                    { permissions: { isEmpty: true } },
                    { permissions: { has: "platform.admins.manage" } },
                ],
            },
        });

        if (others === 0) {
            throw new AppError(
                status.CONFLICT,
                "This is the only account that can manage the platform team. Give somebody else that permission first."
            );
        }
    }

    return prisma.$transaction(async (tx) => {
        const updated = await tx.user.update({
            where: { id },
            data: { permissions: payload.permissions },
            select: ADMIN_FIELDS,
        });

        await logPlatformActivity(
            tx,
            {
                entityType: "admin",
                entityId: id,
                action: "updated",
                summary:
                    payload.permissions.length === 0
                        ? `Gave ${target.full_name} full access`
                        : `Set ${target.full_name}'s access to: ${payload.permissions.join(", ")}`,
            },
            user
        );

        return updated;
    });
};
