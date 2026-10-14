-- CreateEnum
CREATE TYPE "BillingFrequency" AS ENUM ('ONE_TIME', 'WEEKLY', 'BIWEEKLY', 'SEMI_MONTHLY', 'MONTHLY', 'QUARTERLY', 'SEMIANNUAL', 'ANNUAL');

-- CreateEnum
CREATE TYPE "RecurringInvoiceStatus" AS ENUM ('ACTIVE', 'PAUSED', 'COMPLETED', 'ENDED');

-- CreateEnum
CREATE TYPE "InvoiceDelivery" AS ENUM ('EMAIL', 'PORTAL', 'EMAIL_AND_PORTAL');

-- AlterTable
ALTER TABLE "invoices" ADD COLUMN     "recurring_invoice_id" UUID,
ADD COLUMN     "recurring_period_on" DATE;

-- CreateTable
CREATE TABLE "recurring_invoices" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "engagement_id" UUID,
    "name" TEXT NOT NULL,
    "template_id" UUID,
    "frequency" "BillingFrequency" NOT NULL,
    "start_on" DATE NOT NULL,
    "next_send_on" DATE,
    "end_on" DATE,
    "max_occurrences" INTEGER,
    "occurrences" INTEGER NOT NULL DEFAULT 0,
    "status" "RecurringInvoiceStatus" NOT NULL DEFAULT 'ACTIVE',
    "auto_send" BOOLEAN NOT NULL DEFAULT true,
    "autopay" BOOLEAN NOT NULL DEFAULT false,
    "delivery" "InvoiceDelivery" NOT NULL DEFAULT 'EMAIL_AND_PORTAL',
    "payment_terms" TEXT,
    "tax_rate_id" UUID,
    "discount_type" "InvoiceDiscountType" NOT NULL DEFAULT 'FIXED',
    "discount_percent" DECIMAL(5,2),
    "discount_cents" INTEGER NOT NULL DEFAULT 0,
    "notes_to_client" TEXT,
    "assigned_user_id" UUID,
    "created_by_user_id" UUID,
    "paused_at" TIMESTAMPTZ(3),
    "ended_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "recurring_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recurring_invoice_lines" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "recurring_invoice_id" UUID NOT NULL,
    "service_id" UUID,
    "item_name" TEXT,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(10,2) NOT NULL DEFAULT 1,
    "unit_amount_cents" INTEGER NOT NULL,
    "taxable" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "recurring_invoice_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "recurring_invoices_business_id_status_next_send_on_idx" ON "recurring_invoices"("business_id", "status", "next_send_on");

-- CreateIndex
CREATE INDEX "recurring_invoices_business_id_client_id_idx" ON "recurring_invoices"("business_id", "client_id");

-- CreateIndex
CREATE UNIQUE INDEX "recurring_invoices_business_id_id_key" ON "recurring_invoices"("business_id", "id");

-- CreateIndex
CREATE INDEX "recurring_invoice_lines_business_id_recurring_invoice_id_idx" ON "recurring_invoice_lines"("business_id", "recurring_invoice_id");

-- CreateIndex
CREATE INDEX "invoices_business_id_recurring_invoice_id_idx" ON "invoices"("business_id", "recurring_invoice_id");

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_business_id_recurring_invoice_id_fkey" FOREIGN KEY ("business_id", "recurring_invoice_id") REFERENCES "recurring_invoices"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_invoices" ADD CONSTRAINT "recurring_invoices_business_id_client_id_fkey" FOREIGN KEY ("business_id", "client_id") REFERENCES "clients"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_invoices" ADD CONSTRAINT "recurring_invoices_business_id_client_id_engagement_id_fkey" FOREIGN KEY ("business_id", "client_id", "engagement_id") REFERENCES "engagements"("business_id", "client_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_invoices" ADD CONSTRAINT "recurring_invoices_business_id_template_id_fkey" FOREIGN KEY ("business_id", "template_id") REFERENCES "invoice_templates"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_invoices" ADD CONSTRAINT "recurring_invoices_business_id_tax_rate_id_fkey" FOREIGN KEY ("business_id", "tax_rate_id") REFERENCES "invoice_tax_rates"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_invoices" ADD CONSTRAINT "recurring_invoices_business_id_assigned_user_id_fkey" FOREIGN KEY ("business_id", "assigned_user_id") REFERENCES "memberships"("business_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_invoices" ADD CONSTRAINT "recurring_invoices_business_id_created_by_user_id_fkey" FOREIGN KEY ("business_id", "created_by_user_id") REFERENCES "memberships"("business_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_invoice_lines" ADD CONSTRAINT "recurring_invoice_lines_business_id_recurring_invoice_id_fkey" FOREIGN KEY ("business_id", "recurring_invoice_id") REFERENCES "recurring_invoices"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_invoice_lines" ADD CONSTRAINT "recurring_invoice_lines_business_id_service_id_fkey" FOREIGN KEY ("business_id", "service_id") REFERENCES "services"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- R36 (Rasel, Oct 14): the Recurring Invoices screen (schedules and their lines, the invoices
-- they make, one per period).

