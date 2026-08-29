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
const cookie = (await call("POST", "/auth/login", { email, password: "Passw0rd123" })).cookie;

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

console.log(`\n${bad === 0 ? "NOTHING LEAKED" : `${bad} LEAK(S)`}`);
