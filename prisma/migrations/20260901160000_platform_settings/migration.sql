-- How this installation is set up: what it calls itself in the mail it sends,
-- who customers write to, and what a company that signs up itself gets put on.
--
-- One row, always. A second would be a second answer to questions that have one.
--
-- SMTP is deliberately not here. Mail credentials stay in the environment,
-- where they can be rotated without a database write and never turn up in a
-- backup of this table; the settings screen reads their status, not their
-- values.

CREATE TABLE "platform_settings" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "product_name" TEXT NOT NULL DEFAULT 'AGENCIO',
    "support_email" TEXT NOT NULL DEFAULT '',
    "default_plan_id" TEXT,
    "default_trial_days" INTEGER NOT NULL DEFAULT 14,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" TEXT,

    CONSTRAINT "platform_settings_pkey" PRIMARY KEY ("id")
);

-- Restrict, not SET NULL: a plan disappearing from under new sign-ups changes
-- what every future customer gets, and that should take a deliberate edit here
-- rather than a delete somewhere else.
ALTER TABLE "platform_settings" ADD CONSTRAINT "platform_settings_default_plan_id_fkey"
    FOREIGN KEY ("default_plan_id") REFERENCES "plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "platform_settings_default_plan_id_idx" ON "platform_settings"("default_plan_id");

-- The row exists from the start. Code that reads settings should not have to
-- carry a "what if nobody has saved yet" branch.
INSERT INTO "platform_settings" ("id", "updated_at") VALUES ('singleton', CURRENT_TIMESTAMP);
