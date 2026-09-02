import status from "http-status";
import { Prisma } from "../../../generated/prisma/client.js";
import { Currency, LedgerSource } from "../../../generated/prisma/enums.js";
import AppError from "../../errorHelpers/AppError.js";
import { IRequestUser } from "../../interfaces/requestUser.interface.js";
import { prisma } from "../../lib/prisma.js";
import { assertAccount, reverseLedgerEntries, writeLedgerEntry } from "../../shared/ledger.js";
import { dateRangeWhere, pageSlice, type ListOptions } from "../../shared/listQuery.js";
import {
    ICreateDistributionPayload,
    ICreateShareholderPayload,
    IUpdateShareholderPayload,
} from "./loan.validation.js";

/**
 * The people who own the agency, and profit paid out to them.
 *
 * A distribution is NOT an expense. It is profit being handed to owners, the
 * same way an owner withdrawal is - treating it as a cost would let an agency
 * reduce its own reported profit simply by paying itself. Profit and loss reads
 * expenses and team payouts, so nothing here reaches it; the ledger and the
 * account balances see all of it, because the money genuinely leaves.
 */

const toDate = (value: string) => new Date(`${value}T00:00:00.000Z`);

const SHAREHOLDER_INCLUDE = {
    user: { select: { id: true, full_name: true, email: true } },
};

/**
 * Shares cannot add up to more than the whole business.
 *
 * Checked across ACTIVE shareholders only, and with the row being edited
 * excluded so that changing somebody from 30 to 40 is measured against the
 * others rather than against their own old figure counted twice.
 *
 * A retired shareholder is left out because their share has gone somewhere -
 * counting it would block every legitimate reassignment.
 */
const assertShareTotal = async (
    tx: Prisma.TransactionClient | typeof prisma,
    user: IRequestUser,
    nextPct: number,
    excludeId?: string
) => {
    const others = await tx.shareholder.aggregate({
        where: {
            organization_id: user.organizationId,
            deleted_at: null,
            is_active: true,
            ...(excludeId ? { id: { not: excludeId } } : {}),
        },
        _sum: { share_pct: true },
    });

    const existing = others._sum.share_pct?.toNumber() ?? 0;
    const total = existing + nextPct;

    // Rounded before comparing: three partners on 33.33 each is 99.99, and a
    // float comparison that failed at 100.00000000001 would be a bug people
    // could never explain.
    if (Number(total.toFixed(2)) > 100) {
        throw new AppError(
            status.BAD_REQUEST,
            `Shares would total ${total.toFixed(2)}%. The others already hold ${existing.toFixed(2)}%.`
        );
    }
};

const assertOwnShareholder = async (
    tx: Prisma.TransactionClient | typeof prisma,
    id: string,
    user: IRequestUser
) => {
    const shareholder = await tx.shareholder.findFirst({
        where: { id, organization_id: user.organizationId, deleted_at: null },
        select: { id: true, name: true, is_active: true },
    });

    // A foreign key proves the row exists, never that it is yours.
    if (!shareholder) {
        throw new AppError(status.NOT_FOUND, "Shareholder not found");
    }

    return shareholder;
};

/** Everybody, with what each has been paid. Two queries, not one per person. */
const getAll = async (user: IRequestUser) => {
    const [shareholders, grouped] = await Promise.all([
        prisma.shareholder.findMany({
            where: { organization_id: user.organizationId, deleted_at: null },
            include: SHAREHOLDER_INCLUDE,
            orderBy: [{ is_active: "desc" }, { share_pct: "desc" }, { name: "asc" }],
        }),
        prisma.shareholderDistribution.groupBy({
            by: ["shareholder_id"],
            where: { organization_id: user.organizationId, deleted_at: null },
            _sum: { amount_bdt: true },
        }),
    ]);

    const paid = new Map(
        grouped.map((row) => [row.shareholder_id, row._sum.amount_bdt?.toNumber() ?? 0])
    );

    const rows = shareholders.map((shareholder) => ({
        ...shareholder,
        share_pct: shareholder.share_pct.toNumber(),
        total_paid_bdt: paid.get(shareholder.id) ?? 0,
    }));

    const allocated = rows
        .filter((row) => row.is_active)
        .reduce((sum, row) => sum + row.share_pct, 0);

    return {
        rows,
        total: rows.length,
        // What is still unassigned. Named rather than left for the reader to
        // subtract, because "who owns the rest" is the question this page is
        // opened with.
        allocated_pct: Number(allocated.toFixed(2)),
        unallocated_pct: Number((100 - allocated).toFixed(2)),
    };
};

const create = async (payload: ICreateShareholderPayload, user: IRequestUser) => {
    return prisma.$transaction(async (tx) => {
        if (payload.user_id) {
            // Same reason as everywhere else: the id proves a user exists, not
            // that they are one of ours.
            const member = await tx.user.findFirst({
                where: { id: payload.user_id, organization_id: user.organizationId, deleted_at: null },
                select: { id: true },
            });

            if (!member) {
                throw new AppError(status.NOT_FOUND, "That person is not on your team");
            }
        }

        await assertShareTotal(tx, user, payload.share_pct ?? 0);

        return tx.shareholder.create({
            data: {
                organization_id: user.organizationId,
                user_id: payload.user_id ?? null,
                name: payload.name,
                share_pct: payload.share_pct ?? 0,
                notes: payload.notes ?? "",
            },
            include: SHAREHOLDER_INCLUDE,
        });
    });
};

