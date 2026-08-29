-- Indexes, chosen by measurement rather than instinct.
--
-- A throwaway company was loaded with the volume a 25-person agency reaches in
-- five years (90k time entries, 12k tasks, 6k payments, 9k stage events), every
-- list and KPI query was timed against it, and only the shapes that changed a
-- number are here. What the measurements showed:
--
--   task board            6.0ms -> 0.8ms   (8x - the largest win in the schema)
--   timesheet week        2.8ms -> 2.0ms
--   kpi hours over a year 3.6ms -> 3.0ms
--
-- Two findings worth keeping, because both are counter-intuitive:
--
--   1. Putting deleted_at INSIDE the index - (organization_id, deleted_at,
--      created_at) - is the obvious move and it is WRONG. It measured 4.8ms
--      against 0.6ms for the plain (organization_id, created_at) form, because
--      an IS NULL in the middle stops the planner walking the sort. A partial
--      index (WHERE deleted_at IS NULL) matches the plain form and is slightly
--      smaller, but Prisma cannot express one, and the drift that would cause
--      is not worth 8kB.
--
--   2. The delivery dashboard's groupBy over every project reads ~90% of the
--      table, so no index helps it and none was added. 19ms is what reading
--      that much data costs; the fix, if it ever matters, is to bound it by
--      date, not to index it.
--
-- The tenant-leading shape is the point. Every query in this app filters by
-- organization_id, and an index that does not start there makes each tenant
-- walk every other tenant's rows - which gets worse with every company sold,
-- not with every row a company adds.

-- The measured wins.
CREATE INDEX "time_entries_organization_id_date_idx"
    ON "time_entries" ("organization_id", "date");
CREATE INDEX "tasks_organization_id_status_due_date_idx"
    ON "tasks" ("organization_id", "status", "due_date");

-- Balances for a whole agency: the accounts screen, the dashboard, and the
-- check after every write that moves money.
CREATE INDEX "account_transactions_organization_id_account_id_idx"
    ON "account_transactions" ("organization_id", "account_id");

-- One per list screen, each matching that screen's own sort order. Smaller
-- gains than the two above at today's volume; added for the shape, since these
-- are the tables that grow with both usage and customer count.
CREATE INDEX "clients_organization_id_created_at_idx"
    ON "clients" ("organization_id", "created_at" DESC);
CREATE INDEX "projects_organization_id_created_at_idx"
    ON "projects" ("organization_id", "created_at" DESC);
CREATE INDEX "leads_organization_id_updated_at_idx"
    ON "leads" ("organization_id", "updated_at" DESC);
CREATE INDEX "invoices_organization_id_issue_date_idx"
    ON "invoices" ("organization_id", "issue_date" DESC);
CREATE INDEX "users_organization_id_created_at_idx"
    ON "users" ("organization_id", "created_at" DESC);
CREATE INDEX "credentials_organization_id_created_at_idx"
    ON "credentials" ("organization_id", "created_at" DESC);
