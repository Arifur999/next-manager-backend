import { NextFunction, Request, Response } from "express";
import z from "zod";
import { Role } from "../../generated/prisma/enums.js";

const runValidation = (
    zodSchema: z.ZodType,
    req: Request,
    res: Response,
    next: NextFunction
) => {
        // Multipart forms send the JSON payload as a `data` field alongside the
        // file. Malformed JSON here is the caller's mistake, so it answers 400
        // rather than throwing - an uncaught SyntaxError becomes a 500 whose
        // body carries the parser's own message.
        if (req.body && typeof req.body.data === "string") {
            try {
                req.body = JSON.parse(req.body.data);
            } catch {
                return res.status(400).json({
                    success: false,
                    message: "Validation failed",
                    errors: [{ path: ["data"], message: "Expected valid JSON" }],
                });
            }
        }

        const parseResult = zodSchema.safeParse(req.body);

        if (!parseResult.success) {
            return res.status(400).json({
                success: false,
                message: "Validation failed",
                errors: parseResult.error.issues,
            });
        }

        // Replaced, not merged: defaults and coercions declared on the schema
        // are what the service should see.
    req.body = parseResult.data;
    next();
};

export const validateRequest = (zodSchema: z.ZodType) =>
    (req: Request, res: Response, next: NextFunction) =>
        runValidation(zodSchema, req, res, next);

/**
 * The same validation, with the schema chosen by who is asking.
 *
 * Exists because what a person may CHANGE is not always what their role may
 * REACH. Operations can open their own task and must not be able to move its
 * due date, and that is a field-level rule - a route-level gate cannot express
 * it, and burying it in the service means the refusal arrives without naming
 * the field.
 *
 * Safe only after checkAuth, which is what puts req.user there. Without a user
 * it refuses rather than guessing a schema.
 */
export const validateRequestBy = (pick: (role: Role) => z.ZodType) =>
    (req: Request, res: Response, next: NextFunction) => {
        const user = req.user;

        if (!user) {
            return res.status(401).json({ success: false, message: "Not authenticated" });
        }

        return runValidation(pick(user.role), req, res, next);
    };
