/**
 * Fills a throwaway company with the volume a real agency reaches in a few
 * years, so index decisions can be made against numbers instead of instinct.
 *
 * Everything hangs off one organization and is deleted again at the end - the
 * dev database should not be left carrying a hundred thousand junk rows to
 * make a point about indexes.
 *
 * Run:  npm run perf seed      load the volume
 *       npm run perf measure   time the queries that matter
 *       npm run perf fks       foreign keys with no index (no seed needed)
 *       npm run perf drop      put the database back
 */

import { prisma } from "../src/app/lib/prisma.js";

const MARKER = "__volume_probe__";

// Roughly a 25-person agency, five years in: a few thousand projects' worth of
// tasks, a payment most working days, and time logged by everyone every day.
const SIZE = {
    users: 25,
    clients: 400,
    projects: 600,
    tasks: 12_000,
    payments: 6_000,
    timeEntries: 90_000,
    leads: 3_000,
    stageEvents: 9_000,
};

const drop = async () => {
    const org = await prisma.organization.findFirst({
        where: { name: MARKER },
        select: { id: true },
    });

    if (!org) {
        console.log("nothing to drop");
        return;
    }

    // NOT one cascading delete, which is what this first tried. Payments hold
    // their client with onDelete: Restrict - deliberately, so a client with
    // money against them cannot be erased - and that restriction fires before
    // the organization cascade reaches it. The money rows have to go first, in
    // the order the foreign keys allow.
    const scope = { organization_id: org.id };

    await prisma.timeEntry.deleteMany({ where: scope });
    await prisma.capacity.deleteMany({ where: scope });
    await prisma.leadStageEvent.deleteMany({ where: scope });
    await prisma.task.deleteMany({ where: scope });
    await prisma.accountTransaction.deleteMany({ where: scope });
    await prisma.payment.deleteMany({ where: scope });
    await prisma.lead.deleteMany({ where: scope });
    await prisma.project.deleteMany({ where: scope });
    await prisma.client.deleteMany({ where: scope });
    await prisma.account.deleteMany({ where: scope });

    await prisma.organization.delete({ where: { id: org.id } });
    console.log("dropped the volume organization");
};

