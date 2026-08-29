-- Bringing an agency onto the platform.
--
-- Distinct from platform_invites, which grows the team that runs AGENCIO, and
-- from team_invites, which adds somebody to a company that already exists.
-- This one has no company yet - that is the point. The workspace, its first
-- admin and its subscription are created when the link is accepted.
--
-- Nothing is created at invite time on purpose: an invite that is never
-- accepted would otherwise leave an empty agency on the customers list,
-- counted in every total, belonging to nobody.

CREATE TABLE "agency_invites" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "company_name" TEXT NOT NULL DEFAULT '',
    "plan_id" TEXT,
    "trial_days" INTEGER NOT NULL DEFAULT 14,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agency_invites_pkey" PRIMARY KEY ("id")
);

-- One index hit per link open.
CREATE UNIQUE INDEX "agency_invites_token_hash_key" ON "agency_invites"("token_hash");
-- The outstanding list, and refusing a second live invite to one address.
CREATE INDEX "agency_invites_email_used_at_idx" ON "agency_invites"("email", "used_at");
CREATE INDEX "agency_invites_plan_id_idx" ON "agency_invites"("plan_id");

-- Restrict, not SET NULL: an invite silently losing the plan it was sold on
-- would let somebody accept onto nothing.
ALTER TABLE "agency_invites" ADD CONSTRAINT "agency_invites_plan_id_fkey"
    FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
