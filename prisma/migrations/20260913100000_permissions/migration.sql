-- Who may do what, and how far it reaches.
--
-- TENANT ISOLATION IS NOT A SCOPE. organization_id is applied before any of
-- these rows are consulted, and nothing here can remove it. These decide how
-- much of your OWN agency you see, never whether you see another one.
--
-- Two tables: a template per role, and an exception per person. Absent means
-- inherit, which is what almost every square will be.

CREATE TABLE "role_permissions" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    -- Text, not an enum: adding a module should be a deploy rather than a
    -- migration, and a row naming a module the code no longer has is ignored
    -- rather than fatal.
    "module" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("id")
);

-- One answer per square. Without this an agency could hold two scopes for the
-- same thing and the resolver would have to pick, which is a coin toss nobody
-- could explain.
CREATE UNIQUE INDEX "role_permissions_organization_id_role_module_action_key"
    ON "role_permissions"("organization_id", "role", "module", "action");
CREATE INDEX "role_permissions_organization_id_idx" ON "role_permissions"("organization_id");
-- The resolver's own read: every row for one role, in one query.
CREATE INDEX "role_permissions_organization_id_role_idx" ON "role_permissions"("organization_id", "role");

ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "user_permissions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_permissions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "user_permissions_user_id_module_action_key"
    ON "user_permissions"("user_id", "module", "action");
CREATE INDEX "user_permissions_user_id_idx" ON "user_permissions"("user_id");

ALTER TABLE "user_permissions" ADD CONSTRAINT "user_permissions_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
