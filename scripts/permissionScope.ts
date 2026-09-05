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

const call = async (method: string, path: string, body?: unknown, cookie = "") => {
    const res = await fetch(BASE + path, {
        method,
        headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
        body: body ? JSON.stringify(body) : undefined,
    });
    return {
        status: res.status,
        json: (await res.json().catch(() => ({}))) as { data?: Array<{ id: string }>; message?: string },
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

await setRoleScope("assigned");
await prisma.$disconnect();

console.log(
    `\n${failures === 0 ? "THE ROWS ARE READ, AND THE TENANT LINE HOLDS" : `${failures} CHECK(S) FAILED`}\n`
);
process.exit(failures === 0 ? 0 : 1);
