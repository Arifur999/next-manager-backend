import status from "http-status";
import { Prisma } from "../../../generated/prisma/client.js";
import { Currency, LedgerSource, LoanStatus } from "../../../generated/prisma/enums.js";
import AppError from "../../errorHelpers/AppError.js";
import { IRequestUser } from "../../interfaces/requestUser.interface.js";
import { prisma } from "../../lib/prisma.js";
import { assertAccount, reverseLedgerEntries, writeLedgerEntry } from "../../shared/ledger.js";
import { pageSlice, type ListOptions } from "../../shared/listQuery.js";
import {
    ICreateLoanPayload,
    IPayInstalmentPayload,
    ISetInstalmentsPayload,
    IUpdateLoanPayload,
} from "./loan.validation.js";

/**
 * Bank loans and EMIs.
 *
 * Deliberately not DuePerson. Informal lending between people has no schedule,
 * no interest and no term; folding the two together would mean one screen that
 * answers neither question.
 *
 * Two rules run through everything here:
 *
 *   What is still owed is COMPUTED - principal minus the principal of every
 *   paid instalment - and never stored. A stored outstanding figure and a
 *   schedule are two places to say one thing, and they drift the first time a
 *   write half-fails.
 *
 *   An instalment is principal plus interest, and only the interest is a cost.
 *   Repaying principal settles a liability; counting the whole instalment as an
 *   expense would understate profit by the principal every month. The ledger
 *   row is the full cash, because that is what actually leaves the account -
 *   the split is what profit and loss reads.
 */

const toDate = (value: string) => new Date(`${value}T00:00:00.000Z`);

const LOAN_INCLUDE = {
    account: { select: { id: true, name: true, currency: true } },
    instalments: {
        orderBy: { seq: "asc" as const },
        include: { paid_from_account: { select: { id: true, name: true } } },
    },
};

type LoanWithInstalments = Prisma.LoanGetPayload<{ include: typeof LOAN_INCLUDE }>;

/**
 * What a loan actually stands at.
 *
 * Everything here is derived from the instalments, so no figure on this object
 * can disagree with another one.
 */
const summarise = (loan: LoanWithInstalments) => {
    let principalPaid = 0;
    let interestPaid = 0;
    let principalScheduled = 0;
    let interestScheduled = 0;
    let paidCount = 0;
    let nextDue: { seq: number; due_date: Date; total_bdt: number } | null = null;

    for (const item of loan.instalments) {
        const principal = item.principal_bdt.toNumber();
        const interest = item.interest_bdt.toNumber();

        principalScheduled += principal;
        interestScheduled += interest;

        if (item.paid_at) {
            principalPaid += principal;
            interestPaid += interest;
            paidCount += 1;
        } else if (!nextDue) {
            // The instalments come back ordered by seq, so the first unpaid one
            // IS the next due. No sorting, and no second source of truth.
            nextDue = {
                seq: item.seq,
                due_date: item.due_date,
                total_bdt: principal + interest,
            };
        }
    }

    const principalBdt = loan.principal_bdt.toNumber();

    return {
        ...loan,
        principal_bdt: principalBdt,
        interest_rate: loan.interest_rate.toNumber(),
        instalments: loan.instalments.map((item) => ({
            ...item,
            principal_bdt: item.principal_bdt.toNumber(),
            interest_bdt: item.interest_bdt.toNumber(),
        })),
        // The number people actually want. Measured against the principal
        // borrowed, not against the schedule: a schedule can be edited, the
        // borrowing cannot.
        outstanding_bdt: principalBdt - principalPaid,
        principal_paid_bdt: principalPaid,
        interest_paid_bdt: interestPaid,
        principal_scheduled_bdt: principalScheduled,
        interest_scheduled_bdt: interestScheduled,
        paid_count: paidCount,
        instalment_count: loan.instalments.length,
        next_due: nextDue,
    };
};

/**
 * An equal-principal schedule, as a starting point.
 *
 * Not an EMI formula. A bank's own table rarely matches one exactly, and a
 * schedule nobody can correct is one people keep in a spreadsheet instead - so
 * this fills the rows in and the agency edits them to match the paper they
 * actually signed. Interest is left at zero rather than guessed: a made-up
 * interest figure would flow straight into profit and loss.
 */
