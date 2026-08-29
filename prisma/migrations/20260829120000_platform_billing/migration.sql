-- Plans and subscriptions: what the platform charges a company to use AGENCIO.
--
-- Additive only. Existing companies get a subscription at the bottom of this
-- file rather than being left without one - a company created before billing
-- existed must not be locked out by billing arriving.

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('trialing', 'active', 'past_due', 'suspended', 'cancelled');

-- CreateTable
CREATE TABLE "plans" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "price_usd" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "max_seats" INTEGER,
    "max_projects" INTEGER,
    "features" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "plan_id" TEXT NOT NULL,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'trialing',
    "trial_ends_at" TIMESTAMP(3),
    "current_period_end" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "notes" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "plans_code_key" ON "plans"("code");
CREATE UNIQUE INDEX "subscriptions_organization_id_key" ON "subscriptions"("organization_id");
CREATE INDEX "subscriptions_status_current_period_end_idx" ON "subscriptions"("status", "current_period_end");
CREATE INDEX "subscriptions_status_trial_ends_at_idx" ON "subscriptions"("status", "trial_ends_at");
CREATE INDEX "subscriptions_plan_id_idx" ON "subscriptions"("plan_id");

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_plan_id_fkey"
    FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Seed the starting tiers. Written here rather than in the seed script because
-- checkSubscription needs a plan to exist before the first company registers,
-- and a seed script is not guaranteed to have been run.
INSERT INTO "plans" ("id", "code", "name", "description", "price_usd", "max_seats", "max_projects", "features", "sort_order", "updated_at")
VALUES
    (gen_random_uuid()::text, 'trial', 'Trial', 'Fourteen days, the whole product.', 0, 5, 5, ARRAY['kpi','vault','time_tracking'], 0, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, 'starter', 'Starter', 'A small agency finding its feet.', 29, 5, 10, ARRAY['kpi','vault','time_tracking'], 1, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, 'growth', 'Growth', 'A team with more work than people.', 79, 20, 50, ARRAY['kpi','vault','time_tracking','reports'], 2, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, 'scale', 'Scale', 'No seat or project ceiling.', 199, NULL, NULL, ARRAY['kpi','vault','time_tracking','reports','priority_support'], 3, CURRENT_TIMESTAMP);

-- Every company that already exists gets an active subscription on Growth,
-- with no end date.
--
-- Not a trial: these companies have been using the product, and dropping them
-- into a 14-day countdown they never agreed to would lock them out a fortnight
-- from now with no warning. Billing arriving must not evict existing users -
-- the platform can move them onto real plans deliberately.
INSERT INTO "subscriptions" ("id", "organization_id", "plan_id", "status", "current_period_end", "notes", "updated_at")
SELECT
    gen_random_uuid()::text,
    o."id",
    (SELECT "id" FROM "plans" WHERE "code" = 'growth'),
    'active',
    NULL,
    'Granted automatically when billing was introduced.',
    CURRENT_TIMESTAMP
FROM "organizations" o
WHERE NOT EXISTS (SELECT 1 FROM "subscriptions" s WHERE s."organization_id" = o."id");
