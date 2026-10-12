import assert from "node:assert/strict";
import { describe, it } from "node:test";

// A fixed key for this process, set before the module reads the environment.
process.env.VAULT_ENCRYPTION_KEY = "a1".repeat(32);
await import("../testing/testEnv.js");
const { decryptSecret, encryptSecret } = await import("./crypto.js");

/** Flips one bit in one base64 part of "iv:authTag:ciphertext". */
const tamper = (stored: string, part: 0 | 1 | 2): string => {
    const parts = stored.split(":");
    const bytes = Buffer.from(parts[part], "base64");
    bytes[0] ^= 0x01;
    parts[part] = bytes.toString("base64");
    return parts.join(":");
};

describe("vault encryption", () => {
    it("decrypts what it encrypted, including non-ASCII text", () => {
        for (const secret of ["hunter2", "pässwörd with spaces", "পাসওয়ার্ড", "x".repeat(5000)]) {
            assert.equal(decryptSecret(encryptSecret(secret)), secret);
        }
    });

    it("never produces the same ciphertext twice for one secret", () => {
        const first = encryptSecret("same secret");
        const second = encryptSecret("same secret");
        assert.notEqual(first, second);
        assert.notEqual(first.split(":")[0], second.split(":")[0], "the IV must be random");
    });

    it("stores iv, tag and ciphertext, and never the plain text", () => {
        const stored = encryptSecret("hunter2");
        assert.equal(stored.split(":").length, 3);
        assert.ok(!stored.includes("hunter2"));
    });

    it("refuses a ciphertext, tag or IV that was altered", () => {
        const stored = encryptSecret("hunter2");
        assert.throws(() => decryptSecret(tamper(stored, 2)));
        assert.throws(() => decryptSecret(tamper(stored, 1)));
        assert.throws(() => decryptSecret(tamper(stored, 0)));
    });

    it("refuses a value that is not in the stored form", () => {
        assert.throws(() => decryptSecret("not-encrypted"), /iv:authTag:ciphertext/);
        assert.throws(() => decryptSecret("a:b"), /iv:authTag:ciphertext/);
    });
});
