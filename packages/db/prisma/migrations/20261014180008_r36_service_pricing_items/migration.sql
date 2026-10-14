-- CreateEnum
CREATE TYPE "ServiceLineItemMode" AS ENUM ('INFORMATIONAL', 'ADDITIVE');

-- AlterTable
ALTER TABLE "invoice_lines" ADD COLUMN     "service_add_on_id" UUID;

-- AlterTable
ALTER TABLE "services" ADD COLUMN     "line_item_mode" "ServiceLineItemMode" NOT NULL DEFAULT 'INFORMATIONAL';

-- CreateTable
CREATE TABLE "service_line_items" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "service_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "quantity" DECIMAL(10,2) NOT NULL DEFAULT 1,
    "rate_cents" INTEGER NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "service_line_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_add_ons" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "service_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "price_cents" INTEGER NOT NULL,
    "linked_service_id" UUID,
    "client_selectable" BOOLEAN NOT NULL DEFAULT false,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "archived_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "service_add_ons_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "service_line_items_business_id_service_id_sort_order_idx" ON "service_line_items"("business_id", "service_id", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "service_add_ons_business_id_id_key" ON "service_add_ons"("business_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "service_add_ons_business_id_service_id_name_key" ON "service_add_ons"("business_id", "service_id", "name");

-- CreateIndex
CREATE INDEX "invoice_lines_business_id_service_add_on_id_idx" ON "invoice_lines"("business_id", "service_add_on_id");

-- AddForeignKey
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_business_id_service_add_on_id_fkey" FOREIGN KEY ("business_id", "service_add_on_id") REFERENCES "service_add_ons"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_line_items" ADD CONSTRAINT "service_line_items_business_id_service_id_fkey" FOREIGN KEY ("business_id", "service_id") REFERENCES "services"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_add_ons" ADD CONSTRAINT "service_add_ons_business_id_service_id_fkey" FOREIGN KEY ("business_id", "service_id") REFERENCES "services"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_add_ons" ADD CONSTRAINT "service_add_ons_business_id_linked_service_id_fkey" FOREIGN KEY ("business_id", "linked_service_id") REFERENCES "services"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- R36 (Rasel, Oct 14): a service's line items (component charges) and add-ons, and the add-on an
-- invoice line came from. A line keeps its own name, price and description, so a later catalog
-- change never rewrites an invoice.

-- ---------- Grants and RLS: only the firm's own business scope ----------
-- Line items are replaced as a whole when a service is saved; an unused add-on can be deleted (a
-- foreign key refuses a used one).
GRANT SELECT, INSERT, UPDATE, DELETE ON service_line_items, service_add_ons TO firmivra_app;
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['service_line_items', 'service_add_ons'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I ON %I USING (business_id = app_current_business_id())'
                   ' WITH CHECK (business_id = app_current_business_id())', t || '_business', t);
  END LOOP;
END
$$;

-- ---------- Shape ----------
ALTER TABLE service_line_items
  ADD CONSTRAINT service_line_items_values
    CHECK (btrim(name) <> '' AND char_length(name) <= 200 AND quantity > 0 AND rate_cents >= 0
           AND char_length(description) <= 500);

ALTER TABLE service_add_ons
  ADD CONSTRAINT service_add_ons_values
    CHECK (btrim(name) <> '' AND char_length(name) <= 100 AND price_cents >= 0
           AND char_length(description) <= 500),
  -- Required means always added, selectable means the client chooses: never both.
  ADD CONSTRAINT service_add_ons_required_or_selectable CHECK (NOT (required AND client_selectable)),
  ADD CONSTRAINT service_add_ons_not_itself CHECK (linked_service_id IS NULL OR linked_service_id <> service_id);
