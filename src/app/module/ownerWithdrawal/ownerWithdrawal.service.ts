import status from "http-status";
import { Prisma } from "../../../generated/prisma/client.js";
import { Currency, LedgerSource } from "../../../generated/prisma/enums.js";
import AppError from "../../errorHelpers/AppError.js";
import { IRequestUser } from "../../interfaces/requestUser.interface.js";
import { prisma } from "../../lib/prisma.js";
import { assertAccount, reverseLedgerEntries, writeLedgerEntry } from "../../shared/ledger.js";
import { dateRangeWhere, pageSlice, type ListOptions } from "../../shared/listQuery.js";
import {
    ICreateOwnerWithdrawalPayload,
    IUpdateOwnerWithdrawalPayload,
} from "./ownerWithdrawal.validation.js";

/**
 * Money the owner takes out of the business.
 *
 * The one table in the app that an admin or manager must never read - which is
 * enforced on the route, not here. A withdrawal is not a business expense and
 * must never be counted as one: it is profit already earned, leaving. Reports
 * that add it to expenses would understate profit by exactly the amount taken.
 */

const toDate = (value: string) => new Date(`${value}T00:00:00.000Z`);

const getAllWithdrawals = async (user: IRequestUser, options: ListOptions = {}) => {
    const where: Prisma.OwnerWithdrawalWhereInput = {
        organization_id: user.organizationId,
        deleted_at: null,
        ...dateRangeWhere(options),
    };

    const include = { account: { select: { id: true, name: true, currency: true } } };
    const slice = pageSlice(options);

    if (!slice) {
        const rows = await prisma.ownerWithdrawal.findMany({ where, include, orderBy: { date: "desc" } });
        return { rows, total: rows.length };
    }

    const [rows, total] = await Promise.all([
        prisma.ownerWithdrawal.findMany({
            where,
            include,
            orderBy: { date: "desc" },
            skip: slice.skip,
            take: slice.take,
        }),
        prisma.ownerWithdrawal.count({ where }),
    ]);

    return { rows, total };
};

const createWithdrawal = async (payload: ICreateOwnerWithdrawalPayload, user: IRequestUser) => {
    return prisma.$transaction(async (tx) => {
        await assertAccount(tx, payload.account_id, user, Currency.BDT);

        const date = toDate(payload.date);

        const withdrawal = await tx.ownerWithdrawal.create({
            data: {
                organization_id: user.organizationId,
                date,
                amount_bdt: payload.amount_bdt,
                type: payload.type,
                account_id: payload.account_id,
                notes: payload.notes ?? "",
                created_by: user.userId,
            },
        });

        await writeLedgerEntry(
            tx,
            {
                accountId: payload.account_id,
                date,
                amount: -payload.amount_bdt,
                sourceType: LedgerSource.owner_withdrawal,
                sourceId: withdrawal.id,
                description: `Owner withdrawal (${payload.type})`,
            },
            user,
            Currency.BDT
        );

        return withdrawal;
    });
};

const updateWithdrawal = async (
    id: string,
    payload: IUpdateOwnerWithdrawalPayload,
    user: IRequestUser
) => {
    return prisma.$transaction(async (tx) => {
        const existing = await tx.ownerWithdrawal.findFirst({
            where: { id, organization_id: user.organizationId, deleted_at: null },
        });

        if (!existing) {
            throw new AppError(status.NOT_FOUND, "Withdrawal not found");
        }

        const accountId = payload.account_id ?? existing.account_id;
        await assertAccount(tx, accountId, user, Currency.BDT);

        const date = payload.date ? toDate(payload.date) : existing.date;
        const amount = payload.amount_bdt ?? existing.amount_bdt.toNumber();

        const ledgerChanged =
            accountId !== existing.account_id ||
            amount !== existing.amount_bdt.toNumber() ||
            date.getTime() !== existing.date.getTime();

        if (ledgerChanged) {
            await reverseLedgerEntries(tx, LedgerSource.owner_withdrawal, id, user, "Withdrawal edited");
            await writeLedgerEntry(
                tx,
                {
                    accountId,
                    date,
                    amount: -amount,
                    sourceType: LedgerSource.owner_withdrawal,
                    sourceId: id,
                    description: `Owner withdrawal (${payload.type ?? existing.type})`,
                },
                user,
                Currency.BDT
            );
        }

        return tx.ownerWithdrawal.update({
            where: { id },
            data: {
                date,
                amount_bdt: amount,
                type: payload.type ?? undefined,
                account_id: accountId,
                notes: payload.notes ?? undefined,
            },
        });
    });
};

const deleteWithdrawal = async (id: string, user: IRequestUser) => {
    return prisma.$transaction(async (tx) => {
        const existing = await tx.ownerWithdrawal.findFirst({
            where: { id, organization_id: user.organizationId, deleted_at: null },
        });

        if (!existing) {
            throw new AppError(status.NOT_FOUND, "Withdrawal not found");
        }

        await reverseLedgerEntries(tx, LedgerSource.owner_withdrawal, id, user, "Withdrawal deleted");

        await tx.ownerWithdrawal.update({
            where: { id },
            data: { deleted_at: new Date(), deleted_by: user.userId },
        });

        return { message: "Withdrawal deleted successfully" };
    });
};

export const OwnerWithdrawalService = {
    getAllWithdrawals,
    createWithdrawal,
    updateWithdrawal,
    deleteWithdrawal,
};
