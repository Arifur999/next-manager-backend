import { NextFunction, Request, Response } from "express";
import status from "http-status";
import AppError from "../errorHelpers/AppError.js";
import { resolveScope } from "../shared/resolveScope.js";
import type { PermissionAction, PermissionModule } from "../shared/permissionCatalogue.js";

/**
 * Narrows what a colleague may do WITHIN the role checkAuth already allowed.
 *
 * The replacement for `requirePermission` on company routes. That one asked
 * whether a hand-written string appeared in a flat list on the user; this asks
 * the permission grid, which is the same thing every scoped READ has asked
 * since P2 — so a module turned off on the screen now stops the writes as well
 * as shortening the lists, instead of the two disagreeing.
 *
 * Always sits after checkAuth, never instead of it. The role gate is the outer
 * boundary and this cannot widen it: an admin-only route stays admin-only
 * however the grid is set, because the question is only reached by somebody the
 * route already let in.
 *
 * ── The two hatches, and what became of them ───────────────────────────────
 *
 * The old middleware let anybody through whose permission list was empty, so
 * that an upgrade took nothing from anybody. That hatch is gone because it is
 * no longer needed: absence is not silence any more. Every agency carries a
 * full grid, and a square nobody has touched resolves to its role's default,
 * which was transcribed from the behaviour these routes already had.
 *
 * The admin bypass is gone too, deliberately. It would make the admin row of
 * the grid decorative — the same objection the old middleware itself raised
 * against bypassing super_admin. An admin who narrows their own role can still
 * undo it, because the permissions screen is gated on the ROLE and never on a
 * scope, so there is always a way back in.
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

            // Anything but `none` is permission to act. HOW MUCH they may act
            // on is the service's question, not this one — a middleware cannot
            // know which record is about to be touched, and pretending it can
            // is how a check ends up looking stricter than it is.
            if (scope !== "none") {
                return next();
            }

            // Names what is missing on purpose. The caller is a signed-in
            // colleague, not somebody probing the system, and "you cannot
            // create clients" is the difference between them asking an admin to
            // change one square and reporting the app as broken.
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
