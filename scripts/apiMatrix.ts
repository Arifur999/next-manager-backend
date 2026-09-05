/**
 * Who the API answers, for every role.
 *
 * The page matrix on the frontend says who can OPEN a screen. This says who the
 * server actually serves — and the two are different claims. A page that
 * bounces while its endpoint answers is a leak with a tidy front door; an
 * endpoint that refuses while its page opens is a screen of broken buttons.
 * Both have happened in this codebase, which is why both are now checked.
 *
 * Compared against a committed snapshot rather than hand-written expectations:
 * a change to who the API serves shows up as a diff in a review instead of
 * being invisible. Re-record deliberately with `npm run test:api-matrix -- --update`
 * and read the diff.
 *
 * Only READS are swept. A matrix of writes would create rows on every run and
 * the interesting writes are already asserted, one refusal at a time and by
 * name, in the smoke suite.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";

const BASE = "http://localhost:5000/api/v1";
const SNAPSHOT = "scripts/api-matrix.expected.txt";
const stamp = Date.now();
const update = process.argv.includes("--update");

type Res = { status: number; json: Record<string, unknown>; cookie: string };

const call = async (method: string, path: string, body?: unknown, cookie = ""): Promise<Res> => {
    const res = await fetch(BASE + path, {
        method,
        headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
        body: body ? JSON.stringify(body) : undefined,
    });
    return {
        status: res.status,
        json: (await res.json().catch(() => ({}))) as Record<string, unknown>,
        cookie: (res.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; "),
    };
};

/**
 * Every read a company role might reach for.
 *
 * Listed by hand, unlike the page matrix which reads the filesystem: routes are
 * declared across many files with parameters and middleware, and a list that
 * guessed at them would be less honest than one somebody maintains.
 */
const ENDPOINTS = [
    "/dashboard",
    "/clients",
    "/leads",
    "/projects",
    "/tasks",
    "/tasks/report",
    "/users",
    "/services",
    "/time-entries",
    "/time-entries/capacity",
    "/time-entries/workload",
    "/workflow-statuses",
    "/vault",
    "/chat",
    "/hr/attendance",
    "/hr/leave",
    "/hr/payroll",
    "/invoices",
    "/payments",
    "/expenses",
    "/accounts",
    "/transactions",
    "/team-payouts",
    "/owner-withdrawals",
    "/due-payments",
    "/loans",
    "/loans/summary",
    "/shareholders",
    "/departments",
    "/activity",
    "/notification-rules",
    "/permissions",
    "/security/login-events",
    "/reports/profit-loss",
    "/reports/cash-flow",
    "/reports/client-revenue",
    "/reports/project-profitability",
    "/reports/monthly",
    "/kpi/agency",
    "/kpi/sales",
    "/kpi/delivery",
    "/kpi/me",
];

const ROLES = ["admin", "sales", "project_manager", "operations"] as const;

// ---------------------------------------------------------------- the people
const adminEmail = `am-admin${stamp}@agencio.test`;
await call("POST", "/auth/register", {
    organization_name: "API Matrix Co",
    full_name: "AM Admin",
    email: adminEmail,
    password: "Passw0rd123",
});
const adminCookie = (await call("POST", "/auth/login", { email: adminEmail, password: "Passw0rd123" }))
    .cookie;

const cookies: Record<string, string> = { admin: adminCookie };

for (const role of ROLES.slice(1)) {
    const email = `am-${role}${stamp}@agencio.test`;
    const made = await call(
        "POST",
        "/users",
        { full_name: `AM ${role}`, email, password: "Passw0rd123", role },
        adminCookie
    );

    if (made.status !== 201) {
        console.error(`Could not create the ${role} account: ${made.status} ${made.json.message}`);
        console.error("The matrix needs one of every role, so this is a hard stop.");
        process.exit(1);
    }

    cookies[role] = (await call("POST", "/auth/login", { email, password: "Passw0rd123" })).cookie;
}

// ---------------------------------------------------------------- the sweep
const label = (status: number) => {
    if (status === 200) return "200";
    if (status === 403) return "403";
    if (status === 404) return "404";
    // Anything else is the endpoint being broken rather than guarded, and is
    // reported as itself so it cannot be read as a refusal.
    return String(status);
};

const rows: Array<{ path: string; cells: string[] }> = [];
for (const path of ENDPOINTS) {
    const cells: string[] = [];
    for (const role of ROLES) {
        cells.push(label((await call("GET", path, undefined, cookies[role])).status));
    }
    rows.push({ path, cells });
}

// ---------------------------------------------------------------- the table
const width = Math.max(...ENDPOINTS.map((e) => e.length), 8);
const header = ["ENDPOINT".padEnd(width), ...ROLES.map((r) => r.padEnd(16))].join(" ");
const table = [
    header,
    "-".repeat(header.length),
    ...rows.map(({ path, cells }) =>
        [path.padEnd(width), ...cells.map((c) => c.padEnd(16))].join(" ").trimEnd()
    ),
].join("\n");

// ---------------------------------------------------------------- the checks
let bad = 0;

for (const { path, cells } of rows) {
    cells.forEach((cell, index) => {
        if (cell !== "200" && cell !== "403" && cell !== "404") {
            bad += 1;
            console.log(`FAIL  ${ROLES[index].padEnd(16)} got ${cell} from ${path}`);
        }
    });

    // An endpoint nobody can read is either dead or misconfigured.
    if (!cells.includes("200")) {
        bad += 1;
        console.log(`FAIL  no company role can read ${path}`);
    }
}

if (update) {
    writeFileSync(SNAPSHOT, `${table}\n`);
    console.log(`\nSnapshot written to ${SNAPSHOT}. Read the diff before committing it.`);
    process.exit(bad === 0 ? 0 : 1);
}

if (!existsSync(SNAPSHOT)) {
    console.log(table);
    console.log("\nNo snapshot yet. Run with --update to record this one.");
    process.exit(1);
}

const expected = readFileSync(SNAPSHOT, "utf8").replace(/\r\n/g, "\n").trimEnd();
const actual = table.trimEnd();

if (expected !== actual) {
    const expectedLines = expected.split("\n");
    const actualLines = actual.split("\n");

    console.log("\nWho the API answers has CHANGED:\n");
    for (const line of new Set([...expectedLines, ...actualLines])) {
        if (!expectedLines.includes(line)) console.log(`  +  ${line}`);
        else if (!actualLines.includes(line)) console.log(`  -  ${line}`);
    }
    console.log(
        "\nIf every line above is a change you meant, re-record it with:" +
            "\n  npm run test:api-matrix -- --update"
    );
    bad += 1;
}

console.log(
    `\n${rows.length} endpoints x ${ROLES.length} roles. ` +
        `${bad === 0 ? "The matrix is what it was." : `${bad} PROBLEM(S) above`}`
);
process.exit(bad === 0 ? 0 : 1);
