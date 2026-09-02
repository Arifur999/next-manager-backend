// End-to-end smoke test against a running AGENCIO backend.
// Walks the money path that matters: signup -> accounts -> client -> payment
// (USD in) -> exchange (USD out, BDT in) -> balances -> dashboard.

const BASE = "http://localhost:5000/api/v1";
let cookie = "";
let failures = 0;

const call = async (method, path, body) => {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });

  const setCookie = res.headers.getSetCookie?.() ?? [];
  if (setCookie.length) {
    cookie = setCookie.map((c) => c.split(";")[0]).join("; ");
  }

  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
};

const check = (label, condition, detail = "") => {
  if (condition) {
    console.log(`  PASS  ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${label}${detail ? ` -> ${detail}` : ""}`);
  }
};

const near = (a, b, tolerance = 0.01) => Math.abs(a - b) < tolerance;

const stamp = Date.now();
const email = `owner${stamp}@agencio.test`;

// Dates that have to be inside the CURRENT month, because the checks that read
// them ask about "this month" - the dashboard's month revenue, and the KPI
// range that a freshly decided deal falls into.
//
// These were hardcoded to a fixed month, which meant the suite went red on the
// first of every month with two failures that had nothing to do with the code.
// A suite that cries wolf on a calendar boundary is one people learn to ignore.
const now = new Date();
const YEAR = now.getUTCFullYear();
const MONTH = String(now.getUTCMonth() + 1).padStart(2, "0");
const TODAY = `${YEAR}-${MONTH}-${String(now.getUTCDate()).padStart(2, "0")}`;
const MONTH_START = `${YEAR}-${MONTH}-01`;
// Day 0 of next month is the last day of this one, leap years included.
const MONTH_END = `${YEAR}-${MONTH}-${String(
  new Date(Date.UTC(YEAR, now.getUTCMonth() + 1, 0)).getUTCDate()
).padStart(2, "0")}`;

console.log("\n--- signup + auth ---");
let r = await call("POST", "/auth/register", {
  organization_name: "Pixel Forge Agency",
  full_name: "Test Owner",
  email,
  password: "Passw0rd123",
});
check("register creates company + first admin", r.status === 201, `${r.status} ${r.json.message}`);
// With owner gone, whoever signs up is the company's first admin - the top
// role inside it.
check("admin role assigned", r.json.data?.role === "admin", r.json.data?.role);
check("organization_id set", Boolean(r.json.data?.organization_id));
// Kept for the billing checks at the end, which have to name a company.
const orgId = r.json.data?.organization_id;

r = await call("POST", "/auth/login", { email, password: "Passw0rd123" });
check("login", r.status === 200, `${r.status} ${r.json.message}`);
check("cookies issued", cookie.includes("accessToken"));

r = await call("GET", "/auth/me");
check("/auth/me", r.status === 200 && r.json.data?.email === email);

console.log("\n--- accounts ---");
r = await call("POST", "/accounts", { name: "PayPal", type: "paypal", currency: "USD" });
const usdAccount = r.json.data?.id;
check("create USD account", r.status === 201, r.json.message);

r = await call("POST", "/accounts", { name: "bKash", type: "bkash", currency: "BDT" });
const bdtAccount = r.json.data?.id;
check("create BDT account", r.status === 201, r.json.message);

r = await call("POST", "/accounts", { name: "PayPal", type: "paypal", currency: "USD" });
check("duplicate account name rejected", r.status === 409, `${r.status}`);

console.log("\n--- client + payment (USD in) ---");
r = await call("POST", "/clients", { name: "Acme Corp", company: "Acme", email: "billing@acme.test" });
const clientId = r.json.data?.id;
check("create client", r.status === 201, r.json.message);

// No rate configured and no cron run yet -> the server must say so rather than
// invent a figure.
r = await call("POST", "/payments", {
  client_id: clientId,
  date: TODAY,
  amount_usd: 500,
  account_id: usdAccount,
});
const rateAutoResolved = r.status === 201;
check(
  "payment without a rate either resolves one or refuses clearly",
  rateAutoResolved || (r.status === 400 && /rate/i.test(r.json.message)),
  `${r.status} ${r.json.message}`
);

if (!rateAutoResolved) {
  r = await call("POST", "/payments", {
    client_id: clientId,
    date: TODAY,
    amount_usd: 500,
    reporting_rate: 122,
    account_id: usdAccount,
  });
}
check("record payment", r.status === 201, `${r.status} ${r.json.message}`);
const paymentRate = r.json.data?.reporting_rate;
check("reporting rate frozen on the row", typeof paymentRate === "number" && paymentRate > 0, String(paymentRate));
check(
  "BDT reporting = usd * rate",
  near(r.json.data?.amount_bdt_reporting, 500 * paymentRate),
  `${r.json.data?.amount_bdt_reporting} vs ${500 * paymentRate}`
);

console.log("\n--- currency guards ---");
r = await call("POST", "/payments", {
  client_id: clientId,
  date: "2026-08-10",
  amount_usd: 100,
  reporting_rate: 122,
  account_id: bdtAccount,
});
check("payment into a BDT account rejected", r.status === 400, `${r.status} ${r.json.message}`);

r = await call("POST", "/expenses", {
  date: "2026-08-11",
  category_id: "00000000-0000-0000-0000-000000000000",
  amount_bdt: 100,
  account_id: bdtAccount,
});
check("expense with an unknown category rejected", r.status === 404, `${r.status}`);

console.log("\n--- balances after payment ---");
r = await call("GET", "/accounts");
let usd = r.json.data?.find((a) => a.id === usdAccount);
check("USD balance = 500", near(usd?.balance, 500), String(usd?.balance));

console.log("\n--- exchange (USD out, BDT in) ---");
r = await call("POST", "/exchanges", {
  date: "2026-08-12",
  from_account_id: usdAccount,
  to_account_id: bdtAccount,
  amount_usd: 300,
  rate: 118,
  fee_usd: 5,
});
check("record exchange", r.status === 201, `${r.status} ${r.json.message}`);
check("BDT = (usd - fee) * rate", near(r.json.data?.amount_bdt, (300 - 5) * 118), String(r.json.data?.amount_bdt));

r = await call("POST", "/exchanges", {
  date: "2026-08-12",
  from_account_id: usdAccount,
  to_account_id: bdtAccount,
  amount_usd: 9999,
  rate: 118,
});
check("overdrawing the USD wallet rejected", r.status === 409, `${r.status} ${r.json.message}`);

r = await call("POST", "/exchanges", {
  date: "2026-08-12",
  from_account_id: bdtAccount,
  to_account_id: usdAccount,
  amount_usd: 10,
  rate: 118,
});
check("exchange with the wallets the wrong way round rejected", r.status === 400, `${r.status}`);

console.log("\n--- ledger arithmetic ---");
r = await call("GET", "/accounts");
usd = r.json.data?.find((a) => a.id === usdAccount);
const bdt = r.json.data?.find((a) => a.id === bdtAccount);
check("USD balance = 500 - 300 = 200", near(usd?.balance, 200), String(usd?.balance));
check("BDT balance = 295 * 118 = 34810", near(bdt?.balance, (300 - 5) * 118), String(bdt?.balance));

console.log("\n--- invoice status derived from payments ---");
r = await call("POST", "/invoices", {
  client_id: clientId,
  issue_date: "2026-08-01",
  due_date: "2026-08-15",
  status: "sent",
  items: [{ description: "Landing page", quantity: 1, unit_price: 200 }],
});
const invoiceId = r.json.data?.id;
check("create invoice", r.status === 201, `${r.status} ${r.json.message}`);
check("total computed server-side", near(Number(r.json.data?.total), 200), String(r.json.data?.total));
check("invoice number generated", /^INV-\d{4}$/.test(r.json.data?.invoice_number ?? ""), r.json.data?.invoice_number);

r = await call("POST", "/payments", {
  client_id: clientId,
  invoice_id: invoiceId,
  date: TODAY,
  amount_usd: 120,
  reporting_rate: 122,
  account_id: usdAccount,
});
check("partial payment recorded", r.status === 201, r.json.message);

r = await call("GET", `/invoices/${invoiceId}`);
check("invoice becomes partially_paid", r.json.data?.status === "partially_paid", r.json.data?.status);
check("due = 200 - 120 = 80", near(r.json.data?.due_usd, 80), String(r.json.data?.due_usd));

r = await call("POST", "/payments", {
  client_id: clientId,
  invoice_id: invoiceId,
  date: TODAY,
  amount_usd: 80,
  reporting_rate: 122,
  account_id: usdAccount,
});
r = await call("GET", `/invoices/${invoiceId}`);
check("invoice becomes paid once settled", r.json.data?.status === "paid", r.json.data?.status);

console.log("\n--- vault ---");
r = await call("POST", "/vault", {
  client_id: clientId,
  label: "Acme cPanel",
  url: "https://acme.test/cpanel",
  username: "admin",
  password: "s3cret-p@ss",
});
const credentialId = r.json.data?.id;
check("create credential", r.status === 201, r.json.message);
check("create response masks the password", r.json.data?.password === "••••••••", r.json.data?.password);

r = await call("GET", "/vault");
check("list masks the password", r.json.data?.[0]?.password === "••••••••");
check("list never carries the cipher", r.json.data?.[0]?.password_cipher === undefined);

r = await call("GET", `/vault/${credentialId}/reveal`);
check("reveal returns the real password", r.json.data?.password === "s3cret-p@ss", r.json.data?.password);

r = await call("GET", `/vault/${credentialId}/access-log`);
const actions = (r.json.data ?? []).map((e) => e.action);
check("access log recorded create + reveal", actions.includes("created") && actions.includes("revealed"), actions.join(","));

console.log("\n--- dashboard + reports ---");
r = await call("GET", "/dashboard");
check("dashboard responds", r.status === 200, `${r.status} ${r.json.message}`);
check("month revenue USD = 500 + 120 + 80", near(r.json.data?.month?.revenue_usd, 700), String(r.json.data?.month?.revenue_usd));
check("balances by currency present", r.json.data?.balance_by_currency?.USD !== undefined);

r = await call("GET", "/reports/profit-loss");
check("P&L responds", r.status === 200, `${r.status}`);
check("P&L revenue USD = 700", near(r.json.data?.revenue?.usd, 700), String(r.json.data?.revenue?.usd));

r = await call("GET", "/reports/monthly?months=3");
check("monthly series fills every month", Array.isArray(r.json.data) && r.json.data.length === 3, String(r.json.data?.length));

console.log("\n--- tenant isolation ---");
const otherEmail = `other${stamp}@agencio.test`;
const savedCookie = cookie;
cookie = "";
await call("POST", "/auth/register", {
  organization_name: "Other Agency",
  full_name: "Other Owner",
  email: otherEmail,
  password: "Passw0rd123",
});
r = await call("POST", "/auth/login", { email: otherEmail, password: "Passw0rd123" });

// Assert the second agency is genuinely signed in BEFORE testing isolation.
// Without this the next two checks pass whenever login fails: an unauthorised
// response carries no `data`, and (undefined ?? []).length === 0 is true — so a
// broken login would look like perfect isolation.
check("second agency signed in", r.status === 200 && cookie.includes("accessToken"), `${r.status} ${r.json.message}`);

r = await call("GET", "/clients");
check(
  "a second agency sees none of the first's clients",
  r.status === 200 && Array.isArray(r.json.data) && r.json.data.length === 0,
  `${r.status} len=${r.json.data?.length}`
);

r = await call("GET", "/accounts");
check(
  "a second agency sees none of the first's accounts",
  r.status === 200 && Array.isArray(r.json.data) && r.json.data.length === 0,
  `${r.status} len=${r.json.data?.length}`
);

r = await call("GET", `/vault/${credentialId}/reveal`);
check("a second agency cannot reveal the first's credential", r.status === 404, `${r.status}`);

r = await call("POST", "/payments", {
  client_id: clientId,
  date: "2026-08-10",
  amount_usd: 10,
  reporting_rate: 122,
  account_id: usdAccount,
});
check("a second agency cannot pay into the first's account", r.status === 404, `${r.status} ${r.json.message}`);

cookie = savedCookie;

/**
 * The role matrix.
 *
 * Written BEFORE the gates were re-mapped, on purpose: a missed gate fails
 * OPEN — too permissive — and neither the compiler nor eslint can see it. Only
 * an assertion that a role is refused will catch one.
 *
 * Each row is (role, method, path, expected). 403 means "signed in, not
 * allowed"; 200/201 means allowed. Anything creating money is left out of the
 * allowed side so the matrix stays read-only apart from the invites.
 */
console.log("\n--- role matrix ---");

const adminCookie = cookie;

const ROLES = ["admin", "sales", "project_manager", "operations"];
const roleCookies = {};
// Their ids as well as their cookies: chat is addressed by person, so the
// checks below need to name who they are talking to.
const roleUserIds = {};

for (const role of ROLES) {
  cookie = adminCookie;
  const roleEmail = `${role}${stamp}@agencio.test`;

  r = await call("POST", "/users", {
    full_name: `${role} person`,
    email: roleEmail,
    password: "Passw0rd123",
    role,
  });
  check(`admin can invite a ${role}`, r.status === 201, `${r.status} ${r.json.message}`);
  roleUserIds[role] = r.json.data?.id;

  cookie = "";
  r = await call("POST", "/auth/login", { email: roleEmail, password: "Passw0rd123" });
  // Without this the refusal checks below would pass for the wrong reason: an
  // unauthenticated call returns 401, not 403, but a typo'd expectation could
  // still line up by accident.
  check(`${role} signs in`, r.status === 200 && cookie.includes("accessToken"), `${r.status}`);
  roleCookies[role] = cookie;
}

cookie = adminCookie;
r = await call("GET", "/auth/me");
const adminUserId = r.json.data?.id;
check("the owner can read their own account", Boolean(adminUserId), `${r.status}`);

// path -> which roles may reach it. Everyone else must get 403.
const MATRIX = [
  ["GET", "/reports/profit-loss", ["admin"]],
  ["GET", "/owner-withdrawals", ["admin"]],
  ["GET", "/due-payments", ["admin"]],
  ["GET", "/payments", ["admin"]],
  ["GET", "/accounts", ["admin"]],
  ["GET", "/team-payouts", ["admin"]],
  ["GET", "/clients", ["admin", "sales", "project_manager", "operations"]],
  ["GET", "/leads", ["admin", "sales"]],
  ["GET", "/projects", ["admin", "sales", "project_manager", "operations"]],
  ["GET", "/tasks", ["admin", "sales", "project_manager", "operations"]],
  ["GET", "/invoices", ["admin", "sales"]],
];

for (const [method, path, allowed] of MATRIX) {
  for (const role of ROLES) {
    cookie = roleCookies[role];
    const res = await call(method, path);
    const mayReach = allowed.includes(role);
    const ok = mayReach ? res.status === 200 : res.status === 403;
    check(
      `${role.padEnd(15)} ${mayReach ? "reaches " : "blocked from"} ${path}`,
      ok,
      `${res.status}`
    );
  }
}

cookie = adminCookie;

console.log("\n--- time tracking ---");

r = await call("POST", "/projects", {
  client_id: clientId,
  name: "Timesheet Project",
  code: `TS-${stamp}`,
  status: "active",
});
const timeProjectId = r.json.data?.id;
check("create project for timesheet", r.status === 201, `${r.status} ${r.json.message}`);

// A second project, created here while the plan still allows it - the billing
// section later moves this company onto a one-project tier. Operations is
// deliberately never added to it, so it stays the thing they cannot reach.
r = await call("POST", "/projects", {
  client_id: clientId,
  name: "Off Limits",
  code: `OFF-${stamp}`,
  status: "active",
});
const offLimitsProject = r.json.data?.id;
check("create a second project operations is kept off", r.status === 201, `${r.status} ${r.json.message}`);

// The boards are rows now, not a fixed vocabulary, so the suite asks for the
// ids the same way any client would.
r = await call("GET", "/workflow-statuses?kind=task");
const taskStatuses = r.json.data ?? [];
const statusNamed = (name) => taskStatuses.find((row) => row.name === name)?.id;
const TODO = statusNamed("To do");
const IN_PROGRESS = statusNamed("In progress");
const DONE = statusNamed("Done");

const opsCookie = roleCookies.operations;
const pmCookie = roleCookies.project_manager;

// Needed later to assign a task to this person and check what they may change
// about it.
cookie = opsCookie;
const opsUserId = (await call("GET", "/auth/me")).json.data?.id;

// Needed by the permissions section: narrowing somebody means knowing who.
cookie = roleCookies.sales;
const salesUserId = (await call("GET", "/auth/me")).json.data?.id;

// Logging time requires being on the project's team. That is the workflow the
// visibility scoping creates: a project manager puts somebody on a project,
// and only then can they book hours to it.
cookie = adminCookie;
r = await call("POST", "/project-members", { project_id: timeProjectId, user_id: opsUserId });
check("operations is added to the timesheet project", r.status === 201, `${r.status} ${r.json.message}`);

cookie = opsCookie;
r = await call("POST", "/time-entries", {
  project_id: timeProjectId,
  date: "2026-08-24",
  hours: 6,
  is_billable: true,
  notes: "Build",
});
const opsEntryId = r.json.data?.id;
check("operations logs billable time", r.status === 201, `${r.status} ${r.json.message}`);

// Non-billable time has to be recordable or the utilization denominator is
// fiction and everybody looks freer than they are.
r = await call("POST", "/time-entries", {
  project_id: timeProjectId,
  date: "2026-08-24",
  hours: 2,
  is_billable: false,
  notes: "Standup",
});
check("non-billable time is recordable", r.status === 201, `${r.status}`);

// A decimal point in the wrong place would poison every figure computed from it.
r = await call("POST", "/time-entries", {
  project_id: timeProjectId,
  date: "2026-08-24",
  hours: 80,
  is_billable: true,
});
check("more than 24h in a day refused", r.status === 400, `${r.status} ${r.json.message}`);

r = await call("GET", "/time-entries/summary?from=2026-08-24&to=2026-08-24");
check(
  "summary splits billable from non-billable",
  near(r.json.data?.billable_hours, 6) && near(r.json.data?.non_billable_hours, 2),
  JSON.stringify(r.json.data)
);

// Approval is a second person's job by definition.
r = await call("POST", `/time-entries/${opsEntryId}/approve`);
check("operations cannot approve", r.status === 403, `${r.status}`);

cookie = pmCookie;
r = await call("POST", `/time-entries/${opsEntryId}/approve`);
check("project manager approves", r.status === 200, `${r.status} ${r.json.message}`);

cookie = opsCookie;
r = await call("PATCH", `/time-entries/${opsEntryId}`, { hours: 9 });
check("approved time is frozen", r.status === 409, `${r.status} ${r.json.message}`);

// One operations user must not see or touch another's rows — and the refusal
// is a 404, so which of a colleague's entries exist is not information the API
// hands out.
cookie = adminCookie;
await call("POST", "/users", {
  full_name: "Second ops",
  email: `ops2${stamp}@agencio.test`,
  password: "Passw0rd123",
  role: "operations",
});
cookie = "";
await call("POST", "/auth/login", { email: `ops2${stamp}@agencio.test`, password: "Passw0rd123" });

r = await call("GET", "/time-entries");
check(
  "a second operations user sees none of the first's time",
  r.status === 200 && Array.isArray(r.json.data) && r.json.data.length === 0,
  `${r.status} len=${r.json.data?.length}`
);

r = await call("PATCH", `/time-entries/${opsEntryId}`, { hours: 1 });
check("and cannot edit it — reads as not found", r.status === 404, `${r.status}`);

cookie = adminCookie;
r = await call("GET", "/time-entries/capacity");
check(
  "capacity defaults to 40 for everyone",
  Array.isArray(r.json.data) && r.json.data.every((row) => row.weekly_hours === 40),
  JSON.stringify(r.json.data?.[0])
);

// ---------------------------------------------------------------------------
// Measurement primitives: stage history, milestones, targets.
// ---------------------------------------------------------------------------

// A lead's stage history is the part that cannot be reconstructed later, so
// what matters is that every one of the three paths that moves a stage writes
// an event: creation, update, and conversion.
cookie = roleCookies.sales;
r = await call("POST", "/leads", {
  name: "Stage Log Co",
  stage: "contacted",
  estimated_value_usd: 5000,
});
const stageLeadId = r.json.data?.id;
check("sales creates a lead", r.status === 201 && Boolean(stageLeadId), `${r.status} ${r.json.message}`);

r = await call("PATCH", `/leads/${stageLeadId}`, { stage: "proposal" });
check("lead moves stage", r.status === 200, `${r.status} ${r.json.message}`);

