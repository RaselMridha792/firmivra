-- R37 (Rasel, Oct 14), Tax Returns: e-file and filing status. tax_return_filings is one row per
-- jurisdiction of a return (federal "US" and each state): method, required, status, refund or
-- amount due (cents) and extension. tax_return_filing_attempts is each recorded transmission and
-- its acknowledgment. Status tracking only: staff record what their tax software did; nothing is
-- sent from here. A return with filings can be marked transmitted only after an attempt (or a
-- paper filing) and accepted or closed only when every required jurisdiction is resolved.

-- CreateEnum
CREATE TYPE "TaxFilingMethod" AS ENUM ('EFILE', 'PAPER');

-- CreateEnum
CREATE TYPE "TaxJurisdictionStatus" AS ENUM ('NOT_FILED', 'TRANSMITTED', 'ACCEPTED', 'REJECTED', 'PAPER_FILED');

-- CreateEnum
CREATE TYPE "TaxAmountStatus" AS ENUM ('ESTIMATED', 'FINAL');

-- CreateEnum
CREATE TYPE "TaxExtensionStatus" AS ENUM ('NOT_FILED', 'PREPARED', 'FILED', 'ACCEPTED', 'REJECTED');

-- CreateEnum
CREATE TYPE "TaxAckStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED');

