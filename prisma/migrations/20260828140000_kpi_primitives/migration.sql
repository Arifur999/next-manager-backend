-- Measurement primitives: targets, lead stage history, milestones, baselines.
--
-- Written by hand rather than by `migrate dev`, which needs a TTY. Everything
-- here is additive: new tables, new nullable or defaulted columns. No existing
-- row changes, so this is safe to run against live data.

-- CreateEnum
CREATE TYPE "KpiMetric" AS ENUM (
    'utilization_pct',
    'realization_pct',
    'billable_hours',
    'revenue_usd',
    'gross_margin_pct',
    'deals_won',
    'deal_value_usd',
    'win_rate_pct',
    'pipeline_coverage',
    'on_time_delivery_pct',
    'project_margin_pct'
);

-- CreateEnum
CREATE TYPE "KpiPeriod" AS ENUM ('month', 'quarter', 'year');

-- AlterTable: baselines frozen at kickoff, so scope drift has an original.
ALTER TABLE "projects"
    ADD COLUMN "baseline_hours" DECIMAL(10,2) NOT NULL DEFAULT 0,
    ADD COLUMN "baseline_value_usd" DECIMAL(15,2) NOT NULL DEFAULT 0,
    ADD COLUMN "baseline_set_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "kpi_targets" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "user_id" TEXT,
    "metric" "KpiMetric" NOT NULL,
    "period" "KpiPeriod" NOT NULL,
    "period_start" DATE NOT NULL,
    "target_value" DECIMAL(15,2) NOT NULL,
    "notes" TEXT NOT NULL DEFAULT '',
    "created_by" TEXT,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "kpi_targets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_stage_events" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "lead_id" TEXT NOT NULL,
    "from_stage" "LeadStage",
    "to_stage" "LeadStage" NOT NULL,
    "changed_by" TEXT,
    "changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lead_stage_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_milestones" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "due_date" DATE NOT NULL,
    "submitted_at" TIMESTAMP(3),
    "accepted_at" TIMESTAMP(3),
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "deleted_at" TIMESTAMP(3),
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_milestones_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "kpi_targets_organization_id_user_id_metric_period_period_sta_key"
    ON "kpi_targets"("organization_id", "user_id", "metric", "period", "period_start");
CREATE INDEX "kpi_targets_organization_id_metric_period_start_idx"
    ON "kpi_targets"("organization_id", "metric", "period_start");
CREATE INDEX "kpi_targets_user_id_idx" ON "kpi_targets"("user_id");

-- CreateIndex
CREATE INDEX "lead_stage_events_lead_id_changed_at_idx"
    ON "lead_stage_events"("lead_id", "changed_at");
CREATE INDEX "lead_stage_events_organization_id_to_stage_changed_at_idx"
    ON "lead_stage_events"("organization_id", "to_stage", "changed_at");

-- CreateIndex
CREATE INDEX "project_milestones_organization_id_idx" ON "project_milestones"("organization_id");
CREATE INDEX "project_milestones_project_id_sort_order_idx"
    ON "project_milestones"("project_id", "sort_order");
CREATE INDEX "project_milestones_organization_id_due_date_idx"
    ON "project_milestones"("organization_id", "due_date");

-- AddForeignKey
ALTER TABLE "kpi_targets" ADD CONSTRAINT "kpi_targets_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "kpi_targets" ADD CONSTRAINT "kpi_targets_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_stage_events" ADD CONSTRAINT "lead_stage_events_lead_id_fkey"
    FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_milestones" ADD CONSTRAINT "project_milestones_project_id_fkey"
    FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Back-fill, from what is actually known and nothing more.
--
-- Every lead started as `new` on the day it was created - that much is true of
-- all of them, so it can be written as fact.
INSERT INTO "lead_stage_events" ("id", "organization_id", "lead_id", "from_stage", "to_stage", "changed_by", "changed_at")
SELECT gen_random_uuid()::text, "organization_id", "id", NULL, 'new', NULL, "created_at"
FROM "leads"
WHERE "deleted_at" IS NULL;

-- A converted lead has a real timestamp for when it was won, so that event is
-- also fact. Everything in between is not: a lead sitting at `negotiating`
-- gets no event for it, because nothing recorded when it got there.
--
-- The tempting shortcut - writing each lead's CURRENT stage at its created_at -
-- would say every historical lead reached its stage the instant it was
-- created, giving them all a zero-day cycle and dragging the first average
-- toward nonsense. A missing lead is visibly missing; a fabricated zero is not.
INSERT INTO "lead_stage_events" ("id", "organization_id", "lead_id", "from_stage", "to_stage", "changed_by", "changed_at")
SELECT gen_random_uuid()::text, "organization_id", "id", 'new', 'won', NULL, "converted_at"
FROM "leads"
WHERE "deleted_at" IS NULL AND "converted_at" IS NOT NULL AND "stage" = 'won';