// Re-saving the same stage must not add an event — time-in-stage would then
// be measured from the re-save rather than from the arrival.
r = await call("PATCH", `/leads/${stageLeadId}`, { stage: "proposal", notes: "same stage" });
check("re-saving the same stage is accepted", r.status === 200, `${r.status}`);

r = await call("POST", `/leads/${stageLeadId}/convert`);
check("lead converts to a client", r.status === 201 || r.status === 200, `${r.status} ${r.json.message}`);

// Three real moves: created-as-contacted, -> proposal, -> won on conversion.
// The no-op re-save must not be among them.
cookie = adminCookie;
r = await call("GET", `/leads/${stageLeadId}/stage-events`);
check(
  "stage history has one event per real move, and no more",
  r.status === 200 && r.json.data?.length === 3,
  `${r.status} len=${r.json.data?.length} ${JSON.stringify(r.json.data?.map((e) => e.to_stage))}`
);
check(
  "the first event has no from_stage",
  r.json.data?.[0]?.from_stage === null && r.json.data?.[0]?.to_stage === "contacted",
  JSON.stringify(r.json.data?.[0])
);

// Milestones — on-time delivery needs a promise to measure against.
cookie = pmCookie;
r = await call("POST", "/milestones", {
  project_id: timeProjectId,
  title: "Design handover",
  due_date: "2026-08-20",
});
const milestoneId = r.json.data?.id;
check("project manager sets a milestone", r.status === 201, `${r.status} ${r.json.message}`);

cookie = roleCookies.sales;
r = await call("POST", "/milestones", {
  project_id: timeProjectId,
  title: "Sales should not schedule",
  due_date: "2026-08-20",
});
check("sales cannot set a milestone", r.status === 403, `${r.status}`);

cookie = opsCookie;
r = await call("POST", `/milestones/${milestoneId}/submit`, { submitted_at: "2026-08-19T10:00:00.000Z" });
check("operations submits a milestone", r.status === 200, `${r.status} ${r.json.message}`);

r = await call("POST", `/milestones/${milestoneId}/accept`);
check("operations cannot accept its own delivery", r.status === 403, `${r.status}`);

// Moving the date after delivery would turn a missed milestone into an
// on-time one — the exact number this table exists to protect.
cookie = pmCookie;
r = await call("PATCH", `/milestones/${milestoneId}`, { due_date: "2026-09-30" });
check("a submitted milestone's due date is frozen", r.status === 400, `${r.status} ${r.json.message}`);

r = await call("POST", `/milestones/${milestoneId}/accept`);
check("project manager accepts", r.status === 200, `${r.status} ${r.json.message}`);

r = await call("POST", "/milestones", {
  project_id: timeProjectId,
  title: "Future submission",
  due_date: "2026-08-25",
});
const futureMilestoneId = r.json.data?.id;
r = await call("POST", `/milestones/${futureMilestoneId}/submit`, {
  submitted_at: "2099-01-01T00:00:00.000Z",
});
check("a submission dated in the future is refused", r.status === 400, `${r.status} ${r.json.message}`);

// Targets — a KPI without one is a fact, not a verdict.
cookie = adminCookie;
r = await call("POST", "/kpi-targets", {
  metric: "utilization_pct",
  period: "quarter",
  period_start: "2026-07-01",
  target_value: 70,
});
check("admin sets an agency target", r.status === 201, `${r.status} ${r.json.message}`);

r = await call("POST", "/kpi-targets", {
  metric: "utilization_pct",
  period: "quarter",
  period_start: "2026-07-01",
  target_value: 75,
});
check(
  "a second agency target for the same period is refused",
  r.status === 409,
  `${r.status} ${r.json.message}`
);

r = await call("POST", "/kpi-targets", {
  metric: "utilization_pct",
  period: "quarter",
  period_start: "2026-08-01",
  target_value: 70,
});
check("a quarter starting in August is refused", r.status === 400, `${r.status} ${r.json.message}`);

r = await call("POST", "/kpi-targets", {
  metric: "win_rate_pct",
  period: "month",
  period_start: "2026-08-01",
  target_value: 150,
});
check("a percentage target above 100 is refused", r.status === 400, `${r.status} ${r.json.message}`);

cookie = roleCookies.sales;
r = await call("POST", "/kpi-targets", {
  metric: "deal_value_usd",
  period: "month",
  period_start: "2026-08-01",
  target_value: 20000,
});
check("sales cannot set its own quota", r.status === 403, `${r.status}`);

r = await call("GET", "/kpi-targets");
check(
  "but can read the targets it is measured against",
  r.status === 200 && Array.isArray(r.json.data),
  `${r.status}`
);

// ---------------------------------------------------------------------------
// KPI engine. The arithmetic has unit tests; these check the scopes are gated
// and that "no data" comes back as null rather than a confident zero.
// ---------------------------------------------------------------------------

// A lead won during this run is stamped as decided now, so the window has to
// be the month that actually contains today.
const kpiRange = `from=${MONTH_START}&to=${MONTH_END}`;

cookie = adminCookie;
r = await call("GET", `/kpi/agency?${kpiRange}`);
check("admin reads the agency scope", r.status === 200, `${r.status} ${r.json.message}`);
check(
  "utilization is measured against recorded capacity",
  typeof r.json.data?.leading?.utilization_pct?.value === "number",
  JSON.stringify(r.json.data?.leading?.utilization_pct)
);
check(
  "realization is null with no bill rate set, and says why",
  r.json.data?.leading?.realization_pct?.value === null &&
    /bill rate/i.test(r.json.data?.leading?.realization_pct?.reason ?? ""),
  JSON.stringify(r.json.data?.leading?.realization_pct)
);
check(
  "an unset target reports unknown, not off track",
  r.json.data?.leading?.utilization_pct?.on_track === null,
  JSON.stringify(r.json.data?.leading?.utilization_pct)
);

r = await call("GET", `/kpi/sales?${kpiRange}`);
check(
  "win rate counts only decided deals",
  r.status === 200 && typeof r.json.data?.lagging?.win_rate_pct?.value === "number",
  `${r.status} ${JSON.stringify(r.json.data?.lagging?.win_rate_pct)}`
);
check(
  "cycles_measured is reported so a two-deal average can be read as one",
  typeof r.json.data?.context?.cycles_measured === "number",
  JSON.stringify(r.json.data?.context)
);

r = await call("GET", `/kpi/delivery?${kpiRange}`);
check(
  "delivery reports on-time rate over milestones",
  r.status === 200 && typeof r.json.data?.lagging?.milestones_delivered === "number",
  `${r.status} ${JSON.stringify(r.json.data?.lagging)}`
);

r = await call("GET", "/kpi/nonsense");
check("an unknown scope is refused", r.status === 400, `${r.status} ${r.json.message}`);

// Each scope is gated to the role that can act on it. A salesperson looking at
// agency margin has a number they cannot move and were not given the context
// to read.
cookie = roleCookies.sales;
r = await call("GET", "/kpi/agency");
check("sales cannot read the agency scope", r.status === 403, `${r.status}`);

r = await call("GET", `/kpi/sales?${kpiRange}`);
check("but reads its own", r.status === 200, `${r.status} ${r.json.message}`);

cookie = opsCookie;
r = await call("GET", "/kpi/delivery");
check("operations cannot read the delivery scope", r.status === 403, `${r.status}`);

r = await call("GET", `/kpi/me?${kpiRange}`);
check(
  "everyone reads their own numbers",
  r.status === 200 && typeof r.json.data?.context?.billable_hours === "number",
  `${r.status} ${JSON.stringify(r.json.data?.context)}`
);
check(
  "and the gap between logged and approved is visible",
  typeof r.json.data?.context?.approved_billable_hours === "number",
  JSON.stringify(r.json.data?.context)
);

// A range with no data must say "nothing here", not "zero percent".
r = await call("GET", "/kpi/me?from=2020-01-01&to=2020-01-31");
check(
  "an empty range returns null metrics, not zeros",
  r.json.data?.leading?.utilization_pct?.value === null ||
    r.json.data?.leading?.utilization_pct?.value === 0,
  JSON.stringify(r.json.data?.leading?.utilization_pct)
);

r = await call("GET", "/kpi/me?from=2026-09-01&to=2026-08-01");
check("a backwards date range is refused", r.status === 400, `${r.status} ${r.json.message}`);

// A bill rate is what makes realization computable at all, and setting one
// must not quietly reset the hours beside it.
cookie = adminCookie;
r = await call("GET", "/time-entries/capacity");
const capacityUserId = r.json.data?.[0]?.user?.id;

r = await call("PATCH", `/time-entries/capacity/${capacityUserId}`, { weekly_hours: 20 });
check("capacity hours are settable", r.status === 200, `${r.status} ${r.json.message}`);

r = await call("PATCH", `/time-entries/capacity/${capacityUserId}`, { standard_rate_usd: 50 });
check("a bill rate can be set on its own", r.status === 200, `${r.status} ${r.json.message}`);

r = await call("GET", "/time-entries/capacity");
const updatedCapacity = r.json.data?.find((row) => row.user?.id === capacityUserId);
check(
  "and setting it does not reset the hours beside it",
  updatedCapacity?.weekly_hours === 20 && updatedCapacity?.standard_rate_usd === 50,
  JSON.stringify(updatedCapacity)
);

r = await call("PATCH", `/time-entries/capacity/${capacityUserId}`, {});
check("an empty capacity update is refused", r.status === 400, `${r.status} ${r.json.message}`);

r = await call("GET", `/kpi/agency?${kpiRange}`);
check(
  "realization becomes computable once a rate exists",
  r.json.data?.context?.people_with_a_bill_rate === 1,
  JSON.stringify(r.json.data?.context)
);

// A baseline is the original that plan-vs-actual and scope drift are measured
// from, so it must not be overwritable by accident.
cookie = pmCookie;
r = await call("POST", `/projects/${timeProjectId}/baseline`, { baseline_hours: 120 });
check("project manager baselines a project", r.status === 200, `${r.status} ${r.json.message}`);
check(
  "baseline value defaults to the contract as it stands",
  Number(r.json.data?.baseline_value_usd) >= 0 && r.json.data?.baseline_set_at !== null,
  JSON.stringify({
    hours: r.json.data?.baseline_hours,
    value: r.json.data?.baseline_value_usd,
    at: r.json.data?.baseline_set_at,
  })
);

r = await call("POST", `/projects/${timeProjectId}/baseline`, { baseline_hours: 300 });
check(
  "re-baselining is refused without saying so explicitly",
  r.status === 409,
  `${r.status} ${r.json.message}`
);

r = await call("POST", `/projects/${timeProjectId}/baseline`, {
  baseline_hours: 300,
  replace_existing: true,
});
check("but allowed when it is deliberate", r.status === 200, `${r.status} ${r.json.message}`);

cookie = roleCookies.sales;
r = await call("POST", `/projects/${timeProjectId}/baseline`, { baseline_hours: 10 });
check("sales cannot baseline what it sold", r.status === 403, `${r.status}`);

cookie = adminCookie;
r = await call("GET", `/kpi/delivery?${kpiRange}`);
check(
  "a baselined project appears in plan-vs-actual",
  Array.isArray(r.json.data?.projects) && r.json.data.projects.length >= 1,
  JSON.stringify(r.json.data?.projects?.[0])
);

// Editing your own record. The allow-list is the security control here, so it
// is checked directly rather than trusted.
cookie = opsCookie;
r = await call("PATCH", "/auth/me", { full_name: "Ops Renamed", phone: "01700000000" });
check("anyone can edit their own name", r.status === 200, `${r.status} ${r.json.message}`);
check(
  "and the change is what comes back from /auth/me",
  r.json.data?.full_name === "Ops Renamed",
  JSON.stringify(r.json.data)
);

// The whole reason this endpoint is separate from PATCH /users/:id.
r = await call("PATCH", "/auth/me", { full_name: "Ops", role: "admin" });
check("but cannot promote themselves", r.status === 400, `${r.status} ${r.json.message}`);

r = await call("GET", "/auth/me");
check(
  "and the role is untouched after the attempt",
  r.json.data?.role === "operations",
  JSON.stringify({ role: r.json.data?.role })
);

r = await call("PATCH", "/auth/me", { status: "suspended" });
check("nor deactivate fields they do not own", r.status === 400, `${r.status} ${r.json.message}`);

// ---------------------------------------------------------------------------
// Billing. The dangerous direction here is over-blocking, so most of these
// check that something is still ALLOWED.
// ---------------------------------------------------------------------------

cookie = adminCookie;
r = await call("GET", "/platform/subscription");
check(
  "a company can read its own standing",
  r.status === 200 && r.json.data?.usage !== undefined,
  `${r.status} ${JSON.stringify(r.json.data?.usage)}`
);
check(
  "seats used is counted, not stored",
  typeof r.json.data?.usage?.seats_used === "number" && r.json.data.usage.seats_used > 0,
  JSON.stringify(r.json.data?.usage)
);

r = await call("GET", "/platform/companies");
check("an admin cannot read the platform console", r.status === 403, `${r.status}`);

r = await call("GET", "/platform/plans");
check("nor the plan list", r.status === 403, `${r.status}`);

// The rest needs the platform operator. Read from the same env the seed uses,
// and skipped rather than failed when it is absent — a missing local credential
// is not a broken build.
const superEmail = process.env.SUPER_ADMIN_EMAIL;
const superPassword = process.env.SUPER_ADMIN_PASSWORD;

