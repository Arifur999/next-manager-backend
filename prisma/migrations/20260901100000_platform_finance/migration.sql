-- The platform's own money: what it costs to run, and a nightly photograph of
-- what it earns.
--
-- The snapshot table exists because MRR over time cannot be computed
-- backwards. Subscriptions carry no history, so a trend derived from
-- created_at and today's price would draw a line that never dips - it cannot
-- see anybody who left. The trend is accumulated forward instead.

CREATE TABLE "platform_expenses" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "category" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL,
    "amount_usd" DECIMAL(15,2) NOT NULL,
    "notes" TEXT NOT NULL DEFAULT '',
    "deleted_at" TIMESTAMP(3),
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_expenses_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "platform_expenses_date_idx" ON "platform_expenses"("date" DESC);

CREATE TABLE "platform_metric_snapshots" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "mrr_usd" DECIMAL(15,2) NOT NULL,
    "companies_total" INTEGER NOT NULL,
    "companies_active" INTEGER NOT NULL,
    "companies_trialing" INTEGER NOT NULL,
    "companies_past_due" INTEGER NOT NULL,
    "companies_suspended" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_metric_snapshots_pkey" PRIMARY KEY ("id")
);

-- One row per day: a cron that fires twice corrects the day rather than
-- doubling it.
CREATE UNIQUE INDEX "platform_metric_snapshots_date_key" ON "platform_metric_snapshots"("date");
