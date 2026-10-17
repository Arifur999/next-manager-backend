import { createHash, randomBytes } from "node:crypto";
import { env } from "../../config/env.js";

// The pieces every emailed one-time link shares: a password reset and the
// team, agency and platform invites.

/** 32 bytes from the CSPRNG. Not a uuid: uuids are identifiers, and their guessability is nobody's design goal. */
export const createLinkToken = () => randomBytes(32).toString("hex");

/** Only this is stored, so the table read from a backup holds no working links. */
export const hashLinkToken = (token: string) => createHash("sha256").update(token).digest("hex");

/** A page on the web app. FRONTEND_URL may list several origins; links use the first. */
export const webAppUrl = (path: string) => `${env.FRONTEND_URL.split(",")[0]}${path}`;
