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

// Named rather than assumed. With DATABASE_URL unset, pg falls through to
// libpq's defaults - host 127.0.0.1, with the user and database both taken
// from the OS user, which inside the container is `node`. The operator then
// gets `role "node" does not exist` on their first deploy and goes looking for
// a Postgres problem that does not exist. The npm script passes
// -r dotenv/config and the container does not, so this is exactly the path
// that loses the variable.
if (!process.env.DATABASE_URL) {
    console.error("FAILED DATABASE_URL is not set. Nothing to migrate against.");
    process.exit(1);
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

// Only one of these may run at a time, across every machine.
//
// Migrations run at container start and this server is built to run behind
// more than one instance, so two replicas booting together is the normal case
// rather than the unlucky one. Without a lock both see an empty history, both
// apply the first migration, and the loser dies on `type "Role" already
// exists` - which reads like a broken migration rather than a race.
//
// A SESSION-level advisory lock, taken before the table check below, so it
// covers the CREATE TABLE too: checking for the table and creating it are two
// statements, and the gap between them is the same race. Postgres releases the
// lock when the connection ends, including when this process is killed, so
// there is nothing to clean up by hand. `prisma migrate deploy` takes one for
// exactly this reason; this script replaced the command without replacing the
// lock.
//
// Held during --dry as well. A dry run that reported a half-applied database
// would be worse than one that waited.
//
// The key is arbitrary but must never change - it IS the identity of the lock.
const MIGRATION_LOCK_KEY = 72707369;
await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK_KEY]);

// Prisma's own bookkeeping table, created here when the database has never
// seen it.
//
// `prisma migrate deploy` creates this on its first run. This script replaced
// that command and never did — so it worked on a machine where an earlier
// `migrate dev` had already made the table, and died on any database that had
// never met Prisma. That is every production database on its first deploy:
//
//     error: relation "_prisma_migrations" does not exist
//
// Found by running the built container against an empty Postgres, which is the
// only place the gap shows.
//
// The columns are Prisma's exact shape, so a later `prisma migrate` run on a
// machine where the schema engine does work reads this history as its own
// rather than as a stranger's table.
const CREATE_MIGRATIONS_TABLE = `
    CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
        "id"                  VARCHAR(36)  PRIMARY KEY NOT NULL,
        "checksum"            VARCHAR(64)  NOT NULL,
        "finished_at"         TIMESTAMPTZ,
        "migration_name"      VARCHAR(255) NOT NULL,
        "logs"                TEXT,
        "rolled_back_at"      TIMESTAMPTZ,
        "started_at"          TIMESTAMPTZ  NOT NULL DEFAULT now(),
        "applied_steps_count" INTEGER      NOT NULL DEFAULT 0
    )
`;

const { rows: [{ present }] } = await client.query(
    `SELECT to_regclass('_prisma_migrations') IS NOT NULL AS present`
);

// --dry stays read-only even here. Without the table nothing has been applied,
// so an empty history is the honest answer rather than a reason to write.
if (!present && !dry) {
    await client.query(CREATE_MIGRATIONS_TABLE);
    console.log("INIT   created _prisma_migrations (first deploy on this database)");
}

const { rows: applied } = present
    ? await client.query(
        `SELECT migration_name, checksum FROM _prisma_migrations WHERE finished_at IS NOT NULL`
    )
    : { rows: [] };
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
        // The rollback gets a try of its own. When a migration fails BY
        // killing the connection - a server restart, an OOM kill, an
        // idle-transaction timeout - ROLLBACK rejects as well, and that
        // rejection would replace the real error with a connection error and
        // never name the migration that was in flight.
        try {
            await client.query("ROLLBACK");
        } catch {
            // Nothing to roll back on a dead connection: Postgres discarded
            // the transaction with the session. The original error below is
            // the one worth reporting.
        }

        console.error(`FAILED ${name}\n       ${error.message}`);
        await client.end().catch(() => {});
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
