-- A team inside the agency: Design, Development, Marketing.
--
-- A second axis to role, not a replacement for it. Role says what somebody may
-- do; a department says which part of the business they belong to, and that is
-- the cut every "how is Design doing" question needs and no role can answer.

CREATE TABLE "departments" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "departments_pkey" PRIMARY KEY ("id")
);

-- Names are unique per agency, not globally.
CREATE UNIQUE INDEX "departments_organization_id_name_key" ON "departments"("organization_id", "name");
CREATE INDEX "departments_organization_id_idx" ON "departments"("organization_id");

ALTER TABLE "departments" ADD CONSTRAINT "departments_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Null is a real answer: somebody can work here without belonging to a
-- department, and forcing one would invent a fact.
ALTER TABLE "users" ADD COLUMN "department_id" TEXT;

-- SET NULL, never CASCADE: removing a department must not remove people.
ALTER TABLE "users" ADD CONSTRAINT "users_department_id_fkey"
    FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- The FK, and the department filter on the team list. Postgres does not index
-- a foreign key for you.
CREATE INDEX "users_department_id_idx" ON "users"("department_id");
