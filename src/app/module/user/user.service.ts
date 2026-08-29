import status from "http-status";
import { Prisma } from "../../../generated/prisma/client.js";
import { Role, UserStatus } from "../../../generated/prisma/enums.js";
import AppError from "../../errorHelpers/AppError.js";
import { IRequestUser } from "../../interfaces/requestUser.interface.js";
import { assertSeatAvailable } from "../../middleware/checkSubscription.js";
import { prisma } from "../../lib/prisma.js";
import { logActivity } from "../../shared/activity.js";
import { escapeLikeTerm, pageSlice, type ListOptions } from "../../shared/listQuery.js";
import { passwordUtils } from "../../utils/password.js";
import { ICreateUserPayload, IUpdateUserPayload } from "./user.validation.js";

const PUBLIC_USER_FIELDS = {
    id: true,
    email: true,
    full_name: true,
    phone: true,
    avatar_url: true,
    role: true,
    status: true,
    email_verified: true,
    permissions: true,
    created_at: true,
    updated_at: true,
} as const;

// Everyone in the caller's agency.
const getAllUsers = async (
    user: IRequestUser,
    filters: { status?: UserStatus } = {},
    options: ListOptions = {}
) => {
    const where: Prisma.UserWhereInput = {
        organization_id: user.organizationId,
        deleted_at: null,
        // Unfiltered still means everybody, pending included - the team screen
        // shows them so nobody is invisible while they wait.
        ...(filters.status ? { status: filters.status } : {}),
        ...(options.search
            ? {
                OR: [
                    { full_name: { contains: escapeLikeTerm(options.search), mode: "insensitive" } },
                    { email: { contains: escapeLikeTerm(options.search), mode: "insensitive" } },
                ],
            }
            : {}),
    };

    const slice = pageSlice(options);

    if (!slice) {
        const rows = await prisma.user.findMany({
            where,
            select: PUBLIC_USER_FIELDS,
            orderBy: { created_at: "desc" },
        });
        return { rows, total: rows.length };
    }

    const [rows, total] = await Promise.all([
        prisma.user.findMany({
            where,
            select: PUBLIC_USER_FIELDS,
            orderBy: { created_at: "desc" },
            skip: slice.skip,
            take: slice.take,
        }),
        prisma.user.count({ where }),
    ]);

    return { rows, total };
};

const getSingleUser = async (id: string, user: IRequestUser) => {
    const found = await prisma.user.findFirst({
        where: { id, organization_id: user.organizationId, deleted_at: null },
        select: PUBLIC_USER_FIELDS,
    });

    if (!found) {
        throw new AppError(status.NOT_FOUND, "User not found");
    }

    return found;
};

const createUser = async (payload: ICreateUserPayload, user: IRequestUser) => {
    // Existence only. Selecting the row would pull the password hash out of
    // the database to answer a yes/no question.
    const existing = await prisma.user.findUnique({
        where: { email: payload.email },
        select: { id: true },
    });

    if (existing) {
        throw new AppError(status.CONFLICT, "An account with this email already exists");
    }

    // Checked here rather than in a route guard: the seat count and the insert
    // belong together, and a limit enforced on the way in is a limit two admins
    // can walk past simultaneously.
    await assertSeatAvailable(user.organizationId);

    return prisma.user.create({
        data: {
            full_name: payload.full_name,
            email: payload.email,
            phone: payload.phone ?? "",
            password: await passwordUtils.hashPassword(payload.password),
            role: payload.role,
            permissions: payload.permissions ?? [],
            // The new colleague joins the caller's company, never whatever
            // organization_id a request body might have carried.
            organization_id: user.organizationId,
        },
        select: PUBLIC_USER_FIELDS,
    });
};

/**
 * How many admins a company would have left if this one stopped being one.
 *
 * With `owner` gone, `admin` is the top of a company and nothing above it can
 * put an admin back. So the last one is protected: demoting or deleting them
 * would leave a company nobody can administer, and no amount of support access
 * would fix it from inside.
 */
const assertNotLastAdmin = async (targetId: string, user: IRequestUser) => {
    const target = await prisma.user.findFirst({
        where: { id: targetId, organization_id: user.organizationId, deleted_at: null },
        select: { role: true },
    });

    if (target?.role !== Role.admin) return;

    const adminCount = await prisma.user.count({
        where: {
            organization_id: user.organizationId,
            deleted_at: null,
            status: UserStatus.active,
            role: Role.admin,
        },
    });

    if (adminCount <= 1) {
        throw new AppError(
            status.CONFLICT,
            "This is the company's only admin. Promote someone else to admin first."
        );
    }
};

const updateUser = async (id: string, payload: IUpdateUserPayload, user: IRequestUser) => {
    const existing = await prisma.user.findFirst({
        where: { id, organization_id: user.organizationId, deleted_at: null },
    });

    if (!existing) {
        throw new AppError(status.NOT_FOUND, "User not found");
    }

    // Only a change that takes admin away needs the guard - editing the last
    // admin's phone number is fine.
    const losingAdmin =
        existing.role === Role.admin &&
        ((payload.role !== undefined && payload.role !== Role.admin) ||
            payload.status === UserStatus.suspended);

    if (losingAdmin) {
        await assertNotLastAdmin(id, user);
    }

    return prisma.user.update({
        where: { id },
        data: payload,
        select: PUBLIC_USER_FIELDS,
    });
};

const deleteUser = async (id: string, user: IRequestUser) => {
    if (id === user.userId) {
        throw new AppError(status.CONFLICT, "You cannot delete your own account");
    }

    const existing = await prisma.user.findFirst({
        where: { id, organization_id: user.organizationId, deleted_at: null },
    });

    if (!existing) {
        throw new AppError(status.NOT_FOUND, "User not found");
    }

    await assertNotLastAdmin(id, user);

    // Soft delete, and deactivate in the same write: a row that is only flagged
    // deleted but still active would keep passing checkAuth.
    await prisma.$transaction(async (tx) => {
        await tx.user.update({
            where: { id },
            data: { deleted_at: new Date(), deleted_by: user.userId, status: UserStatus.suspended },
        });

        // The role is named because removing somebody is also removing an
        // access level, and "who took away the last project manager" is the
        // question this entry exists to answer.
        await logActivity(
            tx,
            {
                entityType: "user",
                entityId: id,
                action: "deleted",
                summary: `Removed ${existing.full_name} (${existing.role}) from the team`,
            },
            user
        );
    });

    return { message: "User deleted successfully" };
};

export const UserService = {
    getAllUsers,
    getSingleUser,
    createUser,
    updateUser,
    deleteUser,
};