const seed = async () => {
    await drop();

    const org = await prisma.organization.create({
        data: { name: MARKER, email: "volume@probe.test" },
        select: { id: true },
    });

    const orgId = org.id;
    console.log(`seeding into ${orgId}`);

    // Raw multi-row inserts. The Prisma client would be perfectly correct here
    // and roughly a hundred times slower, and the point is the shape of the
    // data, not the path it took to get in.
    const chunk = async (label: string, total: number, sql: (from: number, to: number) => string) => {
        const started = Date.now();
        const step = 2_000;
        for (let from = 0; from < total; from += step) {
            await prisma.$executeRawUnsafe(sql(from, Math.min(from + step, total)));
        }
        console.log(`  ${String(total).padStart(7)}  ${label}  (${Date.now() - started}ms)`);
    };

    const series = (from: number, to: number) => `SELECT generate_series(${from}, ${to - 1}) AS i`;

    await chunk("users", SIZE.users, (f, t) => `
        INSERT INTO users (id, organization_id, full_name, email, password, role, created_at, updated_at)
        SELECT gen_random_uuid()::text, '${orgId}', 'Person ' || i, 'vp' || i || '@probe.test',
               'x', (ARRAY['admin','sales','project_manager','operations']::"Role"[])[1 + (i % 4)],
               NOW(), NOW()
        FROM (${series(f, t)}) s;`);

    await chunk("clients", SIZE.clients, (f, t) => `
        INSERT INTO clients (id, organization_id, name, status, created_at, updated_at)
        SELECT gen_random_uuid()::text, '${orgId}', 'Client ' || i,
               (ARRAY['active','inactive','archived']::"ClientStatus"[])[1 + (i % 3)], NOW(), NOW()
        FROM (${series(f, t)}) s;`);

    await chunk("projects", SIZE.projects, (f, t) => `
        INSERT INTO projects (id, organization_id, client_id, name, code, status, contract_value_usd, created_at, updated_at)
        SELECT gen_random_uuid()::text, '${orgId}',
               (SELECT id FROM clients WHERE organization_id = '${orgId}' ORDER BY id LIMIT 1 OFFSET (i % ${SIZE.clients})),
               'Project ' || i, 'P-' || i,
               (ARRAY['planning','active','on_hold','completed','cancelled']::"ProjectStatus"[])[1 + (i % 5)],
               5000, NOW(), NOW()
        FROM (${series(f, t)}) s;`);

    await chunk("tasks", SIZE.tasks, (f, t) => `
        INSERT INTO tasks (id, organization_id, project_id, title, status, priority, due_date, created_at, updated_at)
        SELECT gen_random_uuid()::text, '${orgId}',
               (SELECT id FROM projects WHERE organization_id = '${orgId}' ORDER BY id LIMIT 1 OFFSET (i % ${SIZE.projects})),
               'Task ' || i,
               (ARRAY['todo','in_progress','in_review','done']::"TaskStatus"[])[1 + (i % 4)],
               'medium', (DATE '2023-01-01' + (i % 1200)), NOW(), NOW()
        FROM (${series(f, t)}) s;`);

    // One USD account, so payments have somewhere to land.
    const account = await prisma.account.create({
        data: { organization_id: orgId, name: "Probe USD", type: "paypal", currency: "USD" },
        select: { id: true },
    });

    await chunk("payments", SIZE.payments, (f, t) => `
        INSERT INTO payments (id, organization_id, client_id, account_id, date, amount_usd, reporting_rate, amount_bdt_reporting, created_at, updated_at)
        SELECT gen_random_uuid()::text, '${orgId}',
               (SELECT id FROM clients WHERE organization_id = '${orgId}' ORDER BY id LIMIT 1 OFFSET (i % ${SIZE.clients})),
               '${account.id}', (DATE '2021-01-01' + (i % 1800)), 500, 120, 60000, NOW(), NOW()
        FROM (${series(f, t)}) s;`);

    await chunk("time entries", SIZE.timeEntries, (f, t) => `
        INSERT INTO time_entries (id, organization_id, user_id, project_id, date, hours, is_billable, created_at, updated_at)
        SELECT gen_random_uuid()::text, '${orgId}',
               (SELECT id FROM users WHERE organization_id = '${orgId}' ORDER BY id LIMIT 1 OFFSET (i % ${SIZE.users})),
               (SELECT id FROM projects WHERE organization_id = '${orgId}' ORDER BY id LIMIT 1 OFFSET (i % ${SIZE.projects})),
               (DATE '2021-01-01' + (i % 1800)), 4, (i % 4) <> 0, NOW(), NOW()
        FROM (${series(f, t)}) s;`);

    await chunk("leads", SIZE.leads, (f, t) => `
        INSERT INTO leads (id, organization_id, name, stage, estimated_value_usd, created_at, updated_at)
        SELECT gen_random_uuid()::text, '${orgId}', 'Lead ' || i,
               (ARRAY['new','contacted','proposal','negotiating','won','lost']::"LeadStage"[])[1 + (i % 6)],
               8000, NOW(), NOW()
        FROM (${series(f, t)}) s;`);

    await chunk("stage events", SIZE.stageEvents, (f, t) => `
        INSERT INTO lead_stage_events (id, organization_id, lead_id, from_stage, to_stage, changed_at)
        SELECT gen_random_uuid()::text, '${orgId}',
               (SELECT id FROM leads WHERE organization_id = '${orgId}' ORDER BY id LIMIT 1 OFFSET (i % ${SIZE.leads})),
               'new', (ARRAY['contacted','proposal','won','lost']::"LeadStage"[])[1 + (i % 4)],
               (TIMESTAMP '2021-01-01' + ((i % 1800) || ' days')::interval)
        FROM (${series(f, t)}) s;`);

    // A tenth of everything soft-deleted, which is the case every list query
    // filters for and no index currently covers.
    await prisma.$executeRawUnsafe(`
        UPDATE time_entries SET deleted_at = NOW()
        WHERE organization_id = '${orgId}' AND (('x' || substr(md5(id), 1, 8))::bit(32)::int % 10) = 0;`);
    await prisma.$executeRawUnsafe(`
        UPDATE payments SET deleted_at = NOW()
        WHERE organization_id = '${orgId}' AND (('x' || substr(md5(id), 1, 8))::bit(32)::int % 10) = 0;`);
    await prisma.$executeRawUnsafe(`
        UPDATE tasks SET deleted_at = NOW()
        WHERE organization_id = '${orgId}' AND (('x' || substr(md5(id), 1, 8))::bit(32)::int % 10) = 0;`);

    // Without this the planner is working from stats that predate the load and
    // every measurement below is meaningless.
    await prisma.$executeRawUnsafe("ANALYZE;");

    console.log("seeded");
};

