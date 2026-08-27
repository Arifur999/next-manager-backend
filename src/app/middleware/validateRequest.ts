import { NextFunction, Request, Response } from "express";
import z from "zod";

export const validateRequest = (zodSchema: z.ZodType) => {
    return (req: Request, res: Response, next: NextFunction) => {
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
};
