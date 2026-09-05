import status from "http-status";
import { Role } from "../../../generated/prisma/enums.js";
import AppError from "../../errorHelpers/AppError.js";
import { IRequestUser } from "../../interfaces/requestUser.interface.js";
import { prisma } from "../../lib/prisma.js";
import {
    ACTIONS,
    MODULES,
    MODULE_ACTIONS,
    ROLE_DEFAULTS,
    SCOPES,
    type PermissionAction,
    type PermissionModule,
    type PermissionScope,
} from "../../shared/permissionCatalogue.js";
import { ISetRolePermissionPayload, ISetUserPermissionPayload } from "./permission.validation.js";

/**
 * Reading and writing who may do what.
 *
 * The screen behind this is a grid, so the read hands back the whole grid at
 * once: the catalogue (what can be said), the agency's role rows (what is
 * said), and one person's overrides when asked for. Three round trips to draw
 * one table would be three chances for the table to show a mixture of two
 * moments.
 *
 * Nothing here can widen a role past its route. `checkAuth` refuses the
 * endpoint first, and these rows only narrow inside it — so an agency ticking
 * "operations may view accounts" does not open the accounts route to them; the
 * question would simply never be asked.
 *
 * And no value written here crosses a tenant line, because there is no scope
 * that means another agency. That is the property the whole design rests on and
 * it is enforced by absence rather than by a check.
 */

const CATALOGUE = {
    modules: MODULES.map((module) => ({ module, actions: MODULE_ACTIONS[module] })),
    actions: ACTIONS,
    scopes: SCOPES,
} as const;

/** The roles an agency can configure. A platform operator is not one of them. */
const COMPANY_ROLES = [Role.admin, Role.sales, Role.project_manager, Role.operations] as const;

const assertConfigurable = (role: Role) => {
    if (!(COMPANY_ROLES as readonly Role[]).includes(role)) {
        throw new AppError(status.BAD_REQUEST, "That role is not one an agency configures");
    }
};

const assertColleague = async (userId: string, user: IRequestUser) => {
    const member = await prisma.user.findFirst({
        where: { id: userId, organization_id: user.organizationId, deleted_at: null },
        select: { id: true, full_name: true, role: true },
    });

    // The id proves a user exists, never that they are ours.
    if (!member) {
        throw new AppError(status.NOT_FOUND, "That person is not on your team");
    }

    return member;
};

const getGrid = async (user: IRequestUser, userId?: string) => {
    const [roleRows, overrides, member] = await Promise.all([
        prisma.rolePermission.findMany({
            where: { organization_id: user.organizationId },
            select: { role: true, module: true, action: true, scope: true },
        }),
        userId
            ? prisma.userPermission.findMany({
                  where: { user_id: userId },
                  select: { module: true, action: true, scope: true },
              })
            : Promise.resolve([]),
        userId ? assertColleague(userId, user) : Promise.resolve(null),
    ]);

    return {
        catalogue: CATALOGUE,
        roles: COMPANY_ROLES,
        role_permissions: roleRows,
        // Only present when a person was asked about. An empty array and "not
        // asked" are different answers, so the caller gets null for the second.
        user: member,
        user_permissions: userId ? overrides : null,
    };
};

const setRolePermission = async (payload: ISetRolePermissionPayload, user: IRequestUser) => {
    assertConfigurable(payload.role);

    return prisma.rolePermission.upsert({
        where: {
            organization_id_role_module_action: {
                organization_id: user.organizationId,
                role: payload.role,
                module: payload.module,
                action: payload.action,
            },
        },
        create: {
            organization_id: user.organizationId,
            role: payload.role,
            module: payload.module,
            action: payload.action,
            scope: payload.scope,
        },
        update: { scope: payload.scope },
    });
};

const setUserPermission = async (
    userId: string,
    payload: ISetUserPermissionPayload,
    user: IRequestUser
) => {
    await assertColleague(userId, user);

    return prisma.userPermission.upsert({
        where: {
            user_id_module_action: {
                user_id: userId,
                module: payload.module,
                action: payload.action,
            },
        },
        create: {
            user_id: userId,
            module: payload.module,
            action: payload.action,
            scope: payload.scope,
        },
        update: { scope: payload.scope },
    });
};

/**
 * Remove an override, so this person inherits their role again.
 *
 * Deleting rather than writing the role's current value: an override that
 * happens to match the role today would silently stop following it tomorrow,
 * and "inherits" is a different fact from "is set to the same thing".
 */
const clearUserPermission = async (
    userId: string,
    module: PermissionModule,
    action: PermissionAction,
    user: IRequestUser
) => {
    await assertColleague(userId, user);

    await prisma.userPermission.deleteMany({
        where: { user_id: userId, module, action },
    });

    return { message: "They inherit their role again" };
};

/** What the catalogue says a role starts with, for a "reset" on the screen. */
const roleDefault = (role: Role, module: PermissionModule, action: PermissionAction) =>
    (ROLE_DEFAULTS[role as Exclude<Role, "super_admin">]?.[module]?.[action] ??
        "none") as PermissionScope;

export const PermissionService = {
    getGrid,
    setRolePermission,
    setUserPermission,
    clearUserPermission,
    roleDefault,
};
