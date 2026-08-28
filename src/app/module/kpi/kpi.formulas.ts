/**
 * Every KPI, as arithmetic and nothing else.
 *
 * No Prisma, no request, no dates-from-now. The service gathers the numbers;
 * this file turns them into metrics, which is why it is the part with tests.
 * A ratio computed inline inside a query handler is a ratio nobody ever checks.
 *
 * Two rules run through all of it:
 *
 *   1. **An empty denominator returns null, never zero.** "No data" and "zero
 *      percent" are different answers, and collapsing them is how a dashboard
 *      tells somebody their utilization is 0% on the day they joined. Every
 *      caller has to handle null, which is the point.
 *
 *   2. **USD and BDT are never added.** Every figure here is USD, because that
 *      is the currency the agency bills in. BDT exists only through recorded
 *      exchanges at the rate actually received, and mixing the two would
 *      produce a total that is true in no currency at all.
 */

/** A metric that could not be computed, and why - so a screen can say so. */
export type Unmeasurable = {
    value: null;
    reason: string;
};

export type Measured = {
    value: number;
    reason?: undefined;
};

export type Metric = Measured | Unmeasurable;

export const measured = (value: number): Measured => ({ value });

export const unmeasurable = (reason: string): Unmeasurable => ({ value: null, reason });

/** Rounds to two decimals. Percentages with six decimal places read as noise. */
export const round2 = (value: number): number => Math.round(value * 100) / 100;

const ratio = (numerator: number, denominator: number, reason: string): Metric =>
    denominator > 0 ? measured(round2((numerator / denominator) * 100)) : unmeasurable(reason);

// ---------------------------------------------------------------------------
// Capacity
// ---------------------------------------------------------------------------

/**
 * Available hours over a span of days.
 *
 * Derived from the weekly figure rather than counting working days, because
 * weekly_hours is already "what this person is expected to be available for in
 * a week" - a part-timer's 20 hours is not five days of four.
 */
export const availableHours = (weeklyHours: number, days: number): number =>
    round2((weeklyHours / 7) * days);

/**
 * Billable hours over available hours.
 *
 * The benchmark worth showing against: healthy agencies run 65-80%; most sit
 * at 55-65%. Above 85% is not a win - it means no slack for the unbilled work
 * that keeps an agency running.
 */
export const utilization = (billableHours: number, available: number): Metric =>
    ratio(billableHours, available, "No capacity recorded for this period");

/**
 * What the billable hours were actually worth, against what they should have
 * been worth at the bill rate.
 *
 * This is the number that catches the agency that is busy and poor: 80%
 * utilization with 60% realization means the hours happened and the money did
 * not. Healthy is above 85%.
 */
export const realization = (collectedUsd: number, billableHours: number, rateUsd: number): Metric => {
    if (rateUsd <= 0) {
        return unmeasurable("No bill rate set, so billable hours have no value to compare against");
    }

    if (billableHours <= 0) {
        return unmeasurable("No billable hours logged in this period");
    }

    return measured(round2((collectedUsd / (billableHours * rateUsd)) * 100));
};

/** Collected money per billable hour. The blunt version of realization. */
export const effectiveHourlyRate = (collectedUsd: number, billableHours: number): Metric =>
    billableHours > 0
        ? measured(round2(collectedUsd / billableHours))
        : unmeasurable("No billable hours logged in this period");

// ---------------------------------------------------------------------------
// Money
// ---------------------------------------------------------------------------

/**
 * Gross margin.
 *
 * Direct cost is team payouts plus project expenses. Owner withdrawals are
 * deliberately NOT cost - taking money out of the company is not the cost of
 * producing the work, and counting it would make every profitable month look
 * like whatever the owner happened to withdraw.
 *
 * Can legitimately be negative: a month that cost more than it earned should
 * say so rather than clamp to zero.
 */
export const grossMargin = (revenueUsd: number, directCostUsd: number): Metric =>
    revenueUsd > 0
        ? measured(round2(((revenueUsd - directCostUsd) / revenueUsd) * 100))
        : unmeasurable("No revenue collected in this period");

/**
 * Revenue per head.
 *
 * The benchmark is $150k-250k a year. Compared against an annualised figure by
 * the caller - a monthly number against a yearly benchmark is the kind of
 * comparison that makes a healthy agency look like it is failing.
 */
export const revenuePerPerson = (revenueUsd: number, headcount: number): Metric =>
    headcount > 0
        ? measured(round2(revenueUsd / headcount))
        : unmeasurable("No active people in this period");

/** Annualises a figure covering `days` days, so it can meet a yearly benchmark. */
export const annualise = (value: number, days: number): Metric =>
    days > 0 ? measured(round2((value / days) * 365)) : unmeasurable("Empty date range");

// ---------------------------------------------------------------------------
// Selling
// ---------------------------------------------------------------------------

/**
 * Win rate over deals that were actually decided.
 *
 * Open deals are excluded from the denominator. Counting them would make the
 * rate fall every time a new lead arrives and rise when one is abandoned,
 * which is backwards.
 */
export const winRate = (won: number, lost: number): Metric =>
    ratio(won, won + lost, "No deals were decided in this period");

/** Average value of the deals that were won. */
export const averageDealSize = (wonValueUsd: number, wonCount: number): Metric =>
    wonCount > 0 ? measured(round2(wonValueUsd / wonCount)) : unmeasurable("No deals won in this period");