const generateSchedule = (payload: ICreateLoanPayload) => {
    const start = toDate(payload.started_on);
    const months = payload.term_months;
    // Floored to whole paisa with the remainder on the last row, so the rows
    // sum to exactly the principal rather than to a rounding error.
    const per = Math.floor((payload.principal_bdt / months) * 100) / 100;
    const rows = [];

    for (let index = 0; index < months; index += 1) {
        const due = new Date(start);
        due.setUTCMonth(due.getUTCMonth() + index + 1);

        const isLast = index === months - 1;
        rows.push({
            seq: index + 1,
            due_date: due,
            principal_bdt: new Prisma.Decimal(
                isLast ? Number((payload.principal_bdt - per * (months - 1)).toFixed(2)) : per
            ),
            interest_bdt: new Prisma.Decimal(0),
            notes: "",
        });
    }

    return rows;
};

const assertOwnLoan = async (
    tx: Prisma.TransactionClient | typeof prisma,
    id: string,
    user: IRequestUser
) => {
    const loan = await tx.loan.findFirst({
        where: { id, organization_id: user.organizationId, deleted_at: null },
        select: { id: true, lender: true, principal_bdt: true, status: true },
    });

    // A foreign key proves the row exists, never that it is yours. Same message
    // an unknown id gets: whether it exists in somebody else's agency is not
    // the caller's business to learn.
    if (!loan) {
        throw new AppError(status.NOT_FOUND, "Loan not found");
    }

    return loan;
};

const getAll = async (
    user: IRequestUser,
    options: ListOptions = {},
    filters: { status?: LoanStatus } = {}
) => {
    const where: Prisma.LoanWhereInput = {
        organization_id: user.organizationId,
        deleted_at: null,
        ...(filters.status ? { status: filters.status } : {}),
    };

    const slice = pageSlice(options);
    const query = {
        where,
        include: LOAN_INCLUDE,
        orderBy: [{ status: "asc" as const }, { started_on: "desc" as const }],
    };

    if (!slice) {
        const loans = await prisma.loan.findMany(query);
        const rows = loans.map(summarise);
        return { rows, total: rows.length };
    }

    const [loans, total] = await Promise.all([
        prisma.loan.findMany({ ...query, skip: slice.skip, take: slice.take }),
        prisma.loan.count({ where }),
    ]);

    return { rows: loans.map(summarise), total };
};

const getOne = async (id: string, user: IRequestUser) => {
    const loan = await prisma.loan.findFirst({
        where: { id, organization_id: user.organizationId, deleted_at: null },
        include: LOAN_INCLUDE,
    });

    if (!loan) {
        throw new AppError(status.NOT_FOUND, "Loan not found");
    }

    return summarise(loan);
};

const create = async (payload: ICreateLoanPayload, user: IRequestUser) => {
    return prisma.$transaction(async (tx) => {
        const startedOn = toDate(payload.started_on);

        // Borrowed money arriving is money IN. It is not revenue - profit and
        // loss reads payments, never the ledger - but it genuinely lands in an
        // account, and a balance that did not move would be a lie.
        if (payload.account_id) {
            await assertAccount(tx, payload.account_id, user, Currency.BDT);
        }

        const loan = await tx.loan.create({
            data: {
                organization_id: user.organizationId,
                lender: payload.lender,
                principal_bdt: payload.principal_bdt,
                interest_rate: payload.interest_rate ?? 0,
                started_on: startedOn,
                term_months: payload.term_months,
                account_id: payload.account_id ?? null,
                notes: payload.notes ?? "",
                created_by: user.userId,
            },
        });

        const rows = payload.instalments?.length
            ? payload.instalments.map((item, index) => ({
                  seq: index + 1,
                  due_date: toDate(item.due_date),
                  principal_bdt: new Prisma.Decimal(item.principal_bdt),
                  interest_bdt: new Prisma.Decimal(item.interest_bdt ?? 0),
                  notes: item.notes ?? "",
              }))
            : generateSchedule(payload);

        await tx.loanInstalment.createMany({
            data: rows.map((row) => ({
                ...row,
                organization_id: user.organizationId,
                loan_id: loan.id,
            })),
        });

        if (payload.account_id) {
            await writeLedgerEntry(
                tx,
                {
                    accountId: payload.account_id,
                    date: startedOn,
                    amount: payload.principal_bdt,
                    sourceType: LedgerSource.loan_received,
                    sourceId: loan.id,
                    description: `Loan from ${payload.lender}`,
                },
                user,
                Currency.BDT
            );
        }

        const created = await tx.loan.findUniqueOrThrow({
            where: { id: loan.id },
            include: LOAN_INCLUDE,
        });

        return summarise(created);
    });
};

