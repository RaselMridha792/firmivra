-- Tax returns per client and year (Rasel, Oct 7; R10 step 7, the client portal's Taxes tab).
-- Annual returns and quarterly estimates, with the status the client sees, the filed date and the
-- return PDF. Older years can exist without an engagement.

-- CreateEnum
CREATE TYPE "TaxFilingType" AS ENUM ('INDIVIDUAL', 'BUSINESS');

-- CreateEnum
CREATE TYPE "TaxReturnStatus" AS ENUM ('IN_PROGRESS', 'FILED', 'ACCEPTED', 'REJECTED', 'COMPLETED');

-- CreateTable
CREATE TABLE "tax_returns" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "engagement_id" UUID,
    "tax_year" INTEGER NOT NULL,
    "filing_type" "TaxFilingType" NOT NULL,
    "quarter" INTEGER,
    "form_type" TEXT,
    "status" "TaxReturnStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "filed_on" DATE,
    "document_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "tax_returns_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tax_returns_business_id_client_id_tax_year_idx" ON "tax_returns"("business_id", "client_id", "tax_year");

-- CreateIndex
CREATE INDEX "tax_returns_business_id_document_id_idx" ON "tax_returns"("business_id", "document_id");

-- AddForeignKey
ALTER TABLE "tax_returns" ADD CONSTRAINT "tax_returns_business_id_client_id_fkey" FOREIGN KEY ("business_id", "client_id") REFERENCES "clients"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_returns" ADD CONSTRAINT "tax_returns_business_id_client_id_engagement_id_fkey" FOREIGN KEY ("business_id", "client_id", "engagement_id") REFERENCES "engagements"("business_id", "client_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_returns" ADD CONSTRAINT "tax_returns_business_id_document_id_fkey" FOREIGN KEY ("business_id", "document_id") REFERENCES "documents"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------- Grants, RLS ----------
GRANT SELECT, INSERT, UPDATE, DELETE ON tax_returns TO firmivra_app;
ALTER TABLE tax_returns ENABLE ROW LEVEL SECURITY;
ALTER TABLE tax_returns FORCE ROW LEVEL SECURITY;
CREATE POLICY tax_returns_read ON tax_returns FOR SELECT
  USING (business_id = app_current_business_id());
CREATE POLICY tax_returns_insert ON tax_returns FOR INSERT
  WITH CHECK (business_id = app_current_business_id());
CREATE POLICY tax_returns_update ON tax_returns FOR UPDATE
  USING (business_id = app_current_business_id())
  WITH CHECK (business_id = app_current_business_id());
-- A return the client may already have seen as filed stays: only IN_PROGRESS can be deleted.
CREATE POLICY tax_returns_delete ON tax_returns FOR DELETE
  USING (business_id = app_current_business_id() AND status = 'IN_PROGRESS');

-- ---------- Data rules Prisma cannot express ----------
ALTER TABLE tax_returns ADD CONSTRAINT tax_returns_tax_year CHECK (tax_year BETWEEN 2000 AND 2100);
ALTER TABLE tax_returns ADD CONSTRAINT tax_returns_quarter CHECK (quarter BETWEEN 1 AND 4);
ALTER TABLE tax_returns ADD CONSTRAINT tax_returns_form_type
  CHECK (btrim(form_type) <> '' AND char_length(form_type) <= 20);
-- Filed and accepted returns say when they were filed.
ALTER TABLE tax_returns ADD CONSTRAINT tax_returns_filed_on
  CHECK (status NOT IN ('FILED', 'ACCEPTED') OR filed_on IS NOT NULL);

-- A return stays with its client. The return PDF must be one of that client's documents and never
-- INTERNAL (the client views and downloads it). filed_on is never in the future (database clock,
-- one day of slack for time zones).
CREATE FUNCTION tax_returns_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.id <> OLD.id OR NEW.business_id <> OLD.business_id
                           OR NEW.client_id <> OLD.client_id) THEN
    RAISE EXCEPTION 'tax returns: a return cannot change client' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.document_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.document_id IS DISTINCT FROM OLD.document_id)
     AND NOT EXISTS (SELECT 1 FROM documents d
                     WHERE d.business_id = NEW.business_id AND d.id = NEW.document_id
                       AND d.client_id = NEW.client_id AND d.direction <> 'INTERNAL') THEN
    RAISE EXCEPTION 'tax returns: the return document must be one of this client''s documents, not an internal one'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.filed_on > current_date + 1 THEN
    RAISE EXCEPTION 'tax returns: filed_on cannot be in the future' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER tax_returns_rules
  BEFORE INSERT OR UPDATE ON tax_returns
  FOR EACH ROW EXECUTE FUNCTION tax_returns_rules();
