import "../testing/testEnv.js";
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import z from "zod";
import { env } from "../../config/env.js";
import { Prisma } from "../../generated/prisma/client.js";
import { handlePrismaClientKnownRequestError } from "./handlePrismaErrors.js";
import { handleZodError } from "./handleZodError.js";

const originalNodeEnv = env.NODE_ENV;
afterEach(() => {
    env.NODE_ENV = originalNodeEnv;
});

const knownError = (code: string, meta?: Record<string, unknown>) =>
    new Prisma.PrismaClientKnownRequestError(`Raw ${code} detail from "secret_table"`, { code, clientVersion: "test", meta });

describe("handleZodError", () => {
    it("answers 400 with one entry per issue, paths joined with dots", () => {
        const schema = z.object({ items: z.array(z.object({ price: z.number() })), name: z.string() });
        const result = schema.safeParse({ items: [{ price: "x" }] });
        if (result.success) assert.fail("the payload should not parse");

        const simplified = handleZodError(result.error);
        assert.equal(simplified.statusCode, 400);
        assert.equal(simplified.message, "Validation failed");
        assert.deepEqual(
            simplified.errorSource.map((entry) => entry.path),
            ["items.0.price", "name"]
        );
    });
});

describe("handlePrismaClientKnownRequestError", () => {
    it("maps a unique violation to 409 and names the fields", () => {
        const simplified = handlePrismaClientKnownRequestError(knownError("P2002", { target: ["organization_id", "code"] }));
        assert.equal(simplified.statusCode, 409);
        assert.equal(simplified.message, "Duplicate value for unique field: organization_id, code");
    });

    it("maps a foreign key violation to 409", () => {
        const simplified = handlePrismaClientKnownRequestError(knownError("P2003"));
        assert.equal(simplified.statusCode, 409);
        assert.equal(simplified.message, "This record is linked with other records, operation not allowed");
    });

    it("maps a missing record to 404, using Prisma's cause when there is one", () => {
        assert.equal(handlePrismaClientKnownRequestError(knownError("P2025")).statusCode, 404);
        assert.equal(handlePrismaClientKnownRequestError(knownError("P2025")).message, "Record not found");
        assert.equal(handlePrismaClientKnownRequestError(knownError("P2025", { cause: "No Client found" })).message, "No Client found");
    });

    it("keeps an unknown code's detail in development and hides it in production", () => {
        env.NODE_ENV = "development";
        assert.match(handlePrismaClientKnownRequestError(knownError("P2010")).message, /secret_table/);

        env.NODE_ENV = "production";
        const simplified = handlePrismaClientKnownRequestError(knownError("P2010"));
        assert.equal(simplified.statusCode, 400);
        assert.equal(simplified.message, "Database request failed");
        assert.deepEqual(simplified.errorSource, [{ path: "", message: "Database request failed" }]);
    });
});
