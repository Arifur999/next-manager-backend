import { NextFunction, Request, Response } from "express";
import status from "http-status";
import { Role } from "../../generated/prisma/enums.js";
import AppError from "../errorHelpers/AppError.js";

/**
 * Narrows what a team member may do WITHIN the role checkAuth already allowed.
 *
 * Always sits after checkAuth on a route, never instead of it: the role gate is
 * the outer boundary and this cannot widen it. A route that is owner-and-manager
 * only stays owner-and-manager only however the checkboxes are set.
 *
 * Two deliberate escape hatches, both of which make this safe to turn on for a
 * system that already has users:
 *
 *   - An owner always passes. Locking an owner out of their own workspace with a
 *     checkbox is never the intent and there would be no way back.
 *   - A user with NO permissions stored passes. Every existing team member has
 *     an empty column on the morning of the upgrade, so nobody loses access to
 *     anything they had yesterday. Restrictions begin only once somebody has
 *     actually ticked boxes for that user.
 *
 * Several names may be given, and holding ANY of them is enough.
 */
export const requirePermission = (...allowed: string[]) =>
    (req: Request, _res: Response, next: NextFunction) => {
        const user = req.user;

        if (!user) {
            return next(new AppError(status.UNAUTHORIZED, "Unauthorized access! No user on the request."));
        }

        if (user.role === Role.owner || user.role === Role.super_admin) {
            return next();
        }

        const granted = user.permissions ?? [];
        if (granted.length === 0) {
            return next();
        }

        if (allowed.some((permission) => granted.includes(permission))) {
            return next();
        }

        // Names the missing permission on purpose. The caller is a signed-in
        // colleague, not an attacker probing the system, and "you need Delete
        // Sale for this" is the difference between them asking the owner to tick
        // one box and reporting the app as broken.
        return next(
            new AppError(
                status.FORBIDDEN,
                `You do not have permission for this action. Ask the owner to enable: ${allowed.join(" or ")}.`
            )
        );
    };
