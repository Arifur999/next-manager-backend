import { NextFunction, Request, Response } from "express";
import status from "http-status";
import AppError from "../errorHelpers/AppError.js";

/**
 * This route reads or writes a company's own data, so the caller must belong
 * to one.
 *
 * Sits after `checkAuth()` - the no-arguments form that means "anyone signed
 * in" - on every route that touches tenant data. `checkAuth()` was letting the
 * platform operator through, and their `organizationId` is an empty string, so
 * a scoped query matched nothing and they got a 200 with an empty array.
 *
 * That was safe by accident, not by decision. Nothing broke only because every
 * one of those queries remembered to filter by organization_id; the day one
 * forgets, the empty string stops protecting anything and the operator sees
 * every tenant at once. A 403 that states the rule does not depend on that.
 *
 * Not needed on routes that name their roles - `checkAuth(Role.admin)` already
 * excludes the operator - and deliberately NOT applied to /auth/me,
 * /auth/change-password or PATCH /auth/me, which are about the person rather
 * than a company and which the operator legitimately needs.
 */
export const requireCompany = (req: Request, _res: Response, next: NextFunction) => {
    const user = req.user;

    if (!user) {
        return next(new AppError(status.UNAUTHORIZED, "Not authenticated"));
    }

    if (!user.organizationId) {
        return next(
            new AppError(
                status.FORBIDDEN,
                "This account belongs to no company, so there is no data here to read."
            )
        );
    }

    return next();
};
