import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveRange } from "./kpi.range.js";

describe("resolveRange", () => {
    it("a single day is one day", () => {
        assert.equal(resolveRange({ from: "2026-10-01", to: "2026-10-01" }).days, 1);
    });

    it("1 to 30 October is 30 days", () => {
        assert.equal(resolveRange({ from: "2026-10-01", to: "2026-10-30" }).days, 30);
    });

    it("the default window is 30 days", () => {
        assert.equal(resolveRange({}).days, 30);
    });

    it("a start after the end is refused", () => {
        assert.throws(() => resolveRange({ from: "2026-10-02", to: "2026-10-01" }), /after its end/);
    });
});
