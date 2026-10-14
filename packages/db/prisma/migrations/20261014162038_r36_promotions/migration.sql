-- CreateEnum
CREATE TYPE "PromotionAppliesTo" AS ENUM ('ALL', 'CATEGORIES', 'SERVICES', 'PACKAGES');

-- CreateEnum
CREATE TYPE "PromotionEligibility" AS ENUM ('ALL_CLIENTS', 'NEW_CLIENTS', 'EXISTING_CLIENTS');

-- CreateEnum
CREATE TYPE "PromotionStatus" AS ENUM ('DRAFT', 'ACTIVE', 'INACTIVE');

-- CreateTable
CREATE TABLE "promotions" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "discount_type" "InvoiceDiscountType" NOT NULL,
    "discount_percent" DECIMAL(5,2),
    "discount_cents" INTEGER,
    "applies_to" "PromotionAppliesTo" NOT NULL DEFAULT 'ALL',
    "starts_at" TIMESTAMPTZ(3),
    "ends_at" TIMESTAMPTZ(3),
    "eligibility" "PromotionEligibility" NOT NULL DEFAULT 'ALL_CLIENTS',
    "promo_code" TEXT,
    "allow_stacking" BOOLEAN NOT NULL DEFAULT false,
    "status" "PromotionStatus" NOT NULL DEFAULT 'DRAFT',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "promotions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promotion_targets" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "promotion_id" UUID NOT NULL,
    "category_id" UUID,
    "service_id" UUID,
    "package_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "promotion_targets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promotion_redemptions" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "promotion_id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "discount_cents" INTEGER NOT NULL,
    "redeemed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "promotion_redemptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "promotions_business_id_status_idx" ON "promotions"("business_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "promotions_business_id_id_key" ON "promotions"("business_id", "id");

-- CreateIndex
CREATE INDEX "promotion_targets_business_id_promotion_id_idx" ON "promotion_targets"("business_id", "promotion_id");

-- CreateIndex
CREATE INDEX "promotion_redemptions_business_id_invoice_id_idx" ON "promotion_redemptions"("business_id", "invoice_id");

-- CreateIndex
CREATE INDEX "promotion_redemptions_business_id_client_id_idx" ON "promotion_redemptions"("business_id", "client_id");

-- CreateIndex
CREATE UNIQUE INDEX "promotion_redemptions_promotion_id_invoice_id_key" ON "promotion_redemptions"("promotion_id", "invoice_id");

-- AddForeignKey
ALTER TABLE "promotions" ADD CONSTRAINT "promotions_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotion_targets" ADD CONSTRAINT "promotion_targets_business_id_promotion_id_fkey" FOREIGN KEY ("business_id", "promotion_id") REFERENCES "promotions"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotion_targets" ADD CONSTRAINT "promotion_targets_business_id_category_id_fkey" FOREIGN KEY ("business_id", "category_id") REFERENCES "service_categories"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotion_targets" ADD CONSTRAINT "promotion_targets_business_id_service_id_fkey" FOREIGN KEY ("business_id", "service_id") REFERENCES "services"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotion_targets" ADD CONSTRAINT "promotion_targets_business_id_package_id_fkey" FOREIGN KEY ("business_id", "package_id") REFERENCES "service_packages"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotion_redemptions" ADD CONSTRAINT "promotion_redemptions_business_id_promotion_id_fkey" FOREIGN KEY ("business_id", "promotion_id") REFERENCES "promotions"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotion_redemptions" ADD CONSTRAINT "promotion_redemptions_business_id_invoice_id_fkey" FOREIGN KEY ("business_id", "invoice_id") REFERENCES "invoices"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotion_redemptions" ADD CONSTRAINT "promotion_redemptions_business_id_client_id_fkey" FOREIGN KEY ("business_id", "client_id") REFERENCES "clients"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- R36 (Rasel, Oct 14): Discounts and Promotions: the promotions, what each applies to, and where
-- each was used. A promotion changed or ended later never rewrites a completed invoice.

-- ---------- Grants and RLS: only the firm's own business scope ----------
-- Promotions are ended (INACTIVE), never deleted; the targets are replaced as a whole when one is
-- saved; a redemption is a record and never changes.
GRANT SELECT, INSERT, UPDATE ON promotions TO firmivra_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON promotion_targets TO firmivra_app;
GRANT SELECT, INSERT ON promotion_redemptions TO firmivra_app;
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['promotions', 'promotion_targets', 'promotion_redemptions'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I ON %I USING (business_id = app_current_business_id())'
                   ' WITH CHECK (business_id = app_current_business_id())', t || '_business', t);
  END LOOP;
END
$$;

-- ---------- Shape ----------
ALTER TABLE promotions
  ADD CONSTRAINT promotions_name CHECK (btrim(name) <> '' AND char_length(name) <= 100),
  ADD CONSTRAINT promotions_description CHECK (char_length(description) <= 500),
  -- A percentage (above 0, up to 100) or a fixed amount (above 0), with its one value.
  ADD CONSTRAINT promotions_discount
    CHECK ((discount_type = 'PERCENT') = (discount_percent IS NOT NULL)
           AND (discount_type = 'FIXED') = (discount_cents IS NOT NULL)
           AND (discount_percent IS NULL OR (discount_percent > 0 AND discount_percent <= 100))
           AND (discount_cents IS NULL OR discount_cents > 0)),
  ADD CONSTRAINT promotions_window CHECK (starts_at IS NULL OR ends_at IS NULL OR ends_at > starts_at),
  ADD CONSTRAINT promotions_code CHECK (promo_code ~ '^[A-Z0-9_-]{3,30}$');
-- A code is unique in the firm.
CREATE UNIQUE INDEX promotions_one_code ON promotions (business_id, promo_code) WHERE promo_code IS NOT NULL;

ALTER TABLE promotion_targets
  ADD CONSTRAINT promotion_targets_one CHECK (num_nonnulls(category_id, service_id, package_id) = 1);
-- A target is listed once.
CREATE UNIQUE INDEX promotion_targets_category ON promotion_targets (promotion_id, category_id) WHERE category_id IS NOT NULL;
CREATE UNIQUE INDEX promotion_targets_service ON promotion_targets (promotion_id, service_id) WHERE service_id IS NOT NULL;
CREATE UNIQUE INDEX promotion_targets_package ON promotion_targets (promotion_id, package_id) WHERE package_id IS NOT NULL;

ALTER TABLE promotion_redemptions ADD CONSTRAINT promotion_redemptions_amount CHECK (discount_cents > 0);

-- ---------- Rules ----------
-- A target is of the promotion's kind: ALL has none; CATEGORIES, SERVICES and PACKAGES take theirs.
CREATE FUNCTION promotion_targets_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  kind "PromotionAppliesTo";
BEGIN
  SELECT p.applies_to INTO kind FROM promotions p
   WHERE p.business_id = NEW.business_id AND p.id = NEW.promotion_id;
  IF NOT ((kind = 'CATEGORIES' AND NEW.category_id IS NOT NULL)
       OR (kind = 'SERVICES' AND NEW.service_id IS NOT NULL)
       OR (kind = 'PACKAGES' AND NEW.package_id IS NOT NULL)) THEN
    RAISE EXCEPTION 'promotions: a target must be of the promotion''s kind (a promotion for all has none)'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER promotion_targets_rules
  BEFORE INSERT ON promotion_targets
  FOR EACH ROW EXECUTE FUNCTION promotion_targets_rules();

-- A redemption is for a live promotion, on one of that client's invoices, and promotions do not
-- stack unless both allow it.
CREATE FUNCTION promotion_redemptions_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  promo promotions%ROWTYPE;
BEGIN
  SELECT * INTO promo FROM promotions p WHERE p.business_id = NEW.business_id AND p.id = NEW.promotion_id;
  IF promo.status <> 'ACTIVE' OR (promo.starts_at IS NOT NULL AND promo.starts_at > now())
     OR (promo.ends_at IS NOT NULL AND promo.ends_at <= now()) THEN
    RAISE EXCEPTION 'promotions: only a live promotion can be used' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM invoices i
                 WHERE i.business_id = NEW.business_id AND i.id = NEW.invoice_id AND i.client_id = NEW.client_id) THEN
    RAISE EXCEPTION 'promotions: the invoice must be this client''s' USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM promotion_redemptions r JOIN promotions q ON q.id = r.promotion_id
             WHERE r.business_id = NEW.business_id AND r.invoice_id = NEW.invoice_id
               AND r.promotion_id <> NEW.promotion_id
               AND NOT (promo.allow_stacking AND q.allow_stacking)) THEN
    RAISE EXCEPTION 'promotions: these promotions do not stack on one invoice' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER promotion_redemptions_rules
  BEFORE INSERT ON promotion_redemptions
  FOR EACH ROW EXECUTE FUNCTION promotion_redemptions_rules();