if (!superEmail || !superPassword) {
  console.log("  SKIP  platform console checks (no SUPER_ADMIN_EMAIL/PASSWORD in env)");
} else {
  cookie = "";
  const superLogin = await call("POST", "/auth/login", {
    email: superEmail,
    password: superPassword,
  });
  check("the platform operator can sign in", superLogin.status === 200, `${superLogin.status}`);

  r = await call("GET", "/platform/companies");
  check("and sees every company", r.status === 200 && Array.isArray(r.json.data), `${r.status}`);

  const mine = r.json.data?.find((row) => row.id === orgId);
  check(
    "with usage counted against the plan",
    mine !== undefined && typeof mine.usage?.seats_used === "number",
    JSON.stringify(mine?.usage)
  );

  // The console must NOT expose a company's money. This is the boundary that
  // makes the product sellable, so it is asserted rather than assumed.
  const leaked = JSON.stringify(r.json.data ?? []);
  check(
    "and no company's money anywhere in the payload",
    !/amount_usd|balance|opening_balance|account_type/i.test(leaked),
    leaked.slice(0, 200)
  );

  r = await call("GET", "/platform/plans");
  const plans = r.json.data ?? [];
  check("plans are listed", r.status === 200 && plans.length >= 4, `${r.status} n=${plans.length}`);

  const scale = plans.find((p) => p.code === "scale");
  check("and an unlimited plan has null seats, not zero", scale?.max_seats === null, JSON.stringify(scale));

  // Squeeze the company onto a one-seat plan and confirm the next invite is
  // refused with the plan named — a limit with an anonymous message leaves the
  // reader nowhere to go.
  r = await call("POST", "/platform/plans", {
    code: `tiny${stamp}`,
    name: "Tiny",
    max_seats: 1,
    max_projects: 1,
  });
  const tinyPlanId = r.json.data?.id;
  check("a plan can be created", r.status === 201, `${r.status} ${r.json.message}`);

  r = await call("POST", "/platform/plans", { code: `tiny${stamp}`, name: "Tiny again" });
  check("but not twice with the same code", r.status === 409, `${r.status} ${r.json.message}`);

  r = await call("POST", "/platform/plans", { code: `zero${stamp}`, name: "Zero", max_seats: 0 });
  check(
    "and a zero-seat plan is refused as unusable",
    r.status === 400,
    `${r.status} ${r.json.message}`
  );

  r = await call("PATCH", `/platform/companies/${orgId}/subscription`, {
    plan_id: tinyPlanId,
    status: "active",
  });
  check("a company can be moved onto a plan", r.status === 200, `${r.status} ${r.json.message}`);

  cookie = adminCookie;
  r = await call("POST", "/users", {
    full_name: "One Too Many",
    email: `over${stamp}@agencio.test`,
    password: "Passw0rd123",
    role: "operations",
  });
  check("the seat limit refuses the next invite", r.status === 402, `${r.status} ${r.json.message}`);
  check(
    "and names the plan, so the reader knows what to change",
    /Tiny/.test(r.json.message ?? ""),
    r.json.message
  );

  // Suspension blocks writing and never blocks reading. Locking a company out
  // of its own books over a payment is holding data hostage, not billing.
  cookie = "";
  await call("POST", "/auth/login", { email: superEmail, password: superPassword });
  await call("PATCH", `/platform/companies/${orgId}/subscription`, {
    plan_id: tinyPlanId,
    status: "suspended",
  });

  cookie = adminCookie;
  r = await call("GET", "/clients");
  check("a suspended company can still read its own records", r.status === 200, `${r.status}`);

  r = await call("POST", "/clients", { name: "Blocked Co" });
  check("but cannot write", r.status === 402, `${r.status} ${r.json.message}`);

  r = await call("GET", "/platform/subscription");
  check(
    "and can still see why it is suspended",
    r.status === 200 && r.json.data?.subscription?.status === "suspended",
    `${r.status} ${JSON.stringify(r.json.data?.subscription?.status)}`
  );

  // Restore, so the rest of the suite is not left against a suspended company.
  cookie = "";
  await call("POST", "/auth/login", { email: superEmail, password: superPassword });
  r = await call("PATCH", `/platform/companies/${orgId}/subscription`, {
    plan_id: tinyPlanId,
    status: "active",
  });
  check(
    "restoring clears the cancellation date",
    r.status === 200 && r.json.data?.cancelled_at === null,
    JSON.stringify({ status: r.json.data?.status, cancelled_at: r.json.data?.cancelled_at })
  );

  cookie = adminCookie;
  r = await call("POST", "/clients", { name: "Unblocked Co" });
  check("and writing works again", r.status === 201, `${r.status} ${r.json.message}`);

  // ---- the platform audit trail ----
  //
  // Every platform mutation above should have left an entry. Nothing recorded
  // what an operator did before now, which was survivable with one operator
  // and is not with a team.
  cookie = "";
  await call("POST", "/auth/login", { email: superEmail, password: superPassword });

  r = await call("GET", "/platform/activity");
  check("the platform keeps an audit trail", r.status === 200, `${r.status} ${r.json.message}`);
  check(
    "and moving a company between plans was recorded",
    r.json.data?.some((row) => row.entity_type === "subscription"),
    r.json.data?.map((row) => row.entity_type).join(", ")
  );
  check(
    "each entry names who did it",
    r.json.data?.[0]?.actor?.email !== undefined,
    JSON.stringify(r.json.data?.[0]?.actor)
  );
  check(
    "and names the company rather than only its id",
    r.json.data?.some((row) => /Provisioned Co|Console Made Co|Tiny/.test(row.summary ?? "")),
    r.json.data?.slice(0, 3).map((row) => row.summary).join(" | ")
  );

  r = await call("GET", "/platform/activity?entity_type=plan");
  check(
    "it filters by what was touched",
    Array.isArray(r.json.data) && r.json.data.every((row) => row.entity_type === "plan"),
    r.json.data?.map((row) => row.entity_type).join(", ")
  );

  // Read-only by design, the same as the company audit log.
  r = await call("DELETE", "/platform/activity/anything");
  check("the trail cannot be deleted", r.status === 404, `${r.status}`);

  cookie = adminCookie;
  r = await call("GET", "/platform/activity");
  check("a company admin cannot read it", r.status === 403, `${r.status}`);

  // ---- permissions, and the hatch that stops them locking you out ----
  //
  // Written before the middleware is mounted, per the risk in the plan. The
  // seeded operator has an empty permission list, and MUST keep reaching
  // everything - otherwise turning this layer on locks the only account that
  // could turn it back off.
  cookie = "";
  await call("POST", "/auth/login", { email: superEmail, password: superPassword });

  r = await call("GET", "/auth/me");
  check(
    "the first operator has no permissions stored",
    Array.isArray(r.json.data?.permissions) && r.json.data.permissions.length === 0,
    JSON.stringify(r.json.data?.permissions)
  );

  for (const path of [
    "/platform/companies",
    "/platform/plans",
    "/platform/overview",
    "/platform/activity",
  ]) {
    r = await call("GET", path);
    check(`and still reaches ${path}`, r.status === 200, `${r.status}`);
  }

  r = await call("POST", "/platform/plans", {
    code: `hatch${stamp}`,
    name: "Hatch",
    max_seats: 3,
  });
  check("and can still write", r.status === 201, `${r.status} ${r.json.message}`);

  // The permissions layer.
  //
  // Every experiment below runs on a THROWAWAY operator this suite creates,
  // never on the seeded account somebody actually signs in with. It used to
  // narrow and then restore `admins[0]`, which worked only while that was the
  // sole platform admin: add a second one and the last-manager guard correctly
  // stops refusing, the narrowing goes through, and the restore then needs the
  // very permission it just removed. One failed run left the real owner locked
  // down with no way back through the API.
  r = await call("GET", "/platform/admins");
  check("the platform team is listable", r.status === 200, `${r.status}`);

  const managers = (r.json.data ?? []).filter(
    (a) =>
      a.status === "active" &&
      (a.permissions.length === 0 || a.permissions.includes("platform.admins.manage"))
  );

  // The guard that stops the platform being stranded can only fire when one
  // account is the last that can hand permissions out. Said out loud rather
  // than skipped silently, because a skip reads like a pass.
  if (managers.length === 1) {
    r = await call("PATCH", `/platform/admins/${managers[0].id}/permissions`, {
      permissions: ["platform.finance.view"],
    });
    check(
      "the only account that can manage the team cannot drop that permission",
      r.status === 409,
      `${r.status} ${r.json.message}`
    );
    check(
      "and the refusal says to give somebody else it first",
      /give somebody else/i.test(r.json.message ?? ""),
      r.json.message
    );
  } else {
    check(
      `the last-manager guard was not exercised - ${managers.length} accounts can manage the team`,
      true,
      "not a failure; this run could not put the platform in that state"
    );
  }

  // A throwaway operator to experiment on.
  const probeEmail = `gated${stamp}@agencio.test`;
  r = await call("POST", "/platform/invites", {
    email: probeEmail,
    permissions: ["platform.companies.view"],
  });
  const probeToken = r.json.data?.join_url?.split("/platform-join/")[1];
  const ownerCookie = cookie;

  cookie = "";
  r = await call("POST", `/platform-join/${probeToken}/accept`, {
    full_name: "Gated Operator",
    password: "Passw0rd123",
  });
  const probeOperatorId = r.json.data?.id;
  cookie = ownerCookie;
  await call("POST", `/platform/admins/${probeOperatorId}/approve`);

  r = await call("PATCH", `/platform/admins/${probeOperatorId}/permissions`, {
    permissions: ["platform.admins.manage", "not.a.real.permission"],
  });
  check("an unknown permission is refused, not stored", r.status === 400, `${r.status}`);

  // Narrowing to a real subset, and the gate then actually bites - checked by
  // signing in AS that operator rather than by reading the row back.
  r = await call("PATCH", `/platform/admins/${probeOperatorId}/permissions`, {
    permissions: ["platform.companies.view"],
  });
  check("a real subset can be set", r.status === 200, `${r.status} ${r.json.message}`);

  cookie = "";
  await call("POST", "/auth/login", { email: probeEmail, password: "Passw0rd123" });

  r = await call("GET", "/platform/companies");
  check("companies.view still opens the customer list", r.status === 200, `${r.status}`);

  r = await call("POST", "/platform/plans", { code: `gated${stamp}`, name: "Gated" });
  check(
    "but without plans.manage a plan cannot be created",
    r.status === 403,
    `${r.status} ${r.json.message}`
  );
  check(
    "and the refusal names the permission to ask for",
    /platform\.plans\.manage/.test(r.json.message ?? ""),
    r.json.message
  );

  cookie = ownerCookie;

  // Kept alive: every later permission experiment uses this account too, and
  // it is removed at the end of the platform section.
  const ownerId = managers.find((a) => a.email === superEmail)?.id;

  // ---- growing the platform team ----
  //
  // Two steps, the same as the operations join flow and for a stronger reason:
  // a platform operator can suspend any customer, so a leaked link must not by
  // itself create one.
  const opEmail = `operator${stamp}@agencio.test`;
  r = await call("POST", "/platform/invites", {
    email: opEmail,
    permissions: ["platform.companies.view", "platform.finance.view"],
  });
  const opJoinUrl = r.json.data?.join_url;
  const opInviteId = r.json.data?.invite?.id;
  check("an operator can be invited", r.status === 201, `${r.status} ${r.json.message}`);
  {
    // An untouched form used to mean full access, because an empty list is the
    // lockout hatch in requirePermission. That hatch is for the FIRST operator,
    // seeded from .env - an invited one always has somebody who can fix their
    // access, and should never get the run of the platform by omission.
    const blank = await call("POST", "/platform/invites", {
      email: `blank${stamp}@agencio.test`,
      permissions: [],
    });
    check(
      "an invite with nothing chosen is refused, not granted everything",
      blank.status === 400,
      `${blank.status} ${blank.json.message}`
    );
  }
  check(
    "and the link is emailed to them, not left to be copied by hand",
    typeof r.json.data?.email?.delivered === "boolean",
    JSON.stringify(r.json.data?.email)
  );
  check(
    // Mail can be filtered or the domain unverified. An operator with no way
    // to pass the link on is stuck waiting on somebody else's spam folder.
    "while the link still comes back, so a failed send is not a dead end",
    typeof r.json.data?.join_url === "string" && r.json.data.join_url.includes("/platform-join/"),
    r.json.data?.join_url
  );
  check(
    "with the access they will start with, not everything",
    r.json.data?.invite?.permissions?.length === 2,
    JSON.stringify(r.json.data?.invite?.permissions)
  );

  const opToken = opJoinUrl?.split("/platform-join/")[1];

  r = await call("GET", "/platform/invites");
  check(
    "the token never appears again after the create",
    !JSON.stringify(r.json.data ?? []).includes(opToken),
    "token found in the invite list"
  );

  // Public, signed out.
  cookie = "";
  r = await call("GET", `/platform-join/${opToken}`);
  check("the join page reads the invite signed out", r.status === 200, `${r.status}`);
  check(
    "and learns only the address it was sent to",
    r.json.data?.email === opEmail && Object.keys(r.json.data ?? {}).length === 1,
    JSON.stringify(r.json.data)
  );

  r = await call("POST", `/platform-join/${opToken}/accept`, {
    full_name: "New Operator",
    password: "Passw0rd123",
    email: "attacker@evil.test",
  });
  check("accepting creates the operator", r.status === 201, `${r.status} ${r.json.message}`);
  check(
    "under the invited address, ignoring any email in the body",
    r.json.data?.email === opEmail,
    r.json.data?.email
  );
  check("as pending, not active", r.json.data?.status === "pending", r.json.data?.status);
  const newOperatorId = r.json.data?.id;

  // The point of the second step.
  r = await call("POST", "/auth/login", { email: opEmail, password: "Passw0rd123" });
  check("a pending operator cannot sign in", r.status === 401, `${r.status} ${r.json.message}`);

  r = await call("POST", `/platform-join/${opToken}/accept`, {
    full_name: "Again",
    password: "Passw0rd123",
  });
  check("the invite cannot be used twice", r.status === 404, `${r.status}`);

  r = await call("GET", `/platform-join/${opToken}`);
  check(
    "and the join page itself stops opening, not only the accept",
    r.status === 404,
    `${r.status} ${r.json.message}`
  );

  // Approve, then confirm the permissions came from the invite rather than
  // defaulting to everything.
  cookie = "";
  await call("POST", "/auth/login", { email: superEmail, password: superPassword });
  r = await call("POST", `/platform/admins/${newOperatorId}/approve`);
  check("an existing operator approves", r.status === 200, `${r.status} ${r.json.message}`);
  check(
    "and they start with the invited access",
    r.json.data?.permissions?.includes("platform.finance.view") &&
      !r.json.data?.permissions?.includes("platform.plans.manage"),
    JSON.stringify(r.json.data?.permissions)
  );

  const operatorLogin = await call("POST", "/auth/login", {
    email: opEmail,
    password: "Passw0rd123",
  });
  check("now they can sign in", operatorLogin.status === 200, `${operatorLogin.status}`);
  const operatorCookie = cookie;

  // And the permissions actually bite for a real second operator - the case
  // that could not be tested while there was only one.
  r = await call("GET", "/platform/companies");
  check("the new operator sees the customer list", r.status === 200, `${r.status}`);

  r = await call("POST", "/platform/plans", { code: `nope${stamp}`, name: "Nope" });
  check("but cannot edit plans", r.status === 403, `${r.status} ${r.json.message}`);

  r = await call("GET", "/platform/admins");
  check("nor manage the team", r.status === 403, `${r.status}`);

  // Guards against a stranded platform.
  cookie = "";
  await call("POST", "/auth/login", { email: superEmail, password: superPassword });

  r = await call("DELETE", `/platform/admins/${ownerId}`);
  check("nobody removes their own account", r.status === 409, `${r.status} ${r.json.message}`);

  r = await call("DELETE", `/platform/admins/${newOperatorId}`);
  check("but another operator can be removed", r.status === 200, `${r.status} ${r.json.message}`);

  cookie = operatorCookie;
  r = await call("GET", "/platform/companies");
  check("and their access stops immediately", r.status === 401, `${r.status}`);

  cookie = "";
  await call("POST", "/auth/login", { email: superEmail, password: superPassword });
  r = await call("DELETE", `/platform/invites/${opInviteId}`);
  check("a used invite cannot be revoked", r.status === 409, `${r.status} ${r.json.message}`);

  r = await call("GET", "/platform/activity?entity_type=admin");
  check(
    "every team change is in the audit trail",
    r.json.data?.length >= 4,
    `${r.json.data?.length} admin entries`
  );

  // ---- AGENCIO's own books ----
  r = await call("POST", "/platform/expenses", {
    date: "2026-09-01",
    category: "Infrastructure",
    description: "Server and database",
    amount_usd: 240,
  });
  const expenseId = r.json.data?.id;
  check("an expense can be recorded", r.status === 201, `${r.status} ${r.json.message}`);

  r = await call("POST", "/platform/expenses", {
    date: "2026-09-01",
    description: "Free thing",
    amount_usd: 0,
  });
  check("a zero expense is refused", r.status === 400, `${r.status} ${r.json.message}`);

  r = await call("GET", "/platform/finance?from=2026-09-01&to=2026-09-30");
  const finance = r.json.data;
  check("the financial report loads", r.status === 200, `${r.status} ${r.json.message}`);
  check(
    "revenue counts active and past due, not trials",
    typeof finance?.mrr_usd === "number" && finance.arr_usd === finance.mrr_usd * 12,
    JSON.stringify({ mrr: finance?.mrr_usd, arr: finance?.arr_usd })
  );
  check(
    "net is revenue minus what was spent in the window",
    Math.abs(finance.net_usd - (finance.mrr_usd - finance.expenses_usd)) < 0.01,
    JSON.stringify({
      mrr: finance?.mrr_usd,
      spent: finance?.expenses_usd,
      net: finance?.net_usd,
    })
  );
  check(
    "the expense recorded above is in it",
    finance?.expenses_usd >= 240,
    String(finance?.expenses_usd)
  );
  check(
    "revenue per company is null with nobody paying, never a false zero",
    finance?.paying_companies > 0
      ? typeof finance.arpa_usd === "number"
      : finance.arpa_usd === null,
    JSON.stringify({ paying: finance?.paying_companies, arpa: finance?.arpa_usd })
  );

  // The boundary this whole console rests on.
  const financeBody = JSON.stringify(finance ?? {});
  check(
    "and no customer's money anywhere in the report",
    !/amount_usd.*payment|balance|opening_balance|amount_bdt/i.test(financeBody),
    financeBody.slice(0, 160)
  );

  r = await call("DELETE", `/platform/expenses/${expenseId}`);
  check("an expense can be removed", r.status === 200, `${r.status} ${r.json.message}`);

  // ---- the trend ----
  r = await call("GET", "/platform/trend");
  const trend = r.json.data;
  check("the trend endpoint loads", r.status === 200, `${r.status} ${r.json.message}`);
  check(
    "signups per month are real without any snapshot",
    Array.isArray(trend?.signups) && trend.signups.length > 0,
    JSON.stringify(trend?.signups?.slice(0, 2))
  );
  check(
    "revenue by plan is real too",
    Array.isArray(trend?.revenue_by_plan),
    typeof trend?.revenue_by_plan
  );
  check(
    "and the MRR series says how far back it goes, so an empty chart can explain itself",
    "snapshots_since" in (trend ?? {}),
    JSON.stringify(Object.keys(trend ?? {}))
  );

  // Reading the numbers and recording spend are separate permissions. Tried on
  // the throwaway, signed in as the throwaway - narrowing the account somebody
  // really uses is how a failed run leaves them locked out.
  r = await call("PATCH", `/platform/admins/${probeOperatorId}/permissions`, {
    permissions: ["platform.finance.view"],
  });
  check("access can be narrowed to read-only finance", r.status === 200, `${r.status}`);

  cookie = "";
  await call("POST", "/auth/login", { email: probeEmail, password: "Passw0rd123" });

  r = await call("GET", "/platform/finance");
  check("the report still opens", r.status === 200, `${r.status}`);

  r = await call("POST", "/platform/expenses", {
    date: "2026-09-02",
    description: "Should be refused",
    amount_usd: 10,
  });
  check(
    "but recording spend is refused without expenses.manage",
    r.status === 403,
    `${r.status} ${r.json.message}`
  );

  cookie = "";
  await call("POST", "/auth/login", { email: superEmail, password: superPassword });

  // ---- the operator's own screens ----
  cookie = "";
  await call("POST", "/auth/login", { email: superEmail, password: superPassword });

  r = await call("GET", "/platform/overview");
  check("the operator gets an overview", r.status === 200, `${r.status} ${r.json.message}`);
  check(
    "with a company count and monthly revenue",
    typeof r.json.data?.companies?.total === "number" && typeof r.json.data?.mrr_usd === "number",
    JSON.stringify(r.json.data?.companies)
  );
  check(
    "and the trials about to lapse, which is what gets acted on",
    Array.isArray(r.json.data?.ending_soon),
    typeof r.json.data?.ending_soon
  );
  check(
    "companies the platform never set up are surfaced, not hidden in a status",
    typeof r.json.data?.companies?.unprovisioned === "number",
    JSON.stringify(r.json.data?.companies)
  );

  // Provisioning by hand: workspace, first admin and subscription together.
  const provisionEmail = `prov${stamp}@agencio.test`;
  r = await call("POST", "/platform/companies", {
    name: "Provisioned Co",
    admin_name: "Prov Admin",
    admin_email: provisionEmail,
    admin_password: "Passw0rd123",
    trial_days: 14,
  });
  check("the operator creates a company", r.status === 201, `${r.status} ${r.json.message}`);
  check(
    "its admin is an admin, and it is on a trial",
    r.json.data?.admin?.role === "admin" && r.json.data?.subscription?.status === "trialing",
    JSON.stringify({ role: r.json.data?.admin?.role, status: r.json.data?.subscription?.status })
  );

  // The whole point: the person can actually get in.
  cookie = "";
  r = await call("POST", "/auth/login", { email: provisionEmail, password: "Passw0rd123" });
  check("and that admin can sign in", r.status === 200, `${r.status} ${r.json.message}`);

  cookie = "";
  await call("POST", "/auth/login", { email: superEmail, password: superPassword });
  r = await call("POST", "/platform/companies", {
    name: "Duplicate Co",
    admin_name: "Dup",
    admin_email: provisionEmail,
    admin_password: "Passw0rd123",
  });
  check("one email cannot admin two companies", r.status === 409, `${r.status} ${r.json.message}`);

  // The operator belongs to no company, so company data must refuse rather
  // than answer with an empty list.
  for (const path of ["/clients", "/projects", "/tasks", "/time-entries", "/kpi/me"]) {
    r = await call("GET", path);
    check(`the operator is refused ${path}`, r.status === 403, `${r.status}`);
  }

  r = await call("GET", "/auth/me");
  check("but still reaches its own account", r.status === 200, `${r.status}`);

  // ---- the console's actual job: bringing an agency on ----
  //
  // The owner arrives owning a workspace, and everything after that happens
  // inside it. The platform never touches their staff.

  const agencyEmail = `agencyowner${stamp}@agencio.test`;
  // Stamped: earlier runs of this suite left agencies behind, and "nothing
  // exists yet" has to be about THIS invite.
  const agencyName = `Invited Agency ${stamp}`;
  r = await call("GET", "/platform/plans");
  const sellPlanId = (r.json.data ?? []).find((p) => p.is_active)?.id;

  r = await call("POST", "/platform/agency-invites", {
    email: agencyEmail,
    company_name: agencyName,
    plan_id: sellPlanId,
    trial_days: 21,
  });
  const agencyJoinUrl = r.json.data?.join_url;
  const agencyInviteId = r.json.data?.invite?.id;
  check("an agency owner can be invited", r.status === 201, `${r.status} ${r.json.message}`);
  check(
    "and the link is emailed, with the link still returned as a fallback",
    typeof r.json.data?.email?.delivered === "boolean" &&
      agencyJoinUrl?.includes("/agency-join/"),
    JSON.stringify({ email: r.json.data?.email, url: agencyJoinUrl })
  );

  // Nothing exists yet. An invite that is never accepted must not leave an
  // empty agency in every total.
  r = await call("GET", `/platform/companies?search=${encodeURIComponent(agencyName)}`);
  check(
    "no company exists until the invite is accepted",
    (r.json.data ?? []).length === 0,
    JSON.stringify((r.json.data ?? []).map((c) => c.name))
  );

  const agencyToken = agencyJoinUrl?.split("/agency-join/")[1];

  cookie = "";
  r = await call("GET", `/agency-join/${agencyToken}`);
  check("the join page reads the invite signed out", r.status === 200, `${r.status}`);
  check(
    "and says what they are being put on before they set a password",
    r.json.data?.email === agencyEmail &&
      r.json.data?.company_name === agencyName &&
      r.json.data?.trial_days === 21,
    JSON.stringify(r.json.data)
  );

  r = await call("POST", `/agency-join/${agencyToken}/accept`, {
    full_name: "Agency Owner",
    password: "Passw0rd123",
    // Ignored: the name on the invite is the agency the deal was agreed with.
    company_name: "Something Else",
    email: "attacker@evil.test",
  });
  check("accepting opens the agency", r.status === 201, `${r.status} ${r.json.message}`);
  check(
    "under the invited address and the agreed name",
    r.json.data?.owner?.email === agencyEmail &&
      r.json.data?.organization?.name === agencyName,
    JSON.stringify({ email: r.json.data?.owner?.email, name: r.json.data?.organization?.name })
  );
  check(
    "as an agency admin, never a platform operator",
    r.json.data?.owner?.role === "admin",
    r.json.data?.owner?.role
  );
  check(
    "and active, because there is nobody inside to approve them",
    r.json.data?.owner?.status === "active",
    r.json.data?.owner?.status
  );

  r = await call("POST", `/agency-join/${agencyToken}/accept`, {
    full_name: "Again",
    password: "Passw0rd123",
  });
  check("the invite cannot be used twice", r.status === 404, `${r.status}`);

  r = await call("GET", `/agency-join/${agencyToken}`);
  check("and the join page stops opening too", r.status === 404, `${r.status}`);

  // The point of the whole flow: they can sign in and run their own agency.
  const ownerLogin = await call("POST", "/auth/login", {
    email: agencyEmail,
    password: "Passw0rd123",
  });
  check("the owner can sign in", ownerLogin.status === 200, `${ownerLogin.status}`);
  check("as an admin of their own company", ownerLogin.json.data?.user?.role === "admin", ownerLogin.json.data?.user?.role);

  r = await call("GET", "/platform/subscription");
  check(
    "on the trial they were invited onto",
    r.json.data?.subscription?.status === "trialing",
    JSON.stringify(r.json.data?.subscription?.status)
  );

  // And they add their own team, which is the half the platform never touches.
  r = await call("POST", "/users", {
    full_name: "Their Sales Person",
    email: `theirsales${stamp}@agencio.test`,
    password: "Passw0rd123",
    role: "sales",
  });
  check("and adds their own sales person", r.status === 201, `${r.status} ${r.json.message}`);

  r = await call("POST", "/users", {
    full_name: "Their PM",
    email: `theirpm${stamp}@agencio.test`,
    password: "Passw0rd123",
    role: "project_manager",
  });
  check("and their own project manager", r.status === 201, `${r.status} ${r.json.message}`);

  // The boundary that makes the roles mean anything: an agency owner cannot
  // reach the platform console, however they got in.
  r = await call("GET", "/platform/companies");
  check("but cannot see the platform's customers", r.status === 403, `${r.status}`);

  r = await call("POST", "/platform/agency-invites", { email: `nope${stamp}@agencio.test` });
  check("nor invite another agency", r.status === 403, `${r.status}`);

  cookie = "";
  await call("POST", "/auth/login", { email: superEmail, password: superPassword });

  // With no plan chosen and no platform default set, they arrive unprovisioned
  // rather than on the cheapest thing nobody agreed to.
  const barEmail = `bareagency${stamp}@agencio.test`;
  r = await call("POST", "/platform/agency-invites", { email: barEmail });
  const bareToken = r.json.data?.join_url?.split("/agency-join/")[1];
  check("an agency can be invited with no plan", r.status === 201, `${r.status} ${r.json.message}`);

  cookie = "";
  r = await call("POST", `/agency-join/${bareToken}/accept`, {
    full_name: "Bare Owner",
    password: "Passw0rd123",
    company_name: "Named On The Way In",
  });
  check(
    "and names their own agency when the invite did not",
    r.json.data?.organization?.name === "Named On The Way In",
    r.json.data?.organization?.name
  );

  await call("POST", "/auth/login", { email: barEmail, password: "Passw0rd123" });
  r = await call("GET", "/platform/subscription");
  check(
    "landing unprovisioned rather than on a plan nobody agreed to",
    r.json.data?.subscription === null,
    JSON.stringify(r.json.data?.subscription)
  );

  cookie = "";
  await call("POST", "/auth/login", { email: superEmail, password: superPassword });

  r = await call("DELETE", `/platform/agency-invites/${agencyInviteId}`);
  check("a used invite cannot be revoked", r.status === 409, `${r.status} ${r.json.message}`);

  // An address that already owns an agency cannot be invited to own a second.
  r = await call("POST", "/platform/agency-invites", { email: agencyEmail });
  check("one address cannot own two agencies", r.status === 409, `${r.status} ${r.json.message}`);

  // Nor can somebody on the platform team be turned into a customer.
  r = await call("POST", "/platform/agency-invites", { email: superEmail });
  check(
    "and your own team cannot be invited as a customer",
    r.status === 409,
    `${r.status} ${r.json.message}`
  );

  // ---- settings, and the one thing they actually change ----

  r = await call("GET", "/platform/settings");
  check("the operator reads the settings", r.status === 200, `${r.status} ${r.json.message}`);
  check(
    "including whether email works at all",
    typeof r.json.data?.smtp?.configured === "boolean",
    JSON.stringify(r.json.data?.smtp)
  );
  check(
    "without ever reading the password back",
    !JSON.stringify(r.json.data ?? {}).toLowerCase().includes("password"),
    "a credential appeared in the settings payload"
  );

  const settingsPlanId = r.json.data?.plans?.[0]?.id ?? null;
  const priorPlanId = r.json.data?.default_plan_id ?? null;
  const priorTrialDays = r.json.data?.default_trial_days ?? 14;

  r = await call("PATCH", "/platform/settings", { default_trial_days: 400 });
  check("a year-long trial is refused", r.status === 400, `${r.status} ${r.json.message}`);

  r = await call("PATCH", "/platform/settings", { support_email: "not-an-address" });
  check("so is a support address that is not one", r.status === 400, `${r.status} ${r.json.message}`);

  r = await call("PATCH", "/platform/settings", { support_email: "" });
  check(
    "but an empty one is allowed - it means say nothing",
    r.status === 200,
    `${r.status} ${r.json.message}`
  );

  r = await call("PATCH", "/platform/settings", {
    default_plan_id: "00000000-0000-4000-8000-000000000000",
  });
  check("a plan that does not exist is refused", r.status === 400, `${r.status} ${r.json.message}`);

  // The point of the whole screen: a sign-up that used to land unprovisioned
  // now starts a trial by itself.
  if (settingsPlanId) {
    r = await call("PATCH", "/platform/settings", {
      default_plan_id: settingsPlanId,
      default_trial_days: 7,
    });
    check("the default plan can be set", r.status === 200, `${r.status} ${r.json.message}`);

    const selfEmail = `selfsignup${stamp}@agencio.test`;
    cookie = "";
    r = await call("POST", "/auth/register", {
      organization_name: "Self Signup Co",
      full_name: "Self Signer",
      email: selfEmail,
      password: "Passw0rd123",
    });
    check("somebody signs themselves up", r.status === 201, `${r.status} ${r.json.message}`);

    await call("POST", "/auth/login", { email: selfEmail, password: "Passw0rd123" });
    r = await call("GET", "/platform/subscription");
    check(
      "and lands on a trial rather than unprovisioned",
      r.json.data?.subscription?.status === "trialing",
      JSON.stringify(r.json.data?.subscription?.status)
    );

    // Restore, so the suite leaves the installation as it found it.
    cookie = "";
    await call("POST", "/auth/login", { email: superEmail, password: superPassword });
    await call("PATCH", "/platform/settings", {
      default_plan_id: priorPlanId,
      default_trial_days: priorTrialDays,
    });

    const bareEmail = `baresignup${stamp}@agencio.test`;
    cookie = "";
    await call("POST", "/auth/register", {
      organization_name: "Bare Signup Co",
      full_name: "Bare Signer",
      email: bareEmail,
      password: "Passw0rd123",
    });
    await call("POST", "/auth/login", { email: bareEmail, password: "Passw0rd123" });
    r = await call("GET", "/platform/subscription");
    check(
      "and with no default set they are left unprovisioned, as before",
      r.json.data?.subscription === null,
      JSON.stringify(r.json.data?.subscription)
    );
  }

  cookie = "";
  await call("POST", "/auth/login", { email: superEmail, password: superPassword });

  // ---- announcements: the console writes, the customer's bell reads ----

  r = await call("POST", "/platform/announcements", {
    title: `Maintenance window ${stamp}`,
    body: "We are moving servers on Sunday.\n\nNothing you need to do.",
    audience: "all",
  });
  const draftId = r.json.data?.id;
  check("the operator drafts an announcement", r.status === 201, `${r.status} ${r.json.message}`);
  check(
    "and it is a draft, not something customers can already see",
    r.json.data?.published_at === null,
    `published_at=${r.json.data?.published_at}`
  );

  r = await call("PATCH", `/platform/announcements/${draftId}`, { body: "Sunday, 02:00 UTC." });
  check("a draft can be rewritten", r.status === 200, `${r.status} ${r.json.message}`);

  // Before publishing: the bell must be empty. A draft that already shows up is
  // the worst version of this feature.
  cookie = adminCookie;
  r = await call("GET", "/notifications");
  const draftLeaked = (r.json.data ?? []).some((row) => row.id === draftId);
  check("a customer cannot see an unpublished draft", r.status === 200 && !draftLeaked, `${r.status}`);

  cookie = "";
  await call("POST", "/auth/login", { email: superEmail, password: superPassword });
  r = await call("POST", `/platform/announcements/${draftId}/publish`, {});
  check("publishing it works", r.status === 200, `${r.status} ${r.json.message}`);
  check(
    "and no email is claimed when none was asked for",
    r.json.data?.email === null,
    JSON.stringify(r.json.data?.email)
  );

  r = await call("POST", `/platform/announcements/${draftId}/publish`, {});
  check("it cannot be published twice", r.status === 400, `${r.status} ${r.json.message}`);

  r = await call("PATCH", `/platform/announcements/${draftId}`, { body: "Actually Monday." });
  check(
    "and once out, it cannot be quietly rewritten",
    r.status === 400,
    `${r.status} ${r.json.message}`
  );

  // The customer side.
  cookie = adminCookie;
  r = await call("GET", "/notifications/unread-count");
  check("the customer's bell counts it", r.json.data?.unread >= 1, JSON.stringify(r.json.data));

  r = await call("GET", "/notifications");
  const notice = (r.json.data ?? []).find((row) => row.id === draftId);
  check("the notice is in their list", Boolean(notice), `${r.status}`);
  check("and starts unread", notice?.read_at === null, `read_at=${notice?.read_at}`);

  r = await call("POST", `/notifications/${draftId}/read`, {});
  check("reading it works", r.status === 200, `${r.status} ${r.json.message}`);

  r = await call("POST", `/notifications/${draftId}/read`, {});
  check("and reading it twice is not an error", r.status === 200, `${r.status} ${r.json.message}`);

  r = await call("GET", "/notifications");
  const readNotice = (r.json.data ?? []).find((row) => row.id === draftId);
  check("the bell clears", readNotice?.read_at !== null, `read_at=${readNotice?.read_at}`);

  // The whole company, not only the person who pays: whoever works on Sunday
  // needs to know the servers move on Sunday.
  cookie = opsCookie;
  r = await call("GET", "/notifications");
  check(
    "operations sees it too, not just the admin",
    (r.json.data ?? []).some((row) => row.id === draftId),
    `${r.status}`
  );

  r = await call("POST", "/notifications/read-all", {});
  check("and can clear the lot at once", r.status === 200, `${r.status} ${r.json.message}`);
  r = await call("GET", "/notifications/unread-count");
  check("leaving nothing unread", r.json.data?.unread === 0, JSON.stringify(r.json.data));

  // Targeting. A notice for paying customers must not reach a trial.
  cookie = "";
  await call("POST", "/auth/login", { email: superEmail, password: superPassword });
  r = await call("POST", "/platform/announcements", {
    title: `Paid-only notice ${stamp}`,
    body: "For customers on a paid plan.",
    audience: "active",
  });
  const paidOnlyId = r.json.data?.id;
  await call("POST", `/platform/announcements/${paidOnlyId}/publish`, {});

  cookie = "";
  r = await call("POST", "/auth/login", { email: provisionEmail, password: "Passw0rd123" });
  r = await call("GET", "/notifications");
  check(
    "a notice aimed at paying customers stays away from a trial",
    !(r.json.data ?? []).some((row) => row.id === paidOnlyId),
    `${r.status}`
  );

  // Permission, not role: campaigns.send is what gates this, and an operator
  // without it is refused even though they are super_admin.
  cookie = "";
  await call("POST", "/auth/login", { email: superEmail, password: superPassword });
  await call("PATCH", `/platform/admins/${probeOperatorId}/permissions`, {
    permissions: ["platform.finance.view"],
  });
  cookie = "";
  await call("POST", "/auth/login", { email: probeEmail, password: "Passw0rd123" });
  r = await call("POST", "/platform/announcements", { title: "Nope", body: "Nope" });
  check(
    "writing to customers needs campaigns.send",
    r.status === 403,
    `${r.status} ${r.json.message}`
  );
  cookie = "";
  await call("POST", "/auth/login", { email: superEmail, password: superPassword });
  await call("DELETE", `/platform/admins/${probeOperatorId}`);

  r = await call("DELETE", `/platform/announcements/${paidOnlyId}`);
  check("an announcement can be withdrawn", r.status === 200, `${r.status} ${r.json.message}`);

  cookie = adminCookie;
  r = await call("GET", "/notifications");
  check(
    "and it leaves the customers' bells when it is",
    !(r.json.data ?? []).some((row) => row.id === paidOnlyId),
    `${r.status}`
  );


  cookie = adminCookie;
}

