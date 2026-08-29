/**
 * The password reset happy path, end to end.
 *
 * Separate from smoke.mjs because it needs the database. The token is stored
 * hashed - deliberately - so there is no way to recover the emailed value over
 * HTTP, and the alternative would have been a dev-only endpoint that returns
 * the token in the response. That is one misconfigured NODE_ENV away from
 * handing out reset links in production, so this reads the row instead.
 *
 * Run:  npm run test:reset   (with the server up)
 */

import { createHash, randomBytes } from "node:crypto";
import { prisma } from "../src/app/lib/prisma.js";

const BASE = "http://localhost:5000/api/v1";
let failures = 0;

const call = async (method: string, path: string, body?: unknown) => {
    const res = await fetch(`${BASE}${path}`, {
        method,
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, json: (await res.json().catch(() => ({}))) as Record<string, unknown> };
};

const check = (label: string, condition: boolean, detail = "") => {
    if (condition) {
        console.log(`  PASS  ${label}`);
    } else {
        failures += 1;
        console.log(`  FAIL  ${label}${detail ? ` -> ${detail}` : ""}`);
    }
};

const stamp = Date.now();
const email = `reset${stamp}@agencio.test`;

await call("POST", "/auth/register", {
    organization_name: "Reset Co",
    full_name: "Reset Owner",
    email,
    password: "Passw0rd123",
});

let r = await call("POST", "/auth/login", { email, password: "Passw0rd123" });
check("the account works before the reset", r.status === 200, `${r.status}`);

// Ask for a link, then confirm a row actually landed - the endpoint answers
// the same either way, so its own response proves nothing.
await call("POST", "/auth/forgot-password", { email });

const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
const issued = await prisma.passwordResetToken.findMany({
    where: { user_id: user!.id },
    select: { id: true, used_at: true, expires_at: true },
});
check("a reset token was issued", issued.length === 1, `${issued.length} rows`);
check("unused, with a future expiry", issued[0]?.used_at === null && issued[0].expires_at > new Date());

// The emailed token cannot be read back, so a known one is planted the same
// way the service would store it. This exercises the half that matters: what
// happens when somebody arrives holding a valid token.
const token = randomBytes(32).toString("hex");
await prisma.passwordResetToken.update({
    where: { id: issued[0]!.id },
    data: { token_hash: createHash("sha256").update(token).digest("hex") },
});

r = await call("POST", "/auth/reset-password", { token, new_password: "Newpass456" });
check("a valid token resets the password", r.status === 200, `${r.status} ${r.json.message}`);

r = await call("POST", "/auth/login", { email, password: "Passw0rd123" });
check("the old password stops working", r.status === 401, `${r.status}`);

r = await call("POST", "/auth/login", { email, password: "Newpass456" });
check("the new one works", r.status === 200, `${r.status} ${r.json.message}`);

// A link that keeps working is a link that can be replayed out of an inbox.
r = await call("POST", "/auth/reset-password", { token, new_password: "Thirdpass789" });
check("the same token cannot be used twice", r.status === 400, `${r.status} ${r.json.message}`);

r = await call("POST", "/auth/login", { email, password: "Thirdpass789" });
check("and the replay changed nothing", r.status === 401, `${r.status}`);

// An expired token is refused even though it was never spent.
await call("POST", "/auth/forgot-password", { email });
const fresh = await prisma.passwordResetToken.findFirst({
    where: { user_id: user!.id, used_at: null },
    select: { id: true },
});
const expiredToken = randomBytes(32).toString("hex");
await prisma.passwordResetToken.update({
    where: { id: fresh!.id },
    data: {
        token_hash: createHash("sha256").update(expiredToken).digest("hex"),
        expires_at: new Date(Date.now() - 60_000),
    },
});

r = await call("POST", "/auth/reset-password", { token: expiredToken, new_password: "Expired123" });
check("an expired token is refused", r.status === 400, `${r.status} ${r.json.message}`);

// Asking again must retire whatever was outstanding, or two live links exist
// and the older one still works after the newer is spent.
await call("POST", "/auth/forgot-password", { email });
await call("POST", "/auth/forgot-password", { email });
const live = await prisma.passwordResetToken.count({
    where: { user_id: user!.id, used_at: null },
});
check("only one link is ever live at a time", live === 1, `${live} unused rows`);

await prisma.organization.deleteMany({ where: { name: "Reset Co", email } });
await prisma.$disconnect();

console.log(`\n${failures === 0 ? "RESET FLOW CORRECT" : `${failures} CHECK(S) FAILED`}\n`);
process.exit(failures === 0 ? 0 : 1);
