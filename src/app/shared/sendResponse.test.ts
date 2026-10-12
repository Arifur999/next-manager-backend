import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Prisma } from "../../generated/prisma/client.js";
import { serializeData } from "./sendResponse.js";

describe("serializeData", () => {
    it("turns a Decimal into a plain number", () => {
        assert.equal(serializeData(new Prisma.Decimal("1234.50")), 1234.5);
    });

    it("sends a UTC-midnight Date as a calendar day", () => {
        assert.equal(serializeData(new Date("2026-10-01T00:00:00.000Z")), "2026-10-01");
    });

    it("sends any other Date as a full ISO timestamp", () => {
        assert.equal(serializeData(new Date("2026-10-01T09:30:00.000Z")), "2026-10-01T09:30:00.000Z");
        assert.equal(serializeData(new Date("2026-10-01T00:00:00.001Z")), "2026-10-01T00:00:00.001Z");
    });

    it("walks nested arrays and objects", () => {
        const row = {
            amount: new Prisma.Decimal("10.25"),
            due_date: new Date("2026-11-15T00:00:00.000Z"),
            items: [{ price: new Prisma.Decimal("3"), tags: ["a", "b"] }],
            client: { name: "Acme", created_at: new Date("2026-01-02T03:04:05.000Z") },
        };

        assert.deepEqual(serializeData(row), {
            amount: 10.25,
            due_date: "2026-11-15",
            items: [{ price: 3, tags: ["a", "b"] }],
            client: { name: "Acme", created_at: "2026-01-02T03:04:05.000Z" },
        });
    });

    it("passes null, undefined and primitives through", () => {
        assert.equal(serializeData(null), null);
        assert.equal(serializeData(undefined), undefined);
        assert.equal(serializeData("text"), "text");
        assert.equal(serializeData(42), 42);
        assert.equal(serializeData(false), false);
        assert.deepEqual(serializeData({ note: null, extra: undefined }), { note: null, extra: undefined });
    });
});
