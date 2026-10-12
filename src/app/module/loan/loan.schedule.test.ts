import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Prisma } from "../../../generated/prisma/client.js";
import { LoanStatus } from "../../../generated/prisma/enums.js";
import { generateSchedule, LoanWithInstalments, summarise } from "./loan.schedule.js";

const day = (value: string) => new Date(`${value}T00:00:00.000Z`);
const isoDay = (value: Date) => value.toISOString().slice(0, 10);

const instalment = (
    seq: number,
    principal: string,
    interest: string,
    paidAt: Date | null = null
): LoanWithInstalments["instalments"][number] => ({
    id: `inst-${seq}`,
    organization_id: "org-1",
    loan_id: "loan-1",
    seq,
    due_date: day(`2026-0${seq}-15`),
    principal_bdt: new Prisma.Decimal(principal),
    interest_bdt: new Prisma.Decimal(interest),
    paid_at: paidAt,
    paid_from_account_id: paidAt ? "acc-1" : null,
    paid_from_account: paidAt ? { id: "acc-1", name: "City Bank" } : null,
    notes: "",
    created_at: day("2026-01-01"),
    updated_at: day("2026-01-01"),
});

const loan = (instalments: LoanWithInstalments["instalments"]): LoanWithInstalments => ({
    id: "loan-1",
    organization_id: "org-1",
    lender: "City Bank",
    principal_bdt: new Prisma.Decimal("30000"),
    interest_rate: new Prisma.Decimal("9.5"),
    started_on: day("2026-01-01"),
    term_months: instalments.length,
    account_id: "acc-1",
    status: LoanStatus.active,
    notes: "",
    deleted_at: null,
    created_by: null,
    created_at: day("2026-01-01"),
    updated_at: day("2026-01-01"),
    account: { id: "acc-1", name: "City Bank", currency: "BDT" },
    instalments,
});

describe("generateSchedule", () => {
    it("sums the principal exactly, with the rounding remainder on the last row", () => {
        const rows = generateSchedule({ lender: "City Bank", principal_bdt: 1000, started_on: "2026-03-10", term_months: 3 });

        assert.deepEqual(
            rows.map((row) => row.principal_bdt.toFixed(2)),
            ["333.33", "333.33", "333.34"]
        );
        const total = rows.reduce((sum, row) => sum.plus(row.principal_bdt), new Prisma.Decimal(0));
        assert.equal(total.toFixed(2), "1000.00");
    });

    it("numbers the rows from 1 and leaves interest at zero for the agency to fill in", () => {
        const rows = generateSchedule({ lender: "City Bank", principal_bdt: 1200, started_on: "2026-03-10", term_months: 12 });

        assert.deepEqual(rows.map((row) => row.seq), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
        assert.ok(rows.every((row) => row.interest_bdt.isZero()));
        assert.ok(rows.every((row) => row.principal_bdt.toFixed(2) === "100.00"));
    });

    it("puts the first due date one month after the start, then one a month", () => {
        const rows = generateSchedule({ lender: "City Bank", principal_bdt: 400, started_on: "2026-11-10", term_months: 4 });

        assert.deepEqual(rows.map((row) => isoDay(row.due_date)), ["2026-12-10", "2027-01-10", "2027-02-10", "2027-03-10"]);
    });
});

describe("summarise", () => {
    it("counts paid principal and interest, and owes the rest of the principal", () => {
        const summary = summarise(
            loan([
                instalment(1, "10000", "250", day("2026-01-15")),
                instalment(2, "10000", "200", day("2026-02-15")),
                instalment(3, "10000", "150"),
            ])
        );

        assert.equal(summary.principal_bdt, 30000);
        assert.equal(summary.interest_rate, 9.5);
        assert.equal(summary.principal_paid_bdt, 20000);
        assert.equal(summary.interest_paid_bdt, 450);
        assert.equal(summary.outstanding_bdt, 10000);
        assert.equal(summary.principal_scheduled_bdt, 30000);
        assert.equal(summary.interest_scheduled_bdt, 600);
        assert.equal(summary.paid_count, 2);
        assert.equal(summary.instalment_count, 3);
    });

    it("names the first unpaid instalment as next due, with principal plus interest", () => {
        const summary = summarise(
            loan([instalment(1, "10000", "250", day("2026-01-15")), instalment(2, "10000", "200"), instalment(3, "10000", "150")])
        );

        assert.deepEqual(summary.next_due, { seq: 2, due_date: day("2026-02-15"), total_bdt: 10200 });
    });

    it("measures what is owed against the amount borrowed, not the schedule", () => {
        // A schedule edited down to 25,000 still leaves 30,000 borrowed.
        const summary = summarise(loan([instalment(1, "12500", "0", day("2026-01-15")), instalment(2, "12500", "0")]));

        assert.equal(summary.outstanding_bdt, 17500);
    });

    it("has nothing next due once every instalment is paid", () => {
        const summary = summarise(loan([instalment(1, "15000", "0", day("2026-01-15")), instalment(2, "15000", "0", day("2026-02-15"))]));

        assert.equal(summary.next_due, null);
        assert.equal(summary.outstanding_bdt, 0);
    });

    it("sends instalment amounts as plain numbers", () => {
        const summary = summarise(loan([instalment(1, "30000", "125.50")]));

        assert.equal(summary.instalments[0].principal_bdt, 30000);
        assert.equal(summary.instalments[0].interest_bdt, 125.5);
    });
});
