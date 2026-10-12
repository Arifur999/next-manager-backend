import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { InvoiceStatus } from "../../generated/prisma/enums.js";
import { isOverdue } from "./invoiceStatus.js";

const DAY_MS = 24 * 60 * 60 * 1000;

// Due dates are stored as calendar days, at UTC midnight.
const daysFromToday = (days: number) => {
    const now = new Date();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) + days * DAY_MS);
};

describe("isOverdue", () => {
    it("is true for an unpaid invoice due yesterday", () => {
        assert.equal(isOverdue({ status: InvoiceStatus.sent, due_date: daysFromToday(-1) }), true);
        assert.equal(isOverdue({ status: InvoiceStatus.partially_paid, due_date: daysFromToday(-1) }), true);
    });

    it("is false on the due date itself, and before it", () => {
        assert.equal(isOverdue({ status: InvoiceStatus.sent, due_date: daysFromToday(0) }), false);
        assert.equal(isOverdue({ status: InvoiceStatus.sent, due_date: daysFromToday(3) }), false);
    });

    it("is never true for a paid, draft or cancelled invoice", () => {
        for (const status of [InvoiceStatus.paid, InvoiceStatus.draft, InvoiceStatus.cancelled]) {
            assert.equal(isOverdue({ status, due_date: daysFromToday(-30) }), false, status);
        }
    });
});
