import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { transactionListQueryZodSchema } from "./transaction.validation.js";

const parse = (query: Record<string, unknown>) => transactionListQueryZodSchema.parse(query);

describe("transactionListQueryZodSchema", () => {
    it("reads a known kind", () => {
        assert.equal(parse({ kind: "income" }).kind, "income");
    });

    // Matching kinds with `in` once let these through, and the ledger answered 500.
    it("treats a name every object inherits as an unknown kind", () => {
        for (const kind of ["constructor", "__proto__", "toString"]) {
            assert.equal(parse({ kind }).kind, undefined, `kind=${kind}`);
        }
    });

    it("ignores an unknown kind instead of refusing it", () => {
        assert.equal(parse({ kind: "nonsense" }).kind, undefined);
    });

    it("treats an empty account_id as no filter", () => {
        assert.equal(parse({ account_id: "" }).account_id, undefined);
    });

    it("refuses a malformed account_id", () => {
        assert.equal(transactionListQueryZodSchema.safeParse({ account_id: "cash" }).success, false);
    });
});
