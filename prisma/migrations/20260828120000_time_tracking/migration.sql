-- Time tracking: the foundation every utilization metric rests on.

CREATE TABLE "time_entries" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "task_id" TEXT,
    "date" DATE NOT NULL,
    "hours" DECIMAL(6,2) NOT NULL,
    "is_billable" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT NOT NULL DEFAULT '',
    "approved_at" TIMESTAMP(3),
    "approved_by" TEXT,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "time_entries_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "capacities" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "weekly_hours" DECIMAL(5,2) NOT NULL DEFAULT 40,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "capacities_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "time_entries_organization_id_idx" ON "time_entries"("organization_id");
-- The timesheet: one person, one week.
CREATE INDEX "time_entries_user_id_date_idx" ON "time_entries"("user_id", "date");
-- Planned-vs-actual and project cost: one project, whole history.
CREATE INDEX "time_entries_project_id_date_idx" ON "time_entries"("project_id", "date");
-- The approval queue.
CREATE INDEX "time_entries_organization_id_approved_at_idx" ON "time_entries"("organization_id", "approved_at");

CREATE UNIQUE INDEX "capacities_user_id_key" ON "capacities"("user_id");
CREATE INDEX "capacities_organization_id_idx" ON "capacities"("organization_id");

ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- SetNull, not Cascade: deleting a task must not erase the hours somebody
-- already worked on it. The entry keeps its project and its time.
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "capacities" ADD CONSTRAINT "capacities_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
