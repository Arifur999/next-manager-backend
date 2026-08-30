import status from "http-status";
import { LeaveStatus, NotificationEvent, Role } from "../../../generated/prisma/enums.js";
import AppError from "../../errorHelpers/AppError.js";
import { IRequestUser } from "../../interfaces/requestUser.interface.js";
import { prisma } from "../../lib/prisma.js";
import { logActivity } from "../../shared/activity.js";
import { notify } from "../../shared/notify.js";
import {
    ICreateLeaveTypePayload,
    IDecideLeavePayload,
    IRequestLeavePayload,
    IUpdateLeaveTypePayload,
} from "./hr.validation.js";

/**
 * Asking to be away, and somebody deciding.
 *
 * `days` is stored on the request rather than worked out from the dates,
 * because what counts as a working day is an agency's own business - half days,
 * weekends, public holidays - and recomputing it later would silently restate
 * leave that was already approved on different arithmetic.
 */

const toDate = (value: string) => new Date(`${value}T00:00:00.000Z`);

const TYPE_SELECT = {
    id: true,
    name: true,
    days_per_year: true,
    is_paid: true,
    is_active: true,
} as const;

const REQUEST_SELECT = {
    id: true,
    from_date: true,
    to_date: true,
    days: true,
    reason: true,
    status: true,
    decided_at: true,
    decision_note: true,
    user: { select: { id: true, full_name: true, avatar_url: true } },
    leave_type: { select: { id: true, name: true, is_paid: true } },
} as const;

// ---------------------------------------------------------------- types

const getTypes = async (user: IRequestUser) =>
    prisma.leaveType.findMany({
        where: { organization_id: user.organizationId },
        select: { ...TYPE_SELECT, _count: { select: { requests: true } } },
        orderBy: [{ is_active: "desc" }, { name: "asc" }],
    });

const createType = async (payload: ICreateLeaveTypePayload, user: IRequestUser) => {
    const name = payload.name.trim();

    const duplicate = await prisma.leaveType.findFirst({
        where: {
            organization_id: user.organizationId,
            name: { equals: name, mode: "insensitive" },
        },
        select: { name: true },
    });

    if (duplicate) {
        throw new AppError(status.CONFLICT, `"${duplicate.name}" already exists`);
    }

    return prisma.leaveType.create({
        data: {
            organization_id: user.organizationId,
            name,
            days_per_year: payload.days_per_year ?? 0,
            is_paid: payload.is_paid ?? true,
        },
        select: TYPE_SELECT,
    });
};

const updateType = async (id: string, payload: IUpdateLeaveTypePayload, user: IRequestUser) => {
    const existing = await prisma.leaveType.findFirst({
        where: { id, organization_id: user.organizationId },
        select: { id: true },
    });

    if (!existing) {
        throw new AppError(status.NOT_FOUND, "Leave type not found");
    }

    return prisma.leaveType.update({
        where: { id },
        data: {
            ...(payload.name !== undefined ? { name: payload.name.trim() } : {}),
            ...(payload.days_per_year !== undefined
                ? { days_per_year: payload.days_per_year }
                : {}),
            ...(payload.is_paid !== undefined ? { is_paid: payload.is_paid } : {}),
            ...(payload.is_active !== undefined ? { is_active: payload.is_active } : {}),
        },
        select: TYPE_SELECT,
    });
};

// ---------------------------------------------------------------- requests

/**
 * The queue, or one person's own.
 *
 * Operations sees only their own requests. Reading why every colleague was away
 * is not something a colleague should be able to do - the reason field alone
 * makes that clear.
 */
const getRequests = async (
    user: IRequestUser,
    filters: { status?: LeaveStatus; userId?: string; mine?: boolean } = {}
) => {
    const ownOnly = user.role === Role.operations || filters.mine;

    return prisma.leaveRequest.findMany({
        where: {
            organization_id: user.organizationId,
            ...(ownOnly ? { user_id: user.userId } : filters.userId ? { user_id: filters.userId } : {}),
            ...(filters.status ? { status: filters.status } : {}),
        },
        select: REQUEST_SELECT,
        orderBy: [{ status: "asc" }, { from_date: "desc" }],
        take: 200,
    });
};

/**
 * What is left of somebody's allowance this year.
 *
 * Counts approved days only. Counting pending ones would show a balance that
 * drops and then jumps back when a request is turned down, and somebody
 * planning around it would be planning around a number that is not theirs yet.
 *
 * A type with a zero allowance reports `null` remaining rather than zero:
 * "tracked but not capped" and "you have none left" are opposite answers.
 */
const getBalance = async (user: IRequestUser, userId: string, year: number) => {
    const from = new Date(Date.UTC(year, 0, 1));
    const to = new Date(Date.UTC(year, 11, 31));

    const [types, taken] = await Promise.all([
        prisma.leaveType.findMany({
            where: { organization_id: user.organizationId, is_active: true },
            select: TYPE_SELECT,
            orderBy: { name: "asc" },
        }),
        prisma.leaveRequest.groupBy({
            by: ["leave_type_id"],
            where: {
                organization_id: user.organizationId,
                user_id: userId,
                status: LeaveStatus.approved,
                from_date: { gte: from, lte: to },
            },
            _sum: { days: true },
        }),
    ]);

    const takenBy = new Map(taken.map((row) => [row.leave_type_id, Number(row._sum.days ?? 0)]));

    return types.map((type) => {
        const used = takenBy.get(type.id) ?? 0;

        return {
            leave_type: { id: type.id, name: type.name, is_paid: type.is_paid },
            days_per_year: type.days_per_year,
            days_taken: used,
            remaining: type.days_per_year > 0 ? type.days_per_year - used : null,
        };
    });
};

