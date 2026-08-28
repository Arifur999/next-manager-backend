import status from "http-status";
import { env } from "../../../config/env.js";
import { Role } from "../../../generated/prisma/enums.js";
import AppError from "../../errorHelpers/AppError.js";
import { IRequestUser } from "../../interfaces/requestUser.interface.js";
import { prisma } from "../../lib/prisma.js";
import { jwtUtils } from "../../utils/jwt.js";
import { passwordUtils } from "../../utils/password.js";
import { IChangePasswordPayload, ILoginPayload, IRegisterPayload } from "./auth.validation.js";

// Everything the client is allowed to know about the signed-in user. Anything
// not listed here - the password hash above all - never leaves the service.
const PUBLIC_USER_FIELDS = {
    id: true,
    email: true,
    full_name: true,
    phone: true,
    avatar_url: true,
    role: true,
    is_active: true,
    email_verified: true,
    organization_id: true,
    permissions: true,
    created_at: true,
} as const;

const issueTokens = (user: { id: string; email: string; role: Role; token_version: number }) => {
    const payload = {
        userId: user.id,
        email: user.email,
        role: user.role,
        tokenVersion: user.token_version,
    };

    return {
        accessToken: jwtUtils.createToken(payload, env.ACCESS_TOKEN_SECRET, {
            expiresIn: env.ACCESS_TOKEN_EXPIRES_IN as never,
        }),
        refreshToken: jwtUtils.createToken(payload, env.REFRESH_TOKEN_SECRET, {
            expiresIn: env.REFRESH_TOKEN_EXPIRES_IN as never,
        }),
    };
};

// Signing up creates a COMPANY and its first admin together - one is meaningless
// without the other, so both happen in one transaction. Team members are
// invited from inside an agency (see the user module), never through this
// route, or anyone could self-register into a role.
const register = async (payload: IRegisterPayload) => {
    const existing = await prisma.user.findUnique({ where: { email: payload.email } });

    if (existing) {
        throw new AppError(status.CONFLICT, "An account with this email already exists");
    }

    const hashedPassword = await passwordUtils.hashPassword(payload.password);

    return prisma.$transaction(async (tx) => {
        const organization = await tx.organization.create({
            data: {
                name: payload.organization_name,
                email: payload.email,
            },
        });

        return tx.user.create({
            data: {
                full_name: payload.full_name,
                email: payload.email,
                phone: payload.phone ?? "",
                password: hashedPassword,
                role: Role.admin,
                organization_id: organization.id,
                email_verified: true,
            },
            select: PUBLIC_USER_FIELDS,
        });
    });
};

const login = async (payload: ILoginPayload) => {
    const user = await prisma.user.findUnique({ where: { email: payload.email } });

    // Deliberately the same message for "no such account" and "wrong password":
    // telling them apart turns this endpoint into a way to enumerate who has an
    // account here.
    if (!user || !(await passwordUtils.comparePassword(payload.password, user.password))) {
        throw new AppError(status.UNAUTHORIZED, "Invalid email or password");
    }

    if (!user.is_active) {
        throw new AppError(status.UNAUTHORIZED, "This account has been deactivated. Contact your administrator.");
    }

    const tokens = issueTokens(user);

    const { password: _password, ...safeUser } = user;
    void _password;

    return { ...tokens, user: safeUser };
};

const refreshToken = async (token: string | undefined) => {
    if (!token) {
        throw new AppError(status.UNAUTHORIZED, "No refresh token provided");
    }

    const verified = jwtUtils.verifyToken(token, env.REFRESH_TOKEN_SECRET);

    if (!verified.success) {
        throw new AppError(status.UNAUTHORIZED, "Invalid or expired refresh token");
    }

    const user = await prisma.user.findUnique({ where: { id: verified.decoded.userId } });

    if (!user || !user.is_active) {
        throw new AppError(status.UNAUTHORIZED, "This account is no longer active");
    }

    // The refresh token carries the same version claim as the access token, so a
    // password change invalidates both halves of the pair at once.
    if ((verified.decoded.tokenVersion ?? 0) !== user.token_version) {
        throw new AppError(status.UNAUTHORIZED, "Your password was changed. Please sign in again.");
    }

    return issueTokens(user);
};

const getMe = async (user: IRequestUser) => {
    const found = await prisma.user.findUnique({
        where: { id: user.userId },
        select: PUBLIC_USER_FIELDS,
    });

    if (!found) {
        throw new AppError(status.NOT_FOUND, "User not found");
    }

    return found;
};

const changePassword = async (payload: IChangePasswordPayload, user: IRequestUser) => {
    const found = await prisma.user.findUnique({ where: { id: user.userId } });

    if (!found) {
        throw new AppError(status.NOT_FOUND, "User not found");
    }

    if (!(await passwordUtils.comparePassword(payload.old_password, found.password))) {
        throw new AppError(status.UNAUTHORIZED, "Current password is incorrect");
    }

    await prisma.user.update({
        where: { id: user.userId },
        data: {
            password: await passwordUtils.hashPassword(payload.new_password),
            // Retires every token issued before this moment, including any open
            // session on another device. That is the point of changing it.
            token_version: { increment: 1 },
        },
    });

    return { message: "Password changed successfully. Please sign in again." };
};

export const AuthService = {
    register,
    login,
    refreshToken,
    getMe,
    changePassword,
};
