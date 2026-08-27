import status from "http-status";
import { Prisma } from "../../../generated/prisma/client.js";
import AppError from "../../errorHelpers/AppError.js";
import { IRequestUser } from "../../interfaces/requestUser.interface.js";
import { prisma } from "../../lib/prisma.js";
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
    is_active: true,
    email_verified: true,
    permissions: true,
    created_at: true,
    updated_at: true,
} as const;

// Team members of the caller's workspace. The owner themselves is excluded -
// they are not a row anyone manages from this screen.
const getAllUsers = async (user: IRequestUser, options: ListOptions = {}) => {
    const where: Prisma.UserWhereInput = {
        owner_id: user.ownerId,
        deleted_at: null,
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
        where: { id, owner_id: user.ownerId, deleted_at: null },
        select: PUBLIC_USER_FIELDS,
    });

    if (!found) {
        throw new AppError(status.NOT_FOUND, "User not found");
    }

    return found;
};

const createUser = async (payload: ICreateUserPayload, user: IRequestUser) => {
    const existing = await prisma.user.findUnique({ where: { email: payload.email } });

    if (existing) {
        throw new AppError(status.CONFLICT, "An account with this email already exists");
    }

    return prisma.user.create({
        data: {
            full_name: payload.full_name,
            email: payload.email,
            phone: payload.phone ?? "",
            password: await passwordUtils.hashPassword(payload.password),
            role: payload.role,
            permissions: payload.permissions ?? [],
            // The new member belongs to the caller's workspace, never to whatever
            // owner_id a request body might have carried.
            owner_id: user.ownerId,
        },
        select: PUBLIC_USER_FIELDS,
    });
};

const updateUser = async (id: string, payload: IUpdateUserPayload, user: IRequestUser) => {
    const existing = await prisma.user.findFirst({
        where: { id, owner_id: user.ownerId, deleted_at: null },
    });

    if (!existing) {
        throw new AppError(status.NOT_FOUND, "User not found");
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
        where: { id, owner_id: user.ownerId, deleted_at: null },
    });

    if (!existing) {
        throw new AppError(status.NOT_FOUND, "User not found");
    }

    // Soft delete, and deactivate in the same write: a row that is only flagged
    // deleted but still `is_active` would keep passing checkAuth.
    await prisma.user.update({
        where: { id },
        data: { deleted_at: new Date(), deleted_by: user.userId, is_active: false },
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