const update = async (id: string, payload: IUpdateLoanPayload, user: IRequestUser) => {
    await assertOwnLoan(prisma, id, user);

    const updated = await prisma.loan.update({
        where: { id },
        data: payload,
        include: LOAN_INCLUDE,
    });

    return summarise(updated);
};

/**
 * Replace the schedule.
 *
 * Only the unpaid rows. A paid instalment has moved money through an account,
 * and rewriting it here would leave a ledger row describing a repayment that no
 * longer matches anything - so those are kept and the new rows carry on after
 * them.
 */
const setInstalments = async (id: string, payload: ISetInstalmentsPayload, user: IRequestUser) => {
    return prisma.$transaction(async (tx) => {
        await assertOwnLoan(tx, id, user);

        const paidCount = await tx.loanInstalment.count({
            where: { loan_id: id, organization_id: user.organizationId, paid_at: { not: null } },
        });

        await tx.loanInstalment.deleteMany({
            where: { loan_id: id, organization_id: user.organizationId, paid_at: null },
        });

        // Paid rows keep their sequence numbers and the new ones carry on from
        // there, so "instalment 4 of 12" still means what it meant yesterday.
        let seq = paidCount;

        for (const item of payload.instalments) {
            seq += 1;
            await tx.loanInstalment.create({
                data: {
                    organization_id: user.organizationId,
                    loan_id: id,
                    seq,
                    due_date: toDate(item.due_date),
                    principal_bdt: new Prisma.Decimal(item.principal_bdt),
                    interest_bdt: new Prisma.Decimal(item.interest_bdt ?? 0),
                    notes: item.notes ?? "",
                },
            });
        }

        const loan = await tx.loan.findUniqueOrThrow({ where: { id }, include: LOAN_INCLUDE });
        return summarise(loan);
    });
};

/**
 * Pay one instalment.
 *
 * The cash that leaves the account is principal + interest, and that is the one
 * ledger row. The split stays on the instalment, which is where profit and loss
 * reads the interest from - so there is exactly one money trail and exactly one
 * place the cost of borrowing is recorded.
 */
const payInstalment = async (
    instalmentId: string,
    payload: IPayInstalmentPayload,
    user: IRequestUser
) => {
    return prisma.$transaction(async (tx) => {
        const instalment = await tx.loanInstalment.findFirst({
            where: { id: instalmentId, organization_id: user.organizationId },
            include: { loan: { select: { id: true, lender: true, deleted_at: true } } },
        });

        if (!instalment || instalment.loan.deleted_at) {
            throw new AppError(status.NOT_FOUND, "Instalment not found");
        }

        if (instalment.paid_at) {
            throw new AppError(
                status.CONFLICT,
                "That instalment is already paid. Reverse it if it was recorded by mistake."
            );
        }

        await assertAccount(tx, payload.account_id, user, Currency.BDT);

        const date = payload.date ? toDate(payload.date) : new Date();
        const principal = instalment.principal_bdt.toNumber();
        const interest = instalment.interest_bdt.toNumber();
        const total = principal + interest;

        await tx.loanInstalment.update({
            where: { id: instalmentId },
            data: { paid_at: date, paid_from_account_id: payload.account_id },
        });

        await writeLedgerEntry(
            tx,
            {
                accountId: payload.account_id,
                date,
                amount: -total,
                sourceType: LedgerSource.loan_repayment,
                sourceId: instalmentId,
                description: `Instalment ${instalment.seq} to ${instalment.loan.lender}`,
            },
            user,
            Currency.BDT
        );

        // A loan settles itself when nothing is left unpaid, so the status can
        // never sit at "active" on a loan that is fully repaid.
        const remaining = await tx.loanInstalment.count({
            where: { loan_id: instalment.loan_id, paid_at: null },
        });

        if (remaining === 0) {
            await tx.loan.update({
                where: { id: instalment.loan_id },
                data: { status: LoanStatus.settled },
            });
        }

        const loan = await tx.loan.findUniqueOrThrow({
            where: { id: instalment.loan_id },
            include: LOAN_INCLUDE,
        });

        return summarise(loan);
    });
};