const update = async (id: string, payload: IUpdateShareholderPayload, user: IRequestUser) => {
    return prisma.$transaction(async (tx) => {
        const existing = await assertOwnShareholder(tx, id, user);

        if (payload.user_id) {
            const member = await tx.user.findFirst({
                where: { id: payload.user_id, organization_id: user.organizationId, deleted_at: null },
                select: { id: true },
            });

            if (!member) {
                throw new AppError(status.NOT_FOUND, "That person is not on your team");
            }
        }

        // Only worth checking when they will actually hold a share afterwards.
        // Retiring somebody frees their percentage rather than needing it.
        const willBeActive = payload.is_active ?? existing.is_active;

        if (payload.share_pct !== undefined && willBeActive) {
            await assertShareTotal(tx, user, payload.share_pct, id);
        }

        return tx.shareholder.update({
            where: { id },
            data: payload,
            include: SHAREHOLDER_INCLUDE,
        });
    });
};

const remove = async (id: string, user: IRequestUser) => {
    return prisma.$transaction(async (tx) => {
        await assertOwnShareholder(tx, id, user);

        const paidCount = await tx.shareholderDistribution.count({
            where: { shareholder_id: id, organization_id: user.organizationId, deleted_at: null },
        });

        // Their distributions moved real money through real accounts. Removing
        // the person would leave those ledger rows pointing at nobody, so a
        // shareholder with history is retired instead.
        if (paidCount > 0) {
            throw new AppError(
                status.CONFLICT,
                "This shareholder has distributions recorded. Make them inactive instead."
            );
        }

        await tx.shareholder.update({ where: { id }, data: { deleted_at: new Date() } });

        return { message: "Shareholder deleted successfully" };
    });
};

const getDistributions = async (
    user: IRequestUser,
    shareholderId?: string,
    options: ListOptions = {}
) => {
    const where: Prisma.ShareholderDistributionWhereInput = {
        organization_id: user.organizationId,
        deleted_at: null,
        ...(shareholderId ? { shareholder_id: shareholderId } : {}),
        ...dateRangeWhere(options),
    };

    const include = {
        shareholder: { select: { id: true, name: true, share_pct: true } },
        account: { select: { id: true, name: true, currency: true } },
    };

    const slice = pageSlice(options);

    if (!slice) {
        const rows = await prisma.shareholderDistribution.findMany({
            where,
            include,
            orderBy: { date: "desc" },
        });
        return { rows, total: rows.length };
    }

    const [rows, total] = await Promise.all([
        prisma.shareholderDistribution.findMany({
            where,
            include,
            orderBy: { date: "desc" },
            skip: slice.skip,
            take: slice.take,
        }),
        prisma.shareholderDistribution.count({ where }),
    ]);

    return { rows, total };
};

const createDistribution = async (payload: ICreateDistributionPayload, user: IRequestUser) => {
    return prisma.$transaction(async (tx) => {
        const shareholder = await assertOwnShareholder(tx, payload.shareholder_id, user);

        await assertAccount(tx, payload.account_id, user, Currency.BDT);

        const date = toDate(payload.date);

        const distribution = await tx.shareholderDistribution.create({
            data: {
                organization_id: user.organizationId,
                shareholder_id: payload.shareholder_id,
                date,
                amount_bdt: payload.amount_bdt,
                account_id: payload.account_id,
                notes: payload.notes ?? "",
                created_by: user.userId,
            },
        });

        // Money out, and its own source rather than expense: an expense is a
        // cost of earning profit, this is profit already earned being handed
        // over. The cash-flow report can tell them apart because of this.
        await writeLedgerEntry(
            tx,
            {
                accountId: payload.account_id,
                date,
                amount: -payload.amount_bdt,
                sourceType: LedgerSource.shareholder_distribution,
                sourceId: distribution.id,
                description: `Distribution to ${shareholder.name}`,
            },
            user,
            Currency.BDT
        );

        return distribution;
    });
};

const deleteDistribution = async (id: string, user: IRequestUser) => {
    return prisma.$transaction(async (tx) => {
        const existing = await tx.shareholderDistribution.findFirst({
            where: { id, organization_id: user.organizationId, deleted_at: null },
        });

        if (!existing) {
            throw new AppError(status.NOT_FOUND, "Distribution not found");
        }

        await reverseLedgerEntries(
            tx,
            LedgerSource.shareholder_distribution,
            id,
            user,
            "Distribution deleted"
        );

        await tx.shareholderDistribution.update({ where: { id }, data: { deleted_at: new Date() } });

        return { message: "Distribution deleted successfully" };
    });
};

export const ShareholderService = {
    getAll,
    create,
    update,
    remove,
    getDistributions,
    createDistribution,
    deleteDistribution,
};
