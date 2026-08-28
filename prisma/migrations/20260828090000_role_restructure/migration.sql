-- Role restructure: owner/manager/member give way to the four company roles.
--
-- Written by hand rather than generated. Prisma's draft would have dropped the
-- three old values and failed on any row still using them; the rows have to be
-- mapped across first, and that mapping is the point of this migration:
--
--   owner   -> admin            the agency owner becomes the top company role
--   admin   -> admin            unchanged
--   manager -> project_manager  it already meant "runs projects and teams"
--   member  -> operations       it already meant "does the work"
--
-- Postgres cannot remove a value from an enum in place, so this builds the new
-- type beside the old one, moves the column across with an explicit CASE, and
-- only then drops the old type.

CREATE TYPE "Role_new" AS ENUM ('super_admin', 'admin', 'sales', 'project_manager', 'operations');

-- The default has to go before the cast: Postgres will not re-interpret an
-- existing default expression against a different type.
ALTER TABLE "users" ALTER COLUMN "role" DROP DEFAULT;

ALTER TABLE "users"
  ALTER COLUMN "role" TYPE "Role_new"
  USING (
    CASE "role"::text
      WHEN 'owner'   THEN 'admin'
      WHEN 'manager' THEN 'project_manager'
      WHEN 'member'  THEN 'operations'
      ELSE "role"::text
    END
  )::"Role_new";

DROP TYPE "Role";
ALTER TYPE "Role_new" RENAME TO "Role";

-- Least privilege: an invite that forgets to name a role creates somebody who
-- can do the work and nothing else, rather than somebody who can move money.
ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT 'operations';
