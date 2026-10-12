import { NextFunction, Request, Response } from "express";
import status from "http-status";
import z from "zod";
import { Role } from "../../generated/prisma/enums.js";
import AppError from "../errorHelpers/AppError.js";

const runValidation = (zodSchema: z.ZodType, req: Request, next: NextFunction) => {
    // Multipart forms send the JSON payload as a `data` field beside the file.
    // Malformed JSON there is the caller's mistake: a 400 naming the field.
    if (req.body && typeof req.body.data === "string") {
        try {
            req.body = JSON.parse(req.body.data);
        } catch {
            return next(new z.ZodError([{ code: "custom", path: ["data"], message: "Expected valid JSON", input: req.body.data }]));
        }
    }

    const parseResult = zodSchema.safeParse(req.body);

    // The global error handler turns this into the standard envelope.
    if (!parseResult.success) {
        return next(parseResult.error);
    }

    // Replaced, not merged: defaults and coercions declared on the schema
    // are what the service should see.
    req.body = parseResult.data;
    next();
};

type RequestSchemas = { body?: z.ZodType; query?: z.ZodType; params?: z.ZodType };

/**
 * Validates the body (a schema on its own) or any of body, query and params.
 * Parsed params replace req.params; parsed query lands in res.locals.query,
 * because req.query is a read-only getter in Express 5.
 */
export const validateRequest = (schemas: z.ZodType | RequestSchemas) =>
    (req: Request, res: Response, next: NextFunction) => {
        if (schemas instanceof z.ZodType) {
            return runValidation(schemas, req, next);
        }

        if (schemas.params) {
            const params = schemas.params.safeParse(req.params);
            if (!params.success) return next(params.error);
            req.params = params.data as Request["params"];
        }

        if (schemas.query) {
            const query = schemas.query.safeParse(req.query);
            if (!query.success) return next(query.error);
            res.locals.query = query.data;
        }

        if (schemas.body) {
            return runValidation(schemas.body, req, next);
        }

        next();
    };

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
    (req: Request, _res: Response, next: NextFunction) => {
        const user = req.user;

        if (!user) {
            return next(new AppError(status.UNAUTHORIZED, "Not authenticated"));
        }

        return runValidation(pick(user.role), req, next);
    };
