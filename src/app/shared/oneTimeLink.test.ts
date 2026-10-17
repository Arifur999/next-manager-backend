import "../testing/testEnv.js";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createLinkToken, hashLinkToken, isOpenInvite } from "./oneTimeLink.js";

const HOUR = 60 * 60 * 1000;

describe("createLinkToken", () => {
    it("is 32 random bytes as hex", () => {
        assert.match(createLinkToken(), /^[0-9a-f]{64}$/);
    });

    it("is never the same twice", () => {
        assert.notEqual(createLinkToken(), createLinkToken());
    });
});

describe("hashLinkToken", () => {
    // Pinned to the algorithm, not just to repeatability: a switch to another
    // hash, an HMAC or a pepper would strand every link already sent.
    it("is plain sha256 as hex", () => {
        assert.equal(hashLinkToken("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    });

    it("gives the same sha256 hex for the same token, so a link can be looked up", () => {
        const token = createLinkToken();
        assert.equal(hashLinkToken(token), hashLinkToken(token));
        assert.match(hashLinkToken(token), /^[0-9a-f]{64}$/);
    });

    it("never stores the token itself", () => {
        const token = createLinkToken();
        assert.notEqual(hashLinkToken(token), token);
    });
});

describe("isOpenInvite", () => {
    const open = { used_at: null, revoked_at: null, expires_at: new Date(Date.now() + HOUR) };

    it("is open while unused, unrevoked and in date", () => {
        assert.equal(isOpenInvite(open), true);
    });

    it("is closed once used, revoked or expired", () => {
        assert.equal(isOpenInvite({ ...open, used_at: new Date() }), false);
        assert.equal(isOpenInvite({ ...open, revoked_at: new Date() }), false);
        assert.equal(isOpenInvite({ ...open, expires_at: new Date(Date.now() - HOUR) }), false);
    });

    it("is closed when no invite matched the token", () => {
        assert.equal(isOpenInvite(null), false);
    });
});
