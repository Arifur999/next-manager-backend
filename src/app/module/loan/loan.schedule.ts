import { Prisma } from "../../../generated/prisma/client.js";
import { ICreateLoanPayload } from "./loan.validation.js";
import { toDateOnly } from "../../shared/dates.js";

export const LOAN_INCLUDE = {
    account: { select: { id: true, name: true, currency: true } },
    instalments: {
        orderBy: { seq: "asc" as const },
        include: { paid_from_account: { select: { id: true, name: true } } },
    },
};

export type LoanWithInstalments = Prisma.LoanGetPayload<{ include: typeof LOAN_INCLUDE }>;

/**
 * What a loan actually stands at.
 *
 * Everything here is derived from the instalments, so no figure on this object
 * can disagree with another one.
 */
export const summarise = (loan: LoanWithInstalments) => {
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
export const generateSchedule = (payload: ICreateLoanPayload) => {
    const start = toDateOnly(payload.started_on);
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