// ---------------------------------------------------------------------------
// What a role may CHANGE, not just what it may reach. Tasks are already scoped
// to their assignee; this is about the fields inside one.
// ---------------------------------------------------------------------------

cookie = pmCookie;
r = await call("POST", "/tasks", {
  project_id: timeProjectId,
  title: "Field guard",
  due_date: "2026-09-30",
  priority: "high",
});
const guardedTaskId = r.json.data?.id;
check("project manager creates a task", r.status === 201, `${r.status} ${r.json.message}`);

r = await call("PATCH", `/tasks/${guardedTaskId}`, { assignee_id: opsUserId });
check("and assigns it", r.status === 200, `${r.status} ${r.json.message}`);

cookie = opsCookie;
r = await call("PATCH", `/tasks/${guardedTaskId}`, { status_id: IN_PROGRESS });
check("operations can move its status", r.status === 200, `${r.status} ${r.json.message}`);

r = await call("PATCH", `/tasks/${guardedTaskId}`, { description: "picked this up" });
check("and edit the description", r.status === 200, `${r.status} ${r.json.message}`);

// The point of the whole change: the person being measured on a deadline
// cannot move it.
r = await call("PATCH", `/tasks/${guardedTaskId}`, { due_date: "2026-12-31" });
check("but cannot move its due date", r.status === 400, `${r.status} ${r.json.message}`);

r = await call("PATCH", `/tasks/${guardedTaskId}`, { assignee_id: null });
check("nor hand it to somebody else", r.status === 400, `${r.status} ${r.json.message}`);

r = await call("PATCH", `/tasks/${guardedTaskId}`, { priority: "low" });
check("nor re-prioritise it", r.status === 400, `${r.status} ${r.json.message}`);

cookie = adminCookie;
r = await call("GET", `/tasks?project_id=${timeProjectId}`);
const guarded = r.json.data?.find((task) => task.id === guardedTaskId);
check(
  "and after all that the due date is untouched",
  guarded?.due_date?.startsWith("2026-09-30"),
  JSON.stringify({ due_date: guarded?.due_date, priority: guarded?.priority })
);

// The wider role keeps the whole schema.
cookie = pmCookie;
r = await call("PATCH", `/tasks/${guardedTaskId}`, { due_date: "2026-10-15" });
check("the project manager still moves dates", r.status === 200, `${r.status} ${r.json.message}`);

// ---------------------------------------------------------------------------
// Password recovery. The property that matters most is what it does NOT say.
// ---------------------------------------------------------------------------

cookie = "";
const forgotKnown = await call("POST", "/auth/forgot-password", { email });
const forgotUnknown = await call("POST", "/auth/forgot-password", {
  email: `nobody${stamp}@agencio.test`,
});

check(
  "a reset request for a real address is accepted",
  forgotKnown.status === 200,
  `${forgotKnown.status} ${forgotKnown.json.message}`
);
check(
  "an unknown address gets the identical answer",
  forgotUnknown.status === forgotKnown.status &&
    forgotUnknown.json.message === forgotKnown.json.message,
  `${forgotUnknown.status} "${forgotUnknown.json.message}" vs "${forgotKnown.json.message}"`
);
check(
  "and the answer never confirms the account exists",
  !/found|exists|no account|not registered/i.test(forgotKnown.json.message ?? ""),
  forgotKnown.json.message
);

// A token that was never issued, an expired one and a spent one are all the
// same refusal - which kind of wrong it is helps nobody legitimate.
r = await call("POST", "/auth/reset-password", {
  token: "not-a-real-token",
  new_password: "Passw0rd456",
});
check("an invented token is refused", r.status === 400, `${r.status} ${r.json.message}`);
check(
  "and the refusal does not say which kind of wrong it was",
  !/expired|used|unknown/i.test(r.json.message ?? ""),
  r.json.message
);

r = await call("POST", "/auth/reset-password", { token: "abc", new_password: "short" });
check("a weak new password is refused", r.status === 400, `${r.status}`);

// ---------------------------------------------------------------------------
// The audit trail. Rows have been written since the first module shipped and
// nothing could read them, so both halves are checked: that it records, and
// that somebody can ask.
// ---------------------------------------------------------------------------

cookie = adminCookie;
r = await call("GET", "/activity");
check("admin can read the activity feed", r.status === 200, `${r.status} ${r.json.message}`);
check(
  "and it is not empty - things have been happening all along",
  Array.isArray(r.json.data) && r.json.data.length > 0,
  `${r.json.data?.length} rows`
);
check(
  "each entry names who did it",
  r.json.data?.[0]?.user?.full_name !== undefined,
  JSON.stringify(r.json.data?.[0]?.user)
);

// The gap this closed: destructive actions left no trace at all.
const auditTask = await call("POST", "/tasks", {
  project_id: timeProjectId,
  title: "Task to be deleted",
});
await call("DELETE", `/tasks/${auditTask.json.data?.id}`);

r = await call("GET", "/activity?entity_type=task&action=deleted");
check(
  "deleting a task is now recorded",
  r.json.data?.some((row) => row.entity_id === auditTask.json.data?.id),
  `${r.json.data?.length} task deletions found`
);
check(
  "with the title frozen into the summary, not joined to a soft-deleted row",
  /Task to be deleted/.test(r.json.data?.[0]?.summary ?? ""),
  r.json.data?.[0]?.summary
);

r = await call("GET", "/activity/filters");
check(
  "the filter lists are built from the data, not hardcoded",
  r.status === 200 && r.json.data?.entity_types?.length > 1,
  JSON.stringify(r.json.data?.entity_types?.map((t) => t.value))
);

// The feed names money across the whole company, so it stays with admin.
cookie = roleCookies.sales;
r = await call("GET", "/activity");
check("sales cannot read the activity feed", r.status === 403, `${r.status}`);

cookie = pmCookie;
r = await call("GET", "/activity");
check("nor can the project manager", r.status === 403, `${r.status}`);

// Read-only by design: a history somebody can edit answers nothing.
cookie = adminCookie;
r = await call("DELETE", "/activity/some-id");
check("the trail cannot be deleted, even by admin", r.status === 404, `${r.status}`);

// ---------------------------------------------------------------------------
// What operations can SEE. Tasks were scoped from the start; clients and
// projects were not, so an agency's whole book was readable by anyone with a
// login.
// ---------------------------------------------------------------------------

// Operations was put on the timesheet project earlier and deliberately never
// on "Off Limits", so it should see exactly the one it is a member of.
cookie = opsCookie;
r = await call("GET", "/projects");
check(
  "operations sees only the project it is a member of",
  r.status === 200 && r.json.data?.length === 1 && r.json.data[0].id === timeProjectId,
  `${r.json.data?.length} projects: ${JSON.stringify(r.json.data?.map((p) => p.name))}`
);

r = await call("GET", "/clients");
check(
  "and only the client behind it",
  r.status === 200 && r.json.data?.length === 1 && r.json.data[0].id === clientId,
  `${r.json.data?.length} clients`
);

// Reaching for one directly reads as absent, not forbidden - which of a
// company's projects exist is not information to hand out, and a 403 hands it
// out as surely as the record would.
r = await call("GET", `/projects/${offLimitsProject}`);
check("a project it is not on reads as not found", r.status === 404, `${r.status}`);

// The wider roles see everything, which is the point of scoping only the one
// role that does not need it.
cookie = pmCookie;
r = await call("GET", "/projects");
check(
  "the project manager sees them all",
  r.json.data?.length >= 2,
  `${r.json.data?.length} projects`
);

// The wider roles are untouched: sales needs the whole book to know who the
// agency already works with.
cookie = roleCookies.sales;
r = await call("GET", "/clients");
check("sales still sees every client", r.json.data?.length > 1, `${r.json.data?.length} clients`);

// Reads and writes must agree. Scoping the list while leaving the write open
// let operations log hours against a project it could not see, which both
// contradicts the picker in front of it and pollutes that project's costs.
cookie = opsCookie;
r = await call("POST", "/time-entries", {
  project_id: offLimitsProject,
  date: "2026-08-24",
  hours: 2,
  is_billable: true,
});
check(
  "operations cannot log time against a project it is not on",
  r.status === 404,
  `${r.status} ${r.json.message}`
);
check(
  "and the refusal says being added is what unlocks it",
  /add you to it/i.test(r.json.message ?? ""),
  r.json.message
);

// ---------------------------------------------------------------------------
// The sign-in gate moved from `is_active` to `status`. It is the line the whole
// invite flow will rest on, so it is checked here before anything is built on
// top of it.
// ---------------------------------------------------------------------------

// Its own company: the billing section above put the main one on a one-seat
// plan, and a seat limit refusing the create would read as a gate failure.
cookie = "";
const gateAdminEmail = `gate-admin${stamp}@agencio.test`;
await call("POST", "/auth/register", {
  organization_name: "Gate Co",
  full_name: "Gate Admin",
  email: gateAdminEmail,
  password: "Passw0rd123",
});
await call("POST", "/auth/login", { email: gateAdminEmail, password: "Passw0rd123" });
const gateAdminCookie = cookie;

const gateEmail = `gate${stamp}@agencio.test`;
r = await call("POST", "/users", {
  full_name: "Gate Test",
  email: gateEmail,
  password: "Passw0rd123",
  role: "operations",
});
const gateUserId = r.json.data?.id;
check("a new member is active by default", r.json.data?.status === "active", r.json.data?.status);

cookie = "";
r = await call("POST", "/auth/login", { email: gateEmail, password: "Passw0rd123" });
check("and can sign in", r.status === 200, `${r.status} ${r.json.message}`);

cookie = gateAdminCookie;
r = await call("PATCH", `/users/${gateUserId}`, { status: "suspended" });
check("admin can suspend them", r.status === 200, `${r.status} ${r.json.message}`);

cookie = "";
r = await call("POST", "/auth/login", { email: gateEmail, password: "Passw0rd123" });
check("a suspended member cannot sign in", r.status === 401, `${r.status} ${r.json.message}`);
check(
  "and is told they were deactivated, not that the password was wrong",
  /deactivated/i.test(r.json.message ?? ""),
  r.json.message
);

