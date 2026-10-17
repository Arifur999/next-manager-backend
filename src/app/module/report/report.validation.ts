import z from "zod";
import { listQuerySchema, queryFlag } from "../../shared/listQuery.js";

export const clientRevenueQueryZodSchema = listQuerySchema.extend({
    mine: queryFlag,
});

export const monthlySeriesQueryZodSchema = z.object({
    // Clamped rather than rejected: a silly value narrows the chart instead of
    // breaking the page.
    months: z.coerce
        .number()
        .int()
        .positive()
        .transform((months) => Math.min(months, 36))
        .catch(12)
        .default(12),
});
