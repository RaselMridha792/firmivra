-- R36 (Rasel, Oct 14): the invoice screens' missing columns (staff, terms, percent discount, tax,
-- line service and tax treatment) and the firm's tax rates. Tax joins the totals the database
-- keeps: total = subtotal - discount + tax.

-- CreateEnum
CREATE TYPE "InvoiceDiscountType" AS ENUM ('PERCENT', 'FIXED');

-- AlterTable
ALTER TABLE "invoice_lines" ADD COLUMN     "item_name" TEXT,
ADD COLUMN     "service_id" UUID,
ADD COLUMN     "taxable" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "invoices" ADD COLUMN     "assigned_user_id" UUID,
ADD COLUMN     "discount_percent" DECIMAL(5,2),
ADD COLUMN     "discount_type" "InvoiceDiscountType" NOT NULL DEFAULT 'FIXED',
ADD COLUMN     "payment_terms" TEXT,
ADD COLUMN     "tax_cents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "tax_rate_bps" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "tax_rate_id" UUID,
ADD COLUMN     "taxable_subtotal_cents" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "invoice_tax_rates" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "rate_bps" INTEGER NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "archived_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "invoice_tax_rates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "invoice_tax_rates_business_id_name_key" ON "invoice_tax_rates"("business_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "invoice_tax_rates_business_id_id_key" ON "invoice_tax_rates"("business_id", "id");

-- CreateIndex
CREATE INDEX "invoice_lines_business_id_service_id_idx" ON "invoice_lines"("business_id", "service_id");

-- CreateIndex
CREATE INDEX "invoices_business_id_assigned_user_id_idx" ON "invoices"("business_id", "assigned_user_id");

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_business_id_assigned_user_id_fkey" FOREIGN KEY ("business_id", "assigned_user_id") REFERENCES "memberships"("business_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_business_id_tax_rate_id_fkey" FOREIGN KEY ("business_id", "tax_rate_id") REFERENCES "invoice_tax_rates"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_business_id_service_id_fkey" FOREIGN KEY ("business_id", "service_id") REFERENCES "services"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_tax_rates" ADD CONSTRAINT "invoice_tax_rates_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------- Grants and RLS: only the firm's own business scope; archived, never deleted ----------
GRANT SELECT, INSERT, UPDATE ON invoice_tax_rates TO firmivra_app;
ALTER TABLE invoice_tax_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_tax_rates FORCE ROW LEVEL SECURITY;
CREATE POLICY invoice_tax_rates_business ON invoice_tax_rates
  USING (business_id = app_current_business_id())
  WITH CHECK (business_id = app_current_business_id());

-- ---------- Shape ----------
ALTER TABLE invoice_tax_rates
  ADD CONSTRAINT invoice_tax_rates_name CHECK (btrim(name) <> '' AND char_length(name) <= 60),
  ADD CONSTRAINT invoice_tax_rates_rate CHECK (rate_bps BETWEEN 0 AND 10000),
  ADD CONSTRAINT invoice_tax_rates_default_live CHECK (NOT is_default OR archived_at IS NULL);
CREATE UNIQUE INDEX invoice_tax_rates_one_default ON invoice_tax_rates (business_id)
  WHERE is_default AND archived_at IS NULL;

ALTER TABLE invoices
  ADD CONSTRAINT invoices_payment_terms CHECK (payment_terms ~ '^[a-z0-9_]{1,30}$'),
  ADD CONSTRAINT invoices_discount_percent
    CHECK ((discount_type = 'PERCENT') = (discount_percent IS NOT NULL)
           AND (discount_percent IS NULL OR discount_percent BETWEEN 0 AND 100)),
  ADD CONSTRAINT invoices_tax CHECK (tax_rate_bps BETWEEN 0 AND 10000 AND tax_cents >= 0
           AND taxable_subtotal_cents BETWEEN 0 AND subtotal_cents
           AND (tax_rate_id IS NOT NULL OR tax_rate_bps = 0));
ALTER TABLE invoices DROP CONSTRAINT invoices_amounts;
ALTER TABLE invoices ADD CONSTRAINT invoices_amounts
  CHECK (subtotal_cents >= 0 AND discount_cents >= 0 AND total_cents >= 0
         AND total_cents = subtotal_cents - discount_cents + tax_cents);
ALTER TABLE invoice_lines ADD CONSTRAINT invoice_lines_item_name
  CHECK (item_name IS NULL OR (btrim(item_name) <> '' AND char_length(item_name) <= 200));

-- ---------- Rules ----------
-- A tax rate chosen now must be live (an old invoice may keep an archived one).
CREATE FUNCTION invoices_check_new_rate(firm uuid, rate uuid) RETURNS void
  LANGUAGE plpgsql STABLE
  AS $$
BEGIN
  IF rate IS NOT NULL AND EXISTS (SELECT 1 FROM invoice_tax_rates r
                                  WHERE r.business_id = firm AND r.id = rate AND r.archived_at IS NOT NULL) THEN
    RAISE EXCEPTION 'invoices: an archived tax rate cannot be chosen' USING ERRCODE = 'check_violation';
  END IF;
END
$$;

CREATE FUNCTION invoices_tax_rate_bps(firm uuid, rate uuid) RETURNS integer
  LANGUAGE sql STABLE
  AS $$
  SELECT coalesce((SELECT r.rate_bps FROM invoice_tax_rates r WHERE r.business_id = firm AND r.id = rate), 0)
$$;

CREATE OR REPLACE FUNCTION invoices_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  paid_cents bigint;
  reopening boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'DRAFT' OR NEW.subtotal_cents <> 0 OR NEW.taxable_subtotal_cents <> 0
       OR NEW.tax_cents <> 0 OR NEW.issued_at IS NOT NULL
       OR NEW.paid_at IS NOT NULL OR NEW.canceled_at IS NOT NULL THEN
      RAISE EXCEPTION 'invoices: a new invoice starts as an empty DRAFT; add lines, then issue it'
        USING ERRCODE = 'check_violation';
    END IF;
    PERFORM invoices_check_new_rate(NEW.business_id, NEW.tax_rate_id);
    NEW.tax_rate_bps := invoices_tax_rate_bps(NEW.business_id, NEW.tax_rate_id);
    NEW.total_cents := NEW.subtotal_cents - NEW.discount_cents;
    RETURN NEW;
  END IF;

  IF NEW.id <> OLD.id OR NEW.business_id <> OLD.business_id OR NEW.client_id <> OLD.client_id
     OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'invoices: the client of an invoice cannot change'
      USING ERRCODE = 'check_violation';
  END IF;
  -- Only offline_payments_reopen (one level down) takes a PAID invoice back to OPEN.
  reopening := OLD.status = 'PAID' AND NEW.status = 'OPEN' AND NEW.paid_at IS NULL
    AND pg_trigger_depth() >= 2
    AND (to_jsonb(NEW) - ARRAY['status', 'paid_at', 'updated_at'])
      = (to_jsonb(OLD) - ARRAY['status', 'paid_at', 'updated_at']);
  -- Final means every field: amounts, dates, number, reason, author.
  IF OLD.status IN ('PAID', 'CANCELED') AND NOT reopening
     AND (to_jsonb(NEW) - 'updated_at') IS DISTINCT FROM (to_jsonb(OLD) - 'updated_at') THEN
    RAISE EXCEPTION 'invoices: a paid or canceled invoice is final'
      USING ERRCODE = 'check_violation';
  END IF;
  -- Only the invoice_lines trigger (one level down) moves the subtotal.
  IF (NEW.subtotal_cents <> OLD.subtotal_cents
      OR NEW.taxable_subtotal_cents <> OLD.taxable_subtotal_cents) AND pg_trigger_depth() < 2 THEN
    RAISE EXCEPTION 'invoices: the subtotal is kept by the database from the lines'
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status NOT IN ('DRAFT', 'SCHEDULED')
     AND (NEW.number <> OLD.number OR NEW.currency <> OLD.currency
          OR NEW.discount_cents <> OLD.discount_cents
          OR NEW.engagement_id IS DISTINCT FROM OLD.engagement_id
          OR NEW.tax_rate_id IS DISTINCT FROM OLD.tax_rate_id
          OR NEW.discount_type <> OLD.discount_type
          OR NEW.discount_percent IS DISTINCT FROM OLD.discount_percent) THEN
    RAISE EXCEPTION 'invoices: an issued invoice keeps its number, client, engagement and amounts'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Tax: the rate is copied while the invoice is still being written, then it is the rate on the
  -- taxable lines after the discount's share of them. Nobody sets the tax itself.
  IF OLD.status IN ('DRAFT', 'SCHEDULED') THEN
    IF NEW.tax_rate_id IS DISTINCT FROM OLD.tax_rate_id THEN
      PERFORM invoices_check_new_rate(NEW.business_id, NEW.tax_rate_id);
    END IF;
    NEW.tax_rate_bps := invoices_tax_rate_bps(NEW.business_id, NEW.tax_rate_id);
  END IF;
  IF NEW.subtotal_cents > 0 THEN
    NEW.tax_cents := greatest(0, round(
      (NEW.taxable_subtotal_cents::numeric * (NEW.subtotal_cents - NEW.discount_cents) * NEW.tax_rate_bps)
      / (NEW.subtotal_cents::numeric * 10000)))::integer;
  ELSE
    NEW.tax_cents := 0;
  END IF;

  IF NEW.status <> OLD.status THEN
    IF NOT ((OLD.status = 'DRAFT' AND NEW.status IN ('SCHEDULED', 'OPEN', 'CANCELED'))
         OR (OLD.status = 'SCHEDULED' AND NEW.status IN ('DRAFT', 'OPEN', 'CANCELED'))
         OR (OLD.status = 'OPEN' AND NEW.status IN ('PAID', 'CANCELED'))
         OR reopening) THEN
      RAISE EXCEPTION 'invoices: an invoice cannot go from % to %', OLD.status, NEW.status
        USING ERRCODE = 'check_violation';
    END IF;
    IF reopening
       AND (app_invoice_paid_cents(NEW.id) >= NEW.total_cents
            OR NOT EXISTS (SELECT 1 FROM offline_payments o
                           WHERE o.business_id = NEW.business_id AND o.invoice_id = NEW.id
                             AND o.voided_at IS NOT NULL)) THEN
      RAISE EXCEPTION 'invoices: a paid invoice reopens only when a voided offline payment leaves it uncovered'
        USING ERRCODE = 'check_violation';
    END IF;
    -- Money is never left on a canceled invoice: the firm voids its offline payments and refunds
    -- its Stripe payments first (a SUCCEEDED payment, even partly refunded, still holds money; a
    -- REFUNDED one doesn't).
    IF NEW.status = 'CANCELED'
       AND (EXISTS (SELECT 1 FROM offline_payments o
                    WHERE o.business_id = NEW.business_id AND o.invoice_id = NEW.id
                      AND o.voided_at IS NULL)
            OR EXISTS (SELECT 1 FROM payments p
                       WHERE p.business_id = NEW.business_id AND p.invoice_id = NEW.id
                         AND p.status = 'SUCCEEDED')) THEN
      RAISE EXCEPTION 'invoices: it holds money; void its offline payments and refund its Stripe payments before canceling it'
        USING ERRCODE = 'check_violation';
    END IF;
    -- Nothing to pay means nothing to issue: an empty or fully discounted invoice is canceled.
    IF NEW.status = 'OPEN' AND NEW.subtotal_cents - NEW.discount_cents <= 0 THEN
      RAISE EXCEPTION 'invoices: an invoice is issued only with an amount to pay'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.status = 'PAID' THEN
      paid_cents := app_invoice_paid_cents(NEW.id);
      IF paid_cents < NEW.subtotal_cents - NEW.discount_cents + NEW.tax_cents THEN
        RAISE EXCEPTION 'invoices: PAID needs Stripe and offline payments covering the total'
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;
  END IF;

  NEW.total_cents := NEW.subtotal_cents - NEW.discount_cents + NEW.tax_cents;
  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION invoice_lines_total() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  target uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.invoice_id ELSE NEW.invoice_id END;
BEGIN
  UPDATE invoices
     SET subtotal_cents = (SELECT coalesce(sum(l.amount_cents), 0)
                             FROM invoice_lines l WHERE l.invoice_id = target),
         taxable_subtotal_cents = (SELECT coalesce(sum(l.amount_cents) FILTER (WHERE l.taxable), 0)
                                     FROM invoice_lines l WHERE l.invoice_id = target)
   WHERE id = target;
  RETURN NULL;
END
$$;
