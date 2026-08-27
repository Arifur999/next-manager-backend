import rateLimit from "express-rate-limit";

// Sign-in and password-reset are the routes worth guarding: they are the ones
// where guessing repeatedly pays off. Everything else gets the looser default.
export const authRateLimit = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 20,
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
