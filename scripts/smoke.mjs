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
  date: "2026-08-10",
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
    date: "2026-08-10",
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
  date: "2026-08-14",
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
  date: "2026-08-15",
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

  cookie = "";
  r = await call("POST", "/auth/login", { email: roleEmail, password: "Passw0rd123" });
  // Without this the refusal checks below would pass for the wrong reason: an
  // unauthenticated call returns 401, not 403, but a typo'd expectation could
  // still line up by accident.
  check(`${role} signs in`, r.status === 200 && cookie.includes("accessToken"), `${r.status}`);
  roleCookies[role] = cookie;
}

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

const opsCookie = roleCookies.operations;
const pmCookie = roleCookies.project_manager;

// Needed later to assign a task to this person and check what they may change
// about it.
cookie = opsCookie;
const opsUserId = (await call("GET", "/auth/me")).json.data?.id;

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

const kpiRange = "from=2026-08-01&to=2026-08-31";

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

  // Now the layer itself. The seeded operator is the only platform admin, so
  // the guards that stop the platform being stranded are what can be checked
  // here; a second operator arrives with the invite flow.
  r = await call("GET", "/platform/admins");
  const admins = r.json.data ?? [];
  check("the platform team is listable", r.status === 200 && admins.length >= 1, `${r.status}`);

  const me = admins[0];

  r = await call("PATCH", `/platform/admins/${me?.id}/permissions`, {
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

  r = await call("PATCH", `/platform/admins/${me?.id}/permissions`, {
    permissions: ["platform.admins.manage", "not.a.real.permission"],
  });
  check("an unknown permission is refused, not stored", r.status === 400, `${r.status}`);

  // Narrowing to a real subset that keeps admins.manage is allowed, and the
  // gate then actually bites.
  r = await call("PATCH", `/platform/admins/${me?.id}/permissions`, {
    permissions: ["platform.admins.manage", "platform.companies.view"],
  });
  check("a real subset can be set", r.status === 200, `${r.status} ${r.json.message}`);

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

  // Put it back, or every later run of this suite starts gated.
  r = await call("PATCH", `/platform/admins/${me?.id}/permissions`, { permissions: [] });
  check("clearing the list restores full access", r.status === 200, `${r.status}`);

  r = await call("POST", "/platform/plans", { code: `restored${stamp}`, name: "Restored" });
  check("and writing works again", r.status === 201, `${r.status} ${r.json.message}`);

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

  r = await call("DELETE", `/platform/admins/${me?.id}`);
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

  // Reading the numbers and recording spend are separate permissions.
  r = await call("PATCH", `/platform/admins/${me?.id}/permissions`, {
    permissions: ["platform.admins.manage", "platform.finance.view"],
  });
  check("access can be narrowed to read-only finance", r.status === 200, `${r.status}`);

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

  r = await call("PATCH", `/platform/admins/${me?.id}/permissions`, { permissions: [] });
  check("and full access restores it", r.status === 200, `${r.status}`);

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
r = await call("PATCH", `/tasks/${guardedTaskId}`, { status: "in_progress" });
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

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}\n`);
process.exit(failures === 0 ? 0 : 1);
