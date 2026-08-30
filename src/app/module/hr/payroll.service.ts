import status from "http-status";
import { Prisma } from "../../../generated/prisma/client.js";
import {
    Currency,
    LedgerSource,
    PayoutType,
    PayrollStatus,
    UserStatus,
} from "../../../generated/prisma/enums.js";
import AppError from "../../errorHelpers/AppError.js";
import { IRequestUser } from "../../interfaces/requestUser.interface.js";
import { prisma } from "../../lib/prisma.js";
import { logActivity, money } from "../../shared/activity.js";
import { assertAccount, writeLedgerEntry } from "../../shared/ledger.js";
import {
    ICompletePayrollPayload,
    ICreatePayrollRunPayload,
    ISetPayrollItemsPayload,
} from "./hr.validation.js";

/**
 * A month's salaries.
 *
 * The rule the whole module is built around: **payroll does not record money of
 * its own.** Completing a run creates one TeamPayout per line, through the same
 * ledger path a payout entered by hand takes. Salary is therefore recorded in
 * exactly one place, and every profitability figure in the product - all of
 * which read TeamPayout - picks it up without knowing payroll exists.
 *
 * A second money trail would have been easier to write and impossible to
 * reconcile: the same salary would sit in two tables, and the first time
 * somebody corrected one the books would disagree with themselves forever.
 */

const toDate = (value: string) => new Date(`${value}T00:00:00.000Z`);

const RUN_SELECT = {
    id: true,
    period_start: true,
    period_end: true,
    status: true,
    notes: true,
    completed_at: true,
    account: { select: { id: true, name: true, currency: true } },
    items: {
        select: {
            id: true,
            gross_bdt: true,
            deductions_bdt: true,
            net_bdt: true,
            notes: true,
            payout_id: true,
            user: { select: { id: true, full_name: true, avatar_url: true, role: true } },
        },
        orderBy: { user: { full_name: "asc" } },
    },
} as const;

const getRuns = async (user: IRequestUser) =>
    prisma.payrollRun.findMany({
        where: { organization_id: user.organizationId },
        select: RUN_SELECT,
        orderBy: { period_start: "desc" },
        take: 24,
    });

/**
 * Opening a month.
 *
 * Starts with a line per active member at zero rather than an empty run:
 * payroll is a list somebody adjusts, not one they assemble from nothing, and
 * a missing person is the mistake this makes hardest to make.
 */
const createRun = async (payload: ICreatePayrollRunPayload, user: IRequestUser) => {
    const periodStart = toDate(payload.period_start);
    const periodEnd = toDate(payload.period_end);

    if (periodEnd < periodStart) {
        throw new AppError(status.BAD_REQUEST, "The period ends before it starts");
    }

    const existing = await prisma.payrollRun.findUnique({
        where: {
            organization_id_period_start: {
                organization_id: user.organizationId,
                period_start: periodStart,
            },
        },
        select: { id: true, status: true },
    });

    if (existing) {
        throw new AppError(
            status.CONFLICT,
            `There is already a ${existing.status} payroll run for that month. Open it rather than starting a second one.`
        );
    }

    const members = await prisma.user.findMany({
        where: {
            organization_id: user.organizationId,
            deleted_at: null,
            status: UserStatus.active,
        },
        select: { id: true },
    });

    return prisma.$transaction(async (tx) => {
        const run = await tx.payrollRun.create({
            data: {
                organization_id: user.organizationId,
                period_start: periodStart,
                period_end: periodEnd,
                notes: payload.notes ?? "",
                created_by: user.userId,
                items: { create: members.map((member) => ({ user_id: member.id })) },
            },
            select: RUN_SELECT,
        });

        await logActivity(
            tx,
            {
                entityType: "payroll_run",
                entityId: run.id,
                action: "created",
                summary: `Opened payroll for ${payload.period_start.slice(0, 7)} with ${members.length} people`,
            },
            user
        );

        return run;
    });
};

/**
 * Setting the numbers.
 *
 * Only while the run is a draft. Editing a completed one would leave the
 * payouts it produced saying something different from the payroll that produced
 * them, and the ledger is the half that people are paid from.
 */
const setItems = async (id: string, payload: ISetPayrollItemsPayload, user: IRequestUser) => {
    const run = await prisma.payrollRun.findFirst({
        where: { id, organization_id: user.organizationId },
        select: { id: true, status: true },
    });

    if (!run) {
        throw new AppError(status.NOT_FOUND, "Payroll run not found");
    }

    if (run.status === PayrollStatus.completed) {
        throw new AppError(
            status.CONFLICT,
            "That run has been paid. Record an adjustment as a payout rather than editing history."
        );
    }

    // Every line belongs to this run. Checked as a set - one borrowed id in a
    // list of twenty is exactly what a per-row check invites somebody to skip.
    const ids = payload.items.map((item) => item.id);
    const mine = await prisma.payrollItem.count({ where: { id: { in: ids }, run_id: id } });

    if (mine !== new Set(ids).size) {
        throw new AppError(status.NOT_FOUND, "One of those lines is not on this run");
    }

    return prisma.$transaction(async (tx) => {
        for (const item of payload.items) {
            const gross = new Prisma.Decimal(item.gross_bdt ?? 0);
            const deductions = new Prisma.Decimal(item.deductions_bdt ?? 0);

            if (deductions.greaterThan(gross)) {
                throw new AppError(
                    status.BAD_REQUEST,
                    "Deductions cannot be more than the gross - that would be a negative wage."
                );
            }

            await tx.payrollItem.update({
                where: { id: item.id },
                data: {
                    gross_bdt: gross,
                    deductions_bdt: deductions,
                    // Worked out here rather than trusted from the client: net
                    // is the number somebody is actually paid, and two places
                    // computing it is two places for it to be wrong.
                    net_bdt: gross.minus(deductions),
                    notes: item.notes ?? "",
                },
            });
        }

        return tx.payrollRun.findUniqueOrThrow({ where: { id }, select: RUN_SELECT });
    });
};

