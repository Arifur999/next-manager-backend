import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readAccessToken } from "./readAccessToken.js";

describe("readAccessToken", () => {
    it("reads the token on its own", () => {
        assert.equal(readAccessToken("accessToken=abc.def.ghi"), "abc.def.ghi");
    });

    it("finds it among other cookies and decodes it", () => {
        assert.equal(readAccessToken("theme=dark; accessToken=a%2Eb; refreshToken=x"), "a.b");
    });

    it("is undefined when there is no header or no token", () => {
        assert.equal(readAccessToken(undefined), undefined);
        assert.equal(readAccessToken("theme=dark"), undefined);
        assert.equal(readAccessToken("accessToken="), undefined);
    });

    it("is undefined for a malformed escape instead of throwing", () => {
        assert.equal(readAccessToken("accessToken=%E0%A4%A"), undefined);
    });
});