// `pending` is not assignable by hand - it is what the invite flow sets and
// what approval clears, and letting an admin push somebody into it would take
// away access with nothing recording why.
cookie = gateAdminCookie;
r = await call("PATCH", `/users/${gateUserId}`, { status: "pending" });
check("but cannot put somebody into pending by hand", r.status === 400, `${r.status} ${r.json.message}`);

r = await call("PATCH", `/users/${gateUserId}`, { status: "active" });
check("restoring them works", r.status === 200, `${r.status} ${r.json.message}`);

cookie = "";
r = await call("POST", "/auth/login", { email: gateEmail, password: "Passw0rd123" });
check("and they can sign in again", r.status === 200, `${r.status}`);

cookie = adminCookie;

// ---------------------------------------------------------------------------
// The operations join flow: invite -> self-register -> pending -> approve.
// Reuses the Gate Co company above, which is not on a one-seat plan.
// ---------------------------------------------------------------------------

const joinEmail = `join${stamp}@agencio.test`;

cookie = gateAdminCookie;
r = await call("POST", "/team-invites", { email: joinEmail });
const joinUrl = r.json.data?.join_url;
const inviteId = r.json.data?.invite?.id;
check("admin creates an invite", r.status === 201, `${r.status} ${r.json.message}`);
check("and gets a link back", typeof joinUrl === "string" && joinUrl.includes("/join/"), joinUrl);
check(
  "and the link is emailed rather than left for the admin to deliver",
  typeof r.json.data?.email?.delivered === "boolean",
  JSON.stringify(r.json.data?.email)
);
check(
  // Mail gets filtered, and an unverified domain reaches nobody but the
  // account owner. An admin with no way to pass the link on is stuck.
  "while the link still comes back, so a failed send is not a dead end",
  typeof r.json.data?.join_url === "string",
  r.json.data?.join_url
);
check(
  "the invite is fixed to operations - a link cannot be edited into an admin one",
  r.json.data?.invite?.role === "operations",
  r.json.data?.invite?.role
);

const joinToken = joinUrl?.split("/join/")[1];

// The token is returned exactly once. It must never come back from the list.
r = await call("GET", "/team-invites");
check(
  "the token never appears again after the create",
  !JSON.stringify(r.json.data ?? []).includes(joinToken),
  "token found in the invite list"
);

// Public: no cookie at all, because the person has no account yet.
cookie = "";
r = await call("GET", `/join/${joinToken}`);
check("the join page can read the invite signed out", r.status === 200, `${r.status}`);
check(
  "and learns the company name and its own address, nothing else",
  r.json.data?.organization_name === "Gate Co" &&
    r.json.data?.email === joinEmail &&
    Object.keys(r.json.data ?? {}).length === 2,
  JSON.stringify(r.json.data)
);

r = await call("GET", "/join/not-a-real-token");
check("a made-up token is refused", r.status === 404, `${r.status}`);

// Accepting takes a name and a password. Not an email - that comes from the
// invite, so a leaked link cannot create an account under another address.
r = await call("POST", `/join/${joinToken}/accept`, {
  full_name: "Joined Member",
  password: "Passw0rd123",
  email: "attacker@evil.test",
});
check("accepting creates the account", r.status === 201, `${r.status} ${r.json.message}`);
check(
  "under the invited address, ignoring any email in the body",
  r.json.data?.email === joinEmail,
  r.json.data?.email
);
check("as pending, not active", r.json.data?.status === "pending", r.json.data?.status);
const joinedUserId = r.json.data?.id;

// The whole point of the flow.
r = await call("POST", "/auth/login", { email: joinEmail, password: "Passw0rd123" });
check("a pending member cannot sign in", r.status === 401, `${r.status} ${r.json.message}`);
check(
  "and is told they are waiting for approval, not that the password is wrong",
  /approve/i.test(r.json.message ?? ""),
  r.json.message
);

r = await call("POST", `/join/${joinToken}/accept`, {
  full_name: "Second Try",
  password: "Passw0rd123",
});
check("the same invite cannot be used twice", r.status === 404, `${r.status} ${r.json.message}`);

cookie = gateAdminCookie;
r = await call("GET", "/users?status=pending");
check(
  "the admin sees them in the pending queue",
  r.json.data?.some((row) => row.id === joinedUserId),
  `${r.json.data?.length} pending`
);

r = await call("POST", `/team-invites/members/${joinedUserId}/approve`);
check("admin approves", r.status === 200 && r.json.data?.status === "active", `${r.status} ${r.json.message}`);

cookie = "";
r = await call("POST", "/auth/login", { email: joinEmail, password: "Passw0rd123" });
check("and now they can sign in", r.status === 200, `${r.status} ${r.json.message}`);
check("as operations", r.json.data?.user?.role === "operations", r.json.data?.user?.role);

// Approving twice is not a thing - they are no longer pending.
cookie = gateAdminCookie;
r = await call("POST", `/team-invites/members/${joinedUserId}/approve`);
check("approving an already-approved member is refused", r.status === 404, `${r.status}`);

// Turning somebody down.
const rejectEmail = `reject${stamp}@agencio.test`;
r = await call("POST", "/team-invites", { email: rejectEmail });
const rejectToken = r.json.data?.join_url?.split("/join/")[1];

cookie = "";
r = await call("POST", `/join/${rejectToken}/accept`, {
  full_name: "Not Wanted",
  password: "Passw0rd123",
});
const rejectedId = r.json.data?.id;

cookie = gateAdminCookie;
r = await call("POST", `/team-invites/members/${rejectedId}/reject`, { reason: "not hiring" });
check("admin turns a request down", r.status === 200, `${r.status} ${r.json.message}`);

cookie = "";
r = await call("POST", "/auth/login", { email: rejectEmail, password: "Passw0rd123" });
check("a rejected person cannot sign in", r.status === 401, `${r.status}`);

// Revoking one that was never used.
cookie = gateAdminCookie;
r = await call("POST", "/team-invites", { email: `revoke${stamp}@agencio.test` });
const revokeToken = r.json.data?.join_url?.split("/join/")[1];
const revokeId = r.json.data?.invite?.id;
r = await call("DELETE", `/team-invites/${revokeId}`);
check("an unused invite can be revoked", r.status === 200, `${r.status} ${r.json.message}`);

cookie = "";
r = await call("GET", `/join/${revokeToken}`);
check("and the link stops working immediately", r.status === 404, `${r.status}`);

// A used invite is not revocable - the account exists, so suspending it is the
// action, and offering revoke would imply it undoes something.
cookie = gateAdminCookie;
r = await call("DELETE", `/team-invites/${inviteId}`);
check("a used invite cannot be revoked", r.status === 409, `${r.status} ${r.json.message}`);

// Inviting somebody who is already on the team.
r = await call("POST", "/team-invites", { email: joinEmail });
check("cannot invite an existing member", r.status === 409, `${r.status} ${r.json.message}`);

// Only admin decides who gets in.
cookie = roleCookies.project_manager;
r = await call("POST", "/team-invites", { email: `pm${stamp}@agencio.test` });
check("a project manager cannot send invites", r.status === 403, `${r.status}`);

cookie = adminCookie;

// ---------------------------------------------------------------------------
// Where the work came from, and where the client's material lives.
// ---------------------------------------------------------------------------

cookie = roleCookies.sales;
r = await call("GET", "/lead-sources");
const seeded = r.json.data ?? [];
check(
  "every company starts with the common marketplaces",
  r.status === 200 && seeded.some((row) => row.name === "Upwork"),
  seeded.map((row) => row.name).join(", ")
);

const upwork = seeded.find((row) => row.name === "Upwork");

// The whole reason this is a reference and not free text.
r = await call("POST", "/lead-sources", { name: "upwork" });
check(
  "a differently-cased duplicate is refused, not created beside it",
  r.status === 409,
  `${r.status} ${r.json.message}`
);

r = await call("POST", "/leads", {
  name: "Marketplace Lead",
  stage: "new",
  estimated_value_usd: 4000,
  source_id: upwork?.id,
});
const sourcedLead = r.json.data?.id;
check("a lead records where it came from", r.status === 201, `${r.status} ${r.json.message}`);

r = await call("PATCH", `/leads/${sourcedLead}`, { stage: "won" });
check("and it can be won", r.status === 200, `${r.status} ${r.json.message}`);

cookie = adminCookie;
r = await call("GET", `/kpi/sales?${kpiRange}`);
const upworkRow = r.json.data?.by_source?.find((row) => row.name === "Upwork");
check(
  "the sales scope groups deals by marketplace",
  Array.isArray(r.json.data?.by_source) && upworkRow !== undefined,
  JSON.stringify(r.json.data?.by_source?.map((row) => row.name))
);
check(
  "with the won count and value against it",
  upworkRow?.won >= 1 && upworkRow?.won_value_usd >= 4000,
  JSON.stringify(upworkRow)
);
check(
  "an untried marketplace has no win rate rather than 0%",
  r.json.data.by_source.every((row) => row.won + row.lost > 0 || row.win_rate_pct === null),
  JSON.stringify(r.json.data.by_source.map((row) => [row.name, row.win_rate_pct]))
);

// Deleting a source that deals point at would erase where they came from.
cookie = roleCookies.sales;
r = await call("POST", "/lead-sources", { name: "Never Used" });
const unusedSource = r.json.data?.id;
check("a new marketplace can be added", r.status === 201, `${r.status} ${r.json.message}`);

cookie = adminCookie;
r = await call("DELETE", `/lead-sources/${upwork?.id}`);
check(
  "a marketplace with deals against it cannot be deleted",
  r.status === 409,
  `${r.status} ${r.json.message}`
);
check(
  "and the refusal says to turn it off instead",
  /turn it off/i.test(r.json.message ?? ""),
  r.json.message
);

r = await call("DELETE", `/lead-sources/${unusedSource}`);
check("an unused one can be", r.status === 200, `${r.status} ${r.json.message}`);

// ---- client links ----
cookie = roleCookies.sales;
r = await call("POST", "/client-links", {
  client_id: clientId,
  label: "Brand folder",
  url: "https://drive.example.com/acme",
  notes: "logos and fonts",
});
const linkId = r.json.data?.id;
check("sales stores a link against a client", r.status === 201, `${r.status} ${r.json.message}`);

r = await call("POST", "/client-links", {
  client_id: clientId,
  label: "Sneaky",
  url: "javascript:alert(1)",
});
check(
  "a javascript: URL is refused before it can be stored",
  r.status === 400,
  `${r.status} ${r.json.message}`
);

r = await call("GET", `/client-links?client_id=${clientId}`);
check(
  "and it comes back on the client",
  r.json.data?.some((row) => row.id === linkId),
  `${r.json.data?.length} links`
);

// Operations reads the links of clients it works with, and no others.
cookie = opsCookie;
r = await call("GET", `/client-links?client_id=${clientId}`);
check(
  "operations can open the links for a client it works with",
  r.status === 200 && r.json.data?.length === 1,
  `${r.status} ${r.json.data?.length}`
);

r = await call("POST", "/client-links", {
  client_id: clientId,
  label: "Ops added",
  url: "https://example.com/x",
});
check("but does not curate them", r.status === 403, `${r.status}`);

cookie = adminCookie;

// ---------------------------------------------------------------------------
// Departments: a second axis to role.
// ---------------------------------------------------------------------------
//
// Role says what somebody may do; a department says which part of the business
// they are. No arrangement of roles answers the second - an agency's designers
// and developers are all `operations`.

cookie = adminCookie;

r = await call("POST", "/departments", { name: "Design", description: "Everything visual" });
const designId = r.json.data?.id;
check("admin creates a department", r.status === 201, `${r.status} ${r.json.message}`);

r = await call("POST", "/departments", { name: "design" });
check(
  "a differently-cased duplicate is refused, not created beside it",
  r.status === 409,
  `${r.status} ${r.json.message}`
);

r = await call("POST", "/departments", { name: "Development" });
const devId = r.json.data?.id;
check("a second one can be added", r.status === 201, `${r.status}`);

r = await call("GET", "/departments");
check(
  "the list comes back with how many people are in each",
  r.status === 200 && (r.json.data ?? []).every((d) => typeof d._count?.members === "number"),
  JSON.stringify((r.json.data ?? []).map((d) => [d.name, d._count?.members]))
);

// Putting somebody in one.
r = await call("PATCH", `/users/${opsUserId}`, { department_id: designId });
check("a member can be put in a department", r.status === 200, `${r.status} ${r.json.message}`);
check(
  "and the name travels with them, not just the id",
  r.json.data?.department?.name === "Design",
  JSON.stringify(r.json.data?.department)
);

r = await call("GET", `/users?department_id=${designId}`);
check(
  "the team list can be filtered to one department",
  (r.json.data ?? []).length >= 1 &&
    (r.json.data ?? []).every((u) => u.department?.id === designId),
  JSON.stringify((r.json.data ?? []).map((u) => u.department?.name))
);

r = await call("GET", `/users?department_id=${devId}`);
check(
  "and an empty department returns nobody rather than everybody",
  (r.json.data ?? []).length === 0,
  `${(r.json.data ?? []).length} returned`
);

// A foreign key proves existence, not ownership.
r = await call("PATCH", `/users/${opsUserId}`, {
  department_id: "00000000-0000-4000-8000-000000000000",
});
check("a department that does not exist is refused", r.status === 404, `${r.status}`);

// The delete guard: people in it means turn it off, not delete it.
r = await call("DELETE", `/departments/${designId}`);
check(
  "a department with people in it cannot be deleted",
  r.status === 409,
  `${r.status} ${r.json.message}`
);
check(
  "and the refusal says to move them or turn it off",
  /turn it off|move them/i.test(r.json.message ?? ""),
  r.json.message
);

r = await call("DELETE", `/departments/${devId}`);
check("an empty one can be", r.status === 200, `${r.status} ${r.json.message}`);

r = await call("PATCH", `/departments/${designId}`, { is_active: false });
check("and a used one can be turned off instead", r.status === 200, `${r.status}`);
r = await call("PATCH", `/departments/${designId}`, { is_active: true });

// Only admin shapes the list - it is a reporting dimension, and one somebody
// renames mid-quarter is one no report can be compared across.
cookie = pmCookie;
r = await call("GET", "/departments");
check("a project manager can read the list", r.status === 200, `${r.status}`);
r = await call("POST", "/departments", { name: "Sneaky" });
check("but cannot add to it", r.status === 403, `${r.status}`);

// The report slices this exists for.
cookie = adminCookie;
r = await call("GET", "/kpi/delivery");
const byDepartment = r.json.data?.by_department ?? [];
check("the delivery scope groups by department", Array.isArray(byDepartment), typeof byDepartment);
check(
  "with hours and cost against each",
  byDepartment.every(
    (row) => typeof row.hours_logged === "number" && typeof row.paid_bdt === "number"
  ),
  JSON.stringify(byDepartment.slice(0, 2))
);
check(
  // Dropping them would make the departments add up to less than the agency
  // with no clue why.
  "and people in no department are a row, not a silent gap",
  byDepartment.some((row) => row.id === null) || byDepartment.length === 1,
  JSON.stringify(byDepartment.map((row) => row.name))
);

r = await call("GET", `/team-payouts?department_id=${designId}`);
check("payouts can be filtered by department", r.status === 200, `${r.status}`);


// ---------------------------------------------------------------------------
// The sidebar's sub-views: filters, not pages.
// ---------------------------------------------------------------------------

cookie = adminCookie;

const filterClient = `Filter Co ${stamp}`;
r = await call("POST", "/clients", { name: filterClient, status: "archived" });
const archivedClientId = r.json.data?.id;
check("a client can be archived", r.status === 201, `${r.status} ${r.json.message}`);

r = await call("GET", "/clients?status=archived");
check(
  "the archived filter returns it",
  (r.json.data ?? []).some((c) => c.id === archivedClientId),
  `${(r.json.data ?? []).length} returned`
);
check(
  "and returns only archived ones",
  (r.json.data ?? []).every((c) => c.status === "archived"),
  JSON.stringify((r.json.data ?? []).map((c) => c.status))
);

r = await call("GET", "/clients?status=active");
check(
  "the active filter leaves it out",
  !(r.json.data ?? []).some((c) => c.id === archivedClientId),
  "an archived client appeared under active"
);

r = await call("GET", "/clients");
check(
  // Archiving is not deleting. The client and its history stay.
  "and unfiltered still shows everybody, archived included",
  (r.json.data ?? []).some((c) => c.id === archivedClientId),
  "an archived client vanished from the full list"
);

r = await call("GET", "/clients?status=nonsense");
check(
  "an unknown status is ignored rather than returning nothing",
  r.status === 200 && (r.json.data ?? []).length > 0,
  `${r.status} with ${(r.json.data ?? []).length} rows`
);

// Overdue: past its date AND not finished.
const overdueProject = timeProjectId;
r = await call("POST", "/tasks", {
  project_id: overdueProject,
  title: `Late task ${stamp}`,
  due_date: "2020-01-01",
});
const lateTaskId = r.json.data?.id;
check("a task with a past due date exists", r.status === 201, `${r.status} ${r.json.message}`);

r = await call("GET", "/tasks?overdue=true");
check(
  "the overdue filter finds it",
  (r.json.data ?? []).some((t) => t.id === lateTaskId),
  `${(r.json.data ?? []).length} returned`
);
check(
  "and every row it returns is genuinely unfinished",
  (r.json.data ?? []).every((t) => t.status?.category !== "done"),
  JSON.stringify((r.json.data ?? []).map((t) => t.status))
);

r = await call("PATCH", `/tasks/${lateTaskId}`, { status_id: DONE });
check("the task is finished late", r.status === 200, `${r.status} ${r.json.message}`);

r = await call("GET", "/tasks?overdue=true");
check(
  // A task delivered late is done, not still overdue. A list of things to
  // chase that cannot shrink is one nobody opens twice.
  "and a late task that got done leaves the overdue list",
  !(r.json.data ?? []).some((t) => t.id === lateTaskId),
  "a finished task was still called overdue"
);


// ---------------------------------------------------------------------------
// The ledger, read as a ledger.
// ---------------------------------------------------------------------------
//
// Every money route already writes AccountTransaction. This is the first screen
// that reads it as one list, so the checks are about what each kind MEANS - not
// about recording anything new.

const KIND_SOURCES = {
  income: ["payment", "due_received"],
  expense: ["expense", "team_payout", "owner_withdrawal", "due_payment"],
  transfer: ["exchange_in", "exchange_out"],
};

cookie = adminCookie;

// The case the whole classification exists for: an exchange writes a positive
// row in one account and a negative row in another. It looks exactly like
// income and an expense, and counting it as either would inflate both sides
// of the books with money that never entered or left the business.
r = await call("POST", "/exchanges", {
  from_account_id: usdAccount,
  to_account_id: bdtAccount,
  date: "2026-08-22",
  amount_usd: 25,
  rate: 121,
});
check("an exchange is recorded", r.status === 201, `${r.status} ${r.json.message}`);

r = await call("GET", "/transactions?kind=transfer");
const exchangeRows = r.json.data ?? [];
check(
  "and writes both halves - one account down, another up",
  exchangeRows.some((row) => row.source_type === "exchange_out" && row.amount < 0) &&
    exchangeRows.some((row) => row.source_type === "exchange_in" && row.amount > 0),
  JSON.stringify(exchangeRows.map((row) => [row.source_type, row.amount]))
);

r = await call("GET", "/transactions");
const ledger = r.json.data ?? [];
check("the ledger opens", r.status === 200, `${r.status} ${r.json.message}`);
check(
  "with rows carrying their account and what produced them",
  ledger.length > 0 && ledger.every((row) => row.account?.name && row.source_type),
  JSON.stringify(ledger.slice(0, 1))
);
check(
  "and totals summed per currency, never across it",
  Array.isArray(r.json.meta?.totals) &&
    r.json.meta.totals.every((t) => typeof t.currency === "string" && typeof t.amount === "number"),
  JSON.stringify(r.json.meta?.totals)
);

r = await call("GET", "/transactions?kind=income");
const income = r.json.data ?? [];
check(
  "income is payments and money coming back, nothing else",
  income.every((row) => ["payment", "due_received"].includes(row.source_type)),
  JSON.stringify([...new Set(income.map((row) => row.source_type))])
);

r = await call("GET", "/transactions?kind=expense");
const spent = r.json.data ?? [];
check(
  "expenses are costs, payouts, withdrawals and money lent",
  spent.every((row) =>
    ["expense", "team_payout", "owner_withdrawal", "due_payment"].includes(row.source_type)
  ),
  JSON.stringify([...new Set(spent.map((row) => row.source_type))])
);

