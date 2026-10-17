import { NextFunction, Request, Response } from "express";
import status from "http-status";
import { Role } from "../../generated/prisma/enums.js";
import AppError from "../errorHelpers/AppError.js";

/**
 * Narrows what a platform operator may do inside their role, by named
 * permission (`platform.plans.manage` and the rest). Company routes use
 * requireScope and the permission grid instead; these names are not an
 * agency's to configure. Always after checkAuth, so it can only narrow.
 *
 * Holding any one of the given names is enough. An operator with no stored
 * permissions passes, so the first operator is never locked out of the console
 * that hands permissions out.
 */
export const requirePermission = (...allowed: string[]) =>
    (req: Request, _res: Response, next: NextFunction) => {
        const user = req.user;

        if (!user) {
            return next(new AppError(status.UNAUTHORIZED, "Unauthorized access! No user on the request."));
        }

        // A company admin always passes, so the rule does not depend on which
        // routes happen to use this. super_admin is deliberately not bypassed:
        // splitting a platform team's duties is what these checks are for.
        if (user.role === Role.admin) {
            return next();
        }

        const granted = user.permissions ?? [];
        if (granted.length === 0) {
            return next();
        }

        if (allowed.some((permission) => granted.includes(permission))) {
            return next();
        }

        // Names the missing permission: the caller is a signed-in colleague, and
        // knowing which box to ask for beats reporting the app as broken.
        return next(
            new AppError(
                status.FORBIDDEN,
                `You do not have permission for this action. Ask the owner to enable: ${allowed.join(" or ")}.`
            )
        );
    };
