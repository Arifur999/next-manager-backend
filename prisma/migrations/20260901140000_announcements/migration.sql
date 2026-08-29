-- Notices the platform sends to customers, and who has read them.
--
-- Audience is matched at read time against a company's subscription status
-- rather than fanned out to a recipient table at publish. A company that
-- starts paying tomorrow then sees the notice aimed at paying customers
-- without anybody re-sending it.
--
-- The read table exists because without it the bell never clears, and a badge
-- that never goes away teaches everyone to ignore the next notice too.

CREATE TYPE "AnnouncementAudience" AS ENUM ('all', 'trialing', 'active');

CREATE TABLE "announcements" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "audience" "AnnouncementAudience" NOT NULL DEFAULT 'all',
    "send_email" BOOLEAN NOT NULL DEFAULT false,
    "published_at" TIMESTAMP(3),
    "emailed_count" INTEGER,
    "created_by" TEXT,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "announcements_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "announcements_published_at_idx" ON "announcements"("published_at" DESC);

CREATE TABLE "announcement_reads" (
    "id" TEXT NOT NULL,
    "announcement_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "read_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "announcement_reads_pkey" PRIMARY KEY ("id")
);

-- Reading something twice is not two readings.
CREATE UNIQUE INDEX "announcement_reads_announcement_id_user_id_key"
    ON "announcement_reads"("announcement_id", "user_id");
CREATE INDEX "announcement_reads_user_id_idx" ON "announcement_reads"("user_id");

ALTER TABLE "announcement_reads" ADD CONSTRAINT "announcement_reads_announcement_id_fkey"
    FOREIGN KEY ("announcement_id") REFERENCES "announcements"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "announcement_reads" ADD CONSTRAINT "announcement_reads_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
