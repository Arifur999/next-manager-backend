import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decideLeaveZodSchema, leaveBalanceQueryZodSchema } from "./hr.validation.js";

describe("leaveBalanceQueryZodSchema", () => {
    it("reads a year", () => {
        assert.equal(leaveBalanceQueryZodSchema.parse({ year: "2026" }).year, 2026);
    });

    it("leaves a year it cannot use for the controller's this-year default", () => {
        for (const year of ["", "abc", "0", "-1", "2026.5"]) {
            assert.equal(leaveBalanceQueryZodSchema.parse({ year }).year, undefined, `year=${year}`);
        }
    });

    it("treats an empty user_id as the caller", () => {
        assert.equal(leaveBalanceQueryZodSchema.parse({ user_id: "" }).user_id, undefined);
    });

    it("refuses a malformed user_id", () => {
        assert.equal(leaveBalanceQueryZodSchema.safeParse({ user_id: "not-an-id" }).success, false);
    });
});

describe("decideLeaveZodSchema", () => {
    it("decides without a note", () => {
        assert.deepEqual(decideLeaveZodSchema.parse({ approve: true }), { approve: true });
    });

    it("carries an optional note for the requester", () => {
        assert.equal(decideLeaveZodSchema.parse({ approve: false, note: "Launch week" }).note, "Launch week");
    });

    it("refuses a note past 300 characters, and a missing decision", () => {
        assert.equal(decideLeaveZodSchema.safeParse({ approve: false, note: "x".repeat(301) }).success, false);
        assert.equal(decideLeaveZodSchema.safeParse({ note: "Launch week" }).success, false);
    });
});