/**
 * The queries every screen and every KPI actually issues.
 *
 * Timed through Prisma rather than as hand-written SQL: the nested filters and
 * groupBys are the real shapes, and a simplified SELECT quietly flattens the
 * expensive ones. Best of five, after a warm-up, since a first call carries
 * connection and plan-cache costs that say nothing about the query.
 */
const measure = async () => {
    const org = await prisma.organization.findFirst({
        where: { name: MARKER },
        select: { id: true },
    });

    if (!org) {
        console.log("Nothing loaded. Run: npm run perf seed");
        return;
    }

    const orgId = org.id;

    const best = async (run: () => Promise<unknown>) => {
        await run();
        let ms = Infinity;
        for (let i = 0; i < 5; i += 1) {
            const started = performance.now();
            await run();
            ms = Math.min(ms, performance.now() - started);
        }
        return ms;
    };

    const probes: [string, () => Promise<unknown>][] = [
        ["task board", () =>
            prisma.task.findMany({
                where: { organization_id: orgId, deleted_at: null },
                orderBy: [
                    { status: "asc" },
                    { due_date: { sort: "asc", nulls: "last" } },
                    { priority: "desc" },
                ],
                take: 20,
            })],
        ["clients page", () =>
            prisma.client.findMany({
                where: { organization_id: orgId, deleted_at: null },
                orderBy: { created_at: "desc" },
                take: 20,
            })],
        ["projects page", () =>
            prisma.project.findMany({
                where: { organization_id: orgId, deleted_at: null },
                orderBy: { created_at: "desc" },
                take: 20,
            })],
        ["leads pipeline", () =>
            prisma.lead.findMany({
                where: { organization_id: orgId, deleted_at: null },
                orderBy: { updated_at: "desc" },
            })],
        ["kpi: hours over a year", () =>
            prisma.timeEntry.aggregate({
                where: {
                    organization_id: orgId,
                    deleted_at: null,
                    date: { gte: new Date("2024-01-01"), lte: new Date("2024-12-31") },
                },
                _sum: { hours: true },
            })],
        ["timesheet week", () =>
            prisma.timeEntry.findMany({
                where: {
                    organization_id: orgId,
                    deleted_at: null,
                    date: { gte: new Date("2024-06-03"), lte: new Date("2024-06-09") },
                },
                orderBy: [{ date: "desc" }, { created_at: "desc" }],
            })],
        // Kept in deliberately, and it is the slow one. It reads about 90% of
        // the table, so no index helps it - if this ever needs to be faster the
        // answer is to bound it by date, not to add an index.
        ["delivery: hours by project (reads the lot)", () =>
            prisma.timeEntry.groupBy({
                by: ["project_id"],
                where: { organization_id: orgId, deleted_at: null },
                _sum: { hours: true },
            })],
    ];

    for (const [label, run] of probes) {
        const ms = await best(run);
        console.log(`  ${ms.toFixed(1).padStart(7)}ms  ${label}`);
    }
};

/**
 * Foreign keys the database has no index for.
 *
 * Postgres indexes PRIMARY KEY and UNIQUE on its own and says nothing about
 * foreign keys, so this gap opens silently every time a relation is added.
 * Asked of the database rather than read off the schema, because the schema is
 * where the omission was invisible in the first place.
 */
const unindexedForeignKeys = async () => {
    const rows = (await prisma.$queryRawUnsafe(`
      SELECT
        c.conrelid::regclass::text  AS child_table,
        a.attname                   AS fk_column,
        c.confrelid::regclass::text AS parent_table
      FROM pg_constraint c
      JOIN LATERAL unnest(c.conkey) AS k(attnum) ON true
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
      WHERE c.contype = 'f'
        AND NOT EXISTS (
          SELECT 1 FROM pg_index i
          WHERE i.indrelid = c.conrelid AND i.indkey[0] = k.attnum
        )
      ORDER BY 1, 2;
    `)) as { child_table: string; fk_column: string; parent_table: string }[];

    if (rows.length === 0) {
        console.log("Every foreign key has an index.");
        return;
    }

    console.log(`${rows.length} foreign key(s) with no index. Each one makes a delete on the`);
    console.log("parent scan this whole table, and joins on it have nothing to walk:\n");

    for (const row of rows) {
        console.log(
            `  ${row.child_table.padEnd(26)} ${row.fk_column.padEnd(22)} -> ${row.parent_table}`
        );
    }
};

const command = process.argv[2];

if (command === "drop") {
    await drop();
} else if (command === "measure") {
    await measure();
} else if (command === "fks") {
    await unindexedForeignKeys();
} else {
    await seed();
}

await prisma.$disconnect();
