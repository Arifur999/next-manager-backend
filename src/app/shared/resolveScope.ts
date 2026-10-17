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
 * How far this person reaches for one module and action: their own override,
 * else their role's row, else the catalogue default (only for an agency with no
 * rows at all). It decides neither the tenant - organization_id is always in the
 * query, and `all` means all of YOUR agency's - nor the route, which checkAuth
 * already gated by role.
 *
 * Cached in a WeakMap keyed by the request's user: one query however many
 * modules a request touches, and no TTL, so a changed permission applies on the
 * very next request.
 */

type ResolvedPermissions = Map<string, PermissionScope>;

/** Only what the answer depends on, so the chat socket can ask without a whole request user. */
export type ScopeSubject = Pick<IRequestUser, "userId" | "organizationId" | "role">;

const cache = new WeakMap<ScopeSubject, Promise<ResolvedPermissions>>();

const key = (module: PermissionModule, action: PermissionAction) => `${module}.${action}`;

const load = async (user: ScopeSubject): Promise<ResolvedPermissions> => {
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
    user: ScopeSubject,
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
