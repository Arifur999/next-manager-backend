import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loggablePath } from "./loggablePath.js";

const token = "a".repeat(32) + "0123456789abcdef0123456789ABCDEF";

describe("loggablePath", () => {
    it("drops the query string", () => {
        assert.equal(loggablePath("/api/v1/clients?search=acme"), "/api/v1/clients");
    });

    it("replaces a link token in the path", () => {
        assert.equal(loggablePath(`/api/v1/auth/reset-password/${token}`), "/api/v1/auth/reset-password/:token");
        assert.equal(loggablePath(`/api/v1/join/${token}/accept`), "/api/v1/join/:token/accept");
    });

    it("leaves ids and ordinary segments alone", () => {
        const path = "/api/v1/projects/9f79df12-5c52-4285-a54e-7f8b56485faf";
        assert.equal(loggablePath(path), path);
        assert.equal(loggablePath("/api/v1/" + "a".repeat(63)), "/api/v1/" + "a".repeat(63));
    });
});
