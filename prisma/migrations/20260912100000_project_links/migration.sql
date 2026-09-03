-- Where a project's work actually lives.
--
-- Links, not uploads. An agency's files are already in Drive, Figma and GitHub;
-- storing copies would mean a second place for them to go stale, and the one
-- that goes stale is always the copy.
--
-- The same shape as client_links, deliberately: a project and a client keep
-- their material the same way, and one pattern is one thing to learn.

CREATE TABLE "project_links" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "notes" TEXT NOT NULL DEFAULT '',
    -- Soft, so a link somebody spent an afternoon finding survives a mistaken
    -- delete.
    "deleted_at" TIMESTAMP(3),
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_links_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "project_links_organization_id_idx" ON "project_links"("organization_id");
-- The project detail page: one project, newest first.
CREATE INDEX "project_links_project_id_created_at_idx" ON "project_links"("project_id", "created_at" DESC);

ALTER TABLE "project_links" ADD CONSTRAINT "project_links_project_id_fkey"
    FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
