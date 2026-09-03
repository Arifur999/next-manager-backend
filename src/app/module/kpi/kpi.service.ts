import status from "http-status";
import { Prisma } from "../../../generated/prisma/client.js";
import {
    ExpenseCategoryType,
    KpiMetric,
    LeadStage,
    Role,
} from "../../../generated/prisma/enums.js";
import AppError from "../../errorHelpers/AppError.js";
import { IRequestUser } from "../../interfaces/requestUser.interface.js";
import { prisma } from "../../lib/prisma.js";
import { loadCapacityRows } from "../../shared/capacity.js";
import { OPEN_LEAD_STAGES } from "../../shared/leadStage.js";
import { type ListOptions } from "../../shared/listQuery.js";
import {
    annualise,
    attainment,
    availableHours,
    averageDealSize,
    effectiveHourlyRate,
    grossMargin,
    onTimeDelivery,
    pipelineCoverage,
    pipelineVelocity,
    planVsActual,
    projectMargin,
    realization,
    revenuePerPerson,
    salesCycleDays,
    scopeChange,
    unmeasurable,
    utilization,
    winRate,
} from "./kpi.formulas.js";

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

const DAY_MS = 24 * 60 * 60 * 1000;

type Range = { from: Date; to: Date; days: number };

/**
 * The window every metric is computed over.
 *
 * Defaults to the last 30 days rather than all time: "utilization since the
 * company was founded" is not a number anybody acts on.
 */
const resolveRange = (options: ListOptions): Range => {
    const to = options.to
        ? new Date(`${options.to}T23:59:59.999Z`)
        : new Date();

    const from = options.from
        ? new Date(`${options.from}T00:00:00.000Z`)
        : new Date(to.getTime() - 29 * DAY_MS);

    if (from.getTime() > to.getTime()) {
        throw new AppError(status.BAD_REQUEST, "The start of the range is after its end");
    }

    // Inclusive of both ends, so a single day is one day and not zero.
    const days = Math.max(1, Math.round((to.getTime() - from.getTime()) / DAY_MS) + 1);

    return { from, to, days };
};

const dateColumn = (range: Range) => ({ gte: range.from, lte: range.to });

const num = (value: Prisma.Decimal | null | undefined): number => value?.toNumber() ?? 0;

/**
 * Targets that cover this range, indexed by metric.
 *
 * A target's period_start has to fall inside the window being asked about. A
 * quarterly target scored against one week of it would report 8% attainment
 * and look like a catastrophe, so the caller decides the range and the target
 * has to belong to it.
 */
