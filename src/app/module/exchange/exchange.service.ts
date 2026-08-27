import status from "http-status";
import { Prisma } from "../../../generated/prisma/client.js";
import { Currency, LedgerSource } from "../../../generated/prisma/enums.js";
import AppError from "../../errorHelpers/AppError.js";
import { IRequestUser } from "../../interfaces/requestUser.interface.js";
import { prisma } from "../../lib/prisma.js";
import { logActivity, money } from "../../shared/activity.js";
import { assertAccount, getAccountBalances, reverseLedgerEntries, writeLedgerEntry } from "../../shared/ledger.js";
import { dateRangeWhere, pageSlice, type ListOptions } from "../../shared/listQuery.js";
import { ICreateExchangePayload } from "./exchange.validation.js";

/**
 * Moving USD into BDT. This is the only place BDT comes into existence.
 *
 * One exchange writes two ledger rows in a single transaction - USD out of the
 * source wallet, BDT into the destination - so the two halves can never end up
 * recorded separately.
 *
 * `rate` is what the processor actually paid, which is normally worse than the
 * mid-market rate an API reports. That gap is the processor's margin, and
 * recording the real figure is the difference between books that reconcile and
 * books that do not.
 */

const toDate = (value: string) => new Date(`${value}T00:00:00.000Z`);

const getAllExchanges = async (user: IRequestUser, options: ListOptions = {}) => {
    const where: Prisma.ExchangeTransactionWhereInput = {
        organization_id: user.organizationId,
        deleted_at: null,
        ...dateRangeWhere(options),
    };

    const include = {
        from_account: { select: { id: true, name: true, currency: true } },
        to_account: { select: { id: true, name: true, currency: true } },
    };

    const slice = pageSlice(options);

    if (!slice) {
        const rows = await prisma.exchangeTransaction.findMany({ where, include, orderBy: { date: "desc" } });
        return { rows, total: rows.length };
    }

    const [rows, total] = await Promise.all([
        prisma.exchangeTransaction.findMany({
            where,
            include,
            orderBy: { date: "desc" },
            skip: slice.skip,
            take: slice.take,
        }),
        prisma.exchangeTransaction.count({ where }),
    ]);

    return { rows, total };
};

const createExchange = async (payload: ICreateExchangePayload, user: IRequestUser) => {
    const feeUsd = payload.fee_usd ?? 0;

    if (feeUsd >= payload.amount_usd) {
        throw new AppError(status.BAD_REQUEST, "The fee cannot be equal to or larger than the amount exchanged");
    }

    return prisma.$transaction(async (tx) => {
        // The currency checks are the ones that matter: picking the wrong wallet
        // in the UI is easy, and without these it would corrupt both balances at
        // once and look plausible on every screen.
        const fromAccount = await assertAccount(tx, payload.from_account_id, user, Currency.USD);
        const toAccount = await assertAccount(tx, payload.to_account_id, user, Currency.BDT);

        // Guarding against exchanging money that is not there. Checked here
        // rather than in the UI because the UI can be stale by the time it
        // submits, and an overdrawn wallet is a real accounting error rather
        // than a display bug.
        const balances = await getAccountBalances(user);
        const fromBalance = balances.find((entry) => entry.accountId === fromAccount.id)?.balance ?? 0;

        if (payload.amount_usd > fromBalance) {
            throw new AppError(
                status.CONFLICT,
                `"${fromAccount.name}" holds $${fromBalance.toFixed(2)}, which is less than the $${payload.amount_usd.toFixed(2)} being exchanged.`
            );
        }

        const date = toDate(payload.date);

        // Stored rather than recomputed on read, so a later change to the
        // rounding rule cannot silently restate history.
        const amountBdt = new Prisma.Decimal(payload.amount_usd)
            .minus(feeUsd)
            .times(payload.rate)
            .toDecimalPlaces(2);

        const exchange = await tx.exchangeTransaction.create({
            data: {
                organization_id: user.organizationId,
                date,
                from_account_id: payload.from_account_id,
                to_account_id: payload.to_account_id,
                amount_usd: payload.amount_usd,
                rate: payload.rate,
                fee_usd: feeUsd,
                amount_bdt: amountBdt,
                notes: payload.notes ?? "",
                created_by: user.userId,
            },
        });

        // The fee leaves the USD side with the rest of the amount - it never
        // reached BDT, so deducting the full amount here and crediting only the
        // net on the other side is what makes the two sides agree.
        await writeLedgerEntry(
            tx,
            {
                accountId: payload.from_account_id,
                date,
                amount: -payload.amount_usd,
                sourceType: LedgerSource.exchange_out,
                sourceId: exchange.id,
                description: `Exchanged to ${toAccount.name} @ ${payload.rate}`,
            },
            user,
            Currency.USD
        );

        await writeLedgerEntry(
            tx,
            {
                accountId: payload.to_account_id,
                date,
                amount: amountBdt,
                sourceType: LedgerSource.exchange_in,
                sourceId: exchange.id,
                description: `Exchanged from ${fromAccount.name} @ ${payload.rate}`,
            },
            user,
            Currency.BDT
        );

        await logActivity(tx, {
            entityType: "exchange",
            entityId: exchange.id,
            action: "created",
            summary: `Exchanged ${money(payload.amount_usd, "USD")} to ${money(amountBdt, "BDT")} at ${payload.rate}`,
        }, user);

        return exchange;
    });
};

const deleteExchange = async (id: string, user: IRequestUser) => {
    return prisma.$transaction(async (tx) => {
        const existing = await tx.exchangeTransaction.findFirst({
            where: { id, organization_id: user.organizationId, deleted_at: null },
        });

        if (!existing) {
            throw new AppError(status.NOT_FOUND, "Exchange not found");
        }

        // Both halves reverse together - reverseLedgerEntries matches on
        // source_id, and each side was written with its own source_type.
        await reverseLedgerEntries(tx, LedgerSource.exchange_out, id, user, "Exchange deleted");
        await reverseLedgerEntries(tx, LedgerSource.exchange_in, id, user, "Exchange deleted");

        await tx.exchangeTransaction.update({
            where: { id },
            data: { deleted_at: new Date() },
        });

        return { message: "Exchange deleted successfully" };
    });
};

export const ExchangeService = {
    getAllExchanges,
    createExchange,
    deleteExchange,
};
