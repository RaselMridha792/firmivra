-- r1_tax_attempt_agency (R1, Oct 26; Rasel's tap for Octavia's Oct 25 reviews, 2 of 4, second of
-- two migrations): TX-F22 of the Tax Returns review (docs/specs/review-2026-10-26/CHANGE-LIST.md).
-- A rejection names the agency that rejected it, beside its code, description and corrective
-- action. No backfill. Requiring the agency on a new rejection is the API's rule (today's Record
-- Rejection has no such field yet); here it is only on a rejection and kept once recorded.

-- AlterTable
ALTER TABLE "tax_return_filing_attempts" ADD COLUMN     "rejecting_agency" TEXT;



-- ---------- Data rules Prisma cannot express ----------
ALTER TABLE tax_return_filing_attempts ADD CONSTRAINT tax_return_filing_attempts_agency
  CHECK (rejecting_agency IS NULL
      OR (ack_status = 'REJECTED' AND char_length(btrim(rejecting_agency)) >= 1
          AND char_length(rejecting_agency) <= 100 AND rejecting_agency !~ '[\r\n]'));

-- The r37 rules, plus: a recorded agency is part of the answer and never changes. An earlier
-- rejection without one may still have it added once.
CREATE OR REPLACE FUNCTION tax_return_filing_attempts_rules() RETURNS trigger
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
     OR NEW.reject_description IS DISTINCT FROM OLD.reject_description
     OR (OLD.rejecting_agency IS NOT NULL
         AND NEW.rejecting_agency IS DISTINCT FROM OLD.rejecting_agency)) THEN
    RAISE EXCEPTION 'tax return filing attempts: an answered attempt keeps its answer'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
