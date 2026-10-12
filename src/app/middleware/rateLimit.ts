import rateLimit, { ipKeyGenerator, type Options } from "express-rate-limit";
import { env } from "../../config/env.js";

const isProduction = env.NODE_ENV === "production";

// Guessing routes get tight limits in production and loose ones elsewhere, so
// the smoke suite is not throttled by its own sign-ins. Each kind of route has
// its own bucket: vault reveals from one office IP must not block sign-in.
const FIFTEEN_MINUTES = 15 * 60 * 1000;

const attemptLimit = (productionLimit: number, keyGenerator?: Options["keyGenerator"]) =>
    rateLimit({
        windowMs: FIFTEEN_MINUTES,
        // 20 attempts in fifteen minutes is a password guesser, not a person.
        // Development stays loose: one smoke run signs in as a dozen accounts.
        limit: isProduction ? productionLimit : 3000,
        standardHeaders: "draft-7",
        legacyHeaders: false,
        keyGenerator,
        message: {
            success: false,
            message: "Too many attempts. Please try again in a few minutes.",
        },
    });

/** Login, register, forgot and reset password. */
export const authRateLimit = attemptLimit(20);

/** Looking up and accepting invite tokens. */
export const inviteTokenRateLimit = attemptLimit(20);

/** Signed-in actions worth throttling (vault reveal, rate refresh), per user. */
export const sensitiveActionRateLimit = attemptLimit(20, (req) => req.user?.userId ?? ipKeyGenerator(req.ip ?? ""));

/** Refreshing the access token. Browsers do this on their own, so it is looser. */
export const refreshRateLimit = attemptLimit(60);

// Same reasoning as above, now that the smoke suite has outgrown 300 requests
// a minute: a single full run trips this and every check after the trip fails
// with a rate-limit message rather than a real result, which is worse than
// useless - it looks like 26 broken features.
//
// Production keeps 300/min. That is the number that has to be right.
export const apiRateLimit = rateLimit({
    windowMs: 60 * 1000,
    limit: isProduction ? 300 : 3000,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: {
        success: false,
        message: "Too many requests. Please slow down.",
    },
});
