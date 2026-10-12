import status from "http-status";
import { Role } from "../../../generated/prisma/enums.js";
import AppError from "../../errorHelpers/AppError.js";
import { IRequestUser } from "../../interfaces/requestUser.interface.js";
import { type ListOptions } from "../../shared/listQuery.js";
import { resolveRange } from "./kpi.range.js";
import { salesScope } from "./kpi.sales.js";
import { deliveryScope } from "./kpi.delivery.js";
import { meScope } from "./kpi.me.js";
import { agencyScope } from "./kpi.agency.js";

// Picks the scope and checks the role. Each scope's queries live in its own
// file (kpi.agency, kpi.sales, kpi.delivery, kpi.me) on top of kpi.loaders.

export const KPI_SCOPES = ["agency", "sales", "delivery", "me"] as const;
export type KpiScope = (typeof KPI_SCOPES)[number];

/** Which roles may read which scope. `me` is everyone's own. */
const SCOPE_ROLES: Record<KpiScope, Role[] | null> = {
    agency: [Role.admin],
    sales: [Role.admin, Role.sales],
    delivery: [Role.admin, Role.project_manager],
    me: null,
};

// The route validates `scope` against KPI_SCOPES.
const getScope = async (scope: KpiScope, user: IRequestUser, options: ListOptions = {}) => {
    const allowed = SCOPE_ROLES[scope];

    if (allowed && !allowed.includes(user.role as Role)) {
        throw new AppError(status.FORBIDDEN, "You do not have access to this scope");
    }

    const range = resolveRange(options);
    const meta = {
        scope,
        from: range.from.toISOString().slice(0, 10),
        to: range.to.toISOString().slice(0, 10),
        days: range.days,
    };

    switch (scope) {
        case "agency":
            return { ...meta, ...(await agencyScope(user, range)) };
        case "sales":
            // A salesperson gets THEIR numbers, forced rather than asked:
            // the agency's win rate is a management figure, and reading the
            // narrowing from a query parameter would put it one dropped
            // parameter away. An admin still sees the whole board.
            return {
                ...meta,
                ...(await salesScope(user, range, user.role === Role.sales)),
                mine: user.role === Role.sales,
            };
        case "delivery":
            return { ...meta, ...(await deliveryScope(user, range)) };
        case "me":
            return { ...meta, ...(await meScope(user, range)) };
    }
};

export const KpiService = { getScope };
