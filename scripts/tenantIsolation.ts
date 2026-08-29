/**
 * Can one company reach another company's data.
 *
 * A foreign key proves a row EXISTS. It says nothing about who owns it, and
 * Prisma will happily write `client_id` pointing at another tenant's client if
 * the service does not check. Every reference below is therefore attacked
 * directly with a real id belonging to a real other company - the schema
 * cannot prevent this, so only the services can, and the only way to know is
 * to try.
 *
 * Two companies are created, then A is handed B's ids and asked to use them.
 * Every one of those must be refused.
 *
 * Run:  npm run test:isolation   (with the server up)
 */

const BASE = "http://localhost:5000/api/v1";
const stamp = Date.now();
let failures = 0;

// Responses are probed for arbitrary shapes here, so the value type is
// deliberately unknown rather than any - reading a field still has to be
// narrowed at the point of use.
type Res = { status: number; json: Record<string, unknown> };

const call = async (method: string, path: string, body?: unknown, cookie = ""): Promise<Res & { cookie: string }> => {
    const res = await fetch(BASE + path, {
        method,
        headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
        body: body ? JSON.stringify(body) : undefined,
    });
    const setCookie = res.headers.getSetCookie?.() ?? [];
    return {
        status: res.status,
        json: (await res.json().catch(() => ({}))) as Record<string, unknown>,
        cookie: setCookie.map((c) => c.split(";")[0]).join("; "),
    };
};

/**
 * A refusal, of any shape.
 *
 * 404 and 403 both count: which one is right depends on whether admitting the
 * record exists is itself a leak, and that is decided per endpoint. What must
 * never happen is a 2xx - that is the row being written across a tenant line.
 */
const refused = (label: string, res: Res) => {
    const ok = res.status >= 400;
    if (ok) {
        console.log(`  PASS  ${label}  (${res.status})`);
    } else {
        failures += 1;
        console.log(`  BREACH  ${label}  -> ${res.status} ACCEPTED. ${JSON.stringify(res.json.data ?? res.json).slice(0, 120)}`);
    }
};

const ok = (label: string, condition: boolean, detail = "") => {
    if (condition) {
        console.log(`  PASS  ${label}`);
    } else {
        failures += 1;
        console.log(`  FAIL  ${label}${detail ? ` -> ${detail}` : ""}`);
    }
};

/** Sets up one company with a full set of records to be stolen. */
const buildCompany = async (tag: string) => {
    const email = `iso-${tag}${stamp}@agencio.test`;
    await call("POST", "/auth/register", {
        organization_name: `Iso ${tag}`,
        full_name: `Iso ${tag}`,
        email,
        password: "Passw0rd123",
    });
    const cookie = (await call("POST", "/auth/login", { email, password: "Passw0rd123" })).cookie;

    const usd = (await call("POST", "/accounts", { name: "USD", type: "paypal", currency: "USD" }, cookie)).json.data;
    const bdt = (await call("POST", "/accounts", { name: "BDT", type: "bkash", currency: "BDT" }, cookie)).json.data;
    const client = (await call("POST", "/clients", { name: `${tag} Client` }, cookie)).json.data;
    const project = (await call("POST", "/projects", {
        client_id: client.id,
        name: `${tag} Project`,
        code: `${tag}-${stamp}`,
        status: "active",
    }, cookie)).json.data;
    const task = (await call("POST", "/tasks", { project_id: project.id, title: `${tag} Task` }, cookie)).json.data;
    const invoice = (await call("POST", "/invoices", {
        client_id: client.id,
        issue_date: "2026-08-01",
        due_date: "2026-08-31",
        items: [{ description: "Work", quantity: 1, unit_price: 100 }],
    }, cookie)).json.data;
    const category = (await call("POST", "/expense-categories", { name: `${tag} Cat`, type: "general" }, cookie)).json.data;
    const member = (await call("GET", "/auth/me", undefined, cookie)).json.data;

    return { cookie, usd, bdt, client, project, task, invoice, category, member };
};

console.log("\nbuilding two companies...");
const a = await buildCompany("A");
const b = await buildCompany("B");

ok("both companies set up", Boolean(a.client?.id && b.client?.id), JSON.stringify({ a: a.client?.id, b: b.client?.id }));