const loadTargets = async (
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

const targetOf = (targets: Map<KpiMetric, number>, metric: KpiMetric): number | null =>
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
const loadHours = async (
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
const loadCapacity = async (organizationId: string, userId?: string) => {
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

const loadMoney = async (organizationId: string, range: Range, projectId?: string) => {
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
 * Selling: is enough work coming in, and how fast.
 *
 * Won and lost are counted from stage events rather than from the Lead's
 * current stage, so a deal won inside the window counts for the window even if
 * it has since been reopened or archived.
 */
/**
 * The sales numbers.
 *
 * `mine` narrows every one of them to the deals this person owns. It is not a
 * filter over a total that was computed anyway — each query carries the owner,
 * so a salesperson's win rate is theirs and not the agency's with their name on
 * it.
 *
 * Targets follow the same line: a personal view is measured against personal
 * targets, because holding one person to the whole agency's number would
 * report "off track" at somebody doing fine.
 */
const salesScope = async (user: IRequestUser, range: Range, mine = false) => {
    const targets = await loadTargets(user.organizationId, range, mine ? user.userId : null);

    // Applied to the leads themselves and, through the relation, to their stage
    // events — the events are what win rate and cycle length are counted from,
    // and scoping only the leads would leave both agency-wide.
    const ownLead = mine ? { owner_id: user.userId } : {};
    const ownEvent = mine ? { lead: { owner_id: user.userId } } : {};

    const [decided, openLeads, wonLeads, wonJourneys] = await Promise.all([
        prisma.leadStageEvent.groupBy({
            by: ["to_stage"],
            where: {
                organization_id: user.organizationId,
                to_stage: { in: [LeadStage.won, LeadStage.lost] },
                changed_at: dateColumn(range),
                ...ownEvent,
            },
            _count: { _all: true },
        }),
        prisma.lead.aggregate({
            where: {
                organization_id: user.organizationId,
                deleted_at: null,
                stage: { in: OPEN_LEAD_STAGES },
                ...ownLead,
            },
            _sum: { estimated_value_usd: true },
            _count: { _all: true },
        }),
        prisma.lead.aggregate({
            where: {
                organization_id: user.organizationId,
                deleted_at: null,
                stage: LeadStage.won,
                stage_events: {
                    some: { to_stage: LeadStage.won, changed_at: dateColumn(range) },
                },
                ...ownLead,
            },
            _sum: { estimated_value_usd: true },
            _count: { _all: true },
        }),
        // Every stage event for the deals won in the window, so a cycle can be
        // measured from each lead's first recorded stage to the day it landed.
        prisma.leadStageEvent.findMany({
            where: {
                organization_id: user.organizationId,
                lead: {
                    deleted_at: null,
                    ...ownLead,
                    stage_events: {
                        some: { to_stage: LeadStage.won, changed_at: dateColumn(range) },
                    },
                },
            },
            select: { lead_id: true, to_stage: true, changed_at: true },
            orderBy: { changed_at: "asc" },
        }),
    ]);

    const countOf = (stage: LeadStage) =>
        decided.find((row) => row.to_stage === stage)?._count._all ?? 0;

    const wonCount = countOf(LeadStage.won);
    const lostCount = countOf(LeadStage.lost);
    const wonValueUsd = num(wonLeads._sum.estimated_value_usd);

    // First event to won, per lead. A lead whose history starts at `won` -
    // one back-filled from converted_at with nothing before it - yields zero
    // days and is dropped rather than counted as an instant sale.
    const firstSeen = new Map<string, Date>();
    const wonAt = new Map<string, Date>();

    for (const event of wonJourneys) {
        if (!firstSeen.has(event.lead_id)) firstSeen.set(event.lead_id, event.changed_at);
        if (event.to_stage === LeadStage.won && !wonAt.has(event.lead_id)) {
            wonAt.set(event.lead_id, event.changed_at);
        }
    }

    const cycles: number[] = [];
    for (const [leadId, won] of wonAt) {
        const first = firstSeen.get(leadId);
        if (!first) continue;
        const days = Math.round((won.getTime() - first.getTime()) / DAY_MS);
        if (days > 0) cycles.push(days);
    }

    /**
     * Where the work came from.
     *
     * Grouped over every lead the company has, not the window: a marketplace's
     * win rate over one month is three deals, which is noise. The question
     * "which platform is actually paying" is answered by the whole history, so
     * that is what this counts.
     *
     * Leads with no source are folded into one "not recorded" row rather than
     * dropped. Hiding them would make the percentages add to 100 while being
     * computed from a subset, which is exactly the kind of tidy report that
     * misleads.
     */
    const sourceGroups = await prisma.lead.groupBy({
        by: ["source_id", "stage"],
        where: { organization_id: user.organizationId, deleted_at: null },
        _count: { _all: true },
        _sum: { estimated_value_usd: true },
    });

    const sourceNames = new Map(
        (
            await prisma.leadSource.findMany({
                where: { organization_id: user.organizationId },
                select: { id: true, name: true },
            })
        ).map((row) => [row.id, row.name])
    );

    const bySource = new Map<
        string,
        { name: string; won: number; lost: number; open: number; won_value_usd: number }
    >();

    for (const row of sourceGroups) {
        const key = row.source_id ?? "__none__";
        const entry = bySource.get(key) ?? {
            name: row.source_id ? sourceNames.get(row.source_id) ?? "Removed source" : "Not recorded",
            won: 0,
            lost: 0,
            open: 0,
            won_value_usd: 0,
        };

        const count = row._count._all;

        if (row.stage === LeadStage.won) {
            entry.won += count;
            entry.won_value_usd += num(row._sum.estimated_value_usd);
        } else if (row.stage === LeadStage.lost) {
            entry.lost += count;
        } else {
            entry.open += count;
        }

        bySource.set(key, entry);
    }

    const sourceRows = [...bySource.values()]
        .map((entry) => ({
            ...entry,
            won_value_usd: Math.round(entry.won_value_usd * 100) / 100,
            // Null rather than zero when nothing has been decided here yet -
            // an untried marketplace has no win rate, and showing 0% would
            // read as "we tried and failed".
            win_rate_pct: winRate(entry.won, entry.lost).value,
        }))
        // Most money first: the reader is deciding where to spend the next hour.
        .sort((a, b) => b.won_value_usd - a.won_value_usd);

    const winRateMetric = winRate(wonCount, lostCount);
    const avgDeal = averageDealSize(wonValueUsd, wonCount);
    const cycle = salesCycleDays(cycles);

    return {
        leading: {
            pipeline_coverage: attainment(
                pipelineCoverage(
                    num(openLeads._sum.estimated_value_usd),
                    targetOf(targets, KpiMetric.revenue_usd) ?? 0
                ),
                targetOf(targets, KpiMetric.pipeline_coverage)
            ),
            pipeline_velocity_usd_per_day: pipelineVelocity(
                openLeads._count._all,
                winRateMetric.value,
                avgDeal.value,
                cycle.value
            ),
        },
        lagging: {
            win_rate_pct: attainment(winRateMetric, targetOf(targets, KpiMetric.win_rate_pct)),
            deals_won: attainment({ value: wonCount }, targetOf(targets, KpiMetric.deals_won)),
            deal_value_usd: attainment(
                { value: wonValueUsd },
                targetOf(targets, KpiMetric.deal_value_usd)
            ),
            average_deal_size_usd: avgDeal,
            sales_cycle_days: cycle,
        },
        by_source: sourceRows,
        context: {
            open_deals: openLeads._count._all,
            open_pipeline_usd: num(openLeads._sum.estimated_value_usd),
            deals_lost: lostCount,
            // Said out loud: a cycle length averaged over two deals is not a
            // benchmark, and the screen should be able to say how few.
            cycles_measured: cycles.length,
        },
    };
};

/**
 * Delivery: is the work landing when it was promised, at the size it was sold.
 */
const deliveryScope = async (user: IRequestUser, range: Range) => {
    const targets = await loadTargets(user.organizationId, range, null);

    const [delivered, overdue, projects, hours, capacity] = await Promise.all([
        prisma.projectMilestone.findMany({
            where: {
                organization_id: user.organizationId,
                deleted_at: null,
                submitted_at: { not: null, gte: range.from, lte: range.to },
            },
            select: { due_date: true, submitted_at: true, accepted_at: true },
        }),
        prisma.projectMilestone.count({
            where: {
                organization_id: user.organizationId,
                deleted_at: null,
                submitted_at: null,
                due_date: { lt: new Date() },
            },
        }),
        prisma.project.findMany({
            where: {
                organization_id: user.organizationId,
                deleted_at: null,
                baseline_set_at: { not: null },
            },
            select: {
                id: true,
                name: true,
                code: true,
                contract_value_usd: true,
                baseline_hours: true,
                baseline_value_usd: true,
            },
        }),
        loadHours(user.organizationId, range),
        loadCapacity(user.organizationId),
    ]);

    let onTimeCount = 0;
    for (const milestone of delivered) {
        // Compared on the day, not the instant: a milestone due on the 20th and
        // submitted at 6pm on the 20th is on time.
        const due = Date.UTC(
            milestone.due_date.getUTCFullYear(),
            milestone.due_date.getUTCMonth(),
            milestone.due_date.getUTCDate()
        );
        const submitted = milestone.submitted_at as Date;
        const submittedDay = Date.UTC(
            submitted.getUTCFullYear(),
            submitted.getUTCMonth(),
            submitted.getUTCDate()
        );
        if (submittedDay <= due) onTimeCount += 1;
    }

    // Actual hours per baselined project, so plan-vs-actual can be per project
    // rather than a single agency average that hides the one overrun.
    const actualByProject =
        projects.length > 0
            ? await prisma.timeEntry.groupBy({
                by: ["project_id"],
                where: {
                    organization_id: user.organizationId,
                    deleted_at: null,
                    project_id: { in: projects.map((project) => project.id) },
                },
                _sum: { hours: true },
            })
            : [];

    const actualBy = new Map(actualByProject.map((row) => [row.project_id, num(row._sum.hours)]));

    // Margin per project, in BDT for the same reason as everywhere else: costs
    // exist only in BDT, so that is the only currency both sides are real in.
    // Over the project's whole life, not the window - a project's margin is not
    // a property of the month you happen to be looking at.
    const projectIds = projects.map((project) => project.id);
    const lifetime = { organization_id: user.organizationId, deleted_at: null };

    const [projectIncome, projectExpenses, projectPayouts] =
        projectIds.length > 0
            ? await Promise.all([
                prisma.payment.groupBy({
                    by: ["project_id"],
                    where: { ...lifetime, project_id: { in: projectIds } },
                    _sum: { amount_bdt_reporting: true },
                }),
                prisma.expense.groupBy({
                    by: ["project_id"],
                    where: { ...lifetime, project_id: { in: projectIds } },
                    _sum: { amount_bdt: true },
                }),
                prisma.teamPayout.groupBy({
                    by: ["project_id"],
                    where: { ...lifetime, project_id: { in: projectIds } },
                    _sum: { amount_bdt: true },
                }),
            ])
            : [[], [], []];

    const incomeBy = new Map(
        projectIncome.map((row) => [row.project_id, num(row._sum.amount_bdt_reporting)])
    );
    const costBy = new Map<string, number>();
    for (const row of projectExpenses) {
        costBy.set(row.project_id ?? "", (costBy.get(row.project_id ?? "") ?? 0) + num(row._sum.amount_bdt));
    }
    for (const row of projectPayouts) {
        costBy.set(row.project_id ?? "", (costBy.get(row.project_id ?? "") ?? 0) + num(row._sum.amount_bdt));
    }

    const projectRows = projects.map((project) => ({
        id: project.id,
        name: project.name,
        code: project.code,
        plan_vs_actual_pct: planVsActual(
            actualBy.get(project.id) ?? 0,
            num(project.baseline_hours)
        ),
        scope_change_pct: scopeChange(
            num(project.contract_value_usd),
            num(project.baseline_value_usd)
        ),
        margin_pct: projectMargin(incomeBy.get(project.id) ?? 0, costBy.get(project.id) ?? 0),
        actual_hours: actualBy.get(project.id) ?? 0,
        baseline_hours: num(project.baseline_hours),
    }));

    // Hours and cost per department, over the window.
    //
    // Grouped through the person rather than stored on the row: a department
    // is a fact about somebody, and it moves when they move. Grouping in two
    // steps because neither timeEntry nor teamPayout can group by a field on
    // a relation.
    //
    // People with no department get a row of their own rather than being
    // dropped. Silently omitting them would make the departments add up to
    // less than the agency and give no clue why.
    const [departments, hoursByUser, payoutsByUser] = await Promise.all([
        prisma.department.findMany({
            where: { organization_id: user.organizationId },
            select: {
                id: true,
                name: true,
                members: { where: { deleted_at: null }, select: { id: true } },
            },
            orderBy: { name: "asc" },
        }),
        prisma.timeEntry.groupBy({
            by: ["user_id"],
            where: {
                organization_id: user.organizationId,
                deleted_at: null,
                date: { gte: range.from, lte: range.to },
            },
            _sum: { hours: true },
        }),
        prisma.teamPayout.groupBy({
            by: ["user_id"],
            where: {
                organization_id: user.organizationId,
                deleted_at: null,
                date: { gte: range.from, lte: range.to },
            },
            _sum: { amount_bdt: true },
        }),
    ]);

    const hoursOf = new Map(hoursByUser.map((row) => [row.user_id, num(row._sum.hours)]));
    const paidOf = new Map(payoutsByUser.map((row) => [row.user_id, num(row._sum.amount_bdt)]));
    const placed = new Set<string>();

    const departmentRows = departments.map((department) => {
        let hoursLogged = 0;
        let paidBdt = 0;

        for (const member of department.members) {
            placed.add(member.id);
            hoursLogged += hoursOf.get(member.id) ?? 0;
            paidBdt += paidOf.get(member.id) ?? 0;
        }

        return {
            id: department.id as string | null,
            name: department.name,
            people: department.members.length,
            hours_logged: hoursLogged,
            paid_bdt: paidBdt,
        };
    });

    const looseIds = new Set([...hoursOf.keys(), ...paidOf.keys()].filter((id) => !placed.has(id)));

    if (looseIds.size > 0) {
        let hoursLogged = 0;
        let paidBdt = 0;

        for (const id of looseIds) {
            hoursLogged += hoursOf.get(id) ?? 0;
            paidBdt += paidOf.get(id) ?? 0;
        }

        departmentRows.push({
            id: null,
            name: "No department",
            people: looseIds.size,
            hours_logged: hoursLogged,
            paid_bdt: paidBdt,
        });
    }

    const available = availableHours(capacity.weeklyHours, range.days);

    return {
        leading: {
            free_capacity_hours: Math.max(0, available - hours.total),
            overdue_milestones: overdue,
            utilization_pct: attainment(
                utilization(hours.billable, available),
                targetOf(targets, KpiMetric.utilization_pct)
            ),
        },
        lagging: {
            on_time_delivery_pct: attainment(
                onTimeDelivery(onTimeCount, delivered.length),
                targetOf(targets, KpiMetric.on_time_delivery_pct)
            ),
            milestones_delivered: delivered.length,
            milestones_on_time: onTimeCount,
            // Submitted and never signed off. Delivered is not done, and this
            // is the number that says how much is sitting on a client's desk.
            awaiting_acceptance: delivered.filter((milestone) => !milestone.accepted_at).length,
        },
        projects: projectRows,
        by_department: departmentRows,
        context: {
            available_hours: available,
            logged_hours: hours.total,
            baselined_projects: projects.length,
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

const getScope = async (scope: string, user: IRequestUser, options: ListOptions = {}) => {
    if (!(KPI_SCOPES as readonly string[]).includes(scope)) {
        throw new AppError(
            status.BAD_REQUEST,
            `Unknown scope. Use one of: ${KPI_SCOPES.join(", ")}`
        );
    }

    const typed = scope as KpiScope;
    const allowed = SCOPE_ROLES[typed];

    if (allowed && !allowed.includes(user.role as Role)) {
        throw new AppError(status.FORBIDDEN, "You do not have access to this scope");
    }

    const range = resolveRange(options);
    const meta = {
        scope: typed,
        from: range.from.toISOString().slice(0, 10),
        to: range.to.toISOString().slice(0, 10),
        days: range.days,
    };

    switch (typed) {
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
