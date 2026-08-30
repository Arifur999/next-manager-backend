-- The foreign keys themselves, indexed.
--
-- The board indexes created with these columns are composite and lead with
-- organization_id or assignee_id, so Postgres cannot use either to check the
-- foreign key: for that, status_id has to be the leading column. Without these
-- a delete on workflow_statuses scans every task and every project.
--
-- Found by asking the database (npm run perf fks) rather than by reading the
-- schema, which is the only way this kind of gap shows up.

CREATE INDEX "tasks_status_id_idx" ON "tasks"("status_id");
CREATE INDEX "projects_status_id_idx" ON "projects"("status_id");
