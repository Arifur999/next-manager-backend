-- Who tried to sign in, and whether it worked.
--
-- Both ids are nullable on purpose, and the reason is the tenant boundary: a
-- failed attempt at an address with no account belongs to no company, so it
-- must never appear on any company's screen. A null organization_id is what
-- guarantees that, rather than a filter somebody might forget to write.
--
-- A failed attempt at an address that DOES exist is the valuable case - it is
-- what tells an admin somebody is trying their team's accounts.
--
-- The password is never here, successful or not. Nor is the token.

CREATE TABLE "login_events" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT,
    "user_id" TEXT,
    "email" TEXT NOT NULL,
    "success" BOOLEAN NOT NULL,
    "ip" TEXT NOT NULL DEFAULT '',
    "user_agent" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "login_events_pkey" PRIMARY KEY ("id")
);

-- The security screen: one agency's attempts, newest first.
CREATE INDEX "login_events_organization_id_created_at_idx"
    ON "login_events"("organization_id", "created_at" DESC);
-- The FK, and "show me everything against this person".
CREATE INDEX "login_events_user_id_idx" ON "login_events"("user_id");
-- The nightly prune.
CREATE INDEX "login_events_created_at_idx" ON "login_events"("created_at");

ALTER TABLE "login_events" ADD CONSTRAINT "login_events_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- SET NULL, not CASCADE: removing somebody must not erase the record of
-- attempts made against their account.
ALTER TABLE "login_events" ADD CONSTRAINT "login_events_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
