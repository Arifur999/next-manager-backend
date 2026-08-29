import status from "http-status";
import { Prisma } from "../../../generated/prisma/client.js";
import { Role } from "../../../generated/prisma/enums.js";
import AppError from "../../errorHelpers/AppError.js";
import { IRequestUser } from "../../interfaces/requestUser.interface.js";
import { prisma } from "../../lib/prisma.js";
import { DEFAULT_WEEKLY_HOURS, loadCapacityRows } from "../../shared/capacity.js";
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

        return tx.timeEntry.create({
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
    });
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
            where: { organization_id: user.organizationId, deleted_at: null, is_active: true },
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

export const TimeEntryService = {
    getAllEntries,
    getSummary,
    createEntry,
    updateEntry,
    setApproval,
    deleteEntry,
    getCapacities,
    setCapacity,
};
