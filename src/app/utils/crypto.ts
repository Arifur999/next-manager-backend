import crypto from "crypto";
import { env } from "../../config/env.js";

/**
 * AES-256-GCM for vault credentials.
 *
 * GCM rather than CBC because it is authenticated: decrypt() throws if the
 * ciphertext was altered, so a tampered row fails loudly instead of returning
 * plausible-looking rubbish.
 *
 * Stored format is "iv:authTag:ciphertext", each part base64. The IV is random
 * per encryption and is not a secret - it only has to be unique, and reusing
 * one with the same key is what actually breaks GCM.
 *
 * Losing VAULT_ENCRYPTION_KEY loses every password in the table. It belongs in
 * the secret store, never in the repo, and rotating it means decrypting every
 * row with the old key and re-encrypting with the new one.
 */

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // 96 bits, the size GCM is defined for
const KEY_LENGTH = 32; // 256 bits

// Derived once at module load so a malformed key fails at boot rather than on
// the first credential somebody tries to save.
const getKey = (): Buffer => {
    const raw = env.VAULT_ENCRYPTION_KEY;

    // A 64-character hex string is the intended form (openssl rand -hex 32).
    if (/^[0-9a-fA-F]{64}$/.test(raw)) {
        return Buffer.from(raw, "hex");
    }

    // Anything else is hashed to the right length rather than rejected, so a
    // passphrase works too - but the hex form is what should be used, because
    // a short passphrase is a short passphrase however it is stretched.
    return crypto.createHash("sha256").update(raw, "utf8").digest();
};

const key = getKey();

if (key.length !== KEY_LENGTH) {
    throw new Error("VAULT_ENCRYPTION_KEY did not resolve to a 32-byte key");
}

export const encryptSecret = (plaintext: string): string => {
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

    const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const authTag = cipher.getAuthTag();

    return [iv.toString("base64"), authTag.toString("base64"), ciphertext.toString("base64")].join(":");
};

export const decryptSecret = (stored: string): string => {
    const [ivPart, tagPart, dataPart] = stored.split(":");

    if (!ivPart || !tagPart || !dataPart) {
        throw new Error("Stored secret is not in the expected iv:authTag:ciphertext form");
    }

    const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(ivPart, "base64"));
    decipher.setAuthTag(Buffer.from(tagPart, "base64"));

    return Buffer.concat([
        decipher.update(Buffer.from(dataPart, "base64")),
        decipher.final(),
    ]).toString("utf8");
};

/**
 * What a credential list shows instead of the password: enough to recognise it,
 * not enough to use it. Never send the real value to a list endpoint.
 */
export const maskSecret = (): string => "••••••••";
