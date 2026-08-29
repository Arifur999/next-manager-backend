-- Where a client's work lives. Links, not uploads.
--
-- An agency's files are already in Drive or Figma; copying them here would
-- mean a second copy to keep in step, a storage bill, and one more place a
-- client's material can leak from. A pointer is what people paste into chat
-- anyway.

CREATE TABLE "client_links" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "notes" TEXT NOT NULL DEFAULT '',
    "deleted_at" TIMESTAMP(3),
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "client_links_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "client_links_organization_id_idx" ON "client_links"("organization_id");
CREATE INDEX "client_links_client_id_created_at_idx" ON "client_links"("client_id", "created_at" DESC);

ALTER TABLE "client_links" ADD CONSTRAINT "client_links_client_id_fkey"
    FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