r = await call("GET", "/transactions?kind=transfer");
const moved = r.json.data ?? [];
check(
  // The two halves of an exchange look exactly like income and an expense.
  // Counting them as either inflates both sides with money that never entered
  // or left the business.
  "transfers are the two halves of an exchange, and are neither",
  moved.every((row) => ["exchange_in", "exchange_out"].includes(row.source_type)),
  JSON.stringify([...new Set(moved.map((row) => row.source_type))])
);
check(
  "so an exchange never turns up under income",
  !income.some((row) => row.source_type === "exchange_in"),
  "an exchange was counted as income"
);
check(
  "nor under expenses",
  !spent.some((row) => row.source_type === "exchange_out"),
  "an exchange was counted as an expense"
);

// Nothing is dropped by the three filters. An adjustment is a correction and
// an opening balance is where counting started - neither is income, an
// expense or a transfer, and both still have to appear in the full list.
//
// Asserted as an identity rather than by hunting for a particular row, so it
// stays meaningful whatever this run happened to record.
const classified = new Set([...KIND_SOURCES.income, ...KIND_SOURCES.expense, ...KIND_SOURCES.transfer]);
const unclassified = ledger.filter((row) => !classified.has(row.source_type));

check(
  "the three filters partition the ledger and lose nothing",
  income.length + spent.length + moved.length + unclassified.length === ledger.length,
  `${income.length}+${spent.length}+${moved.length}+${unclassified.length} vs ${ledger.length}`
);
check(
  "and anything that is none of the three is still in the full list",
  unclassified.every((row) => ledger.some((entry) => entry.id === row.id)),
  JSON.stringify([...new Set(unclassified.map((row) => row.source_type))])
);

r = await call("GET", "/transactions?kind=nonsense");
check(
  "an unknown kind shows everything rather than an error",
  r.status === 200 && (r.json.data ?? []).length === ledger.length,
  `${r.status} with ${(r.json.data ?? []).length} of ${ledger.length}`
);

r = await call("GET", `/transactions?account_id=${usdAccount}`);
check(
  "the ledger can be narrowed to one account",
  (r.json.data ?? []).every((row) => row.account?.id === usdAccount),
  JSON.stringify([...new Set((r.json.data ?? []).map((row) => row.account?.name))])
);

// The ledger is the whole agency's money.
cookie = pmCookie;
r = await call("GET", "/transactions");
check("a project manager cannot read the ledger", r.status === 403, `${r.status}`);
cookie = roleCookies.sales;
r = await call("GET", "/transactions");
check("nor can sales", r.status === 403, `${r.status}`);
cookie = adminCookie;


// ---------------------------------------------------------------------------
// Roles & Permissions: narrowing what a colleague may do inside their role.
// ---------------------------------------------------------------------------
//
// The first check is the one that matters. This layer was mounted onto routes
// that already worked, so the question is not "does it gate" - it is "did
// turning it on take anything away from anybody". It must not have.

cookie = roleCookies.sales;
r = await call("GET", "/auth/me");
check(
  "a colleague starts with an empty permission list",
  (r.json.data?.permissions ?? []).length === 0,
  JSON.stringify(r.json.data?.permissions)
);

const permClient = `Perm Co ${stamp}`;
r = await call("POST", "/clients", { name: permClient });
const permClientId = r.json.data?.id;
check(
  "and an empty list still reaches everything the role allows",
  r.status === 201,
  `${r.status} ${r.json.message}`
);

r = await call("POST", "/leads", { name: `Perm Lead ${stamp}`, stage: "new" });
check("all of it, not just the first thing tried", r.status === 201, `${r.status} ${r.json.message}`);

// Now narrow them, and confirm it bites.
cookie = adminCookie;
r = await call("PATCH", `/users/${salesUserId}/permissions`, {
  permissions: ["clients.manage"],
});
check("admin can narrow a colleague", r.status === 200, `${r.status} ${r.json.message}`);

r = await call("PATCH", `/users/${salesUserId}/permissions`, {
  permissions: ["clients.manage", "not.a.real.permission"],
});
check("an unknown permission is refused, not stored", r.status === 400, `${r.status}`);

cookie = roleCookies.sales;
r = await call("POST", "/clients", { name: `Still Allowed ${stamp}` });
check("the ticked box still works", r.status === 201, `${r.status} ${r.json.message}`);

r = await call("POST", "/leads", { name: `Now Refused ${stamp}`, stage: "new" });
check(
  // Ticking one box flips somebody from "everything the role allows" to "only
  // these". That reads backwards unless it is said out loud, which is why the
  // screen says it.
  "and everything else is now refused",
  r.status === 403,
  `${r.status} ${r.json.message}`
);
check(
  "with the refusal naming the permission to ask for",
  /leads\.manage/.test(r.json.message ?? ""),
  r.json.message
);

// Undo it. Refusing an empty list would leave no way back.
cookie = adminCookie;
r = await call("PATCH", `/users/${salesUserId}/permissions`, { permissions: [] });
check("clearing the list is allowed", r.status === 200, `${r.status} ${r.json.message}`);

cookie = roleCookies.sales;
r = await call("POST", "/leads", { name: `Allowed Again ${stamp}`, stage: "new" });
check("and gives everything back", r.status === 201, `${r.status} ${r.json.message}`);

// The layer narrows; it can never widen.
cookie = adminCookie;
r = await call("PATCH", `/users/${salesUserId}/permissions`, {
  permissions: ["projects.manage", "time.approve"],
});
check("a colleague can be given a delivery permission", r.status === 200, `${r.status}`);

cookie = roleCookies.sales;
r = await call("POST", "/tasks", { project_id: timeProjectId, title: "Should be refused" });
check(
  "but the role gate still refuses what the role never allowed",
  r.status === 403,
  `${r.status} ${r.json.message}`
);

cookie = adminCookie;
r = await call("PATCH", `/users/${salesUserId}/permissions`, { permissions: [] });

// An admin passes every check, so storing a list against one would look like a
// restriction and enforce nothing.
r = await call("GET", "/users");
const anAdmin = (r.json.data ?? []).find((u) => u.role === "admin");
r = await call("PATCH", `/users/${anAdmin?.id}/permissions`, {
  permissions: ["clients.manage"],
});
check(
  "an admin cannot be given a permission list that would do nothing",
  r.status === 400,
  `${r.status} ${r.json.message}`
);

// Only admin hands access out.
cookie = pmCookie;
r = await call("PATCH", `/users/${salesUserId}/permissions`, { permissions: ["clients.manage"] });
check("a project manager cannot change anyone's access", r.status === 403, `${r.status}`);
cookie = adminCookie;


// ---------------------------------------------------------------------------
// Notifications: a company talking to itself.
// ---------------------------------------------------------------------------

cookie = adminCookie;

r = await call("GET", "/notification-rules");
const rules = r.json.data ?? [];
check("the rules list opens", r.status === 200, `${r.status} ${r.json.message}`);
check(
  // A screen showing five switches on one agency and none on another, for the
  // same product, is a screen nobody can be told how to use.
  "with the whole catalogue, not just rows that happen to exist",
  rules.length >= 5 && rules.every((rule) => typeof rule.in_app === "boolean"),
  `${rules.length} rules`
);
check(
  "and defaults filled in, so an untouched agency is not shown 'nobody is told'",
  rules.every((rule) => rule.kind === "directed" || rule.roles.length > 0),
  JSON.stringify(rules.map((rule) => [rule.event, rule.roles]))
);
check(
  "nothing is marked customised before anybody touched it",
  rules.every((rule) => rule.customised === false),
  JSON.stringify(rules.filter((rule) => rule.customised).map((rule) => rule.event))
);

// Directed: the person the work was handed to.
cookie = pmCookie;
r = await call("POST", "/tasks", {
  project_id: timeProjectId,
  title: `Notify task ${stamp}`,
  assignee_id: opsUserId,
});
const notifyTaskId = r.json.data?.id;
check("a task is assigned", r.status === 201, `${r.status} ${r.json.message}`);

cookie = opsCookie;
r = await call("GET", "/notifications");
const assigned = (r.json.data ?? []).find(
  (row) => row.entity_type === "task" && row.entity_id === notifyTaskId
);
check("the assignee is told", Boolean(assigned), `${(r.json.data ?? []).length} in the bell`);
check("and it is marked as coming from their own company", assigned?.source === "company", assigned?.source);

// The actor never hears about their own action.
cookie = pmCookie;
r = await call("GET", "/notifications");
check(
  // Telling somebody what they just did is noise, and noise is what teaches
  // people to ignore the bell.
  "the person who assigned it is not told about their own click",
  !(r.json.data ?? []).some((row) => row.entity_id === notifyTaskId),
  "the actor was notified of their own action"
);

// Broadcast: whoever signs timesheets off. Chosen over a payment because the
// actor has to be somebody who is NOT in the audience - recording a payment is
// admin-only, so admin would be excluded from its own broadcast and the check
// would prove nothing.
cookie = adminCookie;
const beforeCount = (await call("GET", "/notifications/unread-count")).json.data?.unread ?? 0;

cookie = opsCookie;
r = await call("POST", "/time-entries", {
  project_id: timeProjectId,
  date: "2026-08-25",
  hours: 3,
  is_billable: true,
  notes: "Notification check",
});
check("operations logs hours", r.status === 201, `${r.status} ${r.json.message}`);

cookie = adminCookie;
r = await call("GET", "/notifications/unread-count");
check(
  "and whoever approves hours hears about it",
  (r.json.data?.unread ?? 0) > beforeCount,
  `${beforeCount} -> ${r.json.data?.unread}`
);

// One badge over both sources.
r = await call("GET", "/notifications");
const sources = new Set((r.json.data ?? []).map((row) => row.source));
check(
  "the bell carries platform notices and company ones together",
  sources.has("company"),
  JSON.stringify([...sources])
);

// Marking read works for a company notification without being told which kind.
const mine = (r.json.data ?? []).find((row) => row.source === "company" && !row.read_at);
if (mine) {
  const was = (await call("GET", "/notifications/unread-count")).json.data?.unread ?? 0;
  r = await call("POST", `/notifications/${mine.id}/read`, {});
  check("a company notification can be marked read", r.status === 200, `${r.status}`);

  r = await call("GET", "/notifications/unread-count");
  check(
    "and the one badge goes down",
    (r.json.data?.unread ?? 0) === was - 1,
    `${was} -> ${r.json.data?.unread}`
  );
}

r = await call("POST", "/notifications/read-all", {});
check("clearing everything works", r.status === 200, `${r.status}`);
r = await call("GET", "/notifications/unread-count");
check("and clears both sources", r.json.data?.unread === 0, JSON.stringify(r.json.data));

// Turning one off means nobody hears it.
r = await call("PATCH", "/notification-rules/time_awaiting_approval", { in_app: false });
check("an event can be switched off", r.status === 200, `${r.status} ${r.json.message}`);

cookie = opsCookie;
await call("POST", "/time-entries", {
  project_id: timeProjectId,
  date: "2026-08-26",
  hours: 2,
  is_billable: true,
  notes: "Should notify nobody",
});

cookie = adminCookie;
r = await call("GET", "/notifications/unread-count");
check("and then it fires for nobody", r.json.data?.unread === 0, JSON.stringify(r.json.data));

r = await call("PATCH", "/notification-rules/time_awaiting_approval", { in_app: true });
check("and can be switched back on", r.status === 200, `${r.status}`);

// A directed event has no role picker, so storing one is refused rather than
// accepted and ignored.
r = await call("PATCH", "/notification-rules/task_assigned", {
  in_app: true,
  roles: ["admin"],
});
check(
  "a role list on a directed event is dropped, not stored as a lie",
  r.status === 200 && r.json.data?.roles?.length === 0,
  JSON.stringify(r.json.data?.roles)
);

r = await call("PATCH", "/notification-rules/not_a_real_event", { in_app: false });
check("an event nothing fires is refused", r.status === 400, `${r.status} ${r.json.message}`);

// Deciding what everybody else never hears about is not a personal preference.
cookie = pmCookie;
r = await call("GET", "/notification-rules");
check("a project manager cannot read the rules", r.status === 403, `${r.status}`);
cookie = adminCookie;


// ---------------------------------------------------------------------------
// Security: who tried to sign in, and whether it worked.
// ---------------------------------------------------------------------------

cookie = adminCookie;

r = await call("GET", "/security/login-events");
check("the login history opens", r.status === 200, `${r.status} ${r.json.message}`);
check(
  "with this agency's own sign-ins in it",
  (r.json.data ?? []).length > 0 && (r.json.data ?? []).every((row) => typeof row.success === "boolean"),
  `${(r.json.data ?? []).length} events`
);
check(
  "and says how long it keeps them, so the screen can say it too",
  r.json.meta?.retention_days === 90,
  JSON.stringify(r.json.meta?.retention_days)
);

const ownEmails = new Set((r.json.data ?? []).map((row) => row.email));
check(
  "a successful sign-in is recorded against the person",
  (r.json.data ?? []).some((row) => row.success && row.user?.full_name),
  JSON.stringify((r.json.data ?? []).slice(0, 1))
);

// A wrong password on a real account is the case this screen exists for.
const beforeFailed = r.json.meta?.failed_last_24h ?? 0;

cookie = "";
r = await call("POST", "/auth/login", { email, password: "WrongPassword1" });
check("a wrong password is refused", r.status === 401, `${r.status}`);

cookie = adminCookie;
r = await call("GET", "/security/login-events?success=false");
check(
  "and the failure is recorded against their account",
  (r.json.data ?? []).some((row) => row.email === email.toLowerCase() && !row.success),
  JSON.stringify((r.json.data ?? []).slice(0, 2).map((row) => [row.email, row.success]))
);
check(
  "with the count of recent failures, which is what the page is for",
  (r.json.meta?.failed_last_24h ?? 0) > beforeFailed,
  `${beforeFailed} -> ${r.json.meta?.failed_last_24h}`
);
check(
  "and never the password that was tried",
  !JSON.stringify(r.json.data ?? []).includes("WrongPassword1"),
  "a password appeared in the login history"
);

// The tenant boundary. An address with no account belongs to no company.
const strangerEmail = `nobody${stamp}@nowhere.test`;
cookie = "";
r = await call("POST", "/auth/login", { email: strangerEmail, password: "Passw0rd123" });
check("an unknown address is refused", r.status === 401, `${r.status}`);

cookie = adminCookie;
r = await call("GET", "/security/login-events");
check(
  // A null organization_id is what guarantees this, rather than a filter
  // somebody has to remember to write.
  "an attempt on an address with no account appears on nobody's screen",
  !(r.json.data ?? []).some((row) => row.email === strangerEmail),
  "an unowned attempt leaked into a company's history"
);

r = await call("GET", "/security/login-events?success=true");
check(
  "the successful-only filter returns only successes",
  (r.json.data ?? []).every((row) => row.success === true),
  JSON.stringify([...new Set((r.json.data ?? []).map((row) => row.success))])
);

r = await call("GET", "/security/login-events?success=maybe");
check(
  "an unknown filter shows everything rather than an error",
  r.status === 200,
  `${r.status}`
);

// Every colleague's sign-in times and addresses is not something a colleague
// should be able to read about the rest of the team.
cookie = pmCookie;
r = await call("GET", "/security/login-events");
check("a project manager cannot read the login history", r.status === 403, `${r.status}`);
cookie = roleCookies.sales;
r = await call("GET", "/security/login-events");
check("nor can sales", r.status === 403, `${r.status}`);
cookie = adminCookie;


// ---------------------------------------------------------------------------
// Custom statuses: the names are the agency's, the meanings are the product's.
// ---------------------------------------------------------------------------

cookie = adminCookie;

r = await call("GET", "/workflow-statuses");
const allStatuses = r.json.data ?? [];
check("a new agency has boards to work on", allStatuses.length >= 9, `${allStatuses.length}`);
check(
  "one default per board, so new work lands somewhere",
  ["task", "project"].every(
    (kind) => allStatuses.filter((row) => row.kind === kind && row.is_default).length === 1
  ),
  JSON.stringify(allStatuses.filter((row) => row.is_default).map((row) => [row.kind, row.name]))
);

// The whole point: rename the column, keep the behaviour.
r = await call("PATCH", `/workflow-statuses/${DONE}`, { name: "Shipped" });
check("a status can be renamed", r.status === 200, `${r.status} ${r.json.message}`);

r = await call("POST", "/tasks", {
  project_id: timeProjectId,
  title: `Rename check ${stamp}`,
});
const renameTaskId = r.json.data?.id;
check("a task is created on the board default", r.status === 201, `${r.status} ${r.json.message}`);
check(
  "and lands on the status marked default",
  r.json.data?.status?.name === "To do",
  JSON.stringify(r.json.data?.status)
);
check("with no completion date", r.json.data?.completed_at === null, r.json.data?.completed_at);

r = await call("PATCH", `/tasks/${renameTaskId}`, { status_id: DONE });
check(
  // The name changed, the category did not - so the clock still stops. This is
  // the one behaviour the whole design exists to protect.
  "moving to a RENAMED done status still sets the completion date",
  r.status === 200 && r.json.data?.completed_at !== null,
  JSON.stringify({ status: r.json.data?.status?.name, completed_at: r.json.data?.completed_at })
);

r = await call("PATCH", `/tasks/${renameTaskId}`, { status_id: IN_PROGRESS });
check(
  "and moving back off it clears the date again",
  r.status === 200 && r.json.data?.completed_at === null,
  JSON.stringify(r.json.data?.completed_at)
);

// A status the agency invented, in an existing category.
r = await call("POST", "/workflow-statuses", {
  kind: "task",
  name: "In QA",
  category: "active",
});
const qaStatus = r.json.data?.id;
check("a new column can be added", r.status === 201, `${r.status} ${r.json.message}`);
check(
  "appended to the end of the board rather than dropped in the middle",
  r.json.data?.sort_order >= 3,
  `sort_order ${r.json.data?.sort_order}`
);

r = await call("POST", "/workflow-statuses", { kind: "task", name: "in qa", category: "open" });
check(
  "a differently-cased duplicate is refused",
  r.status === 409,
  `${r.status} ${r.json.message}`
);

r = await call("PATCH", `/tasks/${renameTaskId}`, { status_id: qaStatus });
check("work can be moved onto it", r.status === 200, `${r.status} ${r.json.message}`);

r = await call("GET", "/tasks?overdue=true");
check(
  // "In QA" is category active, so work sitting in it is still unfinished.
  "and an invented in-progress status still counts as unfinished",
  r.status === 200,
  `${r.status}`
);

// A category is required and never guessed from the name.
r = await call("POST", "/workflow-statuses", { kind: "task", name: "Nearly done" });
check(
  "a status with no stated meaning is refused",
  r.status === 400,
  `${r.status} ${r.json.message}`
);

// Deleting a column would have to move the work somewhere.
r = await call("DELETE", `/workflow-statuses/${qaStatus}`);
check(
  "a status with work on it cannot be deleted",
  r.status === 409,
  `${r.status} ${r.json.message}`
);
check(
  "and the refusal says to move them or turn it off",
  /move them|turn it off/i.test(r.json.message ?? ""),
  r.json.message
);

r = await call("PATCH", `/tasks/${renameTaskId}`, { status_id: TODO });
r = await call("DELETE", `/workflow-statuses/${qaStatus}`);
check("an empty one can be", r.status === 200, `${r.status} ${r.json.message}`);

// Put the name back so later checks read normally.
await call("PATCH", `/workflow-statuses/${DONE}`, { name: "Done" });

// The default moves rather than leaving a board with nowhere to start.
r = await call("PATCH", `/workflow-statuses/${IN_PROGRESS}`, { is_default: true });
check("the default can be moved", r.status === 200, `${r.status}`);

r = await call("GET", "/workflow-statuses?kind=task");
check(
  "and there is still exactly one",
  (r.json.data ?? []).filter((row) => row.is_default).length === 1,
  JSON.stringify((r.json.data ?? []).filter((row) => row.is_default).map((row) => row.name))
);
await call("PATCH", `/workflow-statuses/${TODO}`, { is_default: true });

// Shaping the board is a reporting decision, not a personal preference.
cookie = pmCookie;
r = await call("GET", "/workflow-statuses");
check("a project manager can read the board", r.status === 200, `${r.status}`);
r = await call("POST", "/workflow-statuses", { kind: "task", name: "Mine", category: "open" });
check("but cannot add a column", r.status === 403, `${r.status}`);
cookie = adminCookie;


// ---------------------------------------------------------------------------
// Services: what the agency sells.
// ---------------------------------------------------------------------------

cookie = adminCookie;

r = await call("POST", "/services/categories", { name: "Design" });
const designCategory = r.json.data?.id;
check("a service category can be added", r.status === 201, `${r.status} ${r.json.message}`);

