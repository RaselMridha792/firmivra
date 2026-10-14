-- CreateEnum
CREATE TYPE "InvoicePaymentMethod" AS ENUM ('CARD', 'ACH', 'MANUAL');

-- AlterTable
ALTER TABLE "invoices" ADD COLUMN     "allow_tip" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "autopay" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "email_client" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "include_attachments" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "internal_note" TEXT,
ADD COLUMN     "notes_to_client" TEXT,
ADD COLUMN     "payment_methods" "InvoicePaymentMethod"[] DEFAULT ARRAY['CARD', 'ACH', 'MANUAL']::"InvoicePaymentMethod"[],
ADD COLUMN     "require_payment_before_due" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "template_id" UUID;

-- CreateTable
CREATE TABLE "invoice_templates" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "memo" TEXT,
    "footer" TEXT,
    "show_logo" BOOLEAN NOT NULL DEFAULT true,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "archived_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "invoice_templates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "invoice_templates_business_id_name_key" ON "invoice_templates"("business_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "invoice_templates_business_id_id_key" ON "invoice_templates"("business_id", "id");

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_business_id_template_id_fkey" FOREIGN KEY ("business_id", "template_id") REFERENCES "invoice_templates"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_templates" ADD CONSTRAINT "invoice_templates_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- R36 (Rasel, Oct 14): the Create Invoice screen's notes, template, options and payment methods,
-- and the firm's invoice templates. Nothing here touches the money the database keeps.

-- ---------- Grants and RLS: only the firm's own business scope; archived, never deleted ----------
GRANT SELECT, INSERT, UPDATE ON invoice_templates TO firmivra_app;
ALTER TABLE invoice_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_templates FORCE ROW LEVEL SECURITY;
CREATE POLICY invoice_templates_business ON invoice_templates
  USING (business_id = app_current_business_id())
  WITH CHECK (business_id = app_current_business_id());

-- ---------- Shape ----------
ALTER TABLE invoice_templates
  ADD CONSTRAINT invoice_templates_name CHECK (btrim(name) <> '' AND char_length(name) <= 80),
  ADD CONSTRAINT invoice_templates_text
    CHECK (char_length(description) <= 500 AND char_length(memo) <= 500 AND char_length(footer) <= 500),
  ADD CONSTRAINT invoice_templates_default_live CHECK (NOT is_default OR archived_at IS NULL);
CREATE UNIQUE INDEX invoice_templates_one_default ON invoice_templates (business_id)
  WHERE is_default AND archived_at IS NULL;

ALTER TABLE invoices
  ADD CONSTRAINT invoices_notes
    CHECK (char_length(notes_to_client) <= 2000 AND char_length(internal_note) <= 2000),
  ADD CONSTRAINT invoices_autopay
    CHECK (NOT autopay OR payment_methods && ARRAY['CARD', 'ACH']::"InvoicePaymentMethod"[]);

-- ---------- Rules ----------
-- A template chosen now must be live (an old invoice may keep an archived one).
CREATE FUNCTION invoices_check_template() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF NEW.template_id IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.template_id IS DISTINCT FROM OLD.template_id)
     AND EXISTS (SELECT 1 FROM invoice_templates t
                 WHERE t.business_id = NEW.business_id AND t.id = NEW.template_id
                   AND t.archived_at IS NOT NULL) THEN
    RAISE EXCEPTION 'invoices: an archived template cannot be chosen' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER invoices_check_template
  BEFORE INSERT OR UPDATE OF template_id ON invoices
  FOR EACH ROW EXECUTE FUNCTION invoices_check_template();
