// Apply pending migrations without `prisma migrate deploy`.
//
// Windows Application Control blocks schema-engine-windows.exe on this machine
// — the same policy that blocks vitest's rolldown binary. `prisma generate`
// still works because it never spawns that engine, and so does the app itself,
// which reaches Postgres through @prisma/adapter-pg: a pure JavaScript driver
// with no Rust engine in the path.
//
// So this does what `migrate deploy` does, in JavaScript:
//
//   1. read prisma/migrations/*/migration.sql in name order
//   2. skip the ones already in _prisma_migrations
//   3. run each remaining one INSIDE A TRANSACTION, and record it
//
// The checksum is the SHA-256 of the migration file, byte for byte — verified
// against the rows Prisma itself wrote. Getting it wrong would make a later
// `prisma migrate` (on a machine where it runs) report the history as edited.
//
// The transaction is the part that matters. A migration that fails halfway
// with no transaction leaves a database in a shape no file describes, and the
// next run cannot tell what was applied.
//
// Usage:  node -r dotenv/config scripts/migrate.mjs [--dry]

import { createHash, randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";

const DIR = "prisma/migrations";
const dry = process.argv.includes("--dry");

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

const { rows: applied } = await client.query(
    `SELECT migration_name, checksum FROM _prisma_migrations WHERE finished_at IS NOT NULL`
);
const appliedBy = new Map(applied.map((row) => [row.migration_name, row.checksum]));

const names = readdirSync(DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

let ran = 0;
let drifted = 0;

for (const name of names) {
    const sql = readFileSync(join(DIR, name, "migration.sql"));
    const checksum = createHash("sha256").update(sql).digest("hex");
    const already = appliedBy.get(name);

    if (already) {
        // Reported rather than fixed. A migration whose file changed after it
        // ran is a question for a person: the database and the file disagree,
        // and only one of them knows which is right.
        if (already !== checksum) {
            console.log(`DRIFT  ${name} — applied, but the file has changed since`);
            drifted += 1;
        }
        continue;
    }

    if (dry) {
        console.log(`WOULD  ${name}`);
        ran += 1;
        continue;
    }

    const started = new Date();

    try {
        await client.query("BEGIN");
        await client.query(sql.toString());
        await client.query(
            `INSERT INTO _prisma_migrations
                (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
             VALUES ($1, $2, $3, $4, NULL, NULL, $5, 1)`,
            [randomUUID(), checksum, new Date(), name, started]
        );
        await client.query("COMMIT");
        console.log(`OK     ${name}`);
        ran += 1;
    } catch (error) {
        await client.query("ROLLBACK");
        console.error(`FAILED ${name}\n       ${error.message}`);
        await client.end();
        process.exit(1);
    }
}

await client.end();

console.log(
    ran === 0
        ? "Nothing to apply — the database is up to date."
        : dry
          ? `${ran} migration(s) would run.`
          : `${ran} migration(s) applied.`
);

if (drifted > 0) process.exit(1);
