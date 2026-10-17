import { NextFunction, Request, Response } from "express";
import status from "http-status";
import AppError from "../errorHelpers/AppError.js";
import { resolveScope } from "../shared/resolveScope.js";
import type { PermissionAction, PermissionModule } from "../shared/permissionCatalogue.js";

/**
 * Narrows what a colleague may do within the role checkAuth already allowed, by
 * asking the permission grid - the same question every scoped read asks - so a
 * square switched off stops the writes as well as shortening the lists. Always
 * after checkAuth: an admin-only route stays admin-only however the grid is set.
 *
 * No empty-list or admin bypass. Every agency carries a full grid whose untouched
 * squares resolve to the role defaults, and the permissions screen is gated on
 * the role, not a scope, so an admin who narrows their own role can undo it.
 */
export const requireScope =
    (module: PermissionModule, action: PermissionAction) =>
    async (req: Request, _res: Response, next: NextFunction) => {
        const user = req.user;

        if (!user) {
            return next(
                new AppError(status.UNAUTHORIZED, "Unauthorized access! No user on the request.")
            );
        }

        try {
            const scope = await resolveScope(user, module, action);

            // Anything but `none` lets them act. How much they may act on is the
            // service's question: only it knows which record is being touched.
            if (scope !== "none") {
                return next();
            }

            // Names the missing square: the caller is a signed-in colleague, and
            // knowing what to ask an admin for beats reporting the app as broken.
            return next(
                new AppError(
                    status.FORBIDDEN,
                    `You do not have permission for this action. Ask an admin to allow: ${module} — ${action}.`
                )
            );
        } catch (error) {
            return next(error);
        }
    };
