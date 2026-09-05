import { NextFunction, Request, Response } from "express";
import status from "http-status";
import { Role } from "../../generated/prisma/enums.js";
import AppError from "../errorHelpers/AppError.js";

/**
 * Narrows what a PLATFORM operator may do inside their role.
 *
 * Company routes used to come through here too, checking a hand-written string
 * against a flat list on the user. They ask the permission grid now, through
 * `requireScope` - so a module turned off on the permissions screen stops the
 * writes as well as shortening the lists, instead of the two disagreeing about
 * what somebody may do.
 *
 * What is left is the platform side: `platform.companies.view`,
 * `platform.plans.manage` and the rest, which are a different system with a
 * different audience. They are not an agency's to configure, they never appear
 * on the customer-facing grid, and there is no scope to give them - a platform
 * operator either looks after billing or does not.
 *
 * Always sits after checkAuth, never instead of it. The role gate is the outer
 * boundary and this cannot widen it.
 *
 * Two escape hatches, both of which made this safe to turn on for a system that
 * already had users:
 *
 *   - A company admin always passes. They no longer reach this middleware at
 *     all, but the branch stays because removing it would make the rule depend
 *     on the routing rather than on the check.
 *   - An operator with NO permissions stored passes, so the first operator is
 *     never locked out of the console that hands permissions out.
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
