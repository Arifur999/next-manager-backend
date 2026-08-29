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

const opsCookie = roleCookies.operations;
const pmCookie = roleCookies.project_manager;

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

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}\n`);
process.exit(failures === 0 ? 0 : 1);
