import status from "http-status";
import AppError from "../../errorHelpers/AppError.js";
import { type ListOptions } from "../../shared/listQuery.js";

export const DAY_MS = 24 * 60 * 60 * 1000;

export type Range = { from: Date; to: Date; days: number };

/**
 * The window every metric is computed over.
 *
 * Defaults to the last 30 days rather than all time: "utilization since the
 * company was founded" is not a number anybody acts on.
 */
export const resolveRange = (options: ListOptions): Range => {
    const to = options.to
        ? new Date(`${options.to}T23:59:59.999Z`)
        : new Date();

    const from = options.from
        ? new Date(`${options.from}T00:00:00.000Z`)
        : new Date(to.getTime() - 29 * DAY_MS);

    if (from.getTime() > to.getTime()) {
        throw new AppError(status.BAD_REQUEST, "The start of the range is after its end");
    }

    // Inclusive of both ends. Floor, not round: an explicit `to` ends at
    // 23:59:59.999, which rounding turned into one extra day.
    const days = Math.max(1, Math.floor((to.getTime() - from.getTime()) / DAY_MS) + 1);

    return { from, to, days };
};
