-- Statuses become rows an agency owns, instead of a vocabulary the product
-- hands them.
--
-- The safety here is `category`, not the name. Four places in the code reason
-- about a status rather than displaying it - completed_at is derived from a
-- task reaching done, the dashboard counts open tasks and active projects, and
-- both boards sort by status order. They compare the category, so renaming
-- "Done" to "Shipped" or adding "In QA" leaves every one of them correct.
--
-- This is the only irreversible step in the plan: it drops two enum columns.
-- Nothing is dropped until every row has landed on a new status, and the
-- NOT NULL constraints below are what prove it - if any row failed to map, the
-- migration fails there rather than quietly leaving work without a status.

CREATE TYPE "WorkflowKind" AS ENUM ('task', 'project');
CREATE TYPE "StatusCategory" AS ENUM ('open', 'active', 'blocked', 'done', 'cancelled');

CREATE TABLE "workflow_statuses" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "kind" "WorkflowKind" NOT NULL,
    "name" TEXT NOT NULL,
    "category" "StatusCategory" NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workflow_statuses_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "workflow_statuses_organization_id_kind_name_key"
    ON "workflow_statuses"("organization_id", "kind", "name");
CREATE INDEX "workflow_statuses_organization_id_kind_sort_order_idx"
    ON "workflow_statuses"("organization_id", "kind", "sort_order");

ALTER TABLE "workflow_statuses" ADD CONSTRAINT "workflow_statuses_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Today's vocabulary, given to every agency that already exists. New ones get
-- the same set from seedWorkflowStatuses(), called wherever an organization is
-- created - all three places.
INSERT INTO "workflow_statuses"
    ("id", "organization_id", "kind", "name", "category", "sort_order", "is_default", "updated_at")
SELECT gen_random_uuid(), o."id", 'task', v.name, v.category::"StatusCategory", v.sort_order, v.is_default, CURRENT_TIMESTAMP
FROM "organizations" o
CROSS JOIN (VALUES
    ('To do',       'open',   0, true),
    ('In progress', 'active', 1, false),
    ('In review',   'active', 2, false),
    ('Done',        'done',   3, false)
) AS v(name, category, sort_order, is_default);

INSERT INTO "workflow_statuses"
    ("id", "organization_id", "kind", "name", "category", "sort_order", "is_default", "updated_at")
SELECT gen_random_uuid(), o."id", 'project', v.name, v.category::"StatusCategory", v.sort_order, v.is_default, CURRENT_TIMESTAMP
FROM "organizations" o
CROSS JOIN (VALUES
    ('Planning',  'open',      0, true),
    ('Active',    'active',    1, false),
    ('On hold',   'blocked',   2, false),
    ('Completed', 'done',      3, false),
    ('Cancelled', 'cancelled', 4, false)
) AS v(name, category, sort_order, is_default);

-- Nullable first, so the mapping below can be checked before anything is
-- enforced.
ALTER TABLE "tasks" ADD COLUMN "status_id" TEXT;
ALTER TABLE "projects" ADD COLUMN "status_id" TEXT;

-- Every existing row moves to the status with the same meaning, in its own
-- agency. in_review maps to "In review" rather than being folded into active:
-- an agency that had a review step keeps it.
UPDATE "tasks" t
SET "status_id" = w."id"
FROM "workflow_statuses" w
WHERE w."organization_id" = t."organization_id"
  AND w."kind" = 'task'
  AND w."name" = CASE t."status"::text
      WHEN 'todo'        THEN 'To do'
      WHEN 'in_progress' THEN 'In progress'
      WHEN 'in_review'   THEN 'In review'
      WHEN 'done'        THEN 'Done'
  END;

UPDATE "projects" p
SET "status_id" = w."id"
FROM "workflow_statuses" w
WHERE w."organization_id" = p."organization_id"
  AND w."kind" = 'project'
  AND w."name" = CASE p."status"::text
      WHEN 'planning'  THEN 'Planning'
      WHEN 'active'    THEN 'Active'
      WHEN 'on_hold'   THEN 'On hold'
      WHEN 'completed' THEN 'Completed'
      WHEN 'cancelled' THEN 'Cancelled'
  END;

-- The proof. If a single row failed to map, this fails and the transaction
-- rolls back - rather than leaving work with no status and a screen that
-- cannot render it.
ALTER TABLE "tasks" ALTER COLUMN "status_id" SET NOT NULL;
ALTER TABLE "projects" ALTER COLUMN "status_id" SET NOT NULL;

ALTER TABLE "tasks" ADD CONSTRAINT "tasks_status_id_fkey"
    FOREIGN KEY ("status_id") REFERENCES "workflow_statuses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "projects" ADD CONSTRAINT "projects_status_id_fkey"
    FOREIGN KEY ("status_id") REFERENCES "workflow_statuses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- The board indexes, rebuilt on the new column. The task one was the largest
-- measured win in the schema (6.0ms -> 0.8ms on 12k tasks) and is kept in the
-- same shape.
DROP INDEX IF EXISTS "tasks_assignee_id_status_idx";
DROP INDEX IF EXISTS "tasks_organization_id_status_due_date_idx";
DROP INDEX IF EXISTS "projects_organization_id_status_idx";

CREATE INDEX "tasks_assignee_id_status_id_idx" ON "tasks"("assignee_id", "status_id");
CREATE INDEX "tasks_organization_id_status_id_due_date_idx"
    ON "tasks"("organization_id", "status_id", "due_date");
CREATE INDEX "projects_organization_id_status_id_idx" ON "projects"("organization_id", "status_id");

-- Only now, with every row mapped and constrained.
ALTER TABLE "tasks" DROP COLUMN "status";
ALTER TABLE "projects" DROP COLUMN "status";

DROP TYPE "TaskStatus";
DROP TYPE "ProjectStatus";