-- CreateTable
CREATE TABLE "tax_return_filings" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "tax_return_id" UUID NOT NULL,
    "jurisdiction" TEXT NOT NULL,
    "filing_method" "TaxFilingMethod" NOT NULL DEFAULT 'EFILE',
    "required" BOOLEAN NOT NULL DEFAULT true,
    "status" "TaxJurisdictionStatus" NOT NULL DEFAULT 'NOT_FILED',
    "paper_filed_on" DATE,
    "refund_cents" INTEGER,
    "amount_due_cents" INTEGER,
    "amount_status" "TaxAmountStatus",
    "extension_status" "TaxExtensionStatus" NOT NULL DEFAULT 'NOT_FILED',
    "extended_due_on" DATE,
    "extension_confirmation" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "tax_return_filings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_return_filing_attempts" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "filing_id" UUID NOT NULL,
    "submission_id" TEXT NOT NULL,
    "transmitted_at" TIMESTAMPTZ(3) NOT NULL,
    "ack_status" "TaxAckStatus" NOT NULL DEFAULT 'PENDING',
    "acknowledged_at" TIMESTAMPTZ(3),
    "reject_code" TEXT,
    "reject_description" TEXT,
    "corrective_action" TEXT,
    "recorded_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tax_return_filing_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tax_return_filings_business_id_status_idx" ON "tax_return_filings"("business_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "tax_return_filings_business_id_tax_return_id_jurisdiction_key" ON "tax_return_filings"("business_id", "tax_return_id", "jurisdiction");

-- CreateIndex
CREATE UNIQUE INDEX "tax_return_filings_business_id_id_key" ON "tax_return_filings"("business_id", "id");

-- CreateIndex
CREATE INDEX "tax_return_filing_attempts_business_id_filing_id_transmitte_idx" ON "tax_return_filing_attempts"("business_id", "filing_id", "transmitted_at");

-- CreateIndex
CREATE INDEX "tax_return_filing_attempts_business_id_ack_status_transmitt_idx" ON "tax_return_filing_attempts"("business_id", "ack_status", "transmitted_at");

-- CreateIndex
CREATE UNIQUE INDEX "tax_return_filing_attempts_business_id_filing_id_submission_key" ON "tax_return_filing_attempts"("business_id", "filing_id", "submission_id");

-- AddForeignKey
ALTER TABLE "tax_return_filings" ADD CONSTRAINT "tax_return_filings_business_id_tax_return_id_fkey" FOREIGN KEY ("business_id", "tax_return_id") REFERENCES "tax_returns"("business_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_return_filing_attempts" ADD CONSTRAINT "tax_return_filing_attempts_business_id_filing_id_fkey" FOREIGN KEY ("business_id", "filing_id") REFERENCES "tax_return_filings"("business_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_return_filing_attempts" ADD CONSTRAINT "tax_return_filing_attempts_business_id_recorded_by_user_id_fkey" FOREIGN KEY ("business_id", "recorded_by_user_id") REFERENCES "memberships"("business_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------- Grants and RLS ----------
-- Filings go with a return that was never filed (the cascade); attempts are never deleted by
-- the app.
GRANT SELECT, INSERT, UPDATE ON tax_return_filings, tax_return_filing_attempts TO firmivra_app;
ALTER TABLE tax_return_filings ENABLE ROW LEVEL SECURITY;
ALTER TABLE tax_return_filings FORCE ROW LEVEL SECURITY;
ALTER TABLE tax_return_filing_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE tax_return_filing_attempts FORCE ROW LEVEL SECURITY;
CREATE POLICY tax_return_filings_business ON tax_return_filings
  USING (business_id = app_current_business_id())
  WITH CHECK (business_id = app_current_business_id());
CREATE POLICY tax_return_filing_attempts_business ON tax_return_filing_attempts
  USING (business_id = app_current_business_id())
  WITH CHECK (business_id = app_current_business_id());

-- ---------- Shape ----------
ALTER TABLE tax_return_filings ADD CONSTRAINT tax_return_filings_jurisdiction
  CHECK (jurisdiction ~ '^(US|[A-Z]{2})$');
ALTER TABLE tax_return_filings ADD CONSTRAINT tax_return_filings_method_status
  CHECK ((filing_method = 'PAPER' AND status IN ('NOT_FILED', 'PAPER_FILED'))
      OR (filing_method = 'EFILE' AND status <> 'PAPER_FILED'));
ALTER TABLE tax_return_filings ADD CONSTRAINT tax_return_filings_paper
  CHECK ((status = 'PAPER_FILED') = (paper_filed_on IS NOT NULL));
-- A refund or an amount due, never both, in cents; the amount says estimate or final.
ALTER TABLE tax_return_filings ADD CONSTRAINT tax_return_filings_amounts
  CHECK ((refund_cents IS NULL OR refund_cents >= 0) AND (amount_due_cents IS NULL OR amount_due_cents >= 0)
     AND NOT (coalesce(refund_cents, 0) > 0 AND coalesce(amount_due_cents, 0) > 0)
     AND ((refund_cents IS NULL AND amount_due_cents IS NULL) = (amount_status IS NULL)));
ALTER TABLE tax_return_filings ADD CONSTRAINT tax_return_filings_extension
  CHECK ((extension_status <> 'ACCEPTED' OR extended_due_on IS NOT NULL)
     AND (extension_confirmation IS NULL OR (char_length(btrim(extension_confirmation)) >= 1
          AND char_length(extension_confirmation) <= 100)));

ALTER TABLE tax_return_filing_attempts ADD CONSTRAINT tax_return_filing_attempts_text
  CHECK (char_length(btrim(submission_id)) >= 1 AND char_length(submission_id) <= 50
     AND (reject_code IS NULL OR (char_length(btrim(reject_code)) >= 1 AND char_length(reject_code) <= 50))
     AND (reject_description IS NULL OR (char_length(btrim(reject_description)) >= 1
          AND char_length(reject_description) <= 2000))
     AND (corrective_action IS NULL OR (char_length(btrim(corrective_action)) >= 1
          AND char_length(corrective_action) <= 2000)));
-- Pending has no answer yet; accepted or rejected says when; only a rejection has a reason.
ALTER TABLE tax_return_filing_attempts ADD CONSTRAINT tax_return_filing_attempts_ack
  CHECK ((ack_status = 'PENDING') = (acknowledged_at IS NULL)
     AND (acknowledged_at IS NULL OR acknowledged_at >= transmitted_at)
     AND ((ack_status = 'REJECTED') = (reject_code IS NOT NULL OR reject_description IS NOT NULL)));
-- One answer awaited per filing.
CREATE UNIQUE INDEX tax_return_filing_attempts_one_pending ON tax_return_filing_attempts (filing_id)
  WHERE ack_status = 'PENDING';

-- ---------- Rules ----------
-- A filing stays with its return and jurisdiction. An e-file status follows its attempts: only
-- the attempts' trigger (one level down) sets it. The method changes only before any attempt.
CREATE FUNCTION tax_return_filings_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.filing_method = 'EFILE' AND NEW.status <> 'NOT_FILED' THEN
      RAISE EXCEPTION 'tax return filings: an e-file status follows its attempts'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.id <> OLD.id OR NEW.business_id <> OLD.business_id OR NEW.tax_return_id <> OLD.tax_return_id
     OR NEW.jurisdiction <> OLD.jurisdiction OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'tax return filings: the return and jurisdiction of a filing cannot change'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.filing_method <> OLD.filing_method AND EXISTS (
       SELECT 1 FROM tax_return_filing_attempts a
       WHERE a.business_id = NEW.business_id AND a.filing_id = NEW.id) THEN
    RAISE EXCEPTION 'tax return filings: the method cannot change after an attempt'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.filing_method = 'EFILE' AND NEW.status <> OLD.status AND pg_trigger_depth() = 1 THEN
    RAISE EXCEPTION 'tax return filings: an e-file status follows its attempts'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER tax_return_filings_rules
  BEFORE INSERT OR UPDATE ON tax_return_filings
  FOR EACH ROW EXECUTE FUNCTION tax_return_filings_rules();

-- Attempts: of an e-file filing, and only the first or after a rejection; transmitted now or
-- before; once answered only the corrective action changes; nothing else ever does.
CREATE FUNCTION tax_return_filing_attempts_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT EXISTS (SELECT 1 FROM tax_return_filings f WHERE f.business_id = NEW.business_id
                   AND f.id = NEW.filing_id AND f.filing_method = 'EFILE') THEN
      RAISE EXCEPTION 'tax return filing attempts: an attempt belongs to an e-file filing'
        USING ERRCODE = 'check_violation';
    END IF;
    IF EXISTS (SELECT 1 FROM tax_return_filing_attempts a WHERE a.business_id = NEW.business_id
               AND a.filing_id = NEW.filing_id AND a.ack_status <> 'REJECTED') THEN
      RAISE EXCEPTION 'tax return filing attempts: a new attempt follows a rejection'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.transmitted_at > now() + interval '1 minute' THEN
      RAISE EXCEPTION 'tax return filing attempts: transmitted_at cannot be in the future'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.id <> OLD.id OR NEW.business_id <> OLD.business_id OR NEW.filing_id <> OLD.filing_id
     OR NEW.submission_id <> OLD.submission_id OR NEW.transmitted_at <> OLD.transmitted_at
     OR NEW.recorded_by_user_id <> OLD.recorded_by_user_id OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'tax return filing attempts: what was transmitted, and by whom, cannot change'
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.ack_status <> 'PENDING' AND (NEW.ack_status <> OLD.ack_status
     OR NEW.acknowledged_at IS DISTINCT FROM OLD.acknowledged_at
     OR NEW.reject_code IS DISTINCT FROM OLD.reject_code
     OR NEW.reject_description IS DISTINCT FROM OLD.reject_description) THEN
    RAISE EXCEPTION 'tax return filing attempts: an answered attempt keeps its answer'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER tax_return_filing_attempts_rules
  BEFORE INSERT OR UPDATE ON tax_return_filing_attempts
  FOR EACH ROW EXECUTE FUNCTION tax_return_filing_attempts_rules();

-- The filing's status follows its newest attempt.
CREATE FUNCTION tax_return_filing_attempts_status() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  UPDATE tax_return_filings
     SET status = CASE NEW.ack_status WHEN 'PENDING' THEN 'TRANSMITTED'
                    WHEN 'ACCEPTED' THEN 'ACCEPTED' ELSE 'REJECTED' END::"TaxJurisdictionStatus"
   WHERE business_id = NEW.business_id AND id = NEW.filing_id;
  RETURN NULL;
END
$$;

CREATE TRIGGER tax_return_filing_attempts_status
  AFTER INSERT OR UPDATE ON tax_return_filing_attempts
  FOR EACH ROW EXECUTE FUNCTION tax_return_filing_attempts_status();

-- A return that has filings is marked transmitted only when a required jurisdiction was sent
-- (or filed on paper), and accepted or closed only when every required jurisdiction is accepted
-- or filed on paper. A return without filings (today's way) is unaffected. Fires after
-- tax_returns_0_workflow has settled the step.
CREATE FUNCTION tax_returns_1_filings() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF NEW.workflow_status IS DISTINCT FROM OLD.workflow_status AND EXISTS (
       SELECT 1 FROM tax_return_filings f
       WHERE f.business_id = NEW.business_id AND f.tax_return_id = NEW.id) THEN
    IF NEW.workflow_status = 'TRANSMITTED' AND NOT EXISTS (
         SELECT 1 FROM tax_return_filings f
         WHERE f.business_id = NEW.business_id AND f.tax_return_id = NEW.id AND f.required
           AND f.status IN ('TRANSMITTED', 'ACCEPTED', 'PAPER_FILED')) THEN
      RAISE EXCEPTION 'tax returns: record a transmission or a paper filing before marking the return transmitted'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.workflow_status IN ('ACCEPTED', 'CLOSED') AND EXISTS (
         SELECT 1 FROM tax_return_filings f
         WHERE f.business_id = NEW.business_id AND f.tax_return_id = NEW.id AND f.required
           AND f.status NOT IN ('ACCEPTED', 'PAPER_FILED')) THEN
      RAISE EXCEPTION 'tax returns: every required jurisdiction must be accepted or filed on paper first'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER tax_returns_1_filings
  BEFORE UPDATE ON tax_returns
  FOR EACH ROW EXECUTE FUNCTION tax_returns_1_filings();
