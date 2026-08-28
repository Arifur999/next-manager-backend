import rateLimit from "express-rate-limit";
import { env } from "../../config/env.js";

const isProduction = env.NODE_ENV === "production";

// Sign-in and password-reset are the routes worth guarding: they are the ones
// where guessing repeatedly pays off. Everything else gets the looser default.
//
// The limit is deliberately looser outside production. The smoke suite signs in
// as four roles on every run and locked itself out at 20 - a developer being
// throttled by their own test suite learns nothing about whether the guard
// works, and the temptation is then to delete the guard rather than the
// throttle. Production keeps the tight number, which is where it matters.
export const authRateLimit = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: isProduction ? 20 : 300,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: {
        success: false,
        message: "Too many attempts. Please try again in a few minutes.",
    },
});

export const apiRateLimit = rateLimit({
    windowMs: 60 * 1000,
    limit: 300,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: {
        success: false,
        message: "Too many requests. Please slow down.",
    },
});