/** Undo a repayment recorded by mistake, without erasing that it happened. */
const reverseInstalment = async (instalmentId: string, user: IRequestUser) => {
    return prisma.$transaction(async (tx) => {
        const instalment = await tx.loanInstalment.findFirst({
            where: { id: instalmentId, organization_id: user.organizationId },
            include: { loan: { select: { id: true, deleted_at: true } } },
        });

        if (!instalment || instalment.loan.deleted_at) {
            throw new AppError(status.NOT_FOUND, "Instalment not found");
        }

        if (!instalment.paid_at) {
            throw new AppError(status.BAD_REQUEST, "That instalment has not been paid");
        }

        // An opposite row rather than a delete: "paid, then reversed" is the
        // true history, and the account balance ends exactly where it started.
        await reverseLedgerEntries(
            tx,
            LedgerSource.loan_repayment,
            instalmentId,
            user,
            "Instalment reversed"
        );

        await tx.loanInstalment.update({
            where: { id: instalmentId },
            data: { paid_at: null, paid_from_account_id: null },
        });

        // It is owed again, so a settled loan goes back to active.
        await tx.loan.update({
            where: { id: instalment.loan_id },
            data: { status: LoanStatus.active },
        });

        const loan = await tx.loan.findUniqueOrThrow({
            where: { id: instalment.loan_id },
            include: LOAN_INCLUDE,
        });

        return summarise(loan);
    });
};

const remove = async (id: string, user: IRequestUser) => {
    return prisma.$transaction(async (tx) => {
        await assertOwnLoan(tx, id, user);

        const paidCount = await tx.loanInstalment.count({
            where: { loan_id: id, organization_id: user.organizationId, paid_at: { not: null } },
        });

        // Those instalments moved real money out of real accounts. Removing the
        // loan would leave the ledger rows explaining nothing.
        if (paidCount > 0) {
            throw new AppError(
                status.CONFLICT,
                "This loan has repayments recorded. Close it instead of deleting it."
            );
        }

        await reverseLedgerEntries(tx, LedgerSource.loan_received, id, user, "Loan deleted");
        await tx.loan.update({ where: { id }, data: { deleted_at: new Date() } });

        return { message: "Loan deleted successfully" };
    });
};

/**
 * What is owed across every loan, and what is due next.
 *
 * The figure an admin opens the page for. Computed, like every other balance in
 * this product.
 */
const getSummary = async (user: IRequestUser) => {
    const loans = await prisma.loan.findMany({
        where: { organization_id: user.organizationId, deleted_at: null },
        include: LOAN_INCLUDE,
    });

    const rows = loans.map(summarise);
    const active = rows.filter((loan) => loan.status === LoanStatus.active);

    return {
        loan_count: rows.length,
        active_count: active.length,
        borrowed_bdt: rows.reduce((sum, loan) => sum + loan.principal_bdt, 0),
        outstanding_bdt: active.reduce((sum, loan) => sum + loan.outstanding_bdt, 0),
        // Interest actually paid, which is the only part of borrowing that is a
        // cost. Principal repaid settles a liability and is not on this line.
        interest_paid_bdt: rows.reduce((sum, loan) => sum + loan.interest_paid_bdt, 0),
        principal_paid_bdt: rows.reduce((sum, loan) => sum + loan.principal_paid_bdt, 0),
        next_due: active
            .map((loan) => (loan.next_due ? { lender: loan.lender, ...loan.next_due } : null))
            .filter((row): row is NonNullable<typeof row> => row !== null)
            .sort((a, b) => a.due_date.getTime() - b.due_date.getTime())
            .slice(0, 5),
    };
};

export const LoanService = {
    getAll,
    getOne,
    create,
    update,
    setInstalments,
    payInstalment,
    reverseInstalment,
    remove,
    getSummary,
};
