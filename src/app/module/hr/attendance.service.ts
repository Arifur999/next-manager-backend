import status from "http-status";
import { AttendanceSource } from "../../../generated/prisma/enums.js";
import AppError from "../../errorHelpers/AppError.js";
import { IRequestUser } from "../../interfaces/requestUser.interface.js";
import { resolveScope } from "../../shared/resolveScope.js";
import { prisma } from "../../lib/prisma.js";
import { IRecordAttendancePayload } from "./hr.validation.js";
import { toDateOnly } from "../../shared/dates.js";

/**
 * Who was here, and when - deliberately not TimeEntry, because being present and
 * logging hours are different facts. One row per person per day, written as an
 * upsert, so a second check-in corrects the day rather than adding one.
 */

const SELECT = {
    id: true,
    date: true,
    check_in: true,
    check_out: true,
    source: true,
    notes: true,
    user: { select: { id: true, full_name: true, avatar_url: true } },
} as const;

/** Midnight UTC for a YYYY-MM-DD, matching every other date column here. */

const today = () => {
    const now = new Date();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
};

/**
 * Everyone's attendance, or one person's. When every colleague arrived is a
 * management view: without the "all" attendance view, only one's own rows.
 */
const getAll = async (
    user: IRequestUser,
    filters: { from?: string; to?: string; userId?: string } = {}
) => {
    // Read from the permission rows now. Only "all" sees the whole company;
    // every narrower answer means their own rows, because attendance belongs to
    // one person and there is nothing between "mine" and "everybody".
    const ownOnly = (await resolveScope(user, "attendance", "view")) !== "all";

    return prisma.attendance.findMany({
        where: {
            organization_id: user.organizationId,
            ...(ownOnly ? { user_id: user.userId } : filters.userId ? { user_id: filters.userId } : {}),
            ...(filters.from || filters.to
                ? {
                      date: {
                          ...(filters.from ? { gte: toDateOnly(filters.from) } : {}),
                          ...(filters.to ? { lte: toDateOnly(filters.to) } : {}),
                      },
                  }
                : {}),
        },
        select: SELECT,
        orderBy: [{ date: "desc" }, { check_in: "asc" }],
        take: 400,
    });
};

/**
 * Clocking in, or out: the second call of the day sets the check-out, decided
 * from what is stored rather than from the caller.
 */
const clock = async (user: IRequestUser) => {
    const date = today();

    const existing = await prisma.attendance.findUnique({
        where: { user_id_date: { user_id: user.userId, date } },
        select: { id: true, check_in: true, check_out: true },
    });

    if (!existing) {
        return prisma.attendance.create({
            data: {
                organization_id: user.organizationId,
                user_id: user.userId,
                date,
                check_in: new Date(),
                source: AttendanceSource.self,
            },
            select: SELECT,
        });
    }

    if (existing.check_out) {
        throw new AppError(
            status.CONFLICT,
            "You have already checked out today. Ask an admin to correct it if that is wrong."
        );
    }

    return prisma.attendance.update({
        where: { id: existing.id },
        data: { check_out: new Date() },
        select: SELECT,
    });
};

/**
 * Recording somebody else's day, marked `admin` rather than `self`: "they clocked
 * in" and "somebody wrote it down for them" are different claims.
 */
const record = async (payload: IRecordAttendancePayload, user: IRequestUser) => {
    const member = await prisma.user.findFirst({
        where: { id: payload.user_id, organization_id: user.organizationId, deleted_at: null },
        select: { id: true },
    });

    if (!member) {
        throw new AppError(status.NOT_FOUND, "That person is not on your team");
    }

    const date = toDateOnly(payload.date);
    const at = (time?: string) => (time ? new Date(`${payload.date}T${time}:00.000Z`) : null);

    const checkIn = at(payload.check_in);
    const checkOut = at(payload.check_out);

    if (checkIn && checkOut && checkOut <= checkIn) {
        throw new AppError(status.BAD_REQUEST, "Check-out has to be after check-in");
    }

    return prisma.attendance.upsert({
        where: { user_id_date: { user_id: payload.user_id, date } },
        create: {
            organization_id: user.organizationId,
            user_id: payload.user_id,
            date,
            check_in: checkIn,
            check_out: checkOut,
            source: AttendanceSource.admin,
            notes: payload.notes ?? "",
        },
        update: {
            check_in: checkIn,
            check_out: checkOut,
            source: AttendanceSource.admin,
            notes: payload.notes ?? "",
        },
        select: SELECT,
    });
};

export const AttendanceService = { getAll, clock, record };
