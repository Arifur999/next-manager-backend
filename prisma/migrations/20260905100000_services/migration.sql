-- What an agency sells.
--
-- Three tables and two optional links. Nothing existing changes shape: an
-- invoice line typed by hand is still a real invoice line, and plenty of work
-- does not map onto one thing being sold, so both links are nullable.
--
-- The price on a service is a STARTING point. Every invoice line keeps its own
-- unit price, so changing the catalogue never restates an invoice already sent -
-- the same rule invoice_items already follows for its stored amount.

CREATE TABLE "service_categories" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "service_categories_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "service_categories_organization_id_name_key"
    ON "service_categories"("organization_id", "name");
CREATE INDEX "service_categories_organization_id_idx" ON "service_categories"("organization_id");

ALTER TABLE "service_categories" ADD CONSTRAINT "service_categories_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "services" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "category_id" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "default_price_usd" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "services_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "services_organization_id_name_key" ON "services"("organization_id", "name");
CREATE INDEX "services_organization_id_idx" ON "services"("organization_id");
CREATE INDEX "services_category_id_idx" ON "services"("category_id");

ALTER TABLE "services" ADD CONSTRAINT "services_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- SET NULL, not RESTRICT: removing a category is a tidying decision and must
-- not require moving every service out of it first.
ALTER TABLE "services" ADD CONSTRAINT "services_category_id_fkey"
    FOREIGN KEY ("category_id") REFERENCES "service_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "service_templates" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "service_templates_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "service_templates_organization_id_name_key"
    ON "service_templates"("organization_id", "name");
CREATE INDEX "service_templates_organization_id_idx" ON "service_templates"("organization_id");

ALTER TABLE "service_templates" ADD CONSTRAINT "service_templates_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "service_template_items" (
    "id" TEXT NOT NULL,
    "template_id" TEXT NOT NULL,
    "service_id" TEXT NOT NULL,
    "quantity" DECIMAL(12,2) NOT NULL DEFAULT 1,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "service_template_items_pkey" PRIMARY KEY ("id")
);

-- One line per service per template: two rows for the same service is a
-- quantity, not two lines.
CREATE UNIQUE INDEX "service_template_items_template_id_service_id_key"
    ON "service_template_items"("template_id", "service_id");
CREATE INDEX "service_template_items_template_id_idx" ON "service_template_items"("template_id");
CREATE INDEX "service_template_items_service_id_idx" ON "service_template_items"("service_id");

ALTER TABLE "service_template_items" ADD CONSTRAINT "service_template_items_template_id_fkey"
    FOREIGN KEY ("template_id") REFERENCES "service_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RESTRICT: a service inside a template cannot be deleted out from under it, or
-- the template silently loses a line.
ALTER TABLE "service_template_items" ADD CONSTRAINT "service_template_items_service_id_fkey"
    FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- The two optional links. Both nullable, because a hand-typed invoice line and
-- a project that is not one catalogue item are both normal.
ALTER TABLE "invoice_items" ADD COLUMN "service_id" TEXT;
ALTER TABLE "projects" ADD COLUMN "service_id" TEXT;

CREATE INDEX "invoice_items_service_id_idx" ON "invoice_items"("service_id");
CREATE INDEX "projects_service_id_idx" ON "projects"("service_id");

-- RESTRICT: a service that has been billed cannot be deleted, or the line loses
-- what it was for. Turning it off is what "we stopped selling this" means.
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_service_id_fkey"
    FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "projects" ADD CONSTRAINT "projects_service_id_fkey"
    FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
