-- A company talking to itself.
--
-- Distinct from announcements, which is the platform talking to its customers.
-- Every notification is addressed to ONE person, never to "everybody" - that is
-- what makes an unread count mean anything.
--
-- The event list is short on purpose: every entry has a place in the code that
-- already runs. A switch on a settings screen that fires nothing teaches people
-- the whole screen is decorative.

CREATE TYPE "NotificationEvent" AS ENUM (
    'task_assigned',
    'time_awaiting_approval',
    'payment_recorded',
    'member_awaiting_approval',
    'invoice_overdue'
);

CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "event" "NotificationEvent" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL DEFAULT '',
    "entity_type" TEXT NOT NULL DEFAULT '',
    "entity_id" TEXT,
    "read_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- The bell: one person's newest, and their unread count, off one index.
CREATE INDEX "notifications_user_id_read_at_created_at_idx"
    ON "notifications"("user_id", "read_at", "created_at" DESC);
CREATE INDEX "notifications_organization_id_idx" ON "notifications"("organization_id");

ALTER TABLE "notifications" ADD CONSTRAINT "notifications_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Rules are created on demand, not seeded. An absent row means the built-in
-- default, so an agency that never opens the settings screen still gets the
-- notifications that matter.
CREATE TABLE "notification_rules" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "event" "NotificationEvent" NOT NULL,
    "in_app" BOOLEAN NOT NULL DEFAULT true,
    -- Off by default: email leaves the product and cannot be unsent.
    "email" BOOLEAN NOT NULL DEFAULT false,
    "roles" "Role"[] DEFAULT ARRAY[]::"Role"[],
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_rules_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "notification_rules_organization_id_event_key"
    ON "notification_rules"("organization_id", "event");

ALTER TABLE "notification_rules" ADD CONSTRAINT "notification_rules_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