-- ---------- Grants and RLS: only the firm's own business scope; ended, never deleted ----------
GRANT SELECT, INSERT, UPDATE ON recurring_invoices TO firmivra_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON recurring_invoice_lines TO firmivra_app;
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['recurring_invoices', 'recurring_invoice_lines'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I ON %I USING (business_id = app_current_business_id())'
                   ' WITH CHECK (business_id = app_current_business_id())', t || '_business', t);
  END LOOP;
END
$$;

-- ---------- Shape ----------
ALTER TABLE recurring_invoices
  ADD CONSTRAINT recurring_invoices_name CHECK (btrim(name) <> '' AND char_length(name) <= 100),
  ADD CONSTRAINT recurring_invoices_frequency CHECK (frequency <> 'ONE_TIME'),
  -- A live schedule has a next period; a finished one has none.
  ADD CONSTRAINT recurring_invoices_next
    CHECK ((status IN ('ACTIVE', 'PAUSED')) = (next_send_on IS NOT NULL)
           AND (next_send_on IS NULL OR next_send_on >= start_on)),
  ADD CONSTRAINT recurring_invoices_end_rule
    CHECK (NOT (end_on IS NOT NULL AND max_occurrences IS NOT NULL)
           AND (end_on IS NULL OR end_on >= start_on)
           AND (max_occurrences IS NULL OR max_occurrences >= 1)
           AND occurrences >= 0 AND (max_occurrences IS NULL OR occurrences <= max_occurrences)),
  ADD CONSTRAINT recurring_invoices_paused CHECK ((status = 'PAUSED') = (paused_at IS NOT NULL)),
  ADD CONSTRAINT recurring_invoices_ended
    CHECK ((status IN ('COMPLETED', 'ENDED')) = (ended_at IS NOT NULL)),
  ADD CONSTRAINT recurring_invoices_terms CHECK (payment_terms ~ '^[a-z0-9_]{1,30}$'),
  ADD CONSTRAINT recurring_invoices_discount
    CHECK ((discount_type = 'PERCENT') = (discount_percent IS NOT NULL)
           AND (discount_percent IS NULL OR discount_percent BETWEEN 0 AND 100)
           AND discount_cents >= 0 AND (discount_type = 'FIXED' OR discount_cents = 0)),
  ADD CONSTRAINT recurring_invoices_notes CHECK (char_length(notes_to_client) <= 2000);

ALTER TABLE recurring_invoice_lines
  ADD CONSTRAINT recurring_invoice_lines_values
    CHECK (btrim(description) <> '' AND quantity > 0 AND unit_amount_cents >= 0
           AND (item_name IS NULL OR (btrim(item_name) <> '' AND char_length(item_name) <= 200)));

-- An invoice names the schedule and the period it covers (both or neither); one per period.
ALTER TABLE invoices
  ADD CONSTRAINT invoices_recurring CHECK ((recurring_invoice_id IS NULL) = (recurring_period_on IS NULL));
CREATE UNIQUE INDEX invoices_one_per_recurring_period
  ON invoices (business_id, recurring_invoice_id, recurring_period_on) WHERE recurring_invoice_id IS NOT NULL;
