import status from "http-status";
import { Currency, LedgerSource, LoanStatus } from "../../../generated/prisma/enums.js";
import AppError from "../../errorHelpers/AppError.js";
import { IRequestUser } from "../../interfaces/requestUser.interface.js";
import { prisma } from "../../lib/prisma.js";
import { toDateOnly } from "../../shared/dates.js";
import { assertAccount, reverseLedgerEntries, writeLedgerEntry } from "../../shared/ledger.js";
import { LOAN_INCLUDE, summarise } from "./loan.schedule.js";
import { IPayInstalmentPayload } from "./loan.validation.js";

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

        await assertAccount(tx, payload.account_id, user, Currency.BDT);

        const date = payload.date ? toDateOnly(payload.date) : new Date();
        const principal = instalment.principal_bdt.toNumber();
        const interest = instalment.interest_bdt.toNumber();
        const total = principal + interest;

        // A conditional claim rather than a check then a write, so a double
        // click cannot pay the same instalment twice.
        const claim = await tx.loanInstalment.updateMany({
            where: { id: instalmentId, organization_id: user.organizationId, paid_at: null },
            data: { paid_at: date, paid_from_account_id: payload.account_id },
        });

        if (claim.count === 0) {
            throw new AppError(
                status.CONFLICT,
                "That instalment is already paid. Reverse it if it was recorded by mistake."
            );
        }

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

        // Claimed before the ledger is touched, so two reversals cannot both run.
        const claim = await tx.loanInstalment.updateMany({
            where: { id: instalmentId, organization_id: user.organizationId, paid_at: { not: null } },
            data: { paid_at: null, paid_from_account_id: null },
        });

        if (claim.count === 0) {
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

export const LoanRepaymentService = {
    payInstalment,
    reverseInstalment,
};