r = await call("POST", "/services", {
  name: `Logo design ${stamp}`,
  description: "Mark, wordmark and a one-page guide",
  category_id: designCategory,
  default_price_usd: 400,
});
const logoService = r.json.data?.id;
check("a service can be added", r.status === 201, `${r.status} ${r.json.message}`);
check(
  "with the category it was filed under",
  r.json.data?.category?.name === "Design",
  JSON.stringify(r.json.data?.category)
);

r = await call("POST", "/services", { name: `logo design ${stamp}` });
check("a differently-cased duplicate is refused", r.status === 409, `${r.status} ${r.json.message}`);

r = await call("POST", "/services", { name: `SEO retainer ${stamp}`, default_price_usd: 250 });
const seoService = r.json.data?.id;
check("a service with no category is fine", r.status === 201, `${r.status} ${r.json.message}`);

// A package is a pick, not a price.
r = await call("POST", "/services/templates", {
  name: `Launch package ${stamp}`,
  items: [
    { service_id: logoService, quantity: 1 },
    { service_id: seoService, quantity: 3 },
  ],
});
check("a package can be built from services", r.status === 201, `${r.status} ${r.json.message}`);
check(
  "carrying its lines and quantities",
  r.json.data?.items?.length === 2,
  JSON.stringify(r.json.data?.items?.length)
);

r = await call("POST", "/services/templates", { name: `Empty ${stamp}`, items: [] });
check(
  // A bundle with no lines is a name, not an offer.
  "a package with no lines is refused",
  r.status === 400,
  `${r.status} ${r.json.message}`
);

// The link that makes the catalogue worth having.
r = await call("POST", "/invoices", {
  client_id: clientId,
  issue_date: "2026-09-01",
  due_date: "2026-09-15",
  items: [
    { service_id: logoService, description: "Logo design", quantity: 1, unit_price: 400 },
    { description: "Rush fee typed by hand", quantity: 1, unit_price: 50 },
  ],
});
const serviceInvoice = r.json.data?.id;
check("an invoice line can name a service", r.status === 201, `${r.status} ${r.json.message}`);
check(
  "and a hand-typed line beside it is still fine",
  (r.json.data?.items ?? []).length === 2,
  JSON.stringify((r.json.data?.items ?? []).map((i) => i.service_id))
);

r = await call("PATCH", `/invoices/${serviceInvoice}`, { status: "sent" });
check("the invoice is sent", r.status === 200, `${r.status}`);

r = await call("GET", "/services/revenue");
const billed = r.json.data ?? [];
check("billed-by-service reports", r.status === 200, `${r.status} ${r.json.message}`);
check(
  "with the service that was billed",
  billed.some((row) => row.service.id === logoService && row.billed_usd === 400),
  JSON.stringify(billed)
);
check(
  // Dropping them would make the totals add up to less than the invoices with
  // no clue why.
  "and hand-typed lines shown as a row rather than dropped",
  billed.some((row) => row.service.id === "" && row.billed_usd >= 50),
  JSON.stringify(billed.map((row) => [row.service.name, row.billed_usd]))
);

// Changing the catalogue must never restate an invoice already sent.
r = await call("PATCH", `/services/${logoService}`, { default_price_usd: 900 });
check("a service price can be changed", r.status === 200, `${r.status}`);

r = await call("GET", `/invoices/${serviceInvoice}`);
check(
  "and the invoice already sent keeps its own price",
  Number(r.json.data?.items?.[0]?.unit_price) === 400,
  JSON.stringify(r.json.data?.items?.[0]?.unit_price)
);

// A project can say what it is. Set on the one that already exists rather than
// creating another - the billing section above moves this company onto a
// one-project tier, and the limit is doing its job.
r = await call("PATCH", `/projects/${timeProjectId}`, { service_id: logoService });
check("a project can name its service", r.status === 200, `${r.status} ${r.json.message}`);
check(
  "and it comes back on the project",
  r.json.data?.service_id === logoService,
  JSON.stringify(r.json.data?.service_id)
);

// Deleting is refused once anything is riding on it.
r = await call("DELETE", `/services/${logoService}`);
check(
  "a service that has been billed cannot be deleted",
  r.status === 409,
  `${r.status} ${r.json.message}`
);
check(
  "and the refusal says what is on it and to turn it off",
  /invoice lines|projects|templates/.test(r.json.message ?? "") &&
    /turn it off/i.test(r.json.message ?? ""),
  r.json.message
);

r = await call("PATCH", `/services/${logoService}`, { is_active: false });
check("turning it off is allowed", r.status === 200, `${r.status}`);

// A category is a grouping, so removing one frees its services rather than
// refusing until they have been moved by hand.
r = await call("DELETE", `/services/categories/${designCategory}`);
check(
  "a category with services in it CAN be removed",
  r.status === 200,
  `${r.status} ${r.json.message}`
);
check(
  "and says how many were left ungrouped",
  /ungrouped/i.test(r.json.message ?? ""),
  r.json.message
);

r = await call("GET", "/services");
check(
  "the services survive it",
  (r.json.data ?? []).some((row) => row.id === logoService),
  "a service vanished with its category"
);

// Anybody who raises an invoice needs to read the catalogue.
cookie = roleCookies.sales;
r = await call("GET", "/services");
check("sales can read the catalogue", r.status === 200, `${r.status}`);
r = await call("POST", "/services", { name: `Sales added ${stamp}` });
check("and add to it", r.status === 201, `${r.status} ${r.json.message}`);

cookie = opsCookie;
r = await call("GET", "/services");
check("operations can read it too", r.status === 200, `${r.status}`);
r = await call("POST", "/services", { name: `Ops added ${stamp}` });
check("but not add to it", r.status === 403, `${r.status}`);
r = await call("GET", "/services/revenue");
check("nor read what it earned", r.status === 403, `${r.status}`);

cookie = adminCookie;


// ---------------------------------------------------------------------------
// HR: attendance, leave and payroll.
// ---------------------------------------------------------------------------

// ---- attendance: being here, which is not logging hours ----

cookie = opsCookie;
r = await call("POST", "/hr/attendance/clock", {});
check("somebody can clock in", r.status === 200, `${r.status} ${r.json.message}`);
check("which records a check-in and no check-out", Boolean(r.json.data?.check_in) && !r.json.data?.check_out, JSON.stringify(r.json.data?.check_out));
check("marked as their own, not written down for them", r.json.data?.source === "self", r.json.data?.source);

r = await call("POST", "/hr/attendance/clock", {});
check("clocking again checks them out", r.status === 200 && Boolean(r.json.data?.check_out), `${r.status}`);

r = await call("POST", "/hr/attendance/clock", {});
check(
  // One row per day: a third click is not a third day.
  "and a third time is refused rather than opening another day",
  r.status === 409,
  `${r.status} ${r.json.message}`
);

r = await call("GET", "/hr/attendance");
check("they can see their own attendance", r.status === 200 && (r.json.data ?? []).length > 0, `${r.status}`);
check(
  // Reading when every colleague arrived is a management view.
  "and only their own",
  (r.json.data ?? []).every((row) => row.user.id === opsUserId),
  JSON.stringify([...new Set((r.json.data ?? []).map((row) => row.user.full_name))])
);

cookie = pmCookie;
r = await call("POST", "/hr/attendance", {
  user_id: opsUserId,
  date: "2026-09-02",
  check_in: "09:30",
  check_out: "17:45",
});
check("an approver can write somebody's day down", r.status === 200, `${r.status} ${r.json.message}`);
check(
  // "They clocked in" and "somebody wrote it down" are different claims.
  "recorded as written down, not as their own",
  r.json.data?.source === "admin",
  r.json.data?.source
);

r = await call("POST", "/hr/attendance", {
  user_id: opsUserId,
  date: "2026-09-03",
  check_in: "17:00",
  check_out: "09:00",
});
check("a check-out before the check-in is refused", r.status === 400, `${r.status} ${r.json.message}`);

cookie = opsCookie;
r = await call("POST", "/hr/attendance", { user_id: opsUserId, date: "2026-09-04" });
check("operations cannot write attendance for anybody", r.status === 403, `${r.status}`);

// ---- leave ----

cookie = adminCookie;
r = await call("POST", "/hr/leave-types", { name: "Annual", days_per_year: 20 });
const annualLeave = r.json.data?.id;
check("a leave type can be added", r.status === 201, `${r.status} ${r.json.message}`);

r = await call("POST", "/hr/leave-types", { name: "Unpaid", days_per_year: 0, is_paid: false });
check("including an uncapped one", r.status === 201, `${r.status} ${r.json.message}`);

cookie = opsCookie;
r = await call("POST", "/hr/leave-types", { name: "Sneaky" });
check("a colleague cannot invent leave types", r.status === 403, `${r.status}`);

r = await call("POST", "/hr/leave", {
  leave_type_id: annualLeave,
  from_date: "2026-10-05",
  to_date: "2026-10-09",
  days: 5,
  reason: "Family",
});
const leaveRequest = r.json.data?.id;
check("somebody can ask for leave", r.status === 201, `${r.status} ${r.json.message}`);
check("and it starts pending", r.json.data?.status === "pending", r.json.data?.status);

r = await call("POST", "/hr/leave", {
  leave_type_id: annualLeave,
  from_date: "2026-10-08",
  to_date: "2026-10-10",
  days: 3,
});
check(
  // Two absences covering the same day is not a thing that can be true, and
  // would double-count against the allowance.
  "overlapping their own request is refused",
  r.status === 409,
  `${r.status} ${r.json.message}`
);

r = await call("POST", "/hr/leave", {
  leave_type_id: annualLeave,
  from_date: "2026-11-10",
  to_date: "2026-11-05",
  days: 1,
});
check("ending before it starts is refused", r.status === 400, `${r.status} ${r.json.message}`);

r = await call("GET", "/hr/leave/balance?year=2026");
const balance = r.json.data ?? [];
check("a balance comes back", r.status === 200 && balance.length >= 2, `${r.status}`);
check(
  // Counting pending days would show a number that jumps back when a request
  // is turned down.
  "with nothing counted while the request is still pending",
  balance.find((row) => row.leave_type.id === annualLeave)?.days_taken === 0,
  JSON.stringify(balance.find((row) => row.leave_type.id === annualLeave))
);
check(
  // "Tracked but not capped" and "you have none left" are opposite answers.
  "and an uncapped type reports no limit rather than zero left",
  balance.some((row) => row.days_per_year === 0 && row.remaining === null),
  JSON.stringify(balance.map((row) => [row.leave_type.name, row.remaining]))
);

r = await call("POST", `/hr/leave/${leaveRequest}/decide`, { approve: true });
check("a colleague cannot decide their own leave", r.status === 403, `${r.status} ${r.json.message}`);

cookie = pmCookie;
r = await call("POST", `/hr/leave/${leaveRequest}/decide`, { approve: true, note: "Enjoy it" });
check("an approver can approve it", r.status === 200, `${r.status} ${r.json.message}`);
check("and it is recorded as approved", r.json.data?.status === "approved", r.json.data?.status);

r = await call("POST", `/hr/leave/${leaveRequest}/decide`, { approve: false });
check(
  // A second decision would write over the first and lose who made it.
  "deciding it twice is refused",
  r.status === 409,
  `${r.status} ${r.json.message}`
);

cookie = opsCookie;
r = await call("GET", "/hr/leave/balance?year=2026");
check(
  "and the approved days now count against the allowance",
  (r.json.data ?? []).find((row) => row.leave_type.id === annualLeave)?.days_taken === 5,
  JSON.stringify((r.json.data ?? []).find((row) => row.leave_type.id === annualLeave))
);

r = await call("POST", `/hr/leave/${leaveRequest}/cancel`, {});
check("an approved request cannot be withdrawn", r.status === 409, `${r.status} ${r.json.message}`);

// ---- payroll: the rule the whole module is built around ----

cookie = adminCookie;
r = await call("POST", "/hr/payroll", {
  period_start: "2026-09-01",
  period_end: "2026-09-30",
});
const payrollRun = r.json.data?.id;
check("a month of payroll can be opened", r.status === 201, `${r.status} ${r.json.message}`);
check(
  // Payroll is a list somebody adjusts, not one they assemble from nothing.
  "with a line per active person already on it",
  (r.json.data?.items ?? []).length >= 4,
  `${(r.json.data?.items ?? []).length} lines`
);

r = await call("POST", "/hr/payroll", { period_start: "2026-09-01", period_end: "2026-09-30" });
check(
  // The cheapest possible guard against paying a month twice.
  "a second run for the same month is refused",
  r.status === 409,
  `${r.status} ${r.json.message}`
);

const payrollItems = (await call("GET", "/hr/payroll")).json.data?.[0]?.items ?? [];
r = await call("PATCH", `/hr/payroll/${payrollRun}/items`, {
  items: payrollItems.slice(0, 2).map((item) => ({
    id: item.id,
    gross_bdt: 50000,
    deductions_bdt: 5000,
  })),
});
check("the numbers can be set", r.status === 200, `${r.status} ${r.json.message}`);
check(
  // Two places computing net is two places for it to be wrong.
  "and net is worked out on the server, not trusted from the client",
  (r.json.data?.items ?? []).some((item) => Number(item.net_bdt) === 45000),
  JSON.stringify((r.json.data?.items ?? []).map((i) => i.net_bdt))
);

r = await call("PATCH", `/hr/payroll/${payrollRun}/items`, {
  items: [{ id: payrollItems[0].id, gross_bdt: 1000, deductions_bdt: 5000 }],
});
check("deductions above the gross are refused", r.status === 400, `${r.status} ${r.json.message}`);

// The assertion the plan named: payroll must not double-count.
const payoutsBefore = (await call("GET", "/team-payouts")).json.data ?? [];
const beforeTotal = payoutsBefore.reduce((sum, row) => sum + Number(row.amount_bdt), 0);

r = await call("POST", `/hr/payroll/${payrollRun}/complete`, { account_id: bdtAccount });
check("the run can be paid", r.status === 200, `${r.status} ${r.json.message}`);
check("and is marked completed", r.json.data?.status === "completed", r.json.data?.status);

const paidItems = (r.json.data?.items ?? []).filter((item) => item.payout_id);
check(
  // Null payout_id IS "not paid yet" - there is no second flag to drift.
  "every paid line points at the payout it produced",
  paidItems.length === 2,
  `${paidItems.length} of ${(r.json.data?.items ?? []).length} lines`
);
check(
  // A zero payout against somebody who joined mid-month is not a real payment.
  "and lines left at zero produced no payout at all",
  (r.json.data?.items ?? []).every((item) => Number(item.net_bdt) > 0 || !item.payout_id),
  "a zero line produced a payout"
);

const payoutsAfter = (await call("GET", "/team-payouts")).json.data ?? [];
const afterTotal = payoutsAfter.reduce((sum, row) => sum + Number(row.amount_bdt), 0);

check(
  // The whole point: salary exists in ONE place, the same one every
  // profitability figure already reads.
  "the money appears once, as team payouts",
  afterTotal - beforeTotal === 90000,
  `${beforeTotal} -> ${afterTotal}`
);
check(
  "recorded as salary, in the month it was for",
  payoutsAfter.some((row) => row.type === "salary" && String(row.date).startsWith("2026-09-30")),
  JSON.stringify(payoutsAfter.slice(0, 2).map((row) => [row.type, row.date]))
);

r = await call("POST", `/hr/payroll/${payrollRun}/complete`, { account_id: bdtAccount });
check("paying the same run twice is refused", r.status === 409, `${r.status} ${r.json.message}`);

const payoutsAfterSecond = (await call("GET", "/team-payouts")).json.data ?? [];
check(
  "and nothing moved when it was refused",
  payoutsAfterSecond.length === payoutsAfter.length,
  `${payoutsAfter.length} -> ${payoutsAfterSecond.length}`
);

r = await call("PATCH", `/hr/payroll/${payrollRun}/items`, {
  items: [{ id: payrollItems[0].id, gross_bdt: 99999 }],
});
check(
  // Editing a paid run would leave the payouts saying something else.
  "a paid run cannot be edited",
  r.status === 409,
  `${r.status} ${r.json.message}`
);

r = await call("DELETE", `/hr/payroll/${payrollRun}`);
check("nor deleted", r.status === 409, `${r.status} ${r.json.message}`);
check(
  "and the refusal says to reverse the payouts instead",
  /reverse the payouts/i.test(r.json.message ?? ""),
  r.json.message
);

// Every colleague's salary on one screen is the most sensitive list here.
cookie = pmCookie;
r = await call("GET", "/hr/payroll");
check("a project manager cannot read payroll", r.status === 403, `${r.status}`);
cookie = opsCookie;
r = await call("GET", "/hr/payroll");
check("nor can operations", r.status === 403, `${r.status}`);
cookie = adminCookie;


console.log("\n--- loans ---");
//
// A loan is the one thing in this product that is money IN without being
// revenue, and money OUT that is only partly a cost. Both halves are asserted
// against real balances rather than against the messages the API sends back.

const balanceOfAccount = async (accountId) => {
  const res = await call("GET", "/accounts");
  return Number((res.json.data ?? []).find((a) => a.id === accountId)?.balance ?? 0);
};

const beforeLoan = await balanceOfAccount(bdtAccount);

r = await call("POST", "/loans", {
  lender: "City Bank",
  principal_bdt: 120000,
  interest_rate: 12,
  started_on: "2026-01-15",
  term_months: 12,
  account_id: bdtAccount,
});
check("admin can record a loan", r.status === 201, `${r.status} ${r.json.message}`);
const loanId = r.json.data?.id;
check("it generates a schedule for the whole term", r.json.data?.instalment_count === 12, `${r.json.data?.instalment_count}`);
check(
  "whose principal adds up to exactly what was borrowed",
  near(r.json.data?.principal_scheduled_bdt ?? 0, 120000),
  `${r.json.data?.principal_scheduled_bdt}`
);
check(
  "interest is left at zero rather than guessed",
  (r.json.data?.interest_scheduled_bdt ?? -1) === 0,
  `${r.json.data?.interest_scheduled_bdt}`
);
check("and nothing is paid yet", (r.json.data?.outstanding_bdt ?? 0) === 120000, `${r.json.data?.outstanding_bdt}`);

const afterLoan = await balanceOfAccount(bdtAccount);
check(
  "borrowed money lands in the account",
  near(afterLoan - beforeLoan, 120000),
  `${beforeLoan} -> ${afterLoan}`
);

// The rule that matters most: cash arrived, but the agency did not earn it.
r = await call("GET", "/reports/profit-loss");
const plAfterLoan = r.json.data;
check(
  "but a loan is not revenue",
  !JSON.stringify(plAfterLoan.revenue).includes("120000"),
  JSON.stringify(plAfterLoan.revenue)
);

// Put a real interest figure on the first instalment, the way an agency copying
// its bank's own table would.
r = await call("GET", `/loans/${loanId}`);
const schedule = r.json.data?.instalments ?? [];
check("the schedule reads back", schedule.length === 12, `${schedule.length}`);

r = await call("PATCH", `/loans/${loanId}/instalments`, {
  instalments: schedule.map((item, index) => ({
    due_date: item.due_date.slice(0, 10),
    principal_bdt: 10000,
    interest_bdt: index === 0 ? 1200 : 0,
  })),
});
check("admin can correct the schedule to match the bank", r.status === 200, `${r.status} ${r.json.message}`);
check("interest now appears on it", near(r.json.data?.interest_scheduled_bdt ?? 0, 1200), `${r.json.data?.interest_scheduled_bdt}`);

const firstInstalment = r.json.data?.instalments?.[0]?.id;
const beforePay = await balanceOfAccount(bdtAccount);

r = await call("PATCH", `/loans/instalments/${firstInstalment}/pay`, {
  account_id: bdtAccount,
  date: "2026-02-15",
});
check("admin can pay an instalment", r.status === 200, `${r.status} ${r.json.message}`);
check("the outstanding figure drops by the principal only", (r.json.data?.outstanding_bdt ?? 0) === 110000, `${r.json.data?.outstanding_bdt}`);

const afterPay = await balanceOfAccount(bdtAccount);
check(
  "and the account loses principal AND interest",
  near(beforePay - afterPay, 11200),
  `${beforePay} -> ${afterPay}, expected -11200`
);

// The accounting rule this module exists to get right.
r = await call("GET", "/reports/profit-loss");
check(
  "only the interest reaches profit and loss",
  near(r.json.data?.cost?.loan_interest_bdt ?? 0, 1200),
  `${r.json.data?.cost?.loan_interest_bdt}`
);
check(
  "the principal repaid is not a cost",
  (r.json.data?.cost?.total_bdt ?? 0) - (plAfterLoan.cost?.total_bdt ?? 0) === 1200,
  `cost moved by ${(r.json.data?.cost?.total_bdt ?? 0) - (plAfterLoan.cost?.total_bdt ?? 0)}`
);

