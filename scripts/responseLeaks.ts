/**
 * Does any response body carry something it should never carry.
 *
 * Field names, not values, because a name is what survives a refactor: the day
 * somebody adds a column and forgets the allow-list, this catches it before a
 * customer does. The vault password is checked BY VALUE as well, since the
 * list endpoint is supposed to mask it and a mask is only provable by the
 * plaintext being absent.
 *
 * Run:  npm run test:leaks   (with the server up)
 */
import { createHash, randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client.js";

const BASE = "http://localhost:5000/api/v1";
const stamp = Date.now();
let bad = 0;

const call = async (m: string, p: string, b?: unknown, c = "") => {
    const r = await fetch(BASE + p, {
        method: m,
        headers: { "Content-Type": "application/json", ...(c ? { Cookie: c } : {}) },
        body: b ? JSON.stringify(b) : undefined,
    });
    const sc = r.headers.getSetCookie?.() ?? [];
    return { status: r.status, text: await r.text(), cookie: sc.map((x) => x.split(";")[0]).join("; ") };
};

// Field names that must never appear in a response body.
const FORBIDDEN = [
    '"password"',
    '"token_hash"',
    '"token_version"',
    '"password_hash"',
    // The vault stores AES-GCM as iv:authTag:ciphertext. The reveal endpoint
    // returns the decrypted value on purpose; the LIST must never carry either.
    '"encrypted_password"',
    '"ciphertext"',
];

const email = `leak${stamp}@agencio.test`;
await call("POST", "/auth/register", {
    organization_name: "Leak Co",
    full_name: "Leak Admin",
    email,
    password: "Passw0rd123",
});
const login = await call("POST", "/auth/login", { email, password: "Passw0rd123" });
// Signed out, every body below is a 401 and reads clean, so that is a hard stop.
if (login.status !== 200 || !login.cookie.includes("accessToken")) {
    console.log(`  FAIL  sign-in answered ${login.status}${login.cookie ? "" : " with no cookie"}; nothing below would be checked`);
    process.exit(1);
}
const cookie = login.cookie;

const client = JSON.parse((await call("POST", "/clients", { name: "LC" }, cookie)).text).data;
await call("POST", "/vault", { label: "Server", username: "root", password: "hunter2secret", client_id: client.id }, cookie);

const ENDPOINTS = [
    "/auth/me",
    "/users",
    "/clients",
    "/projects",
    "/vault",
    "/accounts",
    "/dashboard",
    "/activity",
    "/time-entries/capacity",
    "/platform/subscription",
];

console.log("checking response bodies for fields that must never travel:\n");

for (const path of ENDPOINTS) {
    const res = await call("GET", path, undefined, cookie);
    // The vault list carries a "password" key on purpose - masked. The field
    // name proves nothing there, so that one endpoint is judged on the value
    // instead, which is the only thing a mask can be proved by.
    const hits = FORBIDDEN.filter(
        (field) => res.text.includes(field) && !(path === "/vault" && field === '"password"')
    );

    const plaintext = res.text.includes("hunter2secret");

    if (path === "/vault" && !res.text.includes("••••")) {
        bad += 1;
        console.log("  LEAK  /vault password is not masked");
    }

    if (hits.length > 0 || plaintext) {
        bad += 1;
        console.log(`  LEAK  ${path}  ${hits.join(" ")}${plaintext ? " PLAINTEXT-VAULT-PASSWORD" : ""}`);
    } else {
        console.log(`  clean ${path}  (${res.status})`);
    }
}

// Register and login return a user; both are the most likely place a hash
// escapes, because the row was read whole.
for (const [label, res] of [
    ["register response", await call("POST", "/auth/register", {
        organization_name: "Leak Co 2",
        full_name: "Leak 2",
        email: `leak2${stamp}@agencio.test`,
        password: "Passw0rd123",
    })],
    ["login response", await call("POST", "/auth/login", { email, password: "Passw0rd123" })],
] as const) {
    const hits = FORBIDDEN.filter((field) => res.text.includes(field));
    if (hits.length > 0) {
        bad += 1;
        console.log(`  LEAK  ${label}  ${hits.join(" ")}`);
    } else {
        console.log(`  clean ${label}`);
    }
}

// Operations delivers the work and never sees what it is worth. Checked on
// every read that returns a whole project row, with admin as the control.
const MONEY = ['"contract_value_usd"', '"baseline_value_usd"'];
const project = JSON.parse(
    (await call("POST", "/projects", { client_id: client.id, name: "Priced", code: `PR-${stamp}`, contract_value_usd: 1000 }, cookie)).text
).data;
const opsEmail = `leakops${stamp}@agencio.test`;
const ops = JSON.parse(
    (await call("POST", "/users", { full_name: "Leak Ops", email: opsEmail, password: "Passw0rd123", role: "operations" }, cookie)).text
).data;
await call("POST", "/project-members", { project_id: project.id, user_id: ops.id }, cookie);
const opsCookie = (await call("POST", "/auth/login", { email: opsEmail, password: "Passw0rd123" })).cookie;

const adminDetail = await call("GET", `/projects/${project.id}`, undefined, cookie);
if (!adminDetail.text.includes('"contract_value_usd"')) {
    bad += 1;
    console.log("  FAIL  admin lost the contract value, so the operations check below proves nothing");
}

for (const path of ["/projects", "/projects?mine=true", `/projects/${project.id}`, `/clients/${client.id}`]) {
    const res = await call("GET", path, undefined, opsCookie);
    const hits = MONEY.filter((field) => res.text.includes(field));
    if (res.status !== 200 || hits.length > 0) {
        bad += 1;
        console.log(`  LEAK  operations ${path} (${res.status}) ${hits.join(" ")}`);
    } else {
        console.log(`  clean operations ${path}`);
    }
}

// The reset-link check answers whether a link works and nothing else. The
// link rows are written straight to the database, so no mail is ever sent.
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
const resetUser = await prisma.user.findFirst({ where: { email }, select: { id: true } });
const linkToken = randomBytes(32).toString("hex");
const linkRow = await prisma.passwordResetToken.create({
    data: {
        user_id: resetUser?.id ?? "",
        token_hash: createHash("sha256").update(linkToken).digest("hex"),
        expires_at: new Date(Date.now() + 30 * 60 * 1000),
    },
    select: { id: true },
});

const checkLink = async (token: string) => {
    const res = await call("GET", `/auth/reset-password/${token}`);
    return { status: res.status, data: (JSON.parse(res.text) as { data?: Record<string, unknown> }).data ?? {} };
};
const onlyValid = (data: Record<string, unknown>) => Object.keys(data).join(",") === "valid";

for (const [label, token, expected] of [
    ["a fresh reset link", linkToken, true],
    ["an unknown reset link", randomBytes(32).toString("hex"), false],
] as const) {
    const res = await checkLink(token);
    if (res.status !== 200 || res.data.valid !== expected || !onlyValid(res.data)) {
        bad += 1;
        console.log(`  LEAK  ${label}: ${res.status} ${JSON.stringify(res.data)}`);
    } else {
        console.log(`  clean ${label} answers valid=${expected} and nothing else`);
    }
}

await prisma.passwordResetToken.update({ where: { id: linkRow.id }, data: { used_at: new Date() } });
const spent = await checkLink(linkToken);
if (spent.data.valid !== false || !onlyValid(spent.data)) {
    bad += 1;
    console.log(`  LEAK  a used reset link still answers ${JSON.stringify(spent.data)}`);
} else {
    console.log("  clean a used reset link answers valid=false");
}
await prisma.$disconnect();

console.log(`\n${bad === 0 ? "NOTHING LEAKED" : `${bad} LEAK(S)`}`);
process.exitCode = bad === 0 ? 0 : 1;
