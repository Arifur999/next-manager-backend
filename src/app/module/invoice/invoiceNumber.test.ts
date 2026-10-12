import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatInvoiceNumber } from "./invoiceNumber.js";

describe("formatInvoiceNumber", () => {
    it("starts at INV-0001", () => {
        assert.equal(formatInvoiceNumber(null), "INV-0001");
    });

    it("continues the sequence", () => {
        assert.equal(formatInvoiceNumber(41), "INV-0042");
    });

    it("grows past four digits instead of wrapping", () => {
        assert.equal(formatInvoiceNumber(9999), "INV-10000");
    });
});
