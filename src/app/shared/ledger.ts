import status from "http-status";
import { Currency, LedgerSource } from "../../generated/prisma/enums.js";
import { Prisma } from "../../generated/prisma/client.js";
import AppError from "../errorHelpers/AppError.js";
import { prisma } from "../lib/prisma.js";
import { IRequestUser } from "../interfaces/requestUser.interface.js";

type Tx = Prisma.TransactionClient;

/**
 * The single way money is recorded against an account.
 *
 * Nothing anywhere increments a stored balance. Every movement writes one
 * AccountTransaction row with a SIGNED amount - positive in, negative out - and
 * a balance is opening_balance + SUM(amount). A stored balance drifts the first
 * time a multi-step write half-fails; a ledger cannot, and it can always
 * explain where a figure came from.
 *
 * Every helper here takes a transaction client, because a ledger row that is
 * not written in the same transaction as the record that caused it is exactly
 * the drift this design exists to prevent.
 */

export interface LedgerEntryInput {
    accountId: string;
    date: Date;
    /** Signed: positive is money in, negative is money out. */
    amount: Prisma.Decimal | number;
    sourceType: LedgerSource;
    sourceId?: string;
    description?: string;
}

/**
 * Confirms the account belongs to the caller's agency AND holds the currency
 * the caller thinks it does.
 *
 * The currency check is the one that matters in practice: recording a BDT
 * expense against a USD PayPal account is an easy mistake to make from the UI,
 * and without this it would silently corrupt both balances at once.
 */
export const assertAccount = async (
    tx: Tx,
    accountId: string,
    user: IRequestUser,
    expectedCurrency?: Currency
): Promise<{ id: string; currency: Currency; name: string }> => {
    const account = await tx.account.findFirst({
        where: { id: accountId, organization_id: user.organizationId, deleted_at: null },
        select: { id: true, currency: true, name: true },
    });

    if (!account) {
        // Same message an unknown id would produce: whether the account exists
        // in someone else's agency is not the caller's business to learn.
        throw new AppError(status.NOT_FOUND, "Account not found");
    }

    if (expectedCurrency && account.currency !== expectedCurrency) {
        throw new AppError(
            status.BAD_REQUEST,
            `"${account.name}" is a ${account.currency} account, but this needs a ${expectedCurrency} account.`
        );
    }

    return account;
};

export const writeLedgerEntry = async (
    tx: Tx,
    entry: LedgerEntryInput,
    user: IRequestUser,
    currency: Currency
) => {
    return tx.accountTransaction.create({
        data: {
            organization_id: user.organizationId,
            account_id: entry.accountId,
            date: entry.date,
            amount: entry.amount,
            currency,
            source_type: entry.sourceType,
            source_id: entry.sourceId,
            description: entry.description ?? "",
            created_by: user.userId,
        },
    });
};

/**
 * Undo the ledger effect of a record without deleting its history.
 *
 * Writes an opposite row for each existing entry rather than removing them, so
 * "this payment was recorded and then reversed" stays visible. Used when a
 * money record is soft-deleted or edited - an edit is a reversal plus a fresh
 * write, never an in-place amount change.
 */
export const reverseLedgerEntries = async (
    tx: Tx,
    sourceType: LedgerSource,
    sourceId: string,
    user: IRequestUser,
    reason = "Reversed"
) => {
    const existing = await tx.accountTransaction.findMany({
        where: {
            organization_id: user.organizationId,
            source_type: sourceType,
            source_id: sourceId,
        },
    });

    for (const entry of existing) {
        await tx.accountTransaction.create({
            data: {
                organization_id: user.organizationId,
                account_id: entry.account_id,
                date: new Date(),
                amount: entry.amount.negated(),
                currency: entry.currency,
                source_type: LedgerSource.adjustment,
                source_id: sourceId,
                description: `${reason}: ${entry.description}`.trim(),
                created_by: user.userId,
            },
        });
    }

    return existing.length;
};

export interface AccountBalance {
    accountId: string;
    name: string;
    currency: Currency;
    balance: number;
}

/**
 * Balances for every account in the agency, in one pass.
 *
 * Two queries rather than one per account: the accounts, and a grouped sum of
 * the whole ledger. Adding an account never adds a query.
 */
export const getAccountBalances = async (user: IRequestUser): Promise<AccountBalance[]> => {
    const [accounts, sums] = await Promise.all([
        prisma.account.findMany({
            where: { organization_id: user.organizationId, deleted_at: null },
            select: { id: true, name: true, currency: true, opening_balance: true },
            orderBy: { name: "asc" },
        }),
        prisma.accountTransaction.groupBy({
            by: ["account_id"],
            where: { organization_id: user.organizationId },
            _sum: { amount: true },
        }),
    ]);

    const movementByAccount = new Map(
        sums.map((row) => [row.account_id, row._sum.amount?.toNumber() ?? 0])
    );

    return accounts.map((account) => ({
        accountId: account.id,
        name: account.name,
        currency: account.currency,
        balance: account.opening_balance.toNumber() + (movementByAccount.get(account.id) ?? 0),
    }));
};

/**
 * Totals per currency, for the dashboard's "Account Balances" tile.
 *
 * Deliberately NOT summed into one number: USD and BDT are different things,
 * and adding them would require a rate that would then be silently baked into
 * a headline figure. The UI shows both.
 */
export const getBalanceByCurrency = async (user: IRequestUser): Promise<Record<Currency, number>> => {
    const balances = await getAccountBalances(user);

    return balances.reduce(
        (totals, account) => {
            totals[account.currency] += account.balance;
            return totals;
        },
        { USD: 0, BDT: 0 } as Record<Currency, number>
    );
};