console.log("\n--- A tries to READ B's records ---");
refused("read B's client", await call("GET", `/clients/${b.client.id}`, undefined, a.cookie));
refused("read B's project", await call("GET", `/projects/${b.project.id}`, undefined, a.cookie));
refused("read B's invoice", await call("GET", `/invoices/${b.invoice.id}`, undefined, a.cookie));
refused("read B's project financials", await call("GET", `/projects/${b.project.id}/financials`, undefined, a.cookie));
refused("read B's client financials", await call("GET", `/clients/${b.client.id}/financials`, undefined, a.cookie));

console.log("\n--- A tries to WRITE using B's ids ---");
refused(
    "payment against B's client",
    await call("POST", "/payments", {
        client_id: b.client.id,
        date: "2026-08-10",
        amount_usd: 100,
        reporting_rate: 120,
        account_id: a.usd.id,
    }, a.cookie)
);

refused(
    "payment into B's account",
    await call("POST", "/payments", {
        client_id: a.client.id,
        date: "2026-08-10",
        amount_usd: 100,
        reporting_rate: 120,
        account_id: b.usd.id,
    }, a.cookie)
);

refused(
    "payment attached to B's invoice",
    await call("POST", "/payments", {
        client_id: a.client.id,
        invoice_id: b.invoice.id,
        date: "2026-08-10",
        amount_usd: 100,
        reporting_rate: 120,
        account_id: a.usd.id,
    }, a.cookie)
);

refused(
    "project for B's client",
    await call("POST", "/projects", {
        client_id: b.client.id,
        name: "Stolen",
        code: `ST-${stamp}`,
        status: "active",
    }, a.cookie)
);

refused(
    "task on B's project",
    await call("POST", "/tasks", { project_id: b.project.id, title: "Stolen task" }, a.cookie)
);

refused(
    "task assigned to B's person",
    await call("POST", "/tasks", { project_id: a.project.id, title: "x", assignee_id: b.member.id }, a.cookie)
);

refused(
    "invoice for B's client",
    await call("POST", "/invoices", {
        client_id: b.client.id,
        issue_date: "2026-08-01",
        due_date: "2026-08-31",
        items: [{ description: "x", quantity: 1, unit_price: 10 }],
    }, a.cookie)
);

refused(
    "invoice on B's project",
    await call("POST", "/invoices", {
        client_id: a.client.id,
        project_id: b.project.id,
        issue_date: "2026-08-01",
        due_date: "2026-08-31",
        items: [{ description: "x", quantity: 1, unit_price: 10 }],
    }, a.cookie)
);

refused(
    "time logged to B's project",
    await call("POST", "/time-entries", {
        project_id: b.project.id,
        date: "2026-08-10",
        hours: 1,
        is_billable: true,
    }, a.cookie)
);

refused(
    "time logged to B's task",
    await call("POST", "/time-entries", {
        project_id: a.project.id,
        task_id: b.task.id,
        date: "2026-08-10",
        hours: 1,
        is_billable: true,
    }, a.cookie)
);

refused(
    "expense in B's category",
    await call("POST", "/expenses", {
        date: "2026-08-10",
        category_id: b.category.id,
        amount_bdt: 100,
        account_id: a.bdt.id,
    }, a.cookie)
);

refused(
    "expense from B's account",
    await call("POST", "/expenses", {
        date: "2026-08-10",
        category_id: a.category.id,
        amount_bdt: 100,
        account_id: b.bdt.id,
    }, a.cookie)
);

refused(
    "payout to B's person",
    await call("POST", "/team-payouts", {
        user_id: b.member.id,
        date: "2026-08-10",
        amount_bdt: 100,
        type: "salary",
        account_id: a.bdt.id,
    }, a.cookie)
);

refused(
    "exchange out of B's account",
    await call("POST", "/exchanges", {
        date: "2026-08-12",
        from_account_id: b.usd.id,
        to_account_id: a.bdt.id,
        amount_usd: 10,
        rate: 120,
    }, a.cookie)
);

refused(
    "B's person added to A's project",
    await call("POST", "/project-members", { project_id: a.project.id, user_id: b.member.id }, a.cookie)
);

