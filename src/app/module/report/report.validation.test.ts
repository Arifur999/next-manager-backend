import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { clientRevenueQueryZodSchema, monthlySeriesQueryZodSchema } from "./report.validation.js";

const monthsFor = (query: Record<string, unknown>) => monthlySeriesQueryZodSchema.parse(query).months;

describe("monthlySeriesQueryZodSchema", () => {
    it("defaults to twelve months", () => {
        assert.equal(monthsFor({}), 12);
    });

    it("reads a whole number of months", () => {
        assert.equal(monthsFor({ months: "6" }), 6);
    });

    it("clamps a long series to three years", () => {
        assert.equal(monthsFor({ months: "100" }), 36);
    });

    it("falls back to twelve for a value it cannot use", () => {
        for (const months of ["0", "-3", "1.5", "abc", ""]) {
            assert.equal(monthsFor({ months }), 12, `months=${months}`);
        }
    });
});

describe("clientRevenueQueryZodSchema", () => {
    it("keeps the date range beside mine", () => {
        const query = clientRevenueQueryZodSchema.parse({ mine: "true", from: "2026-01-01" });
        assert.equal(query.mine, true);
        assert.equal(query.from, "2026-01-01");
    });
});
