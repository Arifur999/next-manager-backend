import { Role } from "../../generated/prisma/enums.js";
import { IRequestUser } from "../interfaces/requestUser.interface.js";
import { prisma } from "../lib/prisma.js";
import {
    ROLE_DEFAULTS,
    isScope,
    type PermissionAction,
    type PermissionModule,
    type PermissionScope,
} from "./permissionCatalogue.js";

/**
 * How far this person's reach goes, for one module and one action.
 *
 * Resolved user override → role template → the catalogue's own default, and the
 * catalogue's default is used only if the agency has no row at all, which after
 * the backfill means an agency created by a deploy that raced the migration.
 *
 * ── What this does NOT decide ──────────────────────────────────────────────
 *
 * The tenant. `organization_id` is on every query before this is consulted and
 * no value here can remove it. `all` means all of YOUR agency's, and there is
 * no scope that means anybody else's, because that question never reaches this
 * function.
 *
 * Nor the route. `checkAuth` has already refused anybody whose ROLE does not
 * carry the endpoint; this only narrows inside that. A row saying operations
 * may view accounts does not open the accounts route to them — it would simply
 * never be asked.
 *
 * ── Why it is cached on the user object ────────────────────────────────────
 *
 * A WeakMap keyed by the request's own IRequestUser, so a request that touches
 * three modules pays for one query and a request that touches none pays for
 * nothing. It is collected with the request; there is no TTL to get wrong and
 * no invalidation to forget, which is the failure mode a shared cache would
 * add — an admin changing a permission and it taking effect in five minutes is
 * worse than not caching at all.
 */

type ResolvedPermissions = Map<string, PermissionScope>;

const cache = new WeakMap<IRequestUser, Promise<ResolvedPermissions>>();

const key = (module: PermissionModule, action: PermissionAction) => `${module}.${action}`;

const load = async (user: IRequestUser): Promise<ResolvedPermissions> => {
    const [roleRows, userRows] = await Promise.all([
        prisma.rolePermission.findMany({
            where: { organization_id: user.organizationId, role: user.role },
            select: { module: true, action: true, scope: true },
        }),
        prisma.userPermission.findMany({
            where: { user_id: user.userId },
            select: { module: true, action: true, scope: true },
        }),
    ]);

    const resolved: ResolvedPermissions = new Map();

    // Role first, then overrides on top — so an override always wins, and an
    // absent override always inherits. Both directions matter: an override that
    // silently did nothing would look exactly like a working one.
    for (const row of [...roleRows, ...userRows]) {
        // A row naming a scope the code no longer has is ignored rather than
        // fatal. The column is text on purpose, and a bad value should cost a
        // fallback to the role default, not a 500 on every request.
        if (isScope(row.scope)) resolved.set(`${row.module}.${row.action}`, row.scope);
    }

    return resolved;
};

export const resolveScope = async (
    user: IRequestUser,
    module: PermissionModule,
    action: PermissionAction
): Promise<PermissionScope> => {
    // A platform operator belongs to no agency and reaches none of these
    // routes. Answering "none" rather than reading rows that cannot exist keeps
    // the question honest.
    if (user.role === Role.super_admin || !user.organizationId) return "none";

    let pending = cache.get(user);
    if (!pending) {
        pending = load(user);
        cache.set(user, pending);
    }

    const resolved = await pending;
    const stored = resolved.get(key(module, action));
    if (stored) return stored;

    // No row for this agency at all. Falls back to the catalogue rather than to
    // "none", because an agency that has somehow lost its template should be
    // the product it was, not a locked building.
    const fallback = ROLE_DEFAULTS[user.role as Exclude<Role, "super_admin">]?.[module]?.[action];
    return fallback ?? "none";
};
