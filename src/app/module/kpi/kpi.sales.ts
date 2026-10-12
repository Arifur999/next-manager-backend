import { KpiMetric, LeadStage } from "../../../generated/prisma/enums.js";
import { IRequestUser } from "../../interfaces/requestUser.interface.js";
import { prisma } from "../../lib/prisma.js";
import { OPEN_LEAD_STAGES } from "../../shared/leadStage.js";
import { DAY_MS, type Range } from "./kpi.range.js";
import { attainment, averageDealSize, pipelineCoverage, pipelineVelocity, salesCycleDays, winRate } from "./kpi.formulas.js";
import { dateColumn, num, loadTargets, targetOf } from "./kpi.loaders.js";

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
export const salesScope = async (user: IRequestUser, range: Range, mine = false) => {
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
