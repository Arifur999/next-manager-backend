import status from "http-status";
import { Prisma } from "../../../generated/prisma/client.js";
import { Role, UserStatus } from "../../../generated/prisma/enums.js";
import AppError from "../../errorHelpers/AppError.js";
import { IRequestUser } from "../../interfaces/requestUser.interface.js";
import { assertSeatAvailable } from "../../shared/planLimits.js";
import { lockRow } from "../../utils/rowLock.js";
import { prisma } from "../../lib/prisma.js";
import { resolveScope } from "../../shared/resolveScope.js";
import { logActivity } from "../../shared/activity.js";
import { escapeLikeTerm, findPage, type ListOptions } from "../../shared/listQuery.js";
import { passwordUtils } from "../../utils/password.js";
import {
    ICreateUserPayload,
    IUpdateUserPayload,
} from "./user.validation.js";
import { sameEmail } from "../../shared/emailField.js";

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

/**
 * Colleagues the caller may see, from the team view scope. "assigned" is the
 * people they share a project with, "own" is only themselves, and both keep
 * the caller in the list. organization_id always sits above this.
 */
const visibilityScope = async (user: IRequestUser): Promise<Prisma.UserWhereInput> => {
    const scope = await resolveScope(user, "team", "view");

    switch (scope) {
        case "all":
            return {};
        case "assigned":
            return {
                OR: [
                    { id: user.userId },
                    { project_memberships: { some: { project: { deleted_at: null, members: { some: { user_id: user.userId } } } } } },
                ],
            };
        case "own":
            return { id: user.userId };
        case "none":
        default:
            // Matches nothing, so a colleague's id 404s as well.
            return { id: { in: [] } };
    }
};

// Everyone in the caller's agency the team view reaches.
const getAllUsers = async (
    user: IRequestUser,
    filters: { status?: UserStatus; departmentId?: string } = {},
    options: ListOptions = {}
) => {
    const where: Prisma.UserWhereInput = {
        organization_id: user.organizationId,
        deleted_at: null,
        // In AND rather than spread: the scope and the search both need an OR.
        AND: [await visibilityScope(user)],
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

    const { rows, total } = await findPage(
        options,
        (page) => prisma.user.findMany({ where, select: fields, orderBy: { created_at: "desc" }, ...page }),
        () => prisma.user.count({ where })
    );

    return { rows, total };
};

const getSingleUser = async (id: string, user: IRequestUser) => {
    const found = await prisma.user.findFirst({
        where: { id, organization_id: user.organizationId, deleted_at: null, AND: [await visibilityScope(user)] },
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
    const existing = await prisma.user.findFirst({
        where: { email: sameEmail(payload.email) },
        select: { id: true },
    });

    if (existing) {
        throw new AppError(status.CONFLICT, "An account with this email already exists");
    }

    await assertOwnDepartment(payload.department_id, user);
    const password = await passwordUtils.hashPassword(payload.password);

    // The seat count and the insert share one transaction, under a lock, so two
    // admins cannot both take the last free seat.
    return prisma.$transaction(async (tx) => {
        await assertSeatAvailable(tx, user.organizationId);

        return tx.user.create({
            data: {
                full_name: payload.full_name,
                email: payload.email,
                phone: payload.phone ?? "",
                password,
                role: payload.role,
                department_id: payload.department_id ?? null,
                // The new colleague joins the caller's company, never whatever
                // organization_id a request body might have carried.
                organization_id: user.organizationId,
            },
            select: PUBLIC_USER_FIELDS,
        });
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
const assertNotLastAdmin = async (tx: Prisma.TransactionClient, targetId: string, user: IRequestUser) => {
    // Locks every admin row first, so two admins demoting each other at once
    // are serialised and the second one sees the first change.
    await lockRow(tx, { kind: "organizationAdmins", organizationId: user.organizationId });

    const target = await tx.user.findFirst({
        where: { id: targetId, organization_id: user.organizationId, deleted_at: null },
        select: { role: true },
    });

    if (target?.role !== Role.admin) return;

    const adminCount = await tx.user.count({
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

    await assertOwnDepartment(payload.department_id, user);

    // Only a change that takes admin away needs the guard - editing the last
    // admin's phone number is fine.
    const losingAdmin =
        existing.role === Role.admin &&
        ((payload.role !== undefined && payload.role !== Role.admin) ||
            payload.status === UserStatus.suspended);

    return prisma.$transaction(async (tx) => {
        if (losingAdmin) {
            await assertNotLastAdmin(tx, id, user);
        }

        return tx.user.update({
            where: { id },
            data: payload,
            select: PUBLIC_USER_FIELDS,
        });
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

    // Soft delete, and deactivate in the same write: a row that is only flagged
    // deleted but still active would keep passing checkAuth.
    await prisma.$transaction(async (tx) => {
        await assertNotLastAdmin(tx, id, user);

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
