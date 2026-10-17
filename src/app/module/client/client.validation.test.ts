import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { clientListQueryZodSchema } from "./client.validation.js";

describe("clientListQueryZodSchema", () => {
    // `status in ClientStatus` once let inherited names through to the database.
    it("treats a name every object inherits as an unknown status", () => {
        assert.equal(clientListQueryZodSchema.parse({ status: "constructor" }).status, undefined);
    });
});
