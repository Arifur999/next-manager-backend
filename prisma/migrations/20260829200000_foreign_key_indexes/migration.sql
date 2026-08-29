-- The eleven foreign keys Postgres left unindexed.
--
-- Postgres builds an index for PRIMARY KEY and UNIQUE automatically. It does
-- NOT build one for a foreign key, and nothing warns you. The cost shows up in
-- two places:
--
--   1. Deletes. Every ON DELETE check scans the whole child table. Deleting one
--      task walked all 90k time_entries rows to find out whether it was
--      allowed: measured 8.4ms against 1.4ms with this index, and it grows
--      linearly - a million rows makes deleting a task take seconds.
--   2. Joins. Every list screen that includes its account, project or user is
--      joining on a column with nothing to walk.
--
-- Found by asking the database rather than reading the schema: a query over
-- pg_constraint for foreign keys with no index starting on their column. Worth
-- re-running after any migration that adds a relation.

-- Deleting a task checked every time entry. The worst of the eleven.
CREATE INDEX "time_entries_task_id_idx" ON "time_entries" ("task_id");

-- Removing a person checked every row they had ever touched.
CREATE INDEX "activity_logs_user_id_idx" ON "activity_logs" ("user_id");
CREATE INDEX "credential_access_logs_user_id_idx" ON "credential_access_logs" ("user_id");

-- Six tables point at accounts, and all six were scanned on any attempt to
-- remove one - which is also why that attempt felt slow before it was refused.
CREATE INDEX "payments_account_id_idx" ON "payments" ("account_id");
CREATE INDEX "expenses_account_id_idx" ON "expenses" ("account_id");
CREATE INDEX "team_payouts_account_id_idx" ON "team_payouts" ("account_id");
CREATE INDEX "owner_withdrawals_account_id_idx" ON "owner_withdrawals" ("account_id");
CREATE INDEX "due_transactions_account_id_idx" ON "due_transactions" ("account_id");
CREATE INDEX "exchange_transactions_from_account_id_idx" ON "exchange_transactions" ("from_account_id");
CREATE INDEX "exchange_transactions_to_account_id_idx" ON "exchange_transactions" ("to_account_id");

-- Deleting a project checked every invoice.
CREATE INDEX "invoices_project_id_idx" ON "invoices" ("project_id");
