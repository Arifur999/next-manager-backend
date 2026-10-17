import "../../testing/testEnv.js";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isUsableResetLink } from "./passwordReset.service.js";

const now = new Date("2026-10-17T12:00:00.000Z");
const later = new Date("2026-10-17T12:30:00.000Z");
const earlier = new Date("2026-10-17T11:30:00.000Z");

describe("isUsableResetLink", () => {
    it("is usable while unused and in date", () => {
        assert.equal(isUsableResetLink({ used_at: null, expires_at: later }, now), true);
    });

    it("is not usable once expired, at the very instant too", () => {
        assert.equal(isUsableResetLink({ used_at: null, expires_at: earlier }, now), false);
        assert.equal(isUsableResetLink({ used_at: null, expires_at: now }, now), false);
    });

    it("is not usable once used, even in date", () => {
        assert.equal(isUsableResetLink({ used_at: earlier, expires_at: later }, now), false);
    });

    it("is not usable when no such link exists", () => {
        assert.equal(isUsableResetLink(null, now), false);
    });
});
