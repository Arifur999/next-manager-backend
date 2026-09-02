-- Talking to each other.
--
-- conversation_members is the permission table: every read, every write and
-- every socket push is decided by whether a row exists in it. Nothing here is
-- reached by a client asserting an id.

CREATE TYPE "ConversationType" AS ENUM ('direct', 'group', 'project');

CREATE TABLE "conversations" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "type" "ConversationType" NOT NULL,
    -- A direct conversation is named after whoever you are talking to, which is
    -- a different name for each of the two people in it, so it is not stored.
    "name" TEXT NOT NULL DEFAULT '',
    "project_id" TEXT,
    -- Both member ids, sorted and joined. Without it, two people opening a DM
    -- at the same moment get two conversations and each sees half the history.
    "direct_key" TEXT,
    "created_by" TEXT,
    "last_message_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- Null direct_key repeats freely in Postgres, so groups and project threads are
-- unaffected by this; it constrains direct conversations only, which is the
-- intent.
CREATE UNIQUE INDEX "conversations_organization_id_direct_key_key" ON "conversations"("organization_id", "direct_key");
CREATE INDEX "conversations_organization_id_idx" ON "conversations"("organization_id");
CREATE INDEX "conversations_organization_id_last_message_at_idx" ON "conversations"("organization_id", "last_message_at" DESC);
CREATE INDEX "conversations_project_id_idx" ON "conversations"("project_id");

ALTER TABLE "conversations" ADD CONSTRAINT "conversations_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_project_id_fkey"
    FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "conversation_members" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    -- How far this person has read. One column rather than a row per message
    -- per member: the question asked is "how many are unread".
    "last_read_at" TIMESTAMP(3),
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversation_members_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "conversation_members_conversation_id_user_id_key" ON "conversation_members"("conversation_id", "user_id");
CREATE INDEX "conversation_members_organization_id_idx" ON "conversation_members"("organization_id");
CREATE INDEX "conversation_members_user_id_idx" ON "conversation_members"("user_id");
CREATE INDEX "conversation_members_conversation_id_idx" ON "conversation_members"("conversation_id");

ALTER TABLE "conversation_members" ADD CONSTRAINT "conversation_members_conversation_id_fkey"
    FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "conversation_members" ADD CONSTRAINT "conversation_members_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "messages" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "sender_id" TEXT,
    "body" TEXT NOT NULL,
    -- Soft, so a thread keeps its shape: removed rather than a gap.
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "messages_organization_id_idx" ON "messages"("organization_id");
-- The thread itself, and the unread count against last_read_at.
CREATE INDEX "messages_conversation_id_created_at_idx" ON "messages"("conversation_id", "created_at" DESC);
CREATE INDEX "messages_sender_id_idx" ON "messages"("sender_id");

ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_fkey"
    FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "messages" ADD CONSTRAINT "messages_sender_id_fkey"
    FOREIGN KEY ("sender_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
