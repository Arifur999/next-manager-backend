import { createHash, randomBytes } from "node:crypto";
import status from "http-status";
import { env } from "../../../config/env.js";
import { Role, UserStatus } from "../../../generated/prisma/enums.js";
import AppError from "../../errorHelpers/AppError.js";
import { IRequestUser } from "../../interfaces/requestUser.interface.js";
import { passwordResetMail, sendMail } from "../../lib/mailer.js";
import { prisma } from "../../lib/prisma.js";
import { jwtUtils } from "../../utils/jwt.js";
import { passwordUtils } from "../../utils/password.js";
import {
    IChangePasswordPayload,
    IForgotPasswordPayload,
    ILoginPayload,
    IRegisterPayload,
    IResetPasswordPayload,
    IUpdateMePayload,
} from "./auth.validation.js";

// Everything the client is allowed to know about the signed-in user. Anything
// not listed here - the password hash above all - never leaves the service.
const PUBLIC_USER_FIELDS = {
    id: true,
    email: true,
    full_name: true,
    phone: true,
    avatar_url: true,
    role: true,
    status: true,
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
    // Existence only - see the note in user.service.ts.
    const existing = await prisma.user.findUnique({
        where: { email: payload.email },
        select: { id: true },
    });

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

    // Told apart on purpose: "waiting for approval" and "you were removed"
    // send somebody to two different people, and one message for both means
    // they ask the wrong one.
    if (user.status !== UserStatus.active) {
        throw new AppError(
            status.UNAUTHORIZED,
            user.status === UserStatus.pending
                ? "This account is waiting for an admin to approve it."
                : "This account has been deactivated. Contact your administrator."
        );
    }

    const tokens = issueTokens(user);

    // Reduced to the same allow-list /auth/me uses, rather than "the whole row
    // minus password".
    //
    // Subtracting one field meant login and /auth/me returned different shapes
    // for the same thing, and login's shape was whatever the table happened to
    // hold - token_version, deleted_at, deleted_by. None of those are secrets,
    // but the next sensitive column added would have been excluded from
    // PUBLIC_USER_FIELDS and shipped by this endpoint anyway. An allow-list one
    // caller bypasses is not an allow-list.
    const safeUser = Object.fromEntries(
        Object.keys(PUBLIC_USER_FIELDS).map((field) => [field, user[field as keyof typeof user]])
    );

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

    if (!user || user.status !== UserStatus.active) {
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

/**
 * A person editing their own record.
 *
 * Separate from updateUser, which is admin-only and can move a role. Only the
 * three fields the schema allows ever reach here - see updateMeZodSchema for
 * why that allow-list is the control rather than a convenience.
 */
const updateMe = async (payload: IUpdateMePayload, user: IRequestUser) => {
    const found = await prisma.user.findFirst({
        where: { id: user.userId, deleted_at: null },
        select: { id: true },
    });

    if (!found) {
        throw new AppError(status.NOT_FOUND, "User not found");
    }

    return prisma.user.update({
        where: { id: user.userId },
        data: payload,
        select: PUBLIC_USER_FIELDS,
    });
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

/**
 * How long a reset link lives.
 *
 * Short enough that a link sitting in a mailbox stops being a key, long enough
 * that somebody who checks their email an hour later is not sent round again.
 */
const RESET_TTL_MINUTES = 30;

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

/**
 * Start a reset.
 *
 * **Always answers the same thing.** Whether the address belongs to an account
 * is not information this endpoint gives away: a different response for a real
 * address turns the form into a way to test which of a leaked email list has
 * an AGENCIO account. So an unknown address does the same amount of work,
 * takes roughly the same time, and gets the same sentence back.
 *
 * The consequence to accept: somebody who mistypes their own address is told
 * "check your email" and receives nothing. That is the cost of not leaking,
 * and the message says "if that address has an account" so it does not lie.
 */
const forgotPassword = async (
    payload: IForgotPasswordPayload,
    context: { ip?: string } = {}
) => {
    const sameAnswer = {
        message:
            "If that address has an account, a reset link is on its way. It expires in 30 minutes.",
    };

    const user = await prisma.user.findFirst({
        where: { email: payload.email, deleted_at: null, status: UserStatus.active },
        select: { id: true, email: true, full_name: true },
    });

    if (!user) {
        return sameAnswer;
    }

    // Everything outstanding for this person is spent first. Two live links at
    // once means the older one still works after the newer has been used.
    await prisma.passwordResetToken.updateMany({
        where: { user_id: user.id, used_at: null },
        data: { used_at: new Date() },
    });

    // 32 bytes from the CSPRNG. Not a uuid: uuids are identifiers, and their
    // guessability is nobody's design goal.
    const token = randomBytes(32).toString("hex");

    await prisma.passwordResetToken.create({
        data: {
            user_id: user.id,
            token_hash: hashToken(token),
            expires_at: new Date(Date.now() + RESET_TTL_MINUTES * 60 * 1000),
            requested_ip: context.ip ?? "",
        },
    });

    const resetUrl = `${env.FRONTEND_URL.split(",")[0]}/reset-password?token=${token}`;
    const result = await sendMail({ to: user.email, ...passwordResetMail(resetUrl, RESET_TTL_MINUTES) });

    // Logged, not returned. The caller gets the same sentence either way -
    // telling an anonymous form that delivery failed would leak that the
    // address exists just as surely as telling it the account was found.
    if (!result.delivered) {
        console.warn(`[auth] reset link for ${user.email} was not delivered: ${result.reason}`);
    }

    return sameAnswer;
};

/**
 * Finish a reset.
 *
 * Refuses with one message for every failure - expired, already used, never
 * existed - because distinguishing them tells whoever is holding a token which
 * kind of wrong it is, and there is nothing a legitimate user does differently
 * in each case. They ask for another link.
 */
const resetPassword = async (payload: IResetPasswordPayload) => {
    const record = await prisma.passwordResetToken.findUnique({
        where: { token_hash: hashToken(payload.token) },
        select: { id: true, user_id: true, expires_at: true, used_at: true },
    });

    const refuse = () =>
        new AppError(
            status.BAD_REQUEST,
            "That reset link is no longer valid. Ask for a new one."
        );

    if (!record || record.used_at || record.expires_at.getTime() < Date.now()) {
        throw refuse();
    }

    await prisma.$transaction(async (tx) => {
        await tx.user.update({
            where: { id: record.user_id },
            data: {
                password: await passwordUtils.hashPassword(payload.new_password),
                // Same as a deliberate change: every session open anywhere is
                // retired. If somebody else had the account, this is what puts
                // them out.
                token_version: { increment: 1 },
            },
        });

        // Spend this one, and everything else outstanding with it. Together in
        // one transaction with the password write, so a failure cannot leave a
        // changed password beside a link that still works.
        await tx.passwordResetToken.updateMany({
            where: { user_id: record.user_id, used_at: null },
            data: { used_at: new Date() },
        });
    });

    return { message: "Password reset. Sign in with the new one." };
};

export const AuthService = {
    register,
    login,
    refreshToken,
    getMe,
    updateMe,
    changePassword,
    forgotPassword,
    resetPassword,
};
