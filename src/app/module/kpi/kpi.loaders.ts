import { Prisma } from "../../../generated/prisma/client.js";
import { ExpenseCategoryType, KpiMetric } from "../../../generated/prisma/enums.js";
import { prisma } from "../../lib/prisma.js";
import { loadCapacityRows } from "../../shared/capacity.js";
import { type Range } from "./kpi.range.js";

/**
 * Gathering the numbers the formulas turn into metrics.
 *
 * Everything arithmetic lives in kpi.formulas.ts and is unit-tested. This file
 * only queries and hands over, which is why it has no ratios in it - a division
 * written here would be a division nobody checks.
 *
 * The one rule that shapes every query below: **USD and BDT are never added.**
 * Revenue exists in both (a payment records the USD received and the BDT it was
 * worth at the frozen reporting rate); costs - expenses and team payouts - are
 * BDT only. So margin is computed in BDT, because that is the one currency in
 * which both sides of the subtraction exist. Utilization and realization are
 * computed in USD, because that is what the agency bills in. Neither figure
 * quietly borrows a number from the other currency.
 */

export const dateColumn = (range: Range) => ({ gte: range.from, lte: range.to });

export const num = (value: Prisma.Decimal | null | undefined): number => value?.toNumber() ?? 0;

/**
 * Targets that cover this range, indexed by metric.
 *
 * A target's period_start has to fall inside the window being asked about. A
 * quarterly target scored against one week of it would report 8% attainment
 * and look like a catastrophe, so the caller decides the range and the target
 * has to belong to it.
 */
export const loadTargets = async (
    organizationId: string,
    range: Range,
    userId: string | null
): Promise<Map<KpiMetric, number>> => {
    const rows = await prisma.kpiTarget.findMany({
        where: {
            organization_id: organizationId,
            deleted_at: null,
            user_id: userId,
            period_start: { gte: range.from, lte: range.to },
        },
        select: { metric: true, target_value: true, period: true, period_start: true },
        orderBy: { period_start: "desc" },
    });

    const byMetric = new Map<KpiMetric, number>();

    for (const row of rows) {
        // Most recent wins - the loop is ordered desc, so the first one seen
        // for a metric is the one that stands.
        if (!byMetric.has(row.metric)) {
            byMetric.set(row.metric, num(row.target_value));
        }
    }

    return byMetric;
};

export const targetOf = (targets: Map<KpiMetric, number>, metric: KpiMetric): number | null =>
    targets.has(metric) ? (targets.get(metric) as number) : null;

// ---------------------------------------------------------------------------
// Hours
// ---------------------------------------------------------------------------

/**
 * Logged hours over a range, split billable / total.
 *
 * `approvedOnly` is the difference between "what the team says it did" and
 * "what somebody signed off". Realization uses approved hours, because
 * unapproved time has not been agreed to be worth anything yet.
 */
export const loadHours = async (
    organizationId: string,
    range: Range,
    userId?: string
) => {
    const where: Prisma.TimeEntryWhereInput = {
        organization_id: organizationId,
        deleted_at: null,
        date: dateColumn(range),
        ...(userId ? { user_id: userId } : {}),
    };

    const [all, billable, approvedBillable] = await Promise.all([
        prisma.timeEntry.aggregate({ where, _sum: { hours: true } }),
        prisma.timeEntry.aggregate({ where: { ...where, is_billable: true }, _sum: { hours: true } }),
        prisma.timeEntry.aggregate({
            where: { ...where, is_billable: true, approved_at: { not: null } },
            _sum: { hours: true },
        }),
    ]);

    return {
        total: num(all._sum.hours),
        billable: num(billable._sum.hours),
        approvedBillable: num(approvedBillable._sum.hours),
    };
};

/**
 * Capacity across the people being measured.
 *
 * Resolved through the shared helper so this and the capacity screen cannot
 * give different answers - they did, briefly, and a company saw a full team on
 * one screen and a null utilization on the other.
 */
export const loadCapacity = async (organizationId: string, userId?: string) => {
    const rows = await loadCapacityRows(organizationId, userId);

    const weeklyHours = rows.reduce((running, row) => running + row.weekly_hours, 0);
    const rated = rows.filter((row) => row.standard_rate_usd > 0);

    // The blended rate is over people who HAVE a rate. Averaging in the
    // unrated ones as zero would halve the rate every time somebody new is
    // added without one.
    const blendedRate =
        rated.length > 0
            ? rated.reduce((running, row) => running + row.standard_rate_usd, 0) / rated.length
            : 0;

    return {
        headcount: rows.length,
        weeklyHours,
        blendedRate,
        // How much of the denominator is an assumption rather than a decision.
        // A utilization figure built mostly on defaults is worth reading as
        // such, so the screen is given the means to say so.
        defaultedPeople: rows.filter((row) => row.is_default).length,
        ratedPeople: rated.length,
    };
};

// ---------------------------------------------------------------------------
// Money
// ---------------------------------------------------------------------------

export const loadMoney = async (organizationId: string, range: Range, projectId?: string) => {
    const scope = {
        organization_id: organizationId,
        deleted_at: null,
        date: dateColumn(range),
        ...(projectId ? { project_id: projectId } : {}),
    };

    const [income, expenses, payouts] = await Promise.all([
        prisma.payment.aggregate({
            where: scope,
            _sum: { amount_usd: true, amount_bdt_reporting: true },
        }),
        prisma.expense.findMany({
            where: scope,
            select: { amount_bdt: true, category: { select: { type: true } } },
        }),
        prisma.teamPayout.aggregate({ where: scope, _sum: { amount_bdt: true } }),
    ]);

    let operatingBdt = 0;
    let employeeBdt = 0;

    for (const expense of expenses) {
        const amount = num(expense.amount_bdt);
        if (expense.category.type === ExpenseCategoryType.employee) {
            employeeBdt += amount;
        } else {
            operatingBdt += amount;
        }
    }

    return {
        revenueUsd: num(income._sum.amount_usd),
        revenueBdt: num(income._sum.amount_bdt_reporting),
        // Owner withdrawals are absent on purpose: money already earned
        // leaving the company is not the cost of producing the work, and
        // counting it would understate margin by exactly the amount taken.
        costBdt: operatingBdt + employeeBdt + num(payouts._sum.amount_bdt),
    };
};
