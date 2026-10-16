-- CreateEnum
CREATE TYPE "PayrollFilingStatus" AS ENUM ('UPCOMING', 'IN_PROGRESS', 'FILED', 'PAID', 'FAILED', 'NEEDS_ATTENTION', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "PayrollPaymentStatus" AS ENUM ('SCHEDULED', 'PAID', 'FAILED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "PayrollReportKind" AS ENUM ('REGISTER', 'EARNINGS', 'DEDUCTIONS', 'EMPLOYER_TAX', 'TAX_FILING', 'JOURNAL', 'LABOR', 'W2_W3', 'FORM_1099', 'OTHER');

-- CreateEnum
CREATE TYPE "PayrollYearEndStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'RECONCILED', 'DELIVERED', 'ARCHIVED');

-- CreateTable
CREATE TABLE "payroll_filings" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "payroll_client_id" UUID NOT NULL,
    "form" TEXT NOT NULL,
    "jurisdiction" TEXT NOT NULL,
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "due_on" DATE,
    "status" "PayrollFilingStatus" NOT NULL DEFAULT 'UNKNOWN',
    "payment_status" "PayrollPaymentStatus" NOT NULL DEFAULT 'UNKNOWN',
    "confirmation_ref" TEXT,
    "source" TEXT,
    "source_synced_at" TIMESTAMPTZ(3),
    "confirmed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "payroll_filings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_reports" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "payroll_client_id" UUID NOT NULL,
    "run_id" UUID,
    "kind" "PayrollReportKind" NOT NULL,
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "document_id" UUID,
    "source" TEXT NOT NULL,
    "pulled_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "requested_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payroll_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_year_ends" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "payroll_client_id" UUID NOT NULL,
    "tax_year" INTEGER NOT NULL,
    "status" "PayrollYearEndStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "items" JSONB NOT NULL DEFAULT '{}',
    "exceptions_note" TEXT,
    "reconciled_at" TIMESTAMPTZ(3),
    "delivered_at" TIMESTAMPTZ(3),
    "delivered_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "payroll_year_ends_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "payroll_filings_business_id_payroll_client_id_due_on_idx" ON "payroll_filings"("business_id", "payroll_client_id", "due_on");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_filings_payroll_client_id_form_jurisdiction_period__key" ON "payroll_filings"("payroll_client_id", "form", "jurisdiction", "period_start", "period_end");

-- CreateIndex
CREATE INDEX "payroll_reports_business_id_payroll_client_id_kind_idx" ON "payroll_reports"("business_id", "payroll_client_id", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_reports_payroll_client_id_kind_period_start_period__key" ON "payroll_reports"("payroll_client_id", "kind", "period_start", "period_end", "version");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_year_ends_payroll_client_id_tax_year_key" ON "payroll_year_ends"("payroll_client_id", "tax_year");

-- AddForeignKey
ALTER TABLE "payroll_filings" ADD CONSTRAINT "payroll_filings_business_id_payroll_client_id_fkey" FOREIGN KEY ("business_id", "payroll_client_id") REFERENCES "payroll_clients"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_reports" ADD CONSTRAINT "payroll_reports_business_id_payroll_client_id_fkey" FOREIGN KEY ("business_id", "payroll_client_id") REFERENCES "payroll_clients"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_reports" ADD CONSTRAINT "payroll_reports_business_id_run_id_fkey" FOREIGN KEY ("business_id", "run_id") REFERENCES "payroll_runs"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_year_ends" ADD CONSTRAINT "payroll_year_ends_business_id_payroll_client_id_fkey" FOREIGN KEY ("business_id", "payroll_client_id") REFERENCES "payroll_clients"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Grants: filings are updated as the provider reports; reports are insert-only versions; year-end is archived.
GRANT SELECT, INSERT, UPDATE ON payroll_filings, payroll_year_ends TO firmivra_app;
GRANT SELECT, INSERT ON payroll_reports TO firmivra_app;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['payroll_filings', 'payroll_reports', 'payroll_year_ends'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I ON %I USING (business_id = app_current_business_id())'
                   ' WITH CHECK (business_id = app_current_business_id())', t || '_business', t);
  END LOOP;
END
$$;

-- Shape
ALTER TABLE payroll_filings ADD CONSTRAINT payroll_filings_values
  CHECK (form ~ '^[A-Za-z0-9][A-Za-z0-9 ._/-]{0,29}$' AND jurisdiction ~ '^[A-Za-z0-9_.-]{1,30}$'
         AND period_end >= period_start
         AND (confirmation_ref IS NULL OR char_length(confirmation_ref) BETWEEN 1 AND 100)
         AND (source IS NULL OR source IN ('provider', 'import'))
         -- Filed or paid only as the provider or an import confirmed it.
         AND (status NOT IN ('FILED', 'PAID') OR (confirmed_at IS NOT NULL AND source IS NOT NULL AND source_synced_at IS NOT NULL))
         AND (payment_status <> 'PAID' OR (confirmed_at IS NOT NULL AND source IS NOT NULL)));

ALTER TABLE payroll_reports ADD CONSTRAINT payroll_reports_values
  CHECK (period_end >= period_start AND version >= 1 AND source IN ('provider', 'import'));

ALTER TABLE payroll_year_ends ADD CONSTRAINT payroll_year_ends_values
  CHECK (tax_year BETWEEN 2000 AND 2100
         AND jsonb_typeof(items) = 'object' AND pg_column_size(items) <= 10000
         AND (exceptions_note IS NULL OR esign_text_ok(exceptions_note, 2000))
         AND (status NOT IN ('RECONCILED', 'DELIVERED') OR reconciled_at IS NOT NULL)
         AND (status <> 'DELIVERED' OR delivered_at IS NOT NULL));

-- A report belongs to the run's payroll client, and its file is a document of the same firm.
CREATE FUNCTION payroll_reports_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF NEW.run_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM payroll_runs r WHERE r.business_id = NEW.business_id AND r.id = NEW.run_id
          AND r.payroll_client_id = NEW.payroll_client_id) THEN
    RAISE EXCEPTION 'PAYROLL_REPORT_RUN: the run belongs to another payroll client'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.document_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM documents d WHERE d.business_id = NEW.business_id AND d.id = NEW.document_id) THEN
    RAISE EXCEPTION 'PAYROLL_REPORT_DOCUMENT: the document is not this firm''s'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER payroll_reports_rules BEFORE INSERT ON payroll_reports
  FOR EACH ROW EXECUTE FUNCTION payroll_reports_rules();
