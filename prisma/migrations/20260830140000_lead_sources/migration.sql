-- Where the work came from, as a reference rather than free text.
--
-- `leads.source` was written on create and read by nothing - no query, no
-- report, no screen. Making it answer "which marketplace is actually paying"
-- means it has to group, and free text does not group: "Upwork", "upwork" and
-- "UpWork" typed on three different days are three marketplaces in a report
-- that splits the numbers and looks fine while doing it.

CREATE TABLE "lead_sources" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lead_sources_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "lead_sources_organization_id_name_key" ON "lead_sources"("organization_id", "name");
CREATE INDEX "lead_sources_organization_id_idx" ON "lead_sources"("organization_id");

ALTER TABLE "lead_sources" ADD CONSTRAINT "lead_sources_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Every company gets the common marketplaces, so the picker is never empty on
-- a screen somebody opened to record a lead right now.
INSERT INTO "lead_sources" ("id", "organization_id", "name", "updated_at")
SELECT gen_random_uuid()::text, o."id", v."name", CURRENT_TIMESTAMP
FROM "organizations" o
CROSS JOIN (VALUES ('Upwork'), ('Fiverr'), ('Freelancer'), ('Direct'), ('Referral')) AS v("name");

ALTER TABLE "leads" ADD COLUMN "source_id" TEXT;

-- Anything already typed becomes a source for that company, matched
-- case-insensitively so "upwork" lands on the seeded "Upwork" rather than
-- creating a second one beside it. Spellings nobody anticipated are created
-- rather than dropped: a lead losing where it came from is worse than a list
-- with an odd entry in it.
INSERT INTO "lead_sources" ("id", "organization_id", "name", "updated_at")
SELECT DISTINCT gen_random_uuid()::text, l."organization_id", TRIM(l."source"), CURRENT_TIMESTAMP
FROM "leads" l
WHERE TRIM(COALESCE(l."source", '')) <> ''
  AND NOT EXISTS (
    SELECT 1 FROM "lead_sources" s
    WHERE s."organization_id" = l."organization_id"
      AND LOWER(s."name") = LOWER(TRIM(l."source"))
  );

UPDATE "leads" l SET "source_id" = s."id"
FROM "lead_sources" s
WHERE s."organization_id" = l."organization_id"
  AND LOWER(s."name") = LOWER(TRIM(COALESCE(l."source", '')))
  AND TRIM(COALESCE(l."source", '')) <> '';

ALTER TABLE "leads" DROP COLUMN "source";

CREATE INDEX "leads_source_id_idx" ON "leads"("source_id");

ALTER TABLE "leads" ADD CONSTRAINT "leads_source_id_fkey"
    FOREIGN KEY ("source_id") REFERENCES "lead_sources"("id") ON DELETE SET NULL ON UPDATE CASCADE;