/**
 * Asking.
 *
 * Overlapping an existing request is refused. Two approved absences covering
 * the same day is not a thing that can be true, and letting it through would
 * double-count against the allowance.
 */
const request = async (payload: IRequestLeavePayload, user: IRequestUser) => {
    const type = await prisma.leaveType.findFirst({
        where: { id: payload.leave_type_id, organization_id: user.organizationId, is_active: true },
        select: { id: true, name: true },
    });

    if (!type) {
        throw new AppError(status.NOT_FOUND, "That kind of leave is not available");
    }

    const from = toDate(payload.from_date);
    const to = toDate(payload.to_date);

    if (to < from) {
        throw new AppError(status.BAD_REQUEST, "The last day cannot be before the first");
    }

    const clash = await prisma.leaveRequest.findFirst({
        where: {
            user_id: user.userId,
            status: { in: [LeaveStatus.pending, LeaveStatus.approved] },
            from_date: { lte: to },
            to_date: { gte: from },
        },
        select: { from_date: true, to_date: true, status: true },
    });

    if (clash) {
        throw new AppError(
            status.CONFLICT,
            `You already have ${clash.status} leave covering those dates. Cancel it first if you are changing the plan.`
        );
    }

    return prisma.$transaction(async (tx) => {
        const created = await tx.leaveRequest.create({
            data: {
                organization_id: user.organizationId,
                user_id: user.userId,
                leave_type_id: payload.leave_type_id,
                from_date: from,
                to_date: to,
                days: payload.days,
                reason: payload.reason ?? "",
            },
            select: REQUEST_SELECT,
        });

        await logActivity(
            tx,
            {
                entityType: "leave_request",
                entityId: created.id,
                action: "created",
                summary: `${user.name} asked for ${payload.days} days of ${type.name}`,
            },
            user
        );

        // The queue is invisible otherwise: somebody waiting on an answer will
        // not chase it, and the people who can answer have no reason to look.
        await notify(tx, user, {
            event: NotificationEvent.leave_requested,
            title: `${user.name} asked for ${payload.days} days of ${type.name}`,
            body: payload.reason || "No reason given.",
            entityType: "leave_request",
            entityId: created.id,
        });

        return created;
    });
};

/** Withdrawing your own, before anybody has decided. */
const cancel = async (id: string, user: IRequestUser) => {
    const existing = await prisma.leaveRequest.findFirst({
        where: { id, organization_id: user.organizationId, user_id: user.userId },
        select: { id: true, status: true },
    });

    if (!existing) {
        throw new AppError(status.NOT_FOUND, "Request not found");
    }

    if (existing.status !== LeaveStatus.pending) {
        throw new AppError(
            status.CONFLICT,
            `That request has already been ${existing.status}. Ask whoever decided it.`
        );
    }

    return prisma.leaveRequest.update({
        where: { id },
        data: { status: LeaveStatus.cancelled },
        select: REQUEST_SELECT,
    });
};

/**
 * Deciding.
 *
 * Only pending requests can be decided. Re-approving an approved one would
 * write a second decision over the first and lose who actually made it.
 */
const decide = async (id: string, payload: IDecideLeavePayload, user: IRequestUser) => {
    const existing = await prisma.leaveRequest.findFirst({
        where: { id, organization_id: user.organizationId },
        select: {
            id: true,
            status: true,
            user_id: true,
            days: true,
            leave_type: { select: { name: true } },
        },
    });

    if (!existing) {
        throw new AppError(status.NOT_FOUND, "Request not found");
    }

    if (existing.status !== LeaveStatus.pending) {
        throw new AppError(status.CONFLICT, `That request was already ${existing.status}`);
    }

    // Nobody signs off their own absence. The whole point of an approval is
    // that a second person looked at it.
    if (existing.user_id === user.userId) {
        throw new AppError(
            status.FORBIDDEN,
            "Somebody else has to decide your own leave."
        );
    }

    return prisma.$transaction(async (tx) => {
        const decided = await tx.leaveRequest.update({
            where: { id },
            data: {
                status: payload.approve ? LeaveStatus.approved : LeaveStatus.rejected,
                decided_by: user.userId,
                decided_at: new Date(),
                decision_note: payload.note ?? "",
            },
            select: REQUEST_SELECT,
        });

        await logActivity(
            tx,
            {
                entityType: "leave_request",
                entityId: id,
                action: "updated",
                summary: `${payload.approve ? "Approved" : "Turned down"} ${decided.user.full_name}'s ${existing.leave_type.name}`,
            },
            user
        );

        await notify(tx, user, {
            event: NotificationEvent.leave_decided,
            userId: existing.user_id,
            title: `Your ${existing.leave_type.name} was ${payload.approve ? "approved" : "turned down"}`,
            body: payload.note || "",
            entityType: "leave_request",
            entityId: id,
        });

        return decided;
    });
};

export const LeaveService = {
    getTypes,
    createType,
    updateType,
    getRequests,
    getBalance,
    request,
    cancel,
    decide,
};
