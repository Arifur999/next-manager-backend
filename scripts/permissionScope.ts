/**
 * Does the API actually read the permission rows?
 *
 * The two matrices prove behaviour did not CHANGE when a module moved from
 * `role === operations` to configured scope. They cannot prove the rows are
 * being read at all — a resolver that ignored them and kept the old hard-coded
 * answer would pass both suites perfectly.
 *
 * So this changes the data and watches the API change with it. The rows are
 * written straight to the database rather than through an endpoint, because the
 * screen that edits them is a later step and this should not wait for it.
 *
 * Run:  npm run test:scope   (with the server up)
 */

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client.js";
import { Role } from "../src/generated/prisma/enums.js";

const BASE = "http://localhost:5000/api/v1";
const stamp = Date.now();
const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

let failures = 0;
const check = (label: string, ok: boolean, detail = "") => {
    if (ok) {
        console.log(`  PASS  ${label}`);
    } else {
        failures += 1;
        console.log(`  FAIL  ${label}${detail ? ` -> ${detail}` : ""}`);
    }
};

const call = async <Row = { id: string }>(method: string, path: string, body?: unknown, cookie = "") => {
    const res = await fetch(BASE + path, {
        method,
        headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
        body: body ? JSON.stringify(body) : undefined,
    });
    return {
        status: res.status,
        json: (await res.json().catch(() => ({}))) as { data?: Row[]; message?: string },
        cookie: (res.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; "),
    };
};

// ---------------------------------------------------------------- an agency
const email = `scope${stamp}@agencio.test`;
await call("POST", "/auth/register", {
    organization_name: "Scope Co",
    full_name: "Scope Admin",
    email,
    password: "Passw0rd123",
});
const admin = (await call("POST", "/auth/login", { email, password: "Passw0rd123" })).cookie;

const worker = await call(
    "POST",
    "/users",
    {
        full_name: "Scope Worker",
        email: `scopeworker${stamp}@agencio.test`,
        password: "Passw0rd123",
        role: "operations",
    },
    admin
);
check("somebody to narrow", worker.status === 201, worker.json.message);
const workerId = (worker.json as unknown as { data: { id: string } }).data?.id;
const workerCookie = (
    await call("POST", "/auth/login", {
        email: `scopeworker${stamp}@agencio.test`,
        password: "Passw0rd123",
    })
).cookie;

const organization = await prisma.user.findUnique({
    where: { id: workerId },
    select: { organization_id: true },
});
const organizationId = organization?.organization_id ?? "";

// Two projects: one the worker is on, one they are not.
const client = await call("POST", "/clients", { name: "Scope Client" }, admin);
const clientId = (client.json as unknown as { data: { id: string } }).data?.id;

const mine = await call(
    "POST",
    "/projects",
    { client_id: clientId, name: "On this one", code: `ON-${stamp}` },
    admin
);
const mineId = (mine.json as unknown as { data: { id: string } }).data?.id;
await call("POST", "/project-members", { project_id: mineId, user_id: workerId }, admin);

const theirs = await call(
    "POST",
    "/projects",
    { client_id: clientId, name: "Not on this one", code: `OFF-${stamp}` },
    admin
);
const theirsId = (theirs.json as unknown as { data: { id: string } }).data?.id;
check("two projects, one of them theirs", Boolean(mineId && theirsId));

const setRoleScope = (scope: string) =>
    prisma.rolePermission.update({
        where: {
            organization_id_role_module_action: {
                organization_id: organizationId,
                role: Role.operations,
                module: "projects",
                action: "view",
            },
        },
        data: { scope },
    });

const visible = async () => {
    const res = await call("GET", "/projects", undefined, workerCookie);
    return (res.json.data ?? []).map((p) => p.id);
};

// ---------------------------------------------------------------- the proof
console.log("\n--- the seed says what the code used to say ---");
const seeded = await prisma.rolePermission.findFirst({
    where: { organization_id: organizationId, role: Role.operations, module: "projects", action: "view" },
    select: { scope: true },
});
check("a new agency seeds operations at 'assigned'", seeded?.scope === "assigned", `${seeded?.scope}`);

let ids = await visible();
check("so they see the project they are on", ids.includes(mineId), `${ids.length} projects`);
check("and not the one they are not", !ids.includes(theirsId), "a project leaked");

console.log("\n--- widen by data alone ---");
await setRoleScope("all");
ids = await visible();
check(
    "'all' shows them the whole agency's projects",
    ids.includes(mineId) && ids.includes(theirsId),
    `${ids.length} projects — the row is not being read`
);

console.log("\n--- and narrow to nothing, on BOTH paths ---");
await setRoleScope("none");
ids = await visible();
check("'none' means an empty list", ids.length === 0, `${ids.length} came back`);

const byId = await call("GET", `/projects/${mineId}`, undefined, workerCookie);
// A list that hides a row while its id still answers is not a scope, it is a
// slower search. This is the half that is easy to forget.
check("and a 404 by id, not merely a short list", byId.status === 404, `${byId.status}`);

console.log("\n--- a person's override beats their role ---");
await prisma.userPermission.create({
    data: { user_id: workerId, module: "projects", action: "view", scope: "assigned" },
});
ids = await visible();
check(
    "the override wins over the role's 'none'",
    ids.includes(mineId),
    "the override did nothing"
);

await prisma.userPermission.deleteMany({
    where: { user_id: workerId, module: "projects", action: "view" },
});
ids = await visible();
// Both directions matter: an override that silently did nothing would look
// exactly like a working one until somebody removed it.
check("and removing it inherits the role again", ids.length === 0, `${ids.length} came back`);

console.log("\n--- what no configuration can reach ---");
await setRoleScope("all");
const otherEmail = `scopeother${stamp}@agencio.test`;
await call("POST", "/auth/register", {
    organization_name: "Other Co",
    full_name: "Other Admin",
    email: otherEmail,
    password: "Passw0rd123",
});
const other = (await call("POST", "/auth/login", { email: otherEmail, password: "Passw0rd123" }))
    .cookie;
const otherClient = await call("POST", "/clients", { name: "Other Client" }, other);
const otherProject = await call(
    "POST",
    "/projects",
    {
        client_id: (otherClient.json as unknown as { data: { id: string } }).data?.id,
        name: "Another agency's",
        code: `OTHER-${stamp}`,
    },
    other
);
const otherId = (otherProject.json as unknown as { data: { id: string } }).data?.id;

ids = await visible();
check(
    "even at 'all', another agency's project is not there",
    !ids.includes(otherId),
    "TENANT BOUNDARY CROSSED — scope must never be able to do this"
);
const otherById = await call("GET", `/projects/${otherId}`, undefined, workerCookie);
check("nor readable by its id", otherById.status === 404, `${otherById.status}`);

console.log("\n--- vault writes follow the grid, not just the role ---");
const setScope = (role: Role, module: string, action: string, scope: string) =>
    prisma.rolePermission.update({
        where: {
            organization_id_role_module_action: { organization_id: organizationId, role, module, action },
        },
        data: { scope },
    });

const salesEmail = `scopesales${stamp}@agencio.test`;
const sales = await call(
    "POST",
    "/users",
    { full_name: "Scope Sales", email: salesEmail, password: "Passw0rd123", role: "sales" },
    admin
);
const salesId = (sales.json as unknown as { data: { id: string } }).data?.id;
await call("POST", "/project-members", { project_id: mineId, user_id: salesId }, admin);
const salesCookie = (await call("POST", "/auth/login", { email: salesEmail, password: "Passw0rd123" })).cookie;

const onMine = await call("POST", "/vault", { label: "Mine", username: "u", password: "p", project_id: mineId }, admin);
const onTheirs = await call("POST", "/vault", { label: "Theirs", username: "u", password: "p", project_id: theirsId }, admin);
const onMineId = (onMine.json as unknown as { data: { id: string } }).data?.id;
const onTheirsId = (onTheirs.json as unknown as { data: { id: string } }).data?.id;

await setScope(Role.sales, "vault", "edit", "none");
const editNone = await call("PATCH", `/vault/${onMineId}`, { label: "Edited" }, salesCookie);
check("vault edit 'none' refuses a PATCH", editNone.status === 403, `${editNone.status}`);
await setScope(Role.sales, "vault", "edit", "all");

await setScope(Role.sales, "vault", "view", "assigned");
const unseen = await call("PATCH", `/vault/${onTheirsId}`, { label: "Edited" }, salesCookie);
check("vault view 'assigned' cannot edit a credential it cannot see", unseen.status === 404, `${unseen.status}`);
const moved = await call("PATCH", `/vault/${onMineId}`, { project_id: theirsId }, salesCookie);
check("nor move one onto a project they are not on", moved.status === 404, `${moved.status}`);
await setScope(Role.sales, "vault", "view", "all");

console.log("\n--- task edits, service writes and assignment follow the grid ---");
const pmEmail = `scopepm${stamp}@agencio.test`;
await call("POST", "/users", { full_name: "Scope PM", email: pmEmail, password: "Passw0rd123", role: "project_manager" }, admin);
const pmCookie = (await call("POST", "/auth/login", { email: pmEmail, password: "Passw0rd123" })).cookie;
const task = await call("POST", "/tasks", { project_id: mineId, title: "Scoped task" }, admin);
const taskId = (task.json as unknown as { data: { id: string } }).data?.id;

const pmEditAllowed = await call("PATCH", `/tasks/${taskId}`, { title: "Renamed" }, pmCookie);
check("by default a project manager edits tasks", pmEditAllowed.status === 200, `${pmEditAllowed.status}`);
await setScope(Role.project_manager, "tasks", "edit", "none");
const pmEditRefused = await call("PATCH", `/tasks/${taskId}`, { title: "Renamed again" }, pmCookie);
check("tasks edit 'none' refuses a PATCH", pmEditRefused.status === 403, `${pmEditRefused.status}`);
await setScope(Role.project_manager, "tasks", "edit", "all");

await setScope(Role.project_manager, "projects", "assign", "none");
const assignRefused = await call("POST", "/project-members", { project_id: theirsId, user_id: workerId }, pmCookie);
check("projects assign 'none' refuses adding a member", assignRefused.status === 403, `${assignRefused.status}`);
await setScope(Role.project_manager, "projects", "assign", "all");

await setScope(Role.sales, "services", "create", "none");
const serviceRefused = await call("POST", "/services", { name: `Scoped ${stamp}` }, salesCookie);
check("services create 'none' refuses a new service", serviceRefused.status === 403, `${serviceRefused.status}`);
await setScope(Role.sales, "services", "create", "all");

console.log("\n--- a leave balance follows the leave view scope ---");
const leaveType = await prisma.leaveType.findFirst({
    where: { organization_id: organizationId },
    select: { id: true },
});
if (!leaveType) {
    throw new Error("A new agency should be seeded with leave types");
}
await prisma.leaveRequest.create({
    data: {
        organization_id: organizationId,
        user_id: salesId,
        leave_type_id: leaveType.id,
        from_date: new Date("2026-03-02"),
        to_date: new Date("2026-03-04"),
        days: 3,
        status: "approved",
    },
});

// Somebody's balance, as somebody else asks for it.
const balanceOf = (userId: string, cookie: string) =>
    call<{ days_taken: number }>("GET", `/hr/leave/balance?year=2026&user_id=${userId}`, undefined, cookie);
const daysTaken = (res: Awaited<ReturnType<typeof balanceOf>>) =>
    (res.json.data ?? []).reduce((sum, row) => sum + row.days_taken, 0);

let balance = await balanceOf(salesId, admin);
check("an admin reads a colleague's leave balance", daysTaken(balance) === 3, `${daysTaken(balance)} days`);
balance = await balanceOf(salesId, workerCookie);
check("leave view 'own' cannot read a colleague's balance", balance.status === 404, `${balance.status}`);
await setScope(Role.operations, "leave", "view", "all");
balance = await balanceOf(salesId, workerCookie);
check("and 'all' lets them read it", daysTaken(balance) === 3, `${daysTaken(balance)} days`);
await setScope(Role.operations, "leave", "view", "own");

const otherAdmin = await prisma.user.findFirst({ where: { email: otherEmail }, select: { id: true } });
balance = await balanceOf(otherAdmin?.id ?? "", admin);
check("even 'all' cannot read another agency's member", balance.status === 404, `${balance.status}`);

console.log("\n--- a personal 'none' empties the reads that used to ignore it ---");
// The audit's four: each square set to Nothing on one salesperson, while the
// list kept coming back whole. An override rather than the role row, because
// that is the path the screen uses for one person.
const setOverride = (userId: string, module: string, action: string, scope: string) =>
    prisma.userPermission.upsert({
        where: { user_id_module_action: { user_id: userId, module, action } },
        create: { user_id: userId, module, action, scope },
        update: { scope },
    });
const clearOverride = (userId: string, module: string, action: string) =>
    prisma.userPermission.deleteMany({ where: { user_id: userId, module, action } });

type Pipeline = { total: number };
const leadCount = async () =>
    ((await call("GET", "/leads", undefined, salesCookie)).json as unknown as { data?: Pipeline }).data?.total ?? -1;
const rowCount = async (path: string) => {
    const res = await call("GET", path, undefined, salesCookie);
    return Array.isArray(res.json.data) ? res.json.data.length : -1;
};

const lead = await call("POST", "/leads", { name: `Scoped lead ${stamp}` }, admin);
const leadId = (lead.json as unknown as { data: { id: string } }).data?.id;
const invoice = await call(
    "POST",
    "/invoices",
    { client_id: clientId, issue_date: "2026-03-01", due_date: "2026-03-31", items: [{ description: "Work", unit_price: 100 }] },
    admin
);
const invoiceId = (invoice.json as unknown as { data: { id: string } }).data?.id;
const service = await call("POST", "/services", { name: `Scoped service ${stamp}` }, admin);
const serviceId = (service.json as unknown as { data: { id: string } }).data?.id;
check("a lead, an invoice and a service to hide", Boolean(leadId && invoiceId && serviceId));

check("by default sales sees the pipeline", (await leadCount()) > 0, `${await leadCount()} leads`);
await setOverride(salesId, "leads", "view", "none");
check("leads view 'none' empties the pipeline", (await leadCount()) === 0, `${await leadCount()} leads`);
const leadById = await call("GET", `/leads/${leadId}/stage-events`, undefined, salesCookie);
check("and a lead's history is a 404", leadById.status === 404, `${leadById.status}`);
await clearOverride(salesId, "leads", "view");

check("by default sales sees invoices", (await rowCount("/invoices")) > 0);
await setOverride(salesId, "invoices", "view", "none");
check("invoices view 'none' empties the list", (await rowCount("/invoices")) === 0, `${await rowCount("/invoices")} rows`);
const invoiceById = await call("GET", `/invoices/${invoiceId}`, undefined, salesCookie);
check("and an invoice by id is a 404", invoiceById.status === 404, `${invoiceById.status}`);
await setOverride(salesId, "invoices", "view", "own");
check("invoices view 'own' hides a client somebody else brought in", (await rowCount("/invoices")) === 0, `${await rowCount("/invoices")} rows`);
await clearOverride(salesId, "invoices", "view");

check("by default sales sees the catalogue", (await rowCount("/services")) > 0);
await setOverride(salesId, "services", "view", "none");
check("services view 'none' empties the catalogue", (await rowCount("/services")) === 0, `${await rowCount("/services")} rows`);
const serviceById = await call("GET", `/services/${serviceId}`, undefined, salesCookie);
check("and a service by id is a 404", serviceById.status === 404, `${serviceById.status}`);
await clearOverride(salesId, "services", "view");

check("by default sales sees the team", (await rowCount("/users")) > 1);
await setOverride(salesId, "team", "view", "own");
check("team view 'own' is only themselves", (await rowCount("/users")) === 1, `${await rowCount("/users")} rows`);
await setOverride(salesId, "team", "view", "none");
check("team view 'none' empties the directory", (await rowCount("/users")) === 0, `${await rowCount("/users")} rows`);
await clearOverride(salesId, "team", "view");

console.log("\n--- the squares that gate writes and reports now answer too ---");
await setOverride(salesId, "reports", "view", "none");
check("reports view 'none' empties client revenue", (await rowCount("/reports/client-revenue")) === 0);
await clearOverride(salesId, "reports", "view");

await setOverride(salesId, "chat", "view", "none");
check("chat view 'none' empties the conversation list", (await rowCount("/chat")) === 0);
await clearOverride(salesId, "chat", "view");
await setOverride(salesId, "chat", "create", "none");
const chatRefused = await call("POST", "/chat", { type: "group", name: "Refused", member_ids: [workerId] }, salesCookie);
check("chat create 'none' refuses a new conversation", chatRefused.status === 403, `${chatRefused.status}`);
await clearOverride(salesId, "chat", "create");

await setOverride(workerId, "time", "create", "none");
const timeRefused = await call("POST", "/time-entries", { project_id: mineId, date: "2026-03-02", hours: 1 }, workerCookie);
check("time create 'none' refuses logging hours", timeRefused.status === 403, `${timeRefused.status}`);
await clearOverride(workerId, "time", "create");

await setScope(Role.project_manager, "tasks", "assign", "none");
const assignTaskRefused = await call("PATCH", `/tasks/${taskId}`, { assignee_id: workerId }, pmCookie);
check("tasks assign 'none' refuses handing a task over", assignTaskRefused.status === 403, `${assignTaskRefused.status}`);
const titleOnly = await call("PATCH", `/tasks/${taskId}`, { title: "Renamed, not reassigned" }, pmCookie);
check("but still edits a task without moving it", titleOnly.status === 200, `${titleOnly.status}`);
await setScope(Role.project_manager, "tasks", "assign", "all");

await setRoleScope("assigned");
await prisma.$disconnect();

console.log(
    `\n${failures === 0 ? "THE ROWS ARE READ, AND THE TENANT LINE HOLDS" : `${failures} CHECK(S) FAILED`}\n`
);
process.exit(failures === 0 ? 0 : 1);
