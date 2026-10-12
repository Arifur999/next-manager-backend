import status from "http-status";
import { KpiMetric, Role } from "../../../generated/prisma/enums.js";
import AppError from "../../errorHelpers/AppError.js";
import { IRequestUser } from "../../interfaces/requestUser.interface.js";
import { prisma } from "../../lib/prisma.js";
import { type ListOptions } from "../../shared/listQuery.js";
import { type Range, resolveRange } from "./kpi.range.js";
import {
    annualise,
    attainment,
    availableHours,
    effectiveHourlyRate,
    grossMargin,
    onTimeDelivery,
    realization,
    revenuePerPerson,
    unmeasurable,
    utilization,
} from "./kpi.formulas.js";
import { loadTargets, targetOf, loadHours, loadCapacity, loadMoney } from "./kpi.loaders.js";
import { salesScope } from "./kpi.sales.js";
import { deliveryScope } from "./kpi.delivery.js";

// ---------------------------------------------------------------------------
// Scopes
// ---------------------------------------------------------------------------

/**
 * The agency's own numbers: is the company healthy.
 *
 * Utilization and realization lead, because they move first - revenue confirms
 * what they already said six weeks earlier.
 */
const agencyScope = async (user: IRequestUser, range: Range) => {
    const targets = await loadTargets(user.organizationId, range, null);

    const [hours, capacity, money] = await Promise.all([
        loadHours(user.organizationId, range),
        loadCapacity(user.organizationId),
        loadMoney(user.organizationId, range),
    ]);

    const available = availableHours(capacity.weeklyHours, range.days);
    const utilizationMetric = utilization(hours.billable, available);
    const realizationMetric = realization(
        money.revenueUsd,
        hours.approvedBillable,
        capacity.blendedRate
    );

    const revenuePerHead = revenuePerPerson(money.revenueUsd, capacity.headcount);
    const annualisedPerHead =
        revenuePerHead.value === null
            ? unmeasurable(revenuePerHead.reason)
            : annualise(revenuePerHead.value, range.days);

    return {
        leading: {
            utilization_pct: attainment(utilizationMetric, targetOf(targets, KpiMetric.utilization_pct)),
            realization_pct: attainment(realizationMetric, targetOf(targets, KpiMetric.realization_pct)),
            effective_hourly_rate_usd: effectiveHourlyRate(money.revenueUsd, hours.billable),
        },
        lagging: {
            revenue_usd: attainment(
                { value: money.revenueUsd },
                targetOf(targets, KpiMetric.revenue_usd)
            ),
            // BDT, because costs only exist in BDT - this is the one currency
            // in which both sides of the subtraction are real.
            gross_margin_pct: attainment(
                grossMargin(money.revenueBdt, money.costBdt),
                targetOf(targets, KpiMetric.gross_margin_pct)
            ),
            net_profit_bdt: money.revenueBdt - money.costBdt,
            revenue_per_person_usd: revenuePerHead,
            annualised_revenue_per_person_usd: annualisedPerHead,
        },
        context: {
            headcount: capacity.headcount,
            available_hours: available,
            logged_hours: hours.total,
            billable_hours: hours.billable,
            approved_billable_hours: hours.approvedBillable,
            blended_rate_usd: capacity.blendedRate,
            people_on_default_capacity: capacity.defaultedPeople,
            people_with_a_bill_rate: capacity.ratedPeople,
            revenue_bdt_reporting: money.revenueBdt,
            cost_bdt: money.costBdt,
        },
    };
};

/**
 * One person's own numbers.
 *
 * Deliberately narrow. Operations should see what they did and what they owe,
 * not the agency's margin - a number they cannot act on and were not given the
 * context to read.
 */
const meScope = async (user: IRequestUser, range: Range) => {
    const targets = await loadTargets(user.organizationId, range, user.userId);

    const [hours, capacity, myMilestones, myTasks] = await Promise.all([
        loadHours(user.organizationId, range, user.userId),
        loadCapacity(user.organizationId, user.userId),
        prisma.projectMilestone.findMany({
            where: {
                organization_id: user.organizationId,
                deleted_at: null,
                submitted_at: { not: null, gte: range.from, lte: range.to },
                project: { members: { some: { user_id: user.userId } } },
            },
            select: { due_date: true, submitted_at: true },
        }),
        prisma.task.count({
            where: {
                organization_id: user.organizationId,
                deleted_at: null,
                assignee_id: user.userId,
                completed_at: null,
            },
        }),
    ]);

    const available = availableHours(capacity.weeklyHours, range.days);

    let onTimeCount = 0;
    for (const milestone of myMilestones) {
        const due = Date.UTC(
            milestone.due_date.getUTCFullYear(),
            milestone.due_date.getUTCMonth(),
            milestone.due_date.getUTCDate()
        );
        const submitted = milestone.submitted_at as Date;
        if (
            Date.UTC(
                submitted.getUTCFullYear(),
                submitted.getUTCMonth(),
                submitted.getUTCDate()
            ) <= due
        ) {
            onTimeCount += 1;
        }
    }

    return {
        leading: {
            utilization_pct: attainment(
                utilization(hours.billable, available),
                targetOf(targets, KpiMetric.utilization_pct)
            ),
            billable_hours: attainment(
                { value: hours.billable },
                targetOf(targets, KpiMetric.billable_hours)
            ),
        },
        lagging: {
            on_time_delivery_pct: attainment(
                onTimeDelivery(onTimeCount, myMilestones.length),
                targetOf(targets, KpiMetric.on_time_delivery_pct)
            ),
            open_tasks: myTasks,
        },
        context: {
            available_hours: available,
            logged_hours: hours.total,
            billable_hours: hours.billable,
            // Approval is somebody else's action, so the gap between logged
            // and approved is worth seeing rather than silently absorbing.
            approved_billable_hours: hours.approvedBillable,
            milestones_delivered: myMilestones.length,
        },
    };
};

// ---------------------------------------------------------------------------

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
