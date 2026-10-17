import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { platformActivityQueryZodSchema, platformTrendQueryZodSchema } from "./platform.validation.js";

describe("platformTrendQueryZodSchema", () => {
    it("defaults to the last 90 days", () => {
        assert.equal(platformTrendQueryZodSchema.parse({}).days, 90);
    });

    it("reads a whole number of days", () => {
        assert.equal(platformTrendQueryZodSchema.parse({ days: "30" }).days, 30);
    });

    it("falls back to 90 for a value it cannot use", () => {
        for (const days of ["", "abc", "0", "-5", "1.5"]) {
            assert.equal(platformTrendQueryZodSchema.parse({ days }).days, 90, `days=${days}`);
        }
    });
});

describe("platformActivityQueryZodSchema", () => {
    it("starts on page 1 with 100 rows", () => {
        const query = platformActivityQueryZodSchema.parse({});
        assert.equal(query.page, 1);
        assert.equal(query.limit, 100);
    });

    it("caps the page size like every list", () => {
        assert.equal(platformActivityQueryZodSchema.parse({ limit: "5000" }).limit, 200);
    });

    it("falls back to the defaults for a page or limit it cannot use", () => {
        const query = platformActivityQueryZodSchema.parse({ page: "0", limit: "abc" });
        assert.equal(query.page, 1);
        assert.equal(query.limit, 100);
    });

    it("refuses a malformed actor_id", () => {
        assert.equal(platformActivityQueryZodSchema.safeParse({ actor_id: "nobody" }).success, false);
    });
});
