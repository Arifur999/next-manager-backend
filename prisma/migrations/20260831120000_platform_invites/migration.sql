-- Invitations to join the platform team.
--
-- Its own table rather than a nullable organization_id on team_invites: a
-- platform operator belongs to no company, and that nullable column would put
-- an "is this an org invite" branch into every query touching it.
--
-- The token is stored hashed, like every other one-time credential here.

CREATE TABLE "platform_invites" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "permissions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_invites_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "platform_invites_token_hash_key" ON "platform_invites"("token_hash");
CREATE INDEX "platform_invites_email_used_at_idx" ON "platform_invites"("email", "used_at");
