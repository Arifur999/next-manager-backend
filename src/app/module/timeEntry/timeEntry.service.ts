import status from "http-status";
import { Prisma } from "../../../generated/prisma/client.js";
import { LeaveStatus, NotificationEvent, Role, UserStatus } from "../../../generated/prisma/enums.js";
import AppError from "../../errorHelpers/AppError.js";
import { IRequestUser } from "../../interfaces/requestUser.interface.js";
import { prisma } from "../../lib/prisma.js";
import { notify } from "../../shared/notify.js";
import { DEFAULT_WEEKLY_HOURS, loadCapacityRows } from "../../shared/capacity.js";
// The same hours-per-period arithmetic utilization is measured with, so a
// workload row and a KPI cannot describe the same week differently.
import { availableHours } from "../kpi/kpi.formulas.js";
import { dateRangeWhere, pageSlice, type ListOptions } from "../../shared/listQuery.js";
import {
    ICreateTimeEntryPayload,
    ISetCapacityPayload,
    IUpdateTimeEntryPayload,
} from "./timeEntry.validation.js";

/**
 * Logged hours.
 *
 * Two rules run through the whole module:
 *
 *   1. **Operations only ever touches their own time.** Not a UI courtesy - the
 *      scope is applied to the where clause, so an id belonging to someone else
 *      reads as "not found" rather than as a permission error. Which of a
 *      colleague's rows exist is not information to hand out.
 *
 *   2. **Approved entries are frozen.** Approval is what makes an hour
 *      billable; letting it be edited afterwards means the number a report was
 *      built from can change under it. Correcting an approved entry means
 *      un-approving it first, which is a deliberate act by someone senior.
 */

const toDate = (value: string) => new Date(`${value}T00:00:00.000Z`);

// A day is 24 hours. Anything above it is a typo - almost always a decimal
// point in the wrong place - and letting it through poisons every utilization
// figure computed from it afterwards.
const MAX_HOURS_PER_ENTRY = 24;

const INCLUDE = {
    user: { select: { id: true, full_name: true, email: true, avatar_url: true } },
    project: { select: { id: true, name: true, code: true } },
    task: { select: { id: true, title: true } },
} as const;

/** Operations sees only their own rows; everyone above sees the company's. */
const visibilityScope = (user: IRequestUser): Prisma.TimeEntryWhereInput =>
    user.role === Role.operations ? { user_id: user.userId } : {};

const assertHours = (hours: number) => {
    if (hours > MAX_HOURS_PER_ENTRY) {
        throw new AppError(
            status.BAD_REQUEST,
            `${hours} hours in one day is not possible. Check the decimal point.`
        );
    }
};

const assertReferences = async (
    tx: Prisma.TransactionClient,
    payload: { project_id?: string; task_id?: string | null },
    user: IRequestUser
) => {
    if (payload.project_id) {
        const project = await tx.project.findFirst({
            where: {
                id: payload.project_id,
                organization_id: user.organizationId,
                deleted_at: null,
                // The same scope the project LIST applies. Without it the read
                // was scoped and the write was not: operations could not see a
                // project but could still log hours against it by id, which
                // both contradicts the picker in front of them and lets anybody
                // pollute a project's cost figures.
                ...(user.role === Role.operations
                    ? { members: { some: { user_id: user.userId } } }
                    : {}),
            },
            select: { id: true },
        });

        if (!project) {
            throw new AppError(
                status.NOT_FOUND,
                user.role === Role.operations
                    ? // Says what to do rather than just no. Being on the team
                      // is the thing that unlocks this, and the person cannot
                      // add themselves.
                      "Project not found. Ask a project manager to add you to it."
                    : "Project not found"
            );
        }
    }

    if (payload.task_id) {
        const task = await tx.task.findFirst({
            where: { id: payload.task_id, organization_id: user.organizationId, deleted_at: null },
            select: { id: true, project_id: true },
        });
        if (!task) throw new AppError(status.NOT_FOUND, "Task not found");

        // A task belonging to a different project would make the project's
        // logged hours disagree with the sum of its tasks'.
        if (payload.project_id && task.project_id !== payload.project_id) {
            throw new AppError(status.BAD_REQUEST, "That task belongs to a different project");
        }
    }
};

const getAllEntries = async (
    user: IRequestUser,
    filters: { userId?: string; projectId?: string; approved?: boolean },
    options: ListOptions = {}
) => {
    const where: Prisma.TimeEntryWhereInput = {
        organization_id: user.organizationId,
        deleted_at: null,
        ...visibilityScope(user),
        ...dateRangeWhere(options),
        ...(filters.userId ? { user_id: filters.userId } : {}),
        ...(filters.projectId ? { project_id: filters.projectId } : {}),
        ...(filters.approved === true ? { approved_at: { not: null } } : {}),
        ...(filters.approved === false ? { approved_at: null } : {}),
    };

    const orderBy: Prisma.TimeEntryOrderByWithRelationInput[] = [
        { date: "desc" },
        { created_at: "desc" },
    ];

    const slice = pageSlice(options);

    if (!slice) {
        const rows = await prisma.timeEntry.findMany({ where, include: INCLUDE, orderBy });
        return { rows, total: rows.length };
    }

    const [rows, total] = await Promise.all([
        prisma.timeEntry.findMany({ where, include: INCLUDE, orderBy, skip: slice.skip, take: slice.take }),
        prisma.timeEntry.count({ where }),
    ]);

    return { rows, total };
};

/**
 * Hours by day for one person over a range - what the timesheet grid draws.
 *
 * Grouped in the database rather than by pulling every row: a month of entries
 * for a whole team is a lot of rows to ship just to add them up.
 */
