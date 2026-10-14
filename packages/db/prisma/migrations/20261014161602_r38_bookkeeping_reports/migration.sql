-- R38 (Rasel, Oct 14), Bookkeeping, part 4: report preparation, review and delivery
-- (docs/mockups/firm-workspace/bookkeeping/source: Upcoming Reports, the Reports tab and "Report
-- Review", and the guides' sections 7 and 8). The report the client sees stays the existing
-- engagement report; bookkeeping_reports is the work around it: due date, who generated,
-- reviewed and delivered it. Delivered needs a published report of the same client and freezes
-- the row. One report per client, type and period.

-- CreateEnum
CREATE TYPE "BookkeepingReportType" AS ENUM ('PROFIT_LOSS', 'BALANCE_SHEET', 'CASH_FLOW', 'GENERAL_LEDGER', 'TRIAL_BALANCE', 'TRANSACTION_DETAIL', 'UNCATEGORIZED', 'RECONCILIATION', 'QUARTERLY_REVIEW', 'YEAR_TO_DATE_SUMMARY', 'BOOKKEEPING_STATUS', 'MISSING_DOCUMENTS', 'CUSTOM');

-- CreateEnum
CREATE TYPE "ReportReviewStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'IN_REVIEW', 'APPROVED', 'DELIVERED');

-- CreateEnum
CREATE TYPE "AccountingBasis" AS ENUM ('CASH', 'ACCRUAL');

-- CreateTable
CREATE TABLE "bookkeeping_reports" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "engagement_id" UUID NOT NULL,
    "period_id" UUID,
    "report_type" "BookkeepingReportType" NOT NULL,
    "custom_name" TEXT,
    "period_label" TEXT NOT NULL,
    "basis" "AccountingBasis",
    "due_on" DATE,
    "status" "ReportReviewStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "generated_at" TIMESTAMPTZ(3),
    "generated_by_user_id" UUID,
    "reviewed_at" TIMESTAMPTZ(3),
    "reviewed_by_user_id" UUID,
    "review_note" TEXT,
    "delivered_at" TIMESTAMPTZ(3),
    "delivered_by_user_id" UUID,
    "engagement_report_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "bookkeeping_reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "bookkeeping_reports_business_id_engagement_id_status_idx" ON "bookkeeping_reports"("business_id", "engagement_id", "status");

-- CreateIndex
CREATE INDEX "bookkeeping_reports_business_id_status_due_on_idx" ON "bookkeeping_reports"("business_id", "status", "due_on");

-- CreateIndex
CREATE UNIQUE INDEX "bookkeeping_reports_business_id_id_key" ON "bookkeeping_reports"("business_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "bookkeeping_reports_engagement_report_id_key" ON "bookkeeping_reports"("engagement_report_id");

-- AddForeignKey
ALTER TABLE "bookkeeping_reports" ADD CONSTRAINT "bookkeeping_reports_business_id_engagement_id_fkey" FOREIGN KEY ("business_id", "engagement_id") REFERENCES "engagements"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookkeeping_reports" ADD CONSTRAINT "bookkeeping_reports_business_id_period_id_fkey" FOREIGN KEY ("business_id", "period_id") REFERENCES "bookkeeping_periods"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookkeeping_reports" ADD CONSTRAINT "bookkeeping_reports_engagement_report_id_fkey" FOREIGN KEY ("engagement_report_id") REFERENCES "engagement_reports"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------- Grants, RLS, policy ----------
-- A report record is never deleted: a mistake is corrected before delivery, kept after.
GRANT SELECT, INSERT, UPDATE ON bookkeeping_reports TO firmivra_app;

ALTER TABLE bookkeeping_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE bookkeeping_reports FORCE ROW LEVEL SECURITY;
CREATE POLICY bookkeeping_reports_business ON bookkeeping_reports
  USING (business_id = app_current_business_id())
  WITH CHECK (business_id = app_current_business_id());

-- ---------- Shape ----------
ALTER TABLE bookkeeping_reports ADD CONSTRAINT bookkeeping_reports_shape
  CHECK (btrim(period_label) <> '' AND char_length(period_label) <= 60
         AND (report_type = 'CUSTOM') = (custom_name IS NOT NULL)
         AND (custom_name IS NULL OR (btrim(custom_name) <> '' AND char_length(custom_name) <= 120))
         AND char_length(review_note) <= 1000
         AND (status NOT IN ('IN_REVIEW', 'APPROVED', 'DELIVERED') OR generated_at IS NOT NULL)
         AND (status NOT IN ('APPROVED', 'DELIVERED') OR reviewed_at IS NOT NULL)
         AND ((status = 'DELIVERED') = (delivered_at IS NOT NULL))
         AND (status <> 'DELIVERED' OR engagement_report_id IS NOT NULL));
-- One report per client, type and period (custom ones by name).
CREATE UNIQUE INDEX bookkeeping_reports_one_per_period
  ON bookkeeping_reports (business_id, engagement_id, report_type, coalesce(custom_name, ''), period_label);

-- ---------- Rules ----------
CREATE FUNCTION bookkeeping_reports_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  er engagement_reports;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.status = 'DELIVERED' THEN
      RAISE EXCEPTION 'bookkeeping reports: a delivered report is frozen'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.engagement_id <> OLD.engagement_id THEN
      RAISE EXCEPTION 'bookkeeping reports: a report stays with its client'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.status <> OLD.status AND NOT ((OLD.status, NEW.status) IN (
         ('NOT_STARTED', 'IN_PROGRESS'), ('IN_PROGRESS', 'IN_REVIEW'), ('IN_REVIEW', 'APPROVED'),
         ('IN_REVIEW', 'IN_PROGRESS'), ('APPROVED', 'DELIVERED'), ('APPROVED', 'IN_PROGRESS'))) THEN
      RAISE EXCEPTION 'bookkeeping reports: a % report cannot become %', OLD.status, NEW.status
        USING ERRCODE = 'check_violation';
    END IF;
    -- Sent back for changes: the review is cleared.
    IF NEW.status = 'IN_PROGRESS' AND OLD.status IN ('IN_REVIEW', 'APPROVED') THEN
      NEW.reviewed_at := NULL; NEW.reviewed_by_user_id := NULL;
    END IF;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM bookkeeping_profiles p
       WHERE p.business_id = NEW.business_id AND p.engagement_id = NEW.engagement_id) THEN
    RAISE EXCEPTION 'bookkeeping reports: a report belongs to an engagement with a bookkeeping profile'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.period_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM bookkeeping_periods p
       WHERE p.business_id = NEW.business_id AND p.id = NEW.period_id
         AND p.engagement_id = NEW.engagement_id) THEN
    RAISE EXCEPTION 'bookkeeping reports: the period must be the same client''s'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.engagement_report_id IS NOT NULL THEN
    SELECT * INTO er FROM engagement_reports r WHERE r.id = NEW.engagement_report_id;
    IF NOT FOUND OR er.business_id <> NEW.business_id OR er.engagement_id <> NEW.engagement_id THEN
      RAISE EXCEPTION 'bookkeeping reports: the report must be one of the same client''s'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.status = 'DELIVERED' AND er.first_published_at IS NULL THEN
      RAISE EXCEPTION 'bookkeeping reports: publish the report before delivering it'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER bookkeeping_reports_rules BEFORE INSERT OR UPDATE ON bookkeeping_reports
  FOR EACH ROW EXECUTE FUNCTION bookkeeping_reports_rules();