/**
 * Open pipeline against the revenue it has to produce.
 *
 * Expressed as a multiple, not a percentage: 3.0 means three dollars of open
 * pipeline for every dollar of target, which is the shape of the rule of thumb
 * (3-4x for a healthy pipeline).
 */
export const pipelineCoverage = (openPipelineUsd: number, revenueTargetUsd: number): Metric =>
    revenueTargetUsd > 0
        ? measured(round2(openPipelineUsd / revenueTargetUsd))
        : unmeasurable("No revenue target set for this period");

/**
 * Mean days from a lead's first stage to the day it was won.
 *
 * Only closed-won deals count. Including open ones would report a cycle length
 * for deals that have not finished, which gets shorter the more stale leads
 * are sitting in the pipeline.
 */
export const salesCycleDays = (cycleLengths: number[]): Metric => {
    if (cycleLengths.length === 0) {
        return unmeasurable("No deals have been won yet, so there is no cycle to measure");
    }

    const total = cycleLengths.reduce((running, days) => running + days, 0);
    return measured(round2(total / cycleLengths.length));
};

/**
 * Pipeline velocity: how much value the pipeline produces per day.
 *
 * (open deals x win rate x average deal size) / cycle length. Every input is a
 * metric that can itself be unmeasurable, so this returns null unless all of
 * them are real - a velocity built on a guessed cycle length is worse than no
 * velocity.
 */
export const pipelineVelocity = (
    openDeals: number,
    winRatePct: number | null,
    avgDealSizeUsd: number | null,
    cycleDays: number | null
): Metric => {
    if (winRatePct === null || avgDealSizeUsd === null || cycleDays === null) {
        return unmeasurable("Needs a win rate, an average deal size and a cycle length");
    }

    if (cycleDays <= 0) {
        return unmeasurable("Cycle length is zero, so velocity is undefined");
    }

    return measured(round2((openDeals * (winRatePct / 100) * avgDealSizeUsd) / cycleDays));
};

// ---------------------------------------------------------------------------
// Delivery
// ---------------------------------------------------------------------------

/**
 * On-time delivery, counted over milestones rather than projects.
 *
 * Measured on submission, not acceptance: the team controls when it hands work
 * over, not when a client gets round to signing it off. Benchmark is above 90%.
 */
export const onTimeDelivery = (onTimeCount: number, deliveredCount: number): Metric =>
    ratio(onTimeCount, deliveredCount, "Nothing has been delivered in this period");

/**
 * Actual hours against the hours the project was baselined at.
 *
 * 100 means exactly on plan, 130 means it took a third longer than sold. A
 * project with no baseline returns null rather than infinity - an unbaselined
 * project is not infinitely over, it is unmeasured.
 */
export const planVsActual = (actualHours: number, baselineHours: number): Metric =>
    baselineHours > 0
        ? measured(round2((actualHours / baselineHours) * 100))
        : unmeasurable("This project was never baselined, so there is no plan to compare against");

/**
 * How far the contract has moved from what was originally sold.
 *
 * Signed: positive is scope added, negative is scope cut. Benchmark is to keep
 * the magnitude under 15%.
 */
export const scopeChange = (currentValueUsd: number, baselineValueUsd: number): Metric =>
    baselineValueUsd > 0
        ? measured(round2(((currentValueUsd - baselineValueUsd) / baselineValueUsd) * 100))
        : unmeasurable("This project was never baselined, so there is no original to drift from");

/**
 * Project margin: what was collected against what the project cost to deliver.
 *
 * Benchmark is 60-70%. Same rule as gross margin - owner withdrawals are not a
 * cost of delivery.
 */
export const projectMargin = (collectedUsd: number, deliveryCostUsd: number): Metric =>
    collectedUsd > 0
        ? measured(round2(((collectedUsd - deliveryCostUsd) / collectedUsd) * 100))
        : unmeasurable("Nothing has been collected on this project yet");

// ---------------------------------------------------------------------------
// Scoring against a target
// ---------------------------------------------------------------------------

export type Attainment = {
    value: number | null;
    target: number | null;
    /** Share of target reached, as a percentage. Null without both numbers. */
    attainment_pct: number | null;
    /** null when either side is missing - "unknown" is not "off track". */
    on_track: boolean | null;
    reason?: string;
};

/**
 * A metric next to the target it was supposed to hit.
 *
 * `lowerIsBetter` exists because some metrics are goals to stay under - scope
 * change and plan-vs-actual are both better small. Scoring those the same way
 * as revenue would mark a project that came in under budget as failing.
 */
export const attainment = (
    metric: Metric,
    target: number | null,
    { lowerIsBetter = false }: { lowerIsBetter?: boolean } = {}
): Attainment => {
    if (metric.value === null) {
        return { value: null, target, attainment_pct: null, on_track: null, reason: metric.reason };
    }

    if (target === null) {
        return {
            value: metric.value,
            target: null,
            attainment_pct: null,
            on_track: null,
            reason: "No target set, so there is nothing to be on track against",
        };
    }

    if (target === 0) {
        // A target of zero is meaningful (no scope changes), but a percentage
        // OF zero is not. on_track still answers, which is what matters.
        return {
            value: metric.value,
            target: 0,
            attainment_pct: null,
            on_track: lowerIsBetter ? metric.value <= 0 : metric.value >= 0,
            reason: "Target is zero, so attainment has no percentage",
        };
    }

    return {
        value: metric.value,
        target,
        attainment_pct: round2((metric.value / target) * 100),
        on_track: lowerIsBetter ? metric.value <= target : metric.value >= target,
    };
};