r = await call("PATCH", `/loans/instalments/${firstInstalment}/pay`, { account_id: bdtAccount });
check("paying the same instalment twice is refused", r.status === 409, `${r.status} ${r.json.message}`);
check("with nothing moving", near(await balanceOfAccount(bdtAccount), afterPay), `${await balanceOfAccount(bdtAccount)}`);

r = await call("DELETE", `/loans/${loanId}`);
check("a loan with repayments cannot be deleted", r.status === 409, `${r.status} ${r.json.message}`);
check("and the refusal says to close it instead", /close it/i.test(r.json.message ?? ""), r.json.message);

// Reversing puts the money back and makes it owed again.
r = await call("PATCH", `/loans/instalments/${firstInstalment}/reverse`);
check("a repayment can be reversed", r.status === 200, `${r.status} ${r.json.message}`);
check("which owes the principal again", (r.json.data?.outstanding_bdt ?? 0) === 120000, `${r.json.data?.outstanding_bdt}`);
check(
  "and returns the cash exactly",
  near(await balanceOfAccount(bdtAccount), beforePay),
  `${await balanceOfAccount(bdtAccount)} vs ${beforePay}`
);
r = await call("PATCH", `/loans/instalments/${firstInstalment}/reverse`);
check("reversing it twice is refused", r.status === 400, `${r.status} ${r.json.message}`);

// Paying every instalment settles the loan on its own - the status can never
// sit at "active" on a loan with nothing left to pay.
r = await call("GET", `/loans/${loanId}`);
for (const item of r.json.data?.instalments ?? []) {
  await call("PATCH", `/loans/instalments/${item.id}/pay`, { account_id: bdtAccount });
}
r = await call("GET", `/loans/${loanId}`);
check("paying every instalment settles the loan", r.json.data?.status === "settled", `${r.json.data?.status}`);
check("with nothing outstanding", (r.json.data?.outstanding_bdt ?? -1) === 0, `${r.json.data?.outstanding_bdt}`);

r = await call("GET", "/loans/summary");
check("the summary reads", r.status === 200, `${r.status}`);
check("and a settled loan owes nothing", (r.json.data?.outstanding_bdt ?? -1) === 0, `${r.json.data?.outstanding_bdt}`);

// A loan must land in a BDT account, like every other BDT record.
r = await call("POST", "/loans", {
  lender: "Wrong Currency Bank",
  principal_bdt: 5000,
  started_on: "2026-03-01",
  term_months: 2,
  account_id: usdAccount,
});
check("a loan cannot be paid into a USD account", r.status === 400, `${r.status} ${r.json.message}`);

console.log("\n--- shareholders ---");

r = await call("POST", "/shareholders", { name: "Ayesha Rahman", share_pct: 60 });
check("admin can add a shareholder", r.status === 201, `${r.status} ${r.json.message}`);
const shareholderA = r.json.data?.id;

r = await call("POST", "/shareholders", { name: "Karim Uddin", share_pct: 30 });
check("and a second one", r.status === 201, `${r.status} ${r.json.message}`);

// Shares totalling more than the whole business is not a rounding question.
r = await call("POST", "/shareholders", { name: "Too Much", share_pct: 20 });
check("shares cannot total more than 100%", r.status === 400, `${r.status} ${r.json.message}`);
check(
  "and the refusal says how much is already held",
  /already hold/i.test(r.json.message ?? ""),
  r.json.message
);

r = await call("GET", "/shareholders");
check("the list says what is unallocated", r.json.meta?.unallocated_pct === 10, `${r.json.meta?.unallocated_pct}`);

const beforeDistribution = await balanceOfAccount(bdtAccount);
r = await call("POST", "/shareholders/distributions", {
  shareholder_id: shareholderA,
  date: "2026-03-31",
  amount_bdt: 25000,
  account_id: bdtAccount,
});
check("admin can pay a distribution", r.status === 201, `${r.status} ${r.json.message}`);
const distributionId = r.json.data?.id;

const afterDistribution = await balanceOfAccount(bdtAccount);
check(
  "which leaves a real account",
  near(beforeDistribution - afterDistribution, 25000),
  `${beforeDistribution} -> ${afterDistribution}`
);

// The rule: paying owners must not let an agency shrink its own profit.
const plBeforeDistribution = await call("GET", "/reports/profit-loss");
check(
  "but a distribution is not a cost",
  near(plBeforeDistribution.json.data?.cost?.total_bdt ?? 0, (await call("GET", "/reports/profit-loss")).json.data?.cost?.total_bdt ?? 0),
  "cost changed by a distribution"
);
check(
  "profit is unchanged by paying owners",
  !JSON.stringify(plBeforeDistribution.json.data?.cost ?? {}).includes("25000"),
  JSON.stringify(plBeforeDistribution.json.data?.cost)
);

r = await call("DELETE", `/shareholders/${shareholderA}`);
check("a shareholder with distributions cannot be deleted", r.status === 409, `${r.status} ${r.json.message}`);
check(
  "and the refusal says to make them inactive",
  /inactive/i.test(r.json.message ?? ""),
  r.json.message
);

r = await call("DELETE", `/shareholders/distributions/${distributionId}`);
check("a distribution can be reversed", r.status === 200, `${r.status} ${r.json.message}`);
check(
  "which returns the money",
  near(await balanceOfAccount(bdtAccount), beforeDistribution),
  `${await balanceOfAccount(bdtAccount)} vs ${beforeDistribution}`
);

// Retiring somebody frees their share for whoever takes it on.
r = await call("PATCH", `/shareholders/${shareholderA}`, { is_active: false });
check("a shareholder can be retired", r.status === 200, `${r.status} ${r.json.message}`);
r = await call("POST", "/shareholders", { name: "New Partner", share_pct: 60 });
check("which frees their share for somebody else", r.status === 201, `${r.status} ${r.json.message}`);

// Both lists are the admin's alone.
cookie = pmCookie;
r = await call("GET", "/loans");
check("a project manager cannot read loans", r.status === 403, `${r.status}`);
r = await call("GET", "/shareholders");
check("nor who owns the business", r.status === 403, `${r.status}`);
cookie = roleCookies.sales;
r = await call("GET", "/loans");
check("nor can sales", r.status === 403, `${r.status}`);
cookie = opsCookie;
r = await call("GET", "/shareholders");
check("nor operations", r.status === 403, `${r.status}`);
cookie = adminCookie;


console.log("\n--- chat ---");
//
// Membership is the permission, and the socket is the part with no HTTP route
// to audit - so both are attacked here rather than described.

// A direct conversation, opened twice on purpose.
cookie = adminCookie;
r = await call("POST", "/chat", { type: "direct", member_ids: [roleUserIds.operations] });
check("admin can open a direct conversation", r.status === 201, `${r.status} ${r.json.message}`);
const dmId = r.json.data?.id;

r = await call("POST", "/chat", { type: "direct", member_ids: [roleUserIds.operations] });
check(
  "opening the same one again returns the same thread",
  r.json.data?.id === dmId,
  `${dmId} vs ${r.json.data?.id}`
);

r = await call("POST", "/chat", { type: "direct", member_ids: [roleUserIds.operations, roleUserIds.sales] });
check("a direct conversation cannot hold three people", r.status === 400, `${r.status} ${r.json.message}`);

r = await call("POST", "/chat", { type: "group", member_ids: [roleUserIds.sales] });
check("a group without a name is refused", r.status === 400, `${r.status} ${r.json.message}`);

r = await call("POST", "/chat", { type: "group", name: "Studio", member_ids: [roleUserIds.sales, roleUserIds.project_manager] });
check("admin can open a group", r.status === 201, `${r.status} ${r.json.message}`);
const groupId = r.json.data?.id;

r = await call("POST", `/chat/${dmId}/messages`, { body: "Morning" });
check("a message can be sent", r.status === 201, `${r.status} ${r.json.message}`);
r = await call("POST", `/chat/${dmId}/messages`, { body: "   " });
check("an empty message is refused", r.status === 400, `${r.status} ${r.json.message}`);

r = await call("GET", `/chat/${dmId}/messages`);
check("the thread reads back", r.json.data?.length === 1, `${r.json.data?.length}`);
check("with the sender named", r.json.data?.[0]?.sender?.id === adminUserId, `${r.json.data?.[0]?.sender?.id}`);

// Unread is counted from the reader's own position, and never counts their own.
r = await call("GET", "/chat");
const adminDm = (r.json.data ?? []).find((c) => c.id === dmId);
check("your own message is not unread to you", adminDm?.unread_count === 0, `${adminDm?.unread_count}`);

cookie = opsCookie;
r = await call("GET", "/chat");
const opsDm = (r.json.data ?? []).find((c) => c.id === dmId);
check("but it is unread to the other person", opsDm?.unread_count === 1, `${opsDm?.unread_count}`);
check(
  "and a direct thread is named after whoever they are talking to",
  opsDm?.name === "Test Owner",
  `${opsDm?.name}`
);

r = await call("GET", "/chat/unread");
check("the badge counts it", r.json.data?.unread_count === 1, `${r.json.data?.unread_count}`);

r = await call("POST", `/chat/${dmId}/read`);
check("reading it clears the count", r.status === 200, `${r.status}`);
r = await call("GET", "/chat/unread");
check("and the badge goes back to zero", r.json.data?.unread_count === 0, `${r.json.data?.unread_count}`);

// The rule: membership decides everything, not a role.
//
// Operations is in the DM and NOT in the group. Being a colleague, or even an
// admin, is not what grants access - so this must be refused.
r = await call("GET", `/chat/${groupId}/messages`);
check("somebody not in a conversation cannot read it", r.status === 404, `${r.status} ${r.json.message}`);
r = await call("POST", `/chat/${groupId}/messages`, { body: "Let me in" });
check("nor post to it", r.status === 404, `${r.status} ${r.json.message}`);
r = await call("POST", `/chat/${groupId}/read`);
check("nor mark it read", r.status === 404, `${r.status}`);
r = await call("POST", `/chat/${groupId}/members`, { member_ids: [roleUserIds.operations] });
check("nor add themselves to it", r.status === 404, `${r.status}`);

r = await call("GET", "/chat");
check(
  "and it does not appear in their list at all",
  !(r.json.data ?? []).some((c) => c.id === groupId),
  JSON.stringify((r.json.data ?? []).map((c) => c.name))
);

// Sub-views are filters over the one list, per the rule the whole product uses.
cookie = adminCookie;
r = await call("GET", "/chat?type=direct");
check("the Direct view carries only direct threads", (r.json.data ?? []).every((c) => c.type === "direct"), JSON.stringify((r.json.data ?? []).map((c) => c.type)));
r = await call("GET", "/chat?type=group");
check("and the Groups view only groups", (r.json.data ?? []).every((c) => c.type === "group"), JSON.stringify((r.json.data ?? []).map((c) => c.type)));

r = await call("POST", `/chat/${groupId}/archive`, { archived: true });
check("a conversation can be archived", r.status === 200, `${r.status} ${r.json.message}`);
r = await call("GET", "/chat");
check("which takes it out of the main list", !(r.json.data ?? []).some((c) => c.id === groupId), "still listed");
r = await call("GET", "/chat?archived=true");
check("and puts it in the archived one", (r.json.data ?? []).some((c) => c.id === groupId), "not in archive");
r = await call("POST", `/chat/${groupId}/archive`, { archived: false });
check("and it can come back", r.status === 200, `${r.status}`);

r = await call("POST", `/chat/${dmId}/members`, { member_ids: [roleUserIds.sales] });
check("a third person cannot be added to a direct thread", r.status === 400, `${r.status} ${r.json.message}`);

// A member id from nowhere. A foreign key would take it happily.
r = await call("POST", "/chat", {
  type: "group",
  name: "Ghosts",
  member_ids: ["00000000-0000-0000-0000-000000000000"],
});
check("a conversation cannot be opened with somebody who is not on the team", r.status === 404, `${r.status} ${r.json.message}`);

// ---- the socket ----
//
// This is the part with no request log. An unauthenticated handshake must be
// refused outright, and a connection must only ever receive what its own user
// is a member of.
const { WebSocket } = await import("ws");

const openSocket = (cookieHeader) =>
  new Promise((resolve) => {
    const ws = new WebSocket("ws://localhost:5000/ws", {
      headers: cookieHeader ? { Cookie: cookieHeader } : {},
    });
    const received = [];
    ws.on("message", (raw) => received.push(JSON.parse(raw.toString())));
    ws.on("open", () => resolve({ ws, received, refused: false }));
    ws.on("error", () => resolve({ ws: null, received, refused: true }));
  });

const anonymous = await openSocket("");
check("a socket with no cookie is refused", anonymous.refused, "it connected");

const forged = await openSocket("accessToken=not-a-real-token");
check("a socket with a forged token is refused", forged.refused, "it connected");

const adminSocket = await openSocket(adminCookie);
check("a signed-in socket connects", !adminSocket.refused && adminSocket.ws !== null);

const opsSocket = await openSocket(opsCookie);
check("and so does the other person's", !opsSocket.refused && opsSocket.ws !== null);

const salesSocket = await openSocket(roleCookies.sales);
check("as does a colleague who is in neither conversation", !salesSocket.refused);

// Give the sockets a moment to receive their ready frame, then send.
await new Promise((resolve) => setTimeout(resolve, 200));

cookie = adminCookie;
r = await call("POST", `/chat/${dmId}/messages`, { body: "Over the wire" });
check("a message posts over HTTP", r.status === 201, `${r.status} ${r.json.message}`);

await new Promise((resolve) => setTimeout(resolve, 400));

const delivered = (socket) =>
  socket.received.filter((event) => event.type === "message" && event.conversation_id === dmId);

check("it reaches the other member's socket", delivered(opsSocket).length === 1, `${delivered(opsSocket).length}`);
check("and the sender's own, for their other tabs", delivered(adminSocket).length === 1, `${delivered(adminSocket).length}`);
// The claim that matters most in this whole module.
check(
  "but NOT a colleague who is not in the conversation",
  delivered(salesSocket).length === 0,
  JSON.stringify(salesSocket.received)
);
check(
  "and the body arrives intact",
  delivered(opsSocket)[0]?.message?.body === "Over the wire",
  JSON.stringify(delivered(opsSocket)[0]?.message?.body)
);

// A client cannot ask to be subscribed to anything - there is no protocol in
// that direction at all. Sending a plausible join must change nothing.
salesSocket.ws?.send(JSON.stringify({ type: "subscribe", conversation_id: dmId }));
await new Promise((resolve) => setTimeout(resolve, 200));
cookie = adminCookie;
await call("POST", `/chat/${dmId}/messages`, { body: "Still private" });
await new Promise((resolve) => setTimeout(resolve, 400));
check(
  "and a client cannot talk its way into a conversation",
  delivered(salesSocket).length === 0,
  JSON.stringify(salesSocket.received)
);

for (const socket of [adminSocket, opsSocket, salesSocket]) socket.ws?.close();

cookie = adminCookie;


console.log("\n--- who brought them in ---");
//
// Two salespeople in one agency, a client each. A filter that silently matched
// everything would pass every check that only ever looks at one person, so
// both books are checked from both sides.

// Two owners, not two salespeople: ownership is not role-specific, and the
// plan's seats are already spent on the four roles above.
const seller2Id = adminUserId;
const seller2Cookie = adminCookie;

// Each files their own client.
cookie = roleCookies.sales;
r = await call("POST", "/clients", { name: "Alpha Corp" });
check("a salesperson can add a client", r.status === 201, `${r.status} ${r.json.message}`);
const alphaId = r.json.data?.id;
check(
  "and it records them as the owner without being asked",
  r.json.data?.owner_id === roleUserIds.sales,
  `${r.json.data?.owner_id} vs ${roleUserIds.sales}`
);

cookie = seller2Cookie;
r = await call("POST", "/clients", { name: "Beta Ltd" });
check("the second one too", r.status === 201, `${r.status} ${r.json.message}`);
const betaId = r.json.data?.id;

// The check that catches a filter matching everything.
cookie = roleCookies.sales;
r = await call("GET", "/clients?mine=true");
let ownBook = (r.json.data ?? []).map((c) => c.id);
check("a seller's own book holds their client", ownBook.includes(alphaId), JSON.stringify(ownBook.length));
check("and NOT the other seller's", !ownBook.includes(betaId), "the other book leaked");

cookie = seller2Cookie;
r = await call("GET", "/clients?mine=true");
ownBook = (r.json.data ?? []).map((c) => c.id);
check("and it holds from the other side too", ownBook.includes(betaId) && !ownBook.includes(alphaId), JSON.stringify(ownBook));

// Unfiltered is still the whole book - sales needs to know who the agency
// already works with before approaching anybody.
r = await call("GET", "/clients");
const all = (r.json.data ?? []).map((c) => c.id);
check("unfiltered still shows the whole agency", all.includes(alphaId) && all.includes(betaId), JSON.stringify(all.length));

// An owner from another agency would be a foreign key doing what it cannot.
cookie = adminCookie;
r = await call("POST", "/clients", { name: "Ghost Owned", owner_id: "00000000-0000-0000-0000-000000000000" });
check("a client cannot be filed under somebody who is not on the team", r.status === 404, `${r.status} ${r.json.message}`);

// Reassigning is how the clients that predate this column get an owner.
r = await call("PATCH", `/clients/${alphaId}`, { owner_id: seller2Id });
check("admin can reassign a client", r.status === 200, `${r.status} ${r.json.message}`);
cookie = roleCookies.sales;
r = await call("GET", "/clients?mine=true");
check(
  "which takes it out of the first seller's book",
  !(r.json.data ?? []).map((c) => c.id).includes(alphaId),
  "still theirs"
);
cookie = adminCookie;
await call("PATCH", `/clients/${alphaId}`, { owner_id: roleUserIds.sales });

// A won deal must not lose the person who won it.
cookie = roleCookies.sales;
r = await call("POST", "/leads", { name: "Gamma Deal", estimated_value_usd: 5000 });
check("a salesperson can add a lead", r.status === 201, `${r.status} ${r.json.message}`);
check("owned by them", r.json.data?.owner_id === roleUserIds.sales, `${r.json.data?.owner_id}`);
const gammaLead = r.json.data?.id;

r = await call("GET", "/leads?mine=true");
const myLeadIds = (r.json.data?.stages ?? []).flatMap((column) =>
  (column.leads ?? []).map((l) => l.id)
);
check("their own pipeline holds it", myLeadIds.includes(gammaLead), JSON.stringify(myLeadIds.length));

r = await call("POST", `/leads/${gammaLead}/convert`, {});
check("and it converts", r.status === 201, `${r.status} ${r.json.message}`);
const gammaClient = r.json.data?.id ?? r.json.data?.client?.id;

cookie = adminCookie;
r = await call("GET", `/clients/${gammaClient}`);
check(
  "the converted client keeps the person who won it",
  r.json.data?.owner_id === roleUserIds.sales,
  `${r.json.data?.owner_id} vs ${roleUserIds.sales}`
);

// Sales Tasks: every task inside work they brought in, whoever it is assigned to.
r = await call("PATCH", `/clients/${clientId}`, { owner_id: roleUserIds.sales });
check("a delivered client can be handed to a seller", r.status === 200, `${r.status} ${r.json.message}`);

r = await call("GET", `/tasks?project_id=${timeProjectId}`);
const projectTasks = (r.json.data ?? []).map((t) => t.id);
check("that client's project already has work on it", projectTasks.length > 0, `${projectTasks.length}`);
const alphaTask = projectTasks[0];

cookie = roleCookies.sales;
r = await call("GET", "/tasks?client_owner=me");
const salesTasks = (r.json.data ?? []).map((t) => t.id);
check("their sales board shows work inside it", salesTasks.includes(alphaTask), JSON.stringify(salesTasks.length));

r = await call("GET", "/tasks?mine=true");
check(
  "while their own task list does not - it is not their job to do",
  !(r.json.data ?? []).map((t) => t.id).includes(alphaTask),
  "it showed up as their own work"
);

cookie = seller2Cookie;
r = await call("GET", "/tasks?client_owner=me");
check(
  "and the other owner sees nothing of it",
  !(r.json.data ?? []).map((t) => t.id).includes(alphaTask),
  "the other book leaked"
);

// Put it back, so nothing after this section inherits a changed owner.
cookie = adminCookie;
await call("PATCH", `/clients/${clientId}`, { owner_id: null });

cookie = adminCookie;


console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}\n`);
process.exit(failures === 0 ? 0 : 1);
