import { prisma } from "../lib/prisma.js";

/**
 * How many hours a week somebody is available for, resolved the same way
 * everywhere.
 *
 * This exists because it was briefly answered in two places and they disagreed:
 * the capacity screen showed everyone at 40, while the KPI engine read only
 * stored Capacity rows and reported "no capacity recorded" for the same people.
 * A company would have seen a full team roster on one screen and a null
 * utilization on the other, with nothing to explain the difference.
 *
 * The default is applied, not withheld - a company that has never opened the
 * capacity screen still gets a utilization figure. What it also gets is
 * `defaulted`, so the screen can say how much of the denominator is an
 * assumption rather than a decision.
 */

export const DEFAULT_WEEKLY_HOURS = 40;

export type CapacityRow = {
    user_id: string;
    weekly_hours: number;
    standard_rate_usd: number;
    /** True when nobody set this person's hours and the default is standing in. */
    is_default: boolean;
};

export const loadCapacityRows = async (
    organizationId: string,
    userId?: string
): Promise<CapacityRow[]> => {
    const [members, stored] = await Promise.all([
        prisma.user.findMany({
            where: {
                organization_id: organizationId,
                deleted_at: null,
                is_active: true,
                ...(userId ? { id: userId } : {}),
            },
            select: { id: true },
        }),
        prisma.capacity.findMany({
            where: { organization_id: organizationId, ...(userId ? { user_id: userId } : {}) },
            select: { user_id: true, weekly_hours: true, standard_rate_usd: true },
        }),
    ]);

    const byUser = new Map(stored.map((row) => [row.user_id, row]));

    return members.map((member) => {
        const row = byUser.get(member.id);
        return {
            user_id: member.id,
            weekly_hours: row ? row.weekly_hours.toNumber() : DEFAULT_WEEKLY_HOURS,
            // No default for the rate. Hours can be assumed because everybody
            // works some; what an hour is worth is a commercial decision and
            // guessing it would put a fabricated number under realization.
            standard_rate_usd: row ? row.standard_rate_usd.toNumber() : 0,
            is_default: !row,
        };
    });
};
