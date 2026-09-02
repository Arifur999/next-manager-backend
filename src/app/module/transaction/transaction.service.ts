import { Prisma } from "../../../generated/prisma/client.js";
import { Currency, LedgerSource } from "../../../generated/prisma/enums.js";
import { IRequestUser } from "../../interfaces/requestUser.interface.js";
import { prisma } from "../../lib/prisma.js";
import {
    dateRangeWhere,
    escapeLikeTerm,
    pageSlice,
    type ListOptions,
} from "../../shared/listQuery.js";

/**
 * The ledger, read as a ledger.
 *
 * Every money route in the product already writes `AccountTransaction`; until
 * now nothing read it as one list. Payments, expenses, payouts, withdrawals and
 * exchanges each had their own screen, so "what happened to our money in March"
 * meant opening five of them and adding up by hand.
 *
 * Nothing new is recorded here. This is a view.
 */

/**
 * What each kind of ledger row means to the business.
 *
 * Classified by `source_type`, deliberately NOT by the sign of the amount. The
 * two halves of an exchange look exactly like income and an expense - money
 * arrives in one account and leaves another - and counting them as either would
 * inflate both sides of the books with money that never entered or left the
 * business. A transfer is its own thing.
 *
 * `opening_balance` and `adjustment` are in none of the three. An opening
 * balance is where counting started, not money earned, and an adjustment is a
 * correction. Both appear under "everything" and nowhere else, rather than
 * being quietly folded into income and overstating what the agency made.
 */
// Bucketed by DIRECTION, not by accounting nature. Borrowed money arriving is
// money in and shows under Income here, even though it is not revenue - this
// screen answers "what moved", and profit and loss answers "what did we
// earn". The same reason an owner withdrawal already sits under Expenses.
const KINDS = {
    income: [LedgerSource.payment, LedgerSource.due_received, LedgerSource.loan_received],
    expense: [
        LedgerSource.expense,
        LedgerSource.team_payout,
        LedgerSource.owner_withdrawal,
        LedgerSource.due_payment,
        LedgerSource.loan_repayment,
        LedgerSource.shareholder_distribution,
    ],
    transfer: [LedgerSource.exchange_in, LedgerSource.exchange_out],
} as const;

export type TransactionKind = keyof typeof KINDS;

export const isTransactionKind = (value: string): value is TransactionKind =>
    value in KINDS;

const SELECT = {
    id: true,
    date: true,
    amount: true,
    currency: true,
    source_type: true,
    source_id: true,
    description: true,
    created_at: true,
    account: { select: { id: true, name: true, currency: true } },
} as const;

const getTransactions = async (
    user: IRequestUser,
    options: ListOptions = {},
    filters: { kind?: TransactionKind; accountId?: string } = {}
) => {
    const where: Prisma.AccountTransactionWhereInput = {
        organization_id: user.organizationId,
        ...dateRangeWhere(options),
        ...(filters.kind ? { source_type: { in: [...KINDS[filters.kind]] } } : {}),
        ...(filters.accountId ? { account_id: filters.accountId } : {}),
        ...(options.search
            ? { description: { contains: escapeLikeTerm(options.search), mode: "insensitive" } }
            : {}),
    };

    // Newest first, and by insertion within a day: several rows can share a
    // date, and a ledger that reorders itself between reads is one nobody can
    // reconcile against.
    const orderBy: Prisma.AccountTransactionOrderByWithRelationInput[] = [
        { date: "desc" },
        { created_at: "desc" },
    ];

    const slice = pageSlice(options);

    const [rows, total, totals] = await Promise.all([
        prisma.accountTransaction.findMany({
            where,
            select: SELECT,
            orderBy,
            ...(slice ?? {}),
        }),
        prisma.accountTransaction.count({ where }),
        // Summed per currency, never across it. Adding dollars to taka produces
        // a number that is true of nothing.
        prisma.accountTransaction.groupBy({
            by: ["currency"],
            where,
            _sum: { amount: true },
        }),
    ]);

    return {
        rows,
        total,
        totals: totals.map((row) => ({
            currency: row.currency as Currency,
            amount: Number(row._sum.amount ?? 0),
        })),
    };
};

export const TransactionService = { getTransactions };
