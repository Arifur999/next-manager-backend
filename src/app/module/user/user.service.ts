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
import {
    ICreateUserPayload,
    ISetUserPermissionsPayload,
    IUpdateUserPayload,
} from "./user.validation.js";

/**
 * What a directory shows.
 *
 * Deliberately narrower than PUBLIC_USER_FIELDS below: no permissions, no
 * status, no email_verified. Who is allowed to do what is a management fact,
 * not a contact detail, and handing every salesperson the whole permission
 * map of every colleague is a bigger answer than the question deserves.
 *
 * Kept as its own object rather than a runtime `delete` on the other one, so
 * a field added there does not silently appear here too.
 */
const DIRECTORY_FIELDS = {
    id: true,
    email: true,
    full_name: true,
    phone: true,
    avatar_url: true,
    role: true,
    department: { select: { id: true, name: true } },
} as const;

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
    // The name travels with the person. A department id alone would make
    // every screen that lists people fetch the whole list to render one word.
    department: { select: { id: true, name: true } },
    created_at: true,
    updated_at: true,
} as const;

// Everyone in the caller's agency.
const getAllUsers = async (
    user: IRequestUser,
    filters: { status?: UserStatus; departmentId?: string } = {},
    options: ListOptions = {}
) => {
    const where: Prisma.UserWhereInput = {
        organization_id: user.organizationId,
        deleted_at: null,
        // Unfiltered still means everybody, pending included - the team screen
        // shows them so nobody is invisible while they wait.
        ...(filters.status ? { status: filters.status } : {}),
        ...(filters.departmentId ? { department_id: filters.departmentId } : {}),
        ...(options.search
            ? {
                OR: [
                    { full_name: { contains: escapeLikeTerm(options.search), mode: "insensitive" } },
                    { email: { contains: escapeLikeTerm(options.search), mode: "insensitive" } },
                ],
            }
            : {}),
    };

    // Admin and the project manager run the team and get the management view.
    // Everybody else gets the directory - which is the whole reason this route
    // could be opened to sales at all.
    const fields =
        user.role === Role.admin || user.role === Role.project_manager
            ? PUBLIC_USER_FIELDS
            : DIRECTORY_FIELDS;

    const slice = pageSlice(options);

    if (!slice) {
        const rows = await prisma.user.findMany({
            where,
            select: fields,
            orderBy: { created_at: "desc" },
        });
        return { rows, total: rows.length };
    }

    const [rows, total] = await Promise.all([
        prisma.user.findMany({
            where,
            select: fields,
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
    await assertOwnDepartment(payload.department_id, user);

    return prisma.user.create({
        data: {
            full_name: payload.full_name,
            email: payload.email,
            phone: payload.phone ?? "",
            password: await passwordUtils.hashPassword(payload.password),
            role: payload.role,
            permissions: payload.permissions ?? [],
            department_id: payload.department_id ?? null,
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


/**
 * A department id arriving in a request is checked against the caller's own
 * agency before it is stored.
 *
 * The foreign key only proves the row exists. Without this, one agency could
 * file its people under another agency's department - and every report cut by
 * department would then quietly include somebody else's team.
 */
const assertOwnDepartment = async (departmentId: string | null | undefined, user: IRequestUser) => {
    if (!departmentId) return;

    const department = await prisma.department.findFirst({
        where: { id: departmentId, organization_id: user.organizationId },
        select: { id: true },
    });

    if (!department) {
        throw new AppError(status.NOT_FOUND, "Department not found");
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

    await assertOwnDepartment(payload.department_id, user);

    return prisma.user.update({
        where: { id },
        data: payload,
        select: PUBLIC_USER_FIELDS,
    });
};

/**
 * What this colleague may do inside their role.
 *
 * Empty means everything the role allows - the state everybody starts in, and
 * the reason turning this layer on changed nothing for anybody. Ticking a box
 * flips them from "everything" to "only these", which reads backwards unless
 * the screen says it, so the screen says it.
 *
 * Not offered for admins. requirePermission lets an admin past every check by
 * design, so storing a list against one would look like a restriction and
 * enforce nothing.
 */
const setPermissions = async (
    id: string,
    payload: ISetUserPermissionsPayload,
    user: IRequestUser
) => {
    const target = await prisma.user.findFirst({
        where: { id, organization_id: user.organizationId, deleted_at: null },
        select: { id: true, full_name: true, role: true },
    });

    if (!target) {
        throw new AppError(status.NOT_FOUND, "User not found");
    }

    if (target.role === Role.admin) {
        throw new AppError(
            status.BAD_REQUEST,
            "An admin already passes every check. Change their role first if you want to limit them."
        );
    }

    return prisma.$transaction(async (tx) => {
        const updated = await tx.user.update({
            where: { id },
            data: { permissions: payload.permissions },
            select: PUBLIC_USER_FIELDS,
        });

        await logActivity(
            tx,
            {
                entityType: "user",
                entityId: id,
                action: "updated",
                summary:
                    payload.permissions.length === 0
                        ? `Gave ${target.full_name} everything their role allows`
                        : `Limited ${target.full_name} to: ${payload.permissions.join(", ")}`,
            },
            user
        );

        return updated;
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
    setPermissions,
};
