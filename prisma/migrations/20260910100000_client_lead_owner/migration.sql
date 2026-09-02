-- Who brought a client or a deal in.
--
-- Nullable, and deliberately NOT backfilled. Everything that exists today
-- belongs to nobody, which is the truth; guessing an owner from created_at or
-- from whoever happens to be in the sales role would invent a fact that then
-- shows up in somebody's own report as if it were recorded.
--
-- SET NULL rather than CASCADE on both: somebody leaving the agency must not
-- take their clients and deals out of the database with them. Their rows simply
-- become unowned, which is the same state everything starts in.

ALTER TABLE "clients" ADD COLUMN "owner_id" TEXT;
ALTER TABLE "leads" ADD COLUMN "owner_id" TEXT;

-- "My clients" and "my pipeline" are the filters the sales workspace is built
-- on, so both get the composite the query actually uses.
CREATE INDEX "clients_organization_id_owner_id_idx" ON "clients"("organization_id", "owner_id");
CREATE INDEX "leads_organization_id_owner_id_idx" ON "leads"("organization_id", "owner_id");

ALTER TABLE "clients" ADD CONSTRAINT "clients_owner_id_fkey"
    FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "leads" ADD CONSTRAINT "leads_owner_id_fkey"
    FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- The composites above lead with organization_id, which cannot serve a lookup
-- on owner_id alone - and that is exactly what deleting a user does to check
-- this constraint. Without these, removing one person scans every client and
-- every lead in the database.
CREATE INDEX "clients_owner_id_idx" ON "clients"("owner_id");
CREATE INDEX "leads_owner_id_idx" ON "leads"("owner_id");