refused(
    "milestone on B's project",
    await call("POST", "/milestones", {
        project_id: b.project.id,
        title: "Stolen milestone",
        due_date: "2026-09-01",
    }, a.cookie)
);

refused(
    "KPI target for B's person",
    await call("POST", "/kpi-targets", {
        user_id: b.member.id,
        metric: "utilization_pct",
        period: "month",
        period_start: "2026-08-01",
        target_value: 70,
    }, a.cookie)
);

refused(
    "vault credential on B's project",
    await call("POST", "/vault", {
        label: "Stolen",
        password: "secret123",
        project_id: b.project.id,
    }, a.cookie)
);

// The references added since this suite was written. Each is a new way to
// write across a tenant line, and a foreign key stops none of them.
const bSource = (await call("POST", "/lead-sources", { name: "B Marketplace" }, b.cookie)).json
    .data as { id: string };
const bLink = (
    await call(
        "POST",
        "/client-links",
        { client_id: b.client.id, label: "B Drive", url: "https://example.com/b" },
        b.cookie
    )
).json.data as { id: string };

refused(
    "lead tagged with B's marketplace",
    await call("POST", "/leads", { name: "Tagged", stage: "new", source_id: bSource.id }, a.cookie)
);

refused(
    "link attached to B's client",
    await call(
        "POST",
        "/client-links",
        { client_id: b.client.id, label: "Stolen", url: "https://example.com/stolen" },
        a.cookie
    )
);

refused(
    "edit B's link",
    await call("PATCH", `/client-links/${bLink.id}`, { label: "Owned" }, a.cookie)
);
refused("delete B's link", await call("DELETE", `/client-links/${bLink.id}`, undefined, a.cookie));
refused(
    "edit B's marketplace",
    await call("PATCH", `/lead-sources/${bSource.id}`, { name: "Owned" }, a.cookie)
);

// A list endpoint cannot 404, so this one is checked by what comes back.
const linkList = await call("GET", `/client-links?client_id=${b.client.id}`, undefined, a.cookie);
ok(
    "A's link list carries none of B's",
    Array.isArray(linkList.json.data) && (linkList.json.data as unknown[]).length === 0,
    JSON.stringify(linkList.json.data)
);

console.log("\n--- A tries to MODIFY B's records ---");
refused("edit B's client", await call("PATCH", `/clients/${b.client.id}`, { name: "Owned" }, a.cookie));
refused("edit B's project", await call("PATCH", `/projects/${b.project.id}`, { name: "Owned" }, a.cookie));
refused("edit B's invoice", await call("PATCH", `/invoices/${b.invoice.id}`, { notes: "Owned" }, a.cookie));
refused("edit B's user", await call("PATCH", `/users/${b.member.id}`, { role: "operations" }, a.cookie));
refused("delete B's client", await call("DELETE", `/clients/${b.client.id}`, undefined, a.cookie));
refused("delete B's project", await call("DELETE", `/projects/${b.project.id}`, undefined, a.cookie));
refused("delete B's task", await call("DELETE", `/tasks/${b.task.id}`, undefined, a.cookie));
refused("delete B's account", await call("DELETE", `/accounts/${b.usd.id}`, undefined, a.cookie));

console.log("\n--- B is untouched ---");
const bClients = await call("GET", "/clients", undefined, b.cookie);
ok(
    "B still sees exactly its own client",
    bClients.json.data?.length === 1 && bClients.json.data[0].id === b.client.id,
    `${bClients.json.data?.length} clients`
);

const bProjects = await call("GET", "/projects", undefined, b.cookie);
ok(
    "and exactly its own project",
    bProjects.json.data?.length === 1 && bProjects.json.data[0].id === b.project.id,
    `${bProjects.json.data?.length} projects`
);

const bAccounts = await call("GET", "/accounts", undefined, b.cookie);
ok(
    "with its account balances unchanged at zero",
    bAccounts.json.data?.every((account: { balance: number }) => account.balance === 0),
    JSON.stringify(bAccounts.json.data?.map((x: { name: string; balance: number }) => `${x.name}:${x.balance}`))
);

console.log(`\n${failures === 0 ? "TENANT ISOLATION HOLDS" : `${failures} PROBLEM(S) - see BREACH lines above`}\n`);
process.exit(failures === 0 ? 0 : 1);
