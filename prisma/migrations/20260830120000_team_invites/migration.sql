-- Invitations for operations members to join a company.
--
-- The token column holds a SHA-256 hash, never the token itself - the same
-- rule password resets follow, and for the same reason: this table read from a
-- backup would otherwise be a set of working keys into live companies.

CREATE TABLE "team_invites" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'operations',
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "team_invites_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "team_invites_token_hash_key" ON "team_invites"("token_hash");
CREATE INDEX "team_invites_organization_id_used_at_idx" ON "team_invites"("organization_id", "used_at");
CREATE INDEX "team_invites_organization_id_email_idx" ON "team_invites"("organization_id", "email");

ALTER TABLE "team_invites" ADD CONSTRAINT "team_invites_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
