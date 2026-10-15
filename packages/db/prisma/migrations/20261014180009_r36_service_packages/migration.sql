-- CreateTable
CREATE TABLE "service_packages" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "category_id" UUID,
    "short_description" TEXT NOT NULL,
    "status" "ServiceStatus" NOT NULL DEFAULT 'DRAFT',
    "icon_key" TEXT,
    "package_price_cents" INTEGER,
    "discount_type" "InvoiceDiscountType",
    "discount_percent" DECIMAL(5,2),
    "discount_cents" INTEGER,
    "visible_to_clients" BOOLEAN NOT NULL DEFAULT false,
    "allow_client_add_ons" BOOLEAN NOT NULL DEFAULT false,
    "display_on_portal" BOOLEAN NOT NULL DEFAULT false,
    "internal_notes" TEXT,
    "updated_by_user_id" UUID,
    "archived_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "service_packages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_package_items" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "package_id" UUID NOT NULL,
    "service_id" UUID NOT NULL,
    "included" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "service_package_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_package_add_ons" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "package_id" UUID NOT NULL,
    "service_add_on_id" UUID,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "price_cents" INTEGER NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "service_package_add_ons_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "service_packages_business_id_status_idx" ON "service_packages"("business_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "service_packages_business_id_name_key" ON "service_packages"("business_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "service_packages_business_id_id_key" ON "service_packages"("business_id", "id");

-- CreateIndex
CREATE INDEX "service_package_items_business_id_service_id_idx" ON "service_package_items"("business_id", "service_id");

-- CreateIndex
CREATE UNIQUE INDEX "service_package_items_business_id_package_id_service_id_key" ON "service_package_items"("business_id", "package_id", "service_id");

-- CreateIndex
CREATE UNIQUE INDEX "service_package_add_ons_business_id_package_id_name_key" ON "service_package_add_ons"("business_id", "package_id", "name");

-- AddForeignKey
ALTER TABLE "service_packages" ADD CONSTRAINT "service_packages_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_packages" ADD CONSTRAINT "service_packages_business_id_category_id_fkey" FOREIGN KEY ("business_id", "category_id") REFERENCES "service_categories"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_packages" ADD CONSTRAINT "service_packages_business_id_updated_by_user_id_fkey" FOREIGN KEY ("business_id", "updated_by_user_id") REFERENCES "memberships"("business_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_package_items" ADD CONSTRAINT "service_package_items_business_id_package_id_fkey" FOREIGN KEY ("business_id", "package_id") REFERENCES "service_packages"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_package_items" ADD CONSTRAINT "service_package_items_business_id_service_id_fkey" FOREIGN KEY ("business_id", "service_id") REFERENCES "services"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_package_add_ons" ADD CONSTRAINT "service_package_add_ons_business_id_package_id_fkey" FOREIGN KEY ("business_id", "package_id") REFERENCES "service_packages"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_package_add_ons" ADD CONSTRAINT "service_package_add_ons_business_id_service_add_on_id_fkey" FOREIGN KEY ("business_id", "service_add_on_id") REFERENCES "service_add_ons"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- R36 (Rasel, Oct 14): the Package Builder: packages of catalog services at one price, the services
-- in each, and the add-ons a client may choose. The total of the services and the client's savings
-- are worked out from current prices, never stored.

-- ---------- Grants and RLS: only the firm's own business scope; archived, never deleted ----------
GRANT SELECT, INSERT, UPDATE ON service_packages TO firmivra_app;
-- The services and add-ons of a package are replaced as a whole when it is saved.
GRANT SELECT, INSERT, UPDATE, DELETE ON service_package_items, service_package_add_ons TO firmivra_app;
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['service_packages', 'service_package_items', 'service_package_add_ons'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I ON %I USING (business_id = app_current_business_id())'
                   ' WITH CHECK (business_id = app_current_business_id())', t || '_business', t);
  END LOOP;
END
$$;

-- ---------- Shape ----------
ALTER TABLE service_packages
  ADD CONSTRAINT service_packages_name CHECK (btrim(name) <> '' AND char_length(name) <= 100),
  ADD CONSTRAINT service_packages_text
    CHECK (btrim(short_description) <> '' AND char_length(short_description) <= 200
           AND char_length(internal_notes) <= 500 AND (icon_key IS NULL OR icon_key ~ '^[a-z0-9-]{1,40}$')),
  -- A package for sale has its price (a draft may wait).
  ADD CONSTRAINT service_packages_priced CHECK (package_price_cents >= 0 AND (status <> 'ACTIVE' OR package_price_cents IS NOT NULL)),
  -- The discount is none, a percentage or a fixed amount, with its one value.
  ADD CONSTRAINT service_packages_discount
    CHECK (coalesce(discount_type = 'PERCENT', false) = (discount_percent IS NOT NULL)
           AND coalesce(discount_type = 'FIXED', false) = (discount_cents IS NOT NULL)
           AND (discount_percent IS NULL OR discount_percent BETWEEN 0 AND 100)
           AND (discount_cents IS NULL OR discount_cents >= 0)),
  ADD CONSTRAINT service_packages_portal CHECK (NOT display_on_portal OR visible_to_clients);

ALTER TABLE service_package_add_ons
  ADD CONSTRAINT service_package_add_ons_values
    CHECK (btrim(name) <> '' AND char_length(name) <= 100 AND price_cents >= 0 AND char_length(description) <= 500);

-- ---------- Rules ----------
-- A package takes a live category, like a service (the same rule).
CREATE TRIGGER service_packages_check_category
  BEFORE INSERT OR UPDATE OF category_id ON service_packages
  FOR EACH ROW EXECUTE FUNCTION services_check_category();

-- Only an active service joins a package; one that is deactivated later stays in it (the screen
-- warns and asks for a replacement before the package is activated again).
CREATE FUNCTION service_package_items_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM services s
                 WHERE s.business_id = NEW.business_id AND s.id = NEW.service_id
                   AND s.status = 'ACTIVE' AND s.archived_at IS NULL) THEN
    RAISE EXCEPTION 'packages: only an active service can be added to a package' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER service_package_items_rules
  BEFORE INSERT ON service_package_items
  FOR EACH ROW EXECUTE FUNCTION service_package_items_rules();
