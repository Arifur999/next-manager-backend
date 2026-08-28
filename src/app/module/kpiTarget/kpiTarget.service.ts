import status from "http-status";
import { Prisma } from "../../../generated/prisma/client.js";
import { KpiMetric, KpiPeriod } from "../../../generated/prisma/enums.js";
import AppError from "../../errorHelpers/AppError.js";
import { IRequestUser } from "../../interfaces/requestUser.interface.js";
import { prisma } from "../../lib/prisma.js";
import {
    ICreateKpiTargetPayload,
    IUpdateKpiTargetPayload,
    PERCENTAGE_METRICS,
} from "./kpiTarget.validation.js";

/**
 * The numbers somebody committed to.
 *
 * A KPI without a target is a fact, not a verdict: 62% utilization is neither
 * good nor bad until it is next to the number it was supposed to be. This is
 * the whole reason the model exists, so a target that cannot be scored - one
 * whose period does not start where its period type says it should - is
 * refused rather than stored.
 */

const INCLUDE = {
    user: { select: { id: true, full_name: true, email: true } },
} as const;

const toDate = (value: string) => new Date(`${value}T00:00:00.000Z`);

/**
 * A period has to start where its type says it does.
 *
 * Without this, "Q3" starting on the 14th of August would sit alongside a
 * real Q3 and the engine would have no way to tell which one a quarter's
 * numbers belong to.
 */
const assertPeriodStart = (period: KpiPeriod, start: Date) => {
    const day = start.getUTCDate();
    const month = start.getUTCMonth(); // 0-indexed

    if (day !== 1) {
        throw new AppError(status.BAD_REQUEST, "A period must start on the first of a month");
    }

    if (period === KpiPeriod.quarter && month % 3 !== 0) {
        throw new AppError(
            status.BAD_REQUEST,
            "A quarter must start in January, April, July or October"
        );
    }

    if (period === KpiPeriod.year && month !== 0) {
        throw new AppError(status.BAD_REQUEST, "A yearly target must start in January");
    }
};

// 150% utilization is not an ambitious goal, it is a typo - and one that makes
// every attainment figure computed against it meaningless.
const assertValue = (metric: KpiMetric, value: number) => {
    if (PERCENTAGE_METRICS.includes(metric) && value > 100) {
        throw new AppError(
            status.BAD_REQUEST,
            `${metric} is a percentage, so ${value} cannot be a target`
        );
    }
};

const assertUserInOrg = async (userId: string, user: IRequestUser) => {
    const member = await prisma.user.findFirst({
        where: { id: userId, organization_id: user.organizationId, deleted_at: null },
        select: { id: true },
    });

    if (!member) {
        throw new AppError(status.NOT_FOUND, "User not found");
    }
};

const getAllTargets = async (
    user: IRequestUser,
    filters: { userId?: string; metric?: KpiMetric; period?: KpiPeriod }
) => {
    const where: Prisma.KpiTargetWhereInput = {
        organization_id: user.organizationId,
        deleted_at: null,
        ...(filters.userId ? { user_id: filters.userId } : {}),
        ...(filters.metric ? { metric: filters.metric } : {}),
        ...(filters.period ? { period: filters.period } : {}),
    };

    const rows = await prisma.kpiTarget.findMany({
        where,
        include: INCLUDE,
        orderBy: [{ period_start: "desc" }, { metric: "asc" }],
    });

    return { rows, total: rows.length };
};

const createTarget = async (payload: ICreateKpiTargetPayload, user: IRequestUser) => {
    const periodStart = toDate(payload.period_start);

    assertPeriodStart(payload.period, periodStart);
    assertValue(payload.metric, payload.target_value);

    if (payload.user_id) {
        await assertUserInOrg(payload.user_id, user);
    }

    // Postgres treats NULLs as distinct, so the unique index does NOT catch a
    // second agency-wide target for the same metric and period. Checked here
    // instead - two targets for one period means two different verdicts on the
    // same number, and nothing downstream could choose between them.
    const duplicate = await prisma.kpiTarget.findFirst({
        where: {
            organization_id: user.organizationId,
            user_id: payload.user_id ?? null,
            metric: payload.metric,
            period: payload.period,
            period_start: periodStart,
            deleted_at: null,
        },
        select: { id: true },
    });

    if (duplicate) {
        throw new AppError(
            status.CONFLICT,
            "A target already exists for that metric and period. Edit it instead."
        );
    }

    return prisma.kpiTarget.create({
        data: {
            organization_id: user.organizationId,
            user_id: payload.user_id ?? null,
            metric: payload.metric,
            period: payload.period,
            period_start: periodStart,
            target_value: payload.target_value,
            notes: payload.notes ?? "",
            created_by: user.userId,
        },
        include: INCLUDE,
    });
};

const updateTarget = async (id: string, payload: IUpdateKpiTargetPayload, user: IRequestUser) => {
    const existing = await prisma.kpiTarget.findFirst({
        where: { id, organization_id: user.organizationId, deleted_at: null },
    });

    if (!existing) {
        throw new AppError(status.NOT_FOUND, "Target not found");
    }

    if (payload.target_value !== undefined) {
        assertValue(existing.metric, payload.target_value);
    }

    return prisma.kpiTarget.update({
        where: { id },
        data: {
            ...(payload.target_value !== undefined ? { target_value: payload.target_value } : {}),
            ...(payload.notes !== undefined ? { notes: payload.notes } : {}),
        },
        include: INCLUDE,
    });
};

const deleteTarget = async (id: string, user: IRequestUser) => {
    const existing = await prisma.kpiTarget.findFirst({
        where: { id, organization_id: user.organizationId, deleted_at: null },
    });

    if (!existing) {
        throw new AppError(status.NOT_FOUND, "Target not found");
    }

    await prisma.kpiTarget.update({ where: { id }, data: { deleted_at: new Date() } });

    return { message: "Target deleted successfully" };
};

export const KpiTargetService = {
    getAllTargets,
    createTarget,
    updateTarget,
    deleteTarget,
};
