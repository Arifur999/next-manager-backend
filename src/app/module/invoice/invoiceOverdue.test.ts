import "../../testing/testEnv.js";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Prisma } from "../../../generated/prisma/client.js";
import { InvoiceStatus } from "../../../generated/prisma/enums.js";
import { isOverdue } from "../../shared/invoiceStatus.js";
import { amountOwed, overdueInvoiceWhere, yesterdayUtc } from "./invoiceOverdue.js";

describe("yesterdayUtc", () => {
    it("is the previous calendar day at UTC midnight, whatever the hour", () => {
        assert.equal(yesterdayUtc(new Date("2026-10-17T01:15:00.000Z")).toISOString(), "2026-10-16T00:00:00.000Z");
        assert.equal(yesterdayUtc(new Date("2026-10-17T23:59:59.999Z")).toISOString(), "2026-10-16T00:00:00.000Z");
    });

    it("crosses month and year boundaries", () => {
        assert.equal(yesterdayUtc(new Date("2026-03-01T01:00:00.000Z")).toISOString(), "2026-02-28T00:00:00.000Z");
        assert.equal(yesterdayUtc(new Date("2027-01-01T01:00:00.000Z")).toISOString(), "2026-12-31T00:00:00.000Z");
    });

    it("picks the day isOverdue first calls overdue, so the notice lands on the day it turns", () => {
        const now = new Date();
        const dueYesterday = yesterdayUtc(now);
        const dueToday = new Date(dueYesterday.getTime() + 24 * 60 * 60 * 1000);
        assert.equal(isOverdue({ status: InvoiceStatus.sent, due_date: dueYesterday }), true);
        assert.equal(isOverdue({ status: InvoiceStatus.sent, due_date: dueToday }), false);
    });
});

describe("overdueInvoiceWhere", () => {
    const where = overdueInvoiceWhere(new Date("2026-10-17T01:15:00.000Z"));

    it("selects only sent and partly paid invoices", () => {
        assert.deepEqual(where.status, { in: [InvoiceStatus.sent, InvoiceStatus.partially_paid] });
    });

    it("selects the ones due yesterday, not deleted, and not yet notified", () => {
        assert.deepEqual(where.due_date, new Date("2026-10-16T00:00:00.000Z"));
        assert.equal(where.deleted_at, null);
        assert.equal(where.overdue_notified_at, null);
    });
});

describe("amountOwed", () => {
    const decimal = (value: string) => new Prisma.Decimal(value);

    it("is the total less what has been paid", () => {
        assert.equal(amountOwed(decimal("500.00"), [{ amount_usd: decimal("120.50") }]).toFixed(2), "379.50");
    });

    it("never goes below zero on an overpayment", () => {
        assert.equal(amountOwed(decimal("100.00"), [{ amount_usd: decimal("150.00") }]).toFixed(2), "0.00");
    });
});
