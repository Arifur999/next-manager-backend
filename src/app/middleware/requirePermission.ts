import { NextFunction, Request, Response } from "express";
import status from "http-status";
import { Role } from "../../generated/prisma/enums.js";
import AppError from "../errorHelpers/AppError.js";

/**
 * Narrows what a colleague may do WITHIN the role checkAuth already allowed.
 *
 * Always sits after checkAuth on a route, never instead of it: the role gate is
 * the outer boundary and this cannot widen it. An admin-only route stays
 * admin-only however the checkboxes are set.
 *
 * Two deliberate escape hatches, both of which make this safe to turn on for a
 * system that already has users:
 *
 *   - An admin always passes. Locking an admin out of their own company with a
 *     checkbox is never the intent and there would be no way back.
 *   - A user with NO permissions stored passes. Every existing colleague has
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

        // A company admin always passes. Locking an admin out of their own
        // company with a checkbox is never the intent, and there would be no
        // way back in.
        //
        // super_admin is deliberately NOT here, though it was until this layer
        // was first used. A platform team is exactly the case these checks
        // exist for - "you look after billing, not the customer list" - and a
        // blanket bypass for the only role that reaches these routes would
        // have made the whole permissions screen decorative. The empty-list
        // hatch below is what keeps the first operator from being locked out.
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

        // Names the missing permission on purpose. The caller is a signed-in
        // colleague, not an attacker probing the system, and "you need Delete
        // Sale for this" is the difference between them asking an admin to tick
        // one box and reporting the app as broken.
        return next(
            new AppError(
                status.FORBIDDEN,
                `You do not have permission for this action. Ask the owner to enable: ${allowed.join(" or ")}.`
            )
        );
    };
