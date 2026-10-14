-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "OfflinePaymentMethod" ADD VALUE 'ACH';
ALTER TYPE "OfflinePaymentMethod" ADD VALUE 'CARD';
ALTER TYPE "OfflinePaymentMethod" ADD VALUE 'OTHER';

-- AlterTable
ALTER TABLE "invoice_events" ADD COLUMN     "offline_payment_id" UUID,
ADD COLUMN     "payment_id" UUID;

-- AlterTable
ALTER TABLE "offline_payments" ADD COLUMN     "deposit_account_id" UUID;

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "card_brand" TEXT,
ADD COLUMN     "last4" TEXT,
ADD COLUMN     "method_type" TEXT,
ADD COLUMN     "tip_cents" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "invoice_attachments" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "added_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoice_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deposit_accounts" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "archived_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "deposit_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "invoice_attachments_business_id_document_id_idx" ON "invoice_attachments"("business_id", "document_id");

-- CreateIndex
CREATE UNIQUE INDEX "invoice_attachments_business_id_invoice_id_document_id_key" ON "invoice_attachments"("business_id", "invoice_id", "document_id");

-- CreateIndex
CREATE UNIQUE INDEX "deposit_accounts_business_id_name_key" ON "deposit_accounts"("business_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "deposit_accounts_business_id_id_key" ON "deposit_accounts"("business_id", "id");

-- AddForeignKey
ALTER TABLE "offline_payments" ADD CONSTRAINT "offline_payments_business_id_deposit_account_id_fkey" FOREIGN KEY ("business_id", "deposit_account_id") REFERENCES "deposit_accounts"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_events" ADD CONSTRAINT "invoice_events_business_id_payment_id_fkey" FOREIGN KEY ("business_id", "payment_id") REFERENCES "payments"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_events" ADD CONSTRAINT "invoice_events_business_id_offline_payment_id_fkey" FOREIGN KEY ("business_id", "offline_payment_id") REFERENCES "offline_payments"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_attachments" ADD CONSTRAINT "invoice_attachments_business_id_invoice_id_fkey" FOREIGN KEY ("business_id", "invoice_id") REFERENCES "invoices"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_attachments" ADD CONSTRAINT "invoice_attachments_business_id_document_id_fkey" FOREIGN KEY ("business_id", "document_id") REFERENCES "documents"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_attachments" ADD CONSTRAINT "invoice_attachments_business_id_added_by_user_id_fkey" FOREIGN KEY ("business_id", "added_by_user_id") REFERENCES "memberships"("business_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deposit_accounts" ADD CONSTRAINT "deposit_accounts_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- R36 (Rasel, Oct 14): Record Payment's other methods and "Deposit To", how a Stripe payment was
-- made (Payment Method column), a tip, the payment a receipt is about, the files sent with an
-- invoice, and the firm's deposit accounts. Nothing here changes how invoices are paid.

-- ---------- Grants and RLS: only the firm's own business scope ----------
GRANT SELECT, INSERT, UPDATE ON deposit_accounts TO firmivra_app;
GRANT SELECT, INSERT, DELETE ON invoice_attachments TO firmivra_app;
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['deposit_accounts', 'invoice_attachments'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I ON %I USING (business_id = app_current_business_id())'
                   ' WITH CHECK (business_id = app_current_business_id())', t || '_business', t);
  END LOOP;
END
$$;

-- ---------- Shape ----------
ALTER TABLE deposit_accounts
  ADD CONSTRAINT deposit_accounts_name CHECK (btrim(name) <> '' AND char_length(name) <= 80),
  ADD CONSTRAINT deposit_accounts_default_live CHECK (NOT is_default OR archived_at IS NULL);
CREATE UNIQUE INDEX deposit_accounts_one_default ON deposit_accounts (business_id)
  WHERE is_default AND archived_at IS NULL;

ALTER TABLE payments
  ADD CONSTRAINT payments_method_details
    CHECK ((method_type IS NULL OR method_type ~ '^[a-z_]{1,30}$')
           AND (card_brand IS NULL OR (coalesce(method_type = 'card', false) AND card_brand ~ '^[a-z_]{1,30}$'))
           AND (last4 IS NULL OR (method_type IS NOT NULL AND last4 ~ '^[0-9]{4}$'))),
  ADD CONSTRAINT payments_tip CHECK (tip_cents >= 0);

ALTER TABLE invoice_events
  ADD CONSTRAINT invoice_events_one_payment CHECK (payment_id IS NULL OR offline_payment_id IS NULL);

-- ---------- Rules ----------
-- How a payment was made is set once, when the processor tells us, and the tip never changes.
CREATE FUNCTION payments_details_once() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF NEW.tip_cents <> OLD.tip_cents
     OR (OLD.method_type IS NOT NULL AND NEW.method_type IS DISTINCT FROM OLD.method_type)
     OR (OLD.card_brand IS NOT NULL AND NEW.card_brand IS DISTINCT FROM OLD.card_brand)
     OR (OLD.last4 IS NOT NULL AND NEW.last4 IS DISTINCT FROM OLD.last4) THEN
    RAISE EXCEPTION 'payments: the tip and how it was paid are set once' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER payments_details_once
  BEFORE UPDATE ON payments
  FOR EACH ROW EXECUTE FUNCTION payments_details_once();

-- Money is deposited into a live account.
CREATE FUNCTION offline_payments_deposit() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF NEW.deposit_account_id IS NOT NULL AND EXISTS (
       SELECT 1 FROM deposit_accounts d
        WHERE d.business_id = NEW.business_id AND d.id = NEW.deposit_account_id AND d.archived_at IS NOT NULL) THEN
    RAISE EXCEPTION 'offline payments: an archived deposit account cannot be chosen' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER offline_payments_deposit
  BEFORE INSERT ON offline_payments
  FOR EACH ROW EXECUTE FUNCTION offline_payments_deposit();

-- A file sent with an invoice is the invoice client's own, shared with them and scanned clean, and
-- changes only while the invoice can still change.
CREATE FUNCTION invoice_attachments_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  target uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.invoice_id ELSE NEW.invoice_id END;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM invoices i WHERE i.id = target AND i.status NOT IN ('PAID', 'CANCELED')) THEN
    RAISE EXCEPTION 'invoice attachments: a paid or canceled invoice keeps its files'
      USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM invoices i JOIN documents d ON d.id = NEW.document_id
                 WHERE i.id = NEW.invoice_id AND d.client_id = i.client_id
                   AND d.direction <> 'INTERNAL' AND d.scan_status = 'CLEAN') THEN
    RAISE EXCEPTION 'invoice attachments: the document must be a clean, shared document of the invoice''s client'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER invoice_attachments_rules
  BEFORE INSERT OR DELETE ON invoice_attachments
  FOR EACH ROW EXECUTE FUNCTION invoice_attachments_rules();
