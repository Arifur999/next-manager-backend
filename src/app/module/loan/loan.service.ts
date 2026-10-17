import status from "http-status";
import { Prisma } from "../../../generated/prisma/client.js";
import { Currency, LedgerSource, LoanStatus } from "../../../generated/prisma/enums.js";
import AppError from "../../errorHelpers/AppError.js";
import { IRequestUser } from "../../interfaces/requestUser.interface.js";
import { prisma } from "../../lib/prisma.js";
import { assertAccount, reverseLedgerEntries, writeLedgerEntry } from "../../shared/ledger.js";
import { findPage, type ListOptions } from "../../shared/listQuery.js";
import { ICreateLoanPayload, ISetInstalmentsPayload, IUpdateLoanPayload } from "./loan.validation.js";
import { toDateOnly } from "../../shared/dates.js";
import { LOAN_INCLUDE, summarise, generateSchedule } from "./loan.schedule.js";

/**
 * Bank loans and EMIs - not DuePerson, whose informal lending has no schedule,
 * interest or term.
 *
 * What is still owed is COMPUTED (principal minus every paid instalment's
 * principal), never stored. An instalment is principal plus interest and only
 * the interest is a cost: the ledger row is the full cash that leaves, and
 * profit and loss reads the split.
 */

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

    const query = {
        where,
        include: LOAN_INCLUDE,
        orderBy: [{ status: "asc" as const }, { started_on: "desc" as const }],
    };

    const { rows: loans, total } = await findPage(
        options,
        (page) => prisma.loan.findMany({ ...query, ...page }),
        () => prisma.loan.count({ where })
    );

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
        const startedOn = toDateOnly(payload.started_on);

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
                  due_date: toDateOnly(item.due_date),
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
 * Replace the schedule's unpaid rows. Paid ones moved money through an account
 * and their ledger rows must keep matching them, so the new rows follow them.
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
                    due_date: toDateOnly(item.due_date),
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

/** What is owed across every loan and what is due next, computed like every balance here. */
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
    remove,
    getSummary,
};
