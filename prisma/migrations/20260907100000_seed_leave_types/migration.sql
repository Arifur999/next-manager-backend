-- The kinds of leave every agency starts with, given to the ones that started
-- before there were any.
--
-- HR shipped with no seeder, so every organization created before this point
-- has an empty list. Asking to be away requires picking a kind, which made
-- leave unusable for them rather than merely unconfigured - and until the Leave
-- Settings screen landed alongside this, they could not fix it from inside the
-- product either.
--
-- Only agencies with NO kinds at all are touched. An agency that already added
-- its own is left exactly as it is: this is a backfill for a gap, not an
-- opinion about somebody's policy.
--
-- days_per_year = 0 means tracked but not capped, which is why unpaid leave
-- carries it. Re-runnable: the WHERE NOT EXISTS makes a second application a
-- no-op, and the unique index on (organization_id, name) would refuse a
-- duplicate anyway.

INSERT INTO "leave_types" ("id", "organization_id", "name", "days_per_year", "is_paid", "is_active", "created_at", "updated_at")
SELECT
    gen_random_uuid()::text,
    o."id",
    seed."name",
    seed."days_per_year",
    seed."is_paid",
    true,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "organizations" o
CROSS JOIN (
    VALUES
        ('Annual leave', 10, true),
        ('Sick leave', 7, true),
        ('Casual leave', 5, true),
        ('Unpaid leave', 0, false)
) AS seed("name", "days_per_year", "is_paid")
WHERE NOT EXISTS (
    SELECT 1 FROM "leave_types" lt WHERE lt."organization_id" = o."id"
);
