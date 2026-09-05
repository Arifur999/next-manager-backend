import { Role } from "../../generated/prisma/enums.js";

/**
 * What a permission can even SAY.
 *
 * Module + Action + Scope. The first two say which door; the third says how
 * much of the room is yours once you are through it — all of the agency's, only
 * what is assigned to you, only what is your own, or none of it.
 *
 * ── The rule that makes this safe to hand to a customer ────────────────────
 *
 *   TENANT ISOLATION IS NOT A SCOPE.
 *
 * `organization_id` is applied unconditionally, before any permission is
 * consulted, and nothing in this file can remove it. Scope decides how much of
 * YOUR OWN agency you see; it is never asked whether you see another one,
 * because that question does not reach here. Without that line, "a business can
 * customise its permissions" would become "a business can misconfigure itself
 * into a cross-tenant leak", and the isolation suite would stop meaning
 * anything.
 *
 * The role gate keeps its place too. `checkAuth` runs first and this only
 * narrows within it — exactly as the older `requirePermission` layer does — so
 * nothing configured here can hand somebody a route their role does not carry.
 *
 * ── Why the module list is longer than eight ───────────────────────────────
 *
 * The plan named clients, services, projects, tasks, team, chat, accounts and
 * reports. But scope is hard-coded in nine services, and four of them are not
 * on that list: the vault, attendance, leave and time entries all narrow
 * operations to their own rows today. Leaving them out would mean the data
 * could never replace the code in those four, which is the whole point — so
 * they are here.
 *
 * Leads and invoices joined them when the old flat permission list retired.
 * Both had a name on that list, and neither could be folded into a module
 * that already existed: invoices are not the accounts module (sales bills a
 * client but never opens the ledger), and leads are not the clients module
 * (turning off client editing would silently stop the pipeline).
 */

export const MODULES = [
    "clients",
    "leads",
    "invoices",
    "services",
    "projects",
    "tasks",
    "team",
    "chat",
    "accounts",
    "reports",
    "vault",
    "attendance",
    "leave",
    "time",
] as const;

export const ACTIONS = ["view", "create", "edit", "delete", "assign"] as const;

/**
 * How far a permission reaches.
 *
 * `none` is a real value, not the absence of a row: "you may not" and "nobody
 * has said" are different answers, and only one of them should be silent.
 */
export const SCOPES = ["all", "assigned", "own", "none"] as const;

export type PermissionModule = (typeof MODULES)[number];
export type PermissionAction = (typeof ACTIONS)[number];
export type PermissionScope = (typeof SCOPES)[number];

export const isModule = (value: string): value is PermissionModule =>
    (MODULES as readonly string[]).includes(value);
export const isAction = (value: string): value is PermissionAction =>
    (ACTIONS as readonly string[]).includes(value);
export const isScope = (value: string): value is PermissionScope =>
    (SCOPES as readonly string[]).includes(value);

/**
 * Which actions each module actually has.
 *
 * Written out rather than assumed to be all five, so the screen cannot offer a
 * picker for "assign a service", which is not a thing.
 */
export const MODULE_ACTIONS: Record<PermissionModule, readonly PermissionAction[]> = {
    clients: ["view", "create", "edit", "delete"],
    leads: ["view", "create", "edit", "delete"],
    invoices: ["view", "create", "edit", "delete"],
    services: ["view", "create", "edit", "delete"],
    projects: ["view", "create", "edit", "delete", "assign"],
    tasks: ["view", "create", "edit", "delete", "assign"],
    team: ["view", "create", "edit", "delete"],
    chat: ["view", "create"],
    accounts: ["view", "create", "edit", "delete"],
    reports: ["view"],
    vault: ["view", "create", "edit", "delete"],
    attendance: ["view", "create", "edit"],
    leave: ["view", "create", "edit"],
    time: ["view", "create", "edit"],
};

/**
 * What a company role starts with.
 *
 * Transcribed from what the services do TODAY, not from what would be tidy.
 * This is the seed every existing agency is backfilled with, so an upgrade must
 * land them in the product they already had — the two permission matrices are
 * the proof of that, and neither is allowed to move in P1 to P3.
 *
 * Read `none` as "the API refuses this today", `all` as "sees the whole
 * agency's", `assigned` as "only what they are a member of", `own` as "only
 * rows that are theirs".
 */
type RoleDefaults = Partial<Record<PermissionModule, Partial<Record<PermissionAction, PermissionScope>>>>;

const ADMIN: RoleDefaults = {
    // The admin is not narrowed anywhere. Listed in full rather than special-
    // cased, so the screen shows a real row for every square and an agency can
    // see what it is changing.
    clients: { view: "all", create: "all", edit: "all", delete: "all" },
    leads: { view: "all", create: "all", edit: "all", delete: "all" },
    invoices: { view: "all", create: "all", edit: "all", delete: "all" },
    services: { view: "all", create: "all", edit: "all", delete: "all" },
    projects: { view: "all", create: "all", edit: "all", delete: "all", assign: "all" },
    tasks: { view: "all", create: "all", edit: "all", delete: "all", assign: "all" },
    team: { view: "all", create: "all", edit: "all", delete: "all" },
    chat: { view: "own", create: "own" },
    accounts: { view: "all", create: "all", edit: "all", delete: "all" },
    reports: { view: "all" },
    vault: { view: "all", create: "all", edit: "all", delete: "all" },
    attendance: { view: "all", create: "all", edit: "all" },
    leave: { view: "all", create: "all", edit: "all" },
    time: { view: "all", create: "all", edit: "all" },
};