const getSummary = async (
    user: IRequestUser,
    filters: { userId?: string },
    options: ListOptions = {}
) => {
    // Operations can only ever summarise themselves, whatever they ask for.
    const targetUserId =
        user.role === Role.operations ? user.userId : filters.userId ?? undefined;

    const where: Prisma.TimeEntryWhereInput = {
        organization_id: user.organizationId,
        deleted_at: null,
        ...(targetUserId ? { user_id: targetUserId } : {}),
        ...dateRangeWhere(options),
    };

    const [byDay, totals] = await Promise.all([
        prisma.timeEntry.groupBy({
            by: ["date", "is_billable"],
            where,
            _sum: { hours: true },
            orderBy: { date: "asc" },
        }),
        prisma.timeEntry.groupBy({
            by: ["is_billable"],
            where,
            _sum: { hours: true },
        }),
    ]);

    const billable = totals.find((row) => row.is_billable)?._sum.hours?.toNumber() ?? 0;
    const nonBillable = totals.find((row) => !row.is_billable)?._sum.hours?.toNumber() ?? 0;

    return {
        days: byDay.map((row) => ({
            date: row.date,
            is_billable: row.is_billable,
            hours: row._sum.hours?.toNumber() ?? 0,
        })),
        billable_hours: billable,
        non_billable_hours: nonBillable,
        total_hours: billable + nonBillable,
    };
};

const createEntry = async (payload: ICreateTimeEntryPayload, user: IRequestUser) => {
    assertHours(payload.hours);

    return prisma.$transaction(async (tx) => {
        await assertReferences(tx, payload, user);

        const entry = await tx.timeEntry.create({
            data: {
                organization_id: user.organizationId,
                // Always the caller. Logging time on somebody else's behalf is
                // not a thing this endpoint does - it would make the audit
                // trail meaningless.
                user_id: user.userId,
                project_id: payload.project_id,
                task_id: payload.task_id ?? null,
                date: toDate(payload.date),
                hours: payload.hours,
                is_billable: payload.is_billable,
                notes: payload.notes ?? "",
            },
            include: INCLUDE,
        });

        // Only when it actually needs somebody. An entry that arrives already
        // approved - or one an approver logged for themselves - is not a
        // queue item, and telling people about it is the noise that teaches
        // them to stop looking at the bell.
        if (!entry.approved_at) {
            await notify(tx, user, {
                event: NotificationEvent.time_awaiting_approval,
                title: `${user.name} logged ${entry.hours} hours on ${entry.project.name}`,
                body: entry.notes || "No note left.",
                entityType: "time_entry",
                entityId: entry.id,
            });
        }

        return entry;    });
};

const updateEntry = async (id: string, payload: IUpdateTimeEntryPayload, user: IRequestUser) => {
    if (payload.hours !== undefined) assertHours(payload.hours);

    return prisma.$transaction(async (tx) => {
        const existing = await tx.timeEntry.findFirst({
            where: {
                id,
                organization_id: user.organizationId,
                deleted_at: null,
                ...visibilityScope(user),
            },
        });

        if (!existing) {
            throw new AppError(status.NOT_FOUND, "Time entry not found");
        }

        if (existing.approved_at) {
            throw new AppError(
                status.CONFLICT,
                "This entry has been approved. Un-approve it first if it needs changing."
            );
        }

        await assertReferences(tx, payload, user);

        return tx.timeEntry.update({
            where: { id },
            data: {
                project_id: payload.project_id ?? undefined,
                task_id: payload.task_id === undefined ? undefined : payload.task_id,
                date: payload.date ? toDate(payload.date) : undefined,
                hours: payload.hours ?? undefined,
                is_billable: payload.is_billable ?? undefined,
                notes: payload.notes ?? undefined,
            },
            include: INCLUDE,
        });
    });
};

/**
 * Approve or un-approve. Never the person's own entry.
 *
 * Self-approval would make the whole step ceremonial - the reason approval
 * exists is that a second person looked at it.
 */
const setApproval = async (id: string, approved: boolean, user: IRequestUser) => {
    const existing = await prisma.timeEntry.findFirst({
        where: { id, organization_id: user.organizationId, deleted_at: null },
        select: { id: true, user_id: true },
    });

    if (!existing) {
        throw new AppError(status.NOT_FOUND, "Time entry not found");
    }

    if (existing.user_id === user.userId) {
        throw new AppError(status.CONFLICT, "You cannot approve your own time");
    }

    return prisma.timeEntry.update({
        where: { id },
        data: {
            approved_at: approved ? new Date() : null,
            approved_by: approved ? user.userId : null,
        },
        include: INCLUDE,
    });
};

const deleteEntry = async (id: string, user: IRequestUser) => {
    const existing = await prisma.timeEntry.findFirst({
        where: {
            id,
            organization_id: user.organizationId,
            deleted_at: null,
            ...visibilityScope(user),
        },
    });

    if (!existing) {
        throw new AppError(status.NOT_FOUND, "Time entry not found");
    }

    if (existing.approved_at) {
        throw new AppError(
            status.CONFLICT,
            "This entry has been approved. Un-approve it first if it needs removing."
        );
    }

    await prisma.timeEntry.update({ where: { id }, data: { deleted_at: new Date() } });

    return { message: "Time entry deleted" };
};

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
    const to = options.to ? new Date(`${options.to}T23:59:59.999Z`) : new Date();
    const from = options.from
        ? new Date(`${options.from}T00:00:00.000Z`)
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

export const TimeEntryService = {
    getAllEntries,
    getSummary,
    createEntry,
    updateEntry,
    setApproval,
    deleteEntry,
    getCapacities,
    getWorkload,
    setCapacity,
};
