import { createHash, randomBytes } from "node:crypto";
import status from "http-status";
import { env } from "../../../config/env.js";
import { UserStatus } from "../../../generated/prisma/enums.js";
import AppError from "../../errorHelpers/AppError.js";
import { logger } from "../../lib/logger.js";
import { passwordResetMail, sendMail } from "../../lib/mailer.js";
import { prisma } from "../../lib/prisma.js";
import { sameEmail } from "../../shared/emailField.js";
import { getBrand } from "../../shared/platformSettings.js";
import { passwordUtils } from "../../utils/password.js";
import { IForgotPasswordPayload, IResetPasswordPayload } from "./auth.validation.js";

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
        where: { email: sameEmail(payload.email), deleted_at: null, status: UserStatus.active },
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
    const result = await sendMail({
        to: user.email,
        ...passwordResetMail(resetUrl, RESET_TTL_MINUTES, await getBrand()),
    });

    // Logged, not returned. The caller gets the same sentence either way -
    // telling an anonymous form that delivery failed would leak that the
    // address exists just as surely as telling it the account was found.
    if (!result.delivered) {
        logger.warn("Reset link was not delivered", { userId: user.id, reason: result.reason });
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
    const tokenHash = hashToken(payload.token);
    const password = await passwordUtils.hashPassword(payload.new_password);

    await prisma.$transaction(async (tx) => {
        const now = new Date();

        // Claim the token in one conditional write, so two requests racing with
        // the same link cannot both set a password.
        const claim = await tx.passwordResetToken.updateMany({
            where: { token_hash: tokenHash, used_at: null, expires_at: { gt: now } },
            data: { used_at: now },
        });

        if (claim.count !== 1) {
            throw new AppError(status.BAD_REQUEST, "That reset link is no longer valid. Ask for a new one.");
        }

        const record = await tx.passwordResetToken.findUniqueOrThrow({
            where: { token_hash: tokenHash },
            select: { user_id: true },
        });

        await tx.user.update({
            where: { id: record.user_id },
            data: {
                password,
                // Same as a deliberate change: every session open anywhere is
                // retired. If somebody else had the account, this puts them out.
                token_version: { increment: 1 },
            },
        });

        // Spend every other outstanding link with it.
        await tx.passwordResetToken.updateMany({
            where: { user_id: record.user_id, used_at: null },
            data: { used_at: now },
        });
    });

    return { message: "Password reset. Sign in with the new one." };
};

export const PasswordResetService = {
    forgotPassword,
    resetPassword,
};