const SALES: RoleDefaults = {
    clients: { view: "all", create: "all", edit: "all", delete: "none" },
    // The pipeline is theirs, but throwing a lead away is not: deleting either
    // is an admin route today and stays one.
    leads: { view: "all", create: "all", edit: "all", delete: "none" },
    invoices: { view: "all", create: "all", edit: "all", delete: "none" },
    services: { view: "all", create: "all", edit: "all", delete: "none" },
    // Sales opens a project and hands it over; running it is somebody else's.
    projects: { view: "all", create: "all", edit: "none", delete: "none", assign: "none" },
    tasks: { view: "all", create: "none", edit: "own", delete: "none", assign: "none" },
    team: { view: "all", create: "none", edit: "none", delete: "none" },
    chat: { view: "own", create: "own" },
    accounts: { view: "none", create: "none", edit: "none", delete: "none" },
    // Their own clients only — the reports are forced to the caller's book.
    reports: { view: "own" },
    vault: { view: "all", create: "all", edit: "all", delete: "none" },
    attendance: { view: "own", create: "own", edit: "none" },
    leave: { view: "own", create: "own", edit: "none" },
    time: { view: "own", create: "own", edit: "own" },
};

const PROJECT_MANAGER: RoleDefaults = {
    clients: { view: "all", create: "none", edit: "none", delete: "none" },
    // Neither the pipeline nor the billing reaches delivery today.
    leads: { view: "none", create: "none", edit: "none", delete: "none" },
    invoices: { view: "none", create: "none", edit: "none", delete: "none" },
    // Read, not shaped: they pick what a project delivers, the seller decides
    // what is on offer.
    services: { view: "all", create: "none", edit: "none", delete: "none" },
    projects: { view: "all", create: "all", edit: "all", delete: "none", assign: "all" },
    tasks: { view: "all", create: "all", edit: "all", delete: "all", assign: "all" },
    team: { view: "all", create: "none", edit: "none", delete: "none" },
    chat: { view: "own", create: "own" },
    accounts: { view: "none", create: "none", edit: "none", delete: "none" },
    reports: { view: "all" },
    vault: { view: "all", create: "all", edit: "all", delete: "none" },
    // They approve hours and decide leave, so they see everybody's.
    attendance: { view: "all", create: "all", edit: "all" },
    leave: { view: "all", create: "own", edit: "all" },
    time: { view: "all", create: "own", edit: "all" },
};

const OPERATIONS: RoleDefaults = {
    // Only the clients whose projects they are on.
    clients: { view: "assigned", create: "none", edit: "none", delete: "none" },
    leads: { view: "none", create: "none", edit: "none", delete: "none" },
    invoices: { view: "none", create: "none", edit: "none", delete: "none" },
    services: { view: "all", create: "none", edit: "none", delete: "none" },
    projects: { view: "assigned", create: "none", edit: "none", delete: "none", assign: "none" },
    // Their own tasks, and only the status and description on them.
    tasks: { view: "own", create: "none", edit: "own", delete: "none", assign: "none" },
    team: { view: "all", create: "none", edit: "none", delete: "none" },
    chat: { view: "own", create: "own" },
    accounts: { view: "none", create: "none", edit: "none", delete: "none" },
    reports: { view: "none" },
    // Credentials on a project they are a member of, and nothing else.
    vault: { view: "assigned", create: "none", edit: "none", delete: "none" },
    attendance: { view: "own", create: "own", edit: "none" },
    leave: { view: "own", create: "own", edit: "none" },
    time: { view: "own", create: "own", edit: "own" },
};

export const ROLE_DEFAULTS: Record<
    Exclude<Role, "super_admin">,
    RoleDefaults
> = {
    [Role.admin]: ADMIN,
    [Role.sales]: SALES,
    [Role.project_manager]: PROJECT_MANAGER,
    [Role.operations]: OPERATIONS,
};

/**
 * Every row a new agency starts with, flattened.
 *
 * A row per role per module per action, so the screen has a square to show and
 * an agency can change any one of them without a migration. Absent squares are
 * the ones MODULE_ACTIONS says do not exist.
 */
export const defaultPermissionRows = (): Array<{
    role: Exclude<Role, "super_admin">;
    module: PermissionModule;
    action: PermissionAction;
    scope: PermissionScope;
}> => {
    const rows = [];

    for (const [role, defaults] of Object.entries(ROLE_DEFAULTS)) {
        for (const module of MODULES) {
            for (const action of MODULE_ACTIONS[module]) {
                const scope = defaults[module]?.[action];
                // A square the defaults do not mention is "none" rather than
                // missing: silence should never read as permission.
                rows.push({
                    role: role as Exclude<Role, "super_admin">,
                    module,
                    action,
                    scope: scope ?? "none",
                });
            }
        }
    }

    return rows;
};
