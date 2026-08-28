import z from "zod";
import { KpiMetric, KpiPeriod } from "../../../generated/prisma/enums.js";

export const createKpiTargetZodSchema = z.object({
    // Null (or absent) means the target belongs to the whole agency rather than
    // to one person. Both can exist for the same metric and period - an agency
    // target is not the sum of the individual ones.
    user_id: z.uuid("user_id must be a valid id").optional().nullable(),
    metric: z.enum(KpiMetric, "Unknown metric"),
    period: z.enum(KpiPeriod, "Period must be month, quarter or year"),
    period_start: z.iso.date("period_start must be YYYY-MM-DD"),
    // Non-negative rather than positive: a target of zero is meaningful for
    // metrics like scope changes, where the goal is none.
    target_value: z
        .number("Target must be a number")
        .min(0, "Target cannot be negative"),
    notes: z.string("Notes must be a string").optional(),
});

// metric, period and period_start identify the target. Changing them would
// silently re-point it at a different period, so they are set once.
export const updateKpiTargetZodSchema = createKpiTargetZodSchema
    .pick({ target_value: true, notes: true })
    .partial();

export type ICreateKpiTargetPayload = z.infer<typeof createKpiTargetZodSchema>;
export type IUpdateKpiTargetPayload = z.infer<typeof updateKpiTargetZodSchema>;

/**
 * Metrics measured as a percentage.
 *
 * Kept here rather than inferred from the name so adding a metric forces a
 * decision about which kind it is: a 150 stored against a percentage metric is
 * a typo, but against revenue_usd it is a small month.
 */
export const PERCENTAGE_METRICS: KpiMetric[] = [
    KpiMetric.utilization_pct,
    KpiMetric.realization_pct,
    KpiMetric.gross_margin_pct,
    KpiMetric.win_rate_pct,
    KpiMetric.on_time_delivery_pct,
    KpiMetric.project_margin_pct,
];