/**
 * Paying it.
 *
 * One TeamPayout per line with a net above zero, each writing its own ledger
 * entry - the same path teamPayout.service takes, so the money exists in one
 * shape only.
 *
 * Lines at zero are skipped rather than producing a payout of nothing. Somebody
 * who joined mid-month and is not being paid yet is a real line; a zero payout
 * against them is not a real payment.
 */
const complete = async (id: string, payload: ICompletePayrollPayload, user: IRequestUser) => {
    return prisma.$transaction(async (tx) => {
        const run = await tx.payrollRun.findFirst({
            where: { id, organization_id: user.organizationId },
            select: {
                id: true,
                status: true,
                period_start: true,
                period_end: true,
                items: { select: { id: true, user_id: true, net_bdt: true } },
            },
        });

        if (!run) {
            throw new AppError(status.NOT_FOUND, "Payroll run not found");
        }

        // The guard that stops a month being paid twice. The unique index on
        // (organization, period_start) stops a second run existing at all; this
        // stops the same run being completed again.
        if (run.status === PayrollStatus.completed) {
            throw new AppError(status.CONFLICT, "That run has already been paid");
        }

        const account = await assertAccount(tx, payload.account_id, user, Currency.BDT);

        const payable = run.items.filter((item) => new Prisma.Decimal(item.net_bdt).greaterThan(0));

        if (payable.length === 0) {
            throw new AppError(
                status.BAD_REQUEST,
                "Every line on this run is zero. Set the amounts before paying it."
            );
        }

        // Paid on the last day of the period rather than today, so a run
        // completed late still lands in the month it was for - otherwise
        // September's salaries would show up in October's costs.
        const date = run.period_end;
        let total = new Prisma.Decimal(0);

        for (const item of payable) {
            const payout = await tx.teamPayout.create({
                data: {
                    organization_id: user.organizationId,
                    date,
                    user_id: item.user_id,
                    amount_bdt: item.net_bdt,
                    type: PayoutType.salary,
                    account_id: payload.account_id,
                    notes: `Payroll ${run.period_start.toISOString().slice(0, 7)}`,
                    created_by: user.userId,
                },
            });

            await writeLedgerEntry(
                tx,
                {
                    accountId: payload.account_id,
                    date,
                    amount: new Prisma.Decimal(item.net_bdt).negated(),
                    sourceType: LedgerSource.team_payout,
                    sourceId: payout.id,
                    description: "Salary (payroll)",
                },
                user,
                Currency.BDT
            );

            await tx.payrollItem.update({
                where: { id: item.id },
                data: { payout_id: payout.id },
            });

            total = total.plus(item.net_bdt);
        }

        const completed = await tx.payrollRun.update({
            where: { id },
            data: {
                status: PayrollStatus.completed,
                account_id: payload.account_id,
                completed_at: new Date(),
                completed_by: user.userId,
            },
            select: RUN_SELECT,
        });

        await logActivity(
            tx,
            {
                entityType: "payroll_run",
                entityId: id,
                action: "updated",
                summary: `Paid ${payable.length} salaries for ${run.period_start.toISOString().slice(0, 7)}, ${money(total.toNumber(), "BDT")} from ${account.name}`,
            },
            user
        );

        return completed;
    });
};

/**
 * Removing a run.
 *
 * Only a draft. A completed run has produced payouts and moved the ledger, and
 * deleting it would leave the money with nothing explaining it - the payouts
 * themselves are what would have to be reversed, on the screen that owns them.
 */
const removeRun = async (id: string, user: IRequestUser) => {
    const run = await prisma.payrollRun.findFirst({
        where: { id, organization_id: user.organizationId },
        select: { id: true, status: true, period_start: true },
    });

    if (!run) {
        throw new AppError(status.NOT_FOUND, "Payroll run not found");
    }

    if (run.status === PayrollStatus.completed) {
        throw new AppError(
            status.CONFLICT,
            "That run has been paid. Reverse the payouts it created instead - deleting it would leave the money unexplained."
        );
    }

    return prisma.$transaction(async (tx) => {
        await tx.payrollRun.delete({ where: { id } });

        await logActivity(
            tx,
            {
                entityType: "payroll_run",
                entityId: id,
                action: "deleted",
                summary: `Discarded the draft payroll for ${run.period_start.toISOString().slice(0, 7)}`,
            },
            user
        );

        return { message: "Draft payroll discarded" };
    });
};

export const PayrollService = { getRuns, createRun, setItems, complete, removeRun };
