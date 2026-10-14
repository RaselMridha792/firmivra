-- CreateEnum
CREATE TYPE "ServiceStatus" AS ENUM ('DRAFT', 'ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "ServicePricingType" AS ENUM ('FIXED', 'STARTING_AT', 'HOURLY', 'CUSTOM_QUOTE', 'RECURRING');

-- CreateEnum
CREATE TYPE "ServiceInclusionKind" AS ENUM ('INCLUDED', 'NOT_INCLUDED');

-- AlterTable
ALTER TABLE "services" ADD COLUMN     "base_price_cents" INTEGER,
ADD COLUMN     "billing_frequency" "BillingFrequency",
ADD COLUMN     "category_id" UUID,
ADD COLUMN     "client_visible" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "full_description" TEXT,
ADD COLUMN     "icon_key" TEXT,
ADD COLUMN     "internal_notes" TEXT,
ADD COLUMN     "pricing_type" "ServicePricingType" NOT NULL DEFAULT 'CUSTOM_QUOTE',
ADD COLUMN     "requires_client_approval" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "status" "ServiceStatus" NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN     "taxable" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "updated_by_user_id" UUID;

-- CreateTable
CREATE TABLE "service_categories" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "icon_key" TEXT,
    "color" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "archived_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "service_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_inclusions" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "service_id" UUID NOT NULL,
    "kind" "ServiceInclusionKind" NOT NULL,
    "text" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "service_inclusions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "service_categories_business_id_name_key" ON "service_categories"("business_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "service_categories_business_id_id_key" ON "service_categories"("business_id", "id");

-- CreateIndex
CREATE INDEX "service_inclusions_business_id_service_id_kind_sort_order_idx" ON "service_inclusions"("business_id", "service_id", "kind", "sort_order");

-- CreateIndex
CREATE INDEX "services_business_id_status_idx" ON "services"("business_id", "status");

-- CreateIndex
CREATE INDEX "services_business_id_category_id_idx" ON "services"("business_id", "category_id");

-- AddForeignKey
ALTER TABLE "services" ADD CONSTRAINT "services_business_id_category_id_fkey" FOREIGN KEY ("business_id", "category_id") REFERENCES "service_categories"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "services" ADD CONSTRAINT "services_business_id_updated_by_user_id_fkey" FOREIGN KEY ("business_id", "updated_by_user_id") REFERENCES "memberships"("business_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_categories" ADD CONSTRAINT "service_categories_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_inclusions" ADD CONSTRAINT "service_inclusions_business_id_service_id_fkey" FOREIGN KEY ("business_id", "service_id") REFERENCES "services"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- R36 (Rasel, Oct 14): the Services and Pricing catalog: a category, a status, a pricing type and
-- price, descriptions and inclusions on each service. A service made before R36 is ACTIVE with a
-- custom quote.

-- ---------- Grants and RLS: only the firm's own business scope ----------
-- The inclusions are replaced as a whole when a service is saved; an unused category can be deleted
-- (a foreign key refuses a used one).
GRANT SELECT, INSERT, UPDATE, DELETE ON service_categories, service_inclusions TO firmivra_app;
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['service_categories', 'service_inclusions'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I ON %I USING (business_id = app_current_business_id())'
                   ' WITH CHECK (business_id = app_current_business_id())', t || '_business', t);
  END LOOP;
END
$$;

-- ---------- Shape ----------
ALTER TABLE services
  ADD CONSTRAINT services_base_price CHECK (base_price_cents >= 0),
  -- A service that is for sale has its price, unless it is a custom quote.
  ADD CONSTRAINT services_priced CHECK (status <> 'ACTIVE' OR pricing_type = 'CUSTOM_QUOTE' OR base_price_cents IS NOT NULL),
  ADD CONSTRAINT services_recurring
    CHECK (pricing_type <> 'RECURRING' OR (billing_frequency IS NOT NULL AND billing_frequency <> 'ONE_TIME')),
  ADD CONSTRAINT services_text
    CHECK (char_length(full_description) <= 1000 AND char_length(internal_notes) <= 500
           AND (icon_key IS NULL OR icon_key ~ '^[a-z0-9-]{1,40}$'));

ALTER TABLE service_categories
  ADD CONSTRAINT service_categories_name CHECK (btrim(name) <> '' AND char_length(name) <= 60),
  ADD CONSTRAINT service_categories_text
    CHECK (char_length(description) <= 200 AND (icon_key IS NULL OR icon_key ~ '^[a-z0-9-]{1,40}$')),
  ADD CONSTRAINT service_categories_color CHECK (color ~ '^#[0-9A-Fa-f]{6}$');

ALTER TABLE service_inclusions
  ADD CONSTRAINT service_inclusions_text CHECK (btrim(text) <> '' AND char_length(text) <= 200);

-- ---------- Rules ----------
-- A category chosen now must be live (an old service may keep one deactivated since).
CREATE FUNCTION services_check_category() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF NEW.category_id IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.category_id IS DISTINCT FROM OLD.category_id)
     AND EXISTS (SELECT 1 FROM service_categories c
                 WHERE c.business_id = NEW.business_id AND c.id = NEW.category_id AND c.archived_at IS NOT NULL) THEN
    RAISE EXCEPTION 'services: an inactive category cannot be chosen' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER services_check_category
  BEFORE INSERT OR UPDATE OF category_id ON services
  FOR EACH ROW EXECUTE FUNCTION services_check_category();
