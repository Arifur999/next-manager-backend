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
    // Production stays tight - 20 attempts in fifteen minutes is a password
    // guesser, not a person. Development does not: one smoke run signs in as a
    // dozen accounts, and three runs inside the window tripped this and made
    // every check after the trip fail for a reason that had nothing to do with
    // the code. Same reasoning as the api limiter below.
    limit: isProduction ? 20 : 3000,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: {
        success: false,
        message: "Too many attempts. Please try again in a few minutes.",
    },
});

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
