import status from "http-status";
import { LeaveStatus, UserStatus } from "../../../generated/prisma/enums.js";
import AppError from "../../errorHelpers/AppError.js";
import { IRequestUser } from "../../interfaces/requestUser.interface.js";
import { prisma } from "../../lib/prisma.js";
import { DEFAULT_WEEKLY_HOURS, loadCapacityRows } from "../../shared/capacity.js";
import { endOfDay, toDateOnly } from "../../shared/dates.js";
import { type ListOptions } from "../../shared/listQuery.js";
// The same hours-per-period arithmetic utilization is measured with, so a
// workload row and a KPI cannot describe the same week differently.
import { availableHours } from "../kpi/kpi.formulas.js";
import { ISetCapacityPayload } from "./timeEntry.validation.js";

/**
 * Everyone's weekly capacity, defaulted for anyone who has never had one set.
 *
 * Returning a row for every active person rather than only those with a stored
 * capacity is what lets utilization be computed for the whole team without the
 * caller having to know who is missing.
 */
const getCapacities = async (user: IRequestUser) => {
    const [members, rows] = await Promise.all([
        prisma.user.findMany({
            where: { organization_id: user.organizationId, deleted_at: null, status: UserStatus.active },
            select: { id: true, full_name: true, email: true, role: true },
            orderBy: { full_name: "asc" },
        }),
        // Same helper the KPI engine divides by, so the hours shown here and
        // the hours utilization is measured against are the same hours.
        loadCapacityRows(user.organizationId),
    ]);

    const byUser = new Map(rows.map((row) => [row.user_id, row]));

    return members.map((member) => {
        const row = byUser.get(member.id);
        return {
            user: member,
            weekly_hours: row?.weekly_hours ?? DEFAULT_WEEKLY_HOURS,
            standard_rate_usd: row?.standard_rate_usd ?? 0,
            is_default: row?.is_default ?? true,
        };
    });
};

const setCapacity = async (
    userId: string,
    payload: ISetCapacityPayload,
    user: IRequestUser
) => {
    const member = await prisma.user.findFirst({
        where: { id: userId, organization_id: user.organizationId, deleted_at: null },
        select: { id: true },
    });

    if (!member) {
        throw new AppError(status.NOT_FOUND, "Team member not found");
    }

    // Either field can be sent alone, so an untouched one keeps its stored
    // value rather than being reset to the column default - setting a rate
    // must not silently return a part-timer to a 40-hour week.
    return prisma.capacity.upsert({
        where: { user_id: userId },
        create: {
            organization_id: user.organizationId,
            user_id: userId,
            ...(payload.weekly_hours !== undefined ? { weekly_hours: payload.weekly_hours } : {}),
            ...(payload.standard_rate_usd !== undefined
                ? { standard_rate_usd: payload.standard_rate_usd }
                : {}),
        },
        update: {
            ...(payload.weekly_hours !== undefined ? { weekly_hours: payload.weekly_hours } : {}),
            ...(payload.standard_rate_usd !== undefined
                ? { standard_rate_usd: payload.standard_rate_usd }
                : {}),
        },
    });
};

/**
 * What each person is carrying, and what is left of them.
 *
 * ONE query behind both readings. Workload is the hours side, Availability is
 * the gap side, and computing them apart is how two screens end up disagreeing
 * about one person's week - which is the mistake `loadCapacityRows` already
 * exists to have fixed once.
 *
 * Capacity DEFAULTS to 40 rather than staying null, following the decision that
 * helper documents: a company that has never opened the capacity screen still
 * gets a figure. What it also gets is `is_default` on every row, so the screen
 * can say which denominators are an assumption rather than a decision.
 *
 * Hours are counted as LOGGED, not as approved. A project manager deciding who
 * to give work to next needs what people are actually doing this week, and
 * approval happens days later - waiting for it would show a team as idle right
 * up until the moment it was too late to act on.
 */
const getWorkload = async (user: IRequestUser, options: ListOptions = {}) => {
    // Defaults to the current week, because "who is free right now" is the
    // question this screen is opened with.
    const to = options.to ? endOfDay(options.to) : new Date();
    const from = options.from
        ? toDateOnly(options.from)
        : new Date(to.getTime() - 6 * 24 * 60 * 60 * 1000);

    const days = Math.max(1, Math.round((to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000)) + 1);

    const [members, capacity, logged, leave] = await Promise.all([
        prisma.user.findMany({
            where: {
                organization_id: user.organizationId,
                deleted_at: null,
                status: UserStatus.active,
            },
            select: {
                id: true,
                full_name: true,
                email: true,
                role: true,
                avatar_url: true,
                department: { select: { id: true, name: true } },
            },
            orderBy: { full_name: "asc" },
        }),
        loadCapacityRows(user.organizationId),
        prisma.timeEntry.groupBy({
            by: ["user_id"],
            where: {
                organization_id: user.organizationId,
                deleted_at: null,
                date: { gte: from, lte: to },
            },
            _sum: { hours: true },
        }),
        // Approved leave overlapping the window. Somebody away on Thursday is
        // not available on Thursday, and a workload screen that ignored it
        // would send work to an empty desk.
        prisma.leaveRequest.findMany({
            where: {
                organization_id: user.organizationId,
                status: LeaveStatus.approved,
                from_date: { lte: to },
                to_date: { gte: from },
            },
            select: { user_id: true, days: true, from_date: true, to_date: true },
        }),
    ]);

    const capacityByUser = new Map(capacity.map((row) => [row.user_id, row]));
    const loggedByUser = new Map(
        logged.map((row) => [row.user_id, row._sum.hours?.toNumber() ?? 0])
    );
    const leaveByUser = new Map<string, number>();
    for (const row of leave) {
        leaveByUser.set(row.user_id, (leaveByUser.get(row.user_id) ?? 0) + Number(row.days));
    }

    const rows = members.map((member) => {
        const own = capacityByUser.get(member.id);
        const weekly = own?.weekly_hours ?? DEFAULT_WEEKLY_HOURS;
        const available = availableHours(weekly, days);
        const loggedHours = loggedByUser.get(member.id) ?? 0;

        return {
            user: member,
            weekly_hours: weekly,
            // Says which of these numbers rests on an assumption rather than on
            // somebody having decided it.
            is_default: own?.is_default ?? true,
            available_hours: available,
            logged_hours: Math.round(loggedHours * 100) / 100,
            // Both readings of one subtraction, so they cannot disagree.
            remaining_hours: Math.round((available - loggedHours) * 100) / 100,
            utilization_pct:
                available > 0 ? Math.round((loggedHours / available) * 1000) / 10 : null,
            leave_days: leaveByUser.get(member.id) ?? 0,
        };
    });

    return {
        rows,
        from: from.toISOString().slice(0, 10),
        to: to.toISOString().slice(0, 10),
        days,
    };
};

export const TimeCapacityService = {
    getCapacities,
    setCapacity,
    getWorkload,
};
