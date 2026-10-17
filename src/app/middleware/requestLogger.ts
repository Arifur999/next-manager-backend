import { randomUUID } from "node:crypto";
import { NextFunction, Request, Response } from "express";
import { logger } from "../lib/logger.js";
import { loggablePath } from "../shared/loggablePath.js";

// An inbound id is kept only if it is short and boring: log fields never carry
// whatever a client felt like sending.
const SAFE_ID = /^[A-Za-z0-9-]{8,64}$/;

/** Gives every request an id, returns it in x-request-id, and logs one line when it finishes. */
export const requestLogger = (req: Request, res: Response, next: NextFunction) => {
    const inbound = req.get("x-request-id");
    req.id = inbound && SAFE_ID.test(inbound) ? inbound : randomUUID();
    const startedAt = performance.now();
    res.setHeader("x-request-id", req.id);

    res.on("finish", () => {
        const fields = {
            requestId: req.id,
            method: req.method,
            // No query string or link token: either can hold a search term or a bearer token.
            path: loggablePath(req.originalUrl),
            status: res.statusCode,
            ms: Math.round(performance.now() - startedAt),
            ...(req.user ? { userId: req.user.userId, organizationId: req.user.organizationId } : {}),
        };

        if (fields.path === "/health") logger.debug("request", fields);
        else logger.info("request", fields);
    });

    next();
};
