import { NextFunction, Request, Response } from "express";
import status from "http-status";
import AppError from "../errorHelpers/AppError.js";

/**
 * The caller must belong to a company. Goes after `checkAuth()` (anyone signed
 * in) on routes that touch tenant data: the platform operator's organizationId
 * is empty, and relying on every query's organization_id filter to turn that
 * into an empty list is safe only until one query forgets it.
 *
 * Not needed where checkAuth names roles, and not used on the /auth/me and
 * change-password routes, which are about the person and the operator needs.
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
