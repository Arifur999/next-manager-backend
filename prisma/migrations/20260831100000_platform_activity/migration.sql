-- What a platform operator did.
--
-- ActivityLog is organization-scoped, so suspending a company or moving it
-- between plans has been leaving no trace anywhere. Survivable with one
-- operator; not once there is a team, which is what the rest of this work
-- creates.

CREATE TABLE "platform_activity_logs" (
    "id" TEXT NOT NULL,
    "actor_id" TEXT,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT,
    "action" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_activity_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "platform_activity_logs_created_at_idx" ON "platform_activity_logs"("created_at" DESC);
CREATE INDEX "platform_activity_logs_actor_id_idx" ON "platform_activity_logs"("actor_id");
CREATE INDEX "platform_activity_logs_entity_type_created_at_idx" ON "platform_activity_logs"("entity_type", "created_at" DESC);

-- SET NULL, matching the company audit log: the entry outlives the operator.
-- Cascading would mean removing somebody erases what they did, which is
-- backwards for an audit trail.
ALTER TABLE "platform_activity_logs" ADD CONSTRAINT "platform_activity_logs_actor_id_fkey"
    FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
