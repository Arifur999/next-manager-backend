import { Prisma } from "../../../generated/prisma/client.js";
import { IRequestUser } from "../../interfaces/requestUser.interface.js";
import { prisma } from "../../lib/prisma.js";
import { dateRangeWhere, pageSlice, type ListOptions } from "../../shared/listQuery.js";

/**
 * Who tried to sign in, and whether it worked.
 *
 * Scoped to the caller's agency by `organization_id`, which is also what keeps
 * the boundary honest: an attempt at an address with no account carries a null
 * organization_id, so it belongs to no company and appears on nobody's screen.
 * That is a property of the row rather than a filter somebody has to remember.
 */

/** Kept for 90 days. Long enough to investigate, short enough not to hoard. */
export const RETENTION_DAYS = 90;

const SELECT = {
    id: true,
    email: true,
    success: true,
    ip: true,
    user_agent: true,
    created_at: true,
    user: { select: { id: true, full_name: true, role: true } },
} as const;

const getLoginEvents = async (
    user: IRequestUser,
    options: ListOptions = {},
    filters: { success?: boolean; userId?: string } = {}
) => {
    const where: Prisma.LoginEventWhereInput = {
        organization_id: user.organizationId,
        ...dateRangeWhere(options),
        ...(filters.success !== undefined ? { success: filters.success } : {}),
        ...(filters.userId ? { user_id: filters.userId } : {}),
    };

    // A page when one was asked for, otherwise a hard cap. An unpaginated
    // security log is a page that gets slower every day it is useful.
    const slice = pageSlice(options) ?? { skip: 0, take: 100 };

    const [rows, total, failedLately] = await Promise.all([
        prisma.loginEvent.findMany({
            where,
            select: SELECT,
            orderBy: { created_at: "desc" },
            ...slice,
        }),
        prisma.loginEvent.count({ where }),
        // The number the screen exists for. Counted over the last day and
        // ignoring the caller's own filters, so narrowing the list cannot hide
        // the thing somebody opened this page to notice.
        prisma.loginEvent.count({
            where: {
                organization_id: user.organizationId,
                success: false,
                created_at: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
            },
        }),
    ]);

    return { rows, total, failed_last_24h: failedLately, retention_days: RETENTION_DAYS };
};

/**
 * Drop what is older than the retention window.
 *
 * Runs nightly. Idempotent by construction - it deletes rows whose date has
 * already passed, so a missed night is caught by the next one.
 */
const pruneLoginEvents = async () => {
    const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
    const { count } = await prisma.loginEvent.deleteMany({ where: { created_at: { lt: cutoff } } });

    return { deleted: count, cutoff };
};

export const SecurityService = { getLoginEvents, pruneLoginEvents };
