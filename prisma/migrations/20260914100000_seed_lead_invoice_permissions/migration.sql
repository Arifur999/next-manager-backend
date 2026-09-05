-- Two modules the catalogue was missing: leads and invoices.
--
-- They arrive because the old flat permission list is retiring, and two of its
-- seven names had nowhere to land. Neither could be folded into a module that
-- already existed:
--
--   invoices is not accounts  -- sales bills a client but never opens the
--                                ledger, so accounts.create is 'none' for them
--                                and billing would have stopped working.
--   leads is not clients      -- turning off client editing would then silently
--                                stop the pipeline, which is a different job.
--
-- 32 rows per organization, taking the total from 168 to 200. Like the seed
-- before it these tuples are a SNAPSHOT, frozen rather than re-derived from
-- today's catalogue: a migration is a record of what happened to a database,
-- and one that re-read the code would rewrite history every time somebody added
-- a module.
--
-- Transcribed from what the routes do TODAY. GET /leads and GET /invoices are
-- checkAuth(admin, sales), their POST and PATCH the same, and DELETE on both is
-- admin-only -- which is exactly the shape below. Nothing reads these rows yet;
-- enforcement moves across in the step after this one, so applying this changes
-- no behaviour at all.

INSERT INTO "role_permissions"
    ("id", "organization_id", "role", "module", "action", "scope", "created_at", "updated_at")
SELECT
    gen_random_uuid()::text,
    o."id",
    seed."role"::"Role",
    seed."module",
    seed."action",
    seed."scope",
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "organizations" o
CROSS JOIN (
    VALUES
        ('admin', 'leads', 'view', 'all'),
        ('admin', 'leads', 'create', 'all'),
        ('admin', 'leads', 'edit', 'all'),
        ('admin', 'leads', 'delete', 'all'),
        ('admin', 'invoices', 'view', 'all'),
        ('admin', 'invoices', 'create', 'all'),
        ('admin', 'invoices', 'edit', 'all'),
        ('admin', 'invoices', 'delete', 'all'),
        ('sales', 'leads', 'view', 'all'),
        ('sales', 'leads', 'create', 'all'),
        ('sales', 'leads', 'edit', 'all'),
        ('sales', 'leads', 'delete', 'none'),
        ('sales', 'invoices', 'view', 'all'),
        ('sales', 'invoices', 'create', 'all'),
        ('sales', 'invoices', 'edit', 'all'),
        ('sales', 'invoices', 'delete', 'none'),
        ('project_manager', 'leads', 'view', 'none'),
        ('project_manager', 'leads', 'create', 'none'),
        ('project_manager', 'leads', 'edit', 'none'),
        ('project_manager', 'leads', 'delete', 'none'),
        ('project_manager', 'invoices', 'view', 'none'),
        ('project_manager', 'invoices', 'create', 'none'),
        ('project_manager', 'invoices', 'edit', 'none'),
        ('project_manager', 'invoices', 'delete', 'none'),
        ('operations', 'leads', 'view', 'none'),
        ('operations', 'leads', 'create', 'none'),
        ('operations', 'leads', 'edit', 'none'),
        ('operations', 'leads', 'delete', 'none'),
        ('operations', 'invoices', 'view', 'none'),
        ('operations', 'invoices', 'create', 'none'),
        ('operations', 'invoices', 'edit', 'none'),
        ('operations', 'invoices', 'delete', 'none')
) AS seed("role", "module", "action", "scope")
-- An agency that somehow already carries one of these keeps what it has. The
-- unique index makes this safe to re-run, which a seed has to be.
ON CONFLICT ("organization_id", "role", "module", "action") DO NOTHING;
