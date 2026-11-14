-- CreateEnum
CREATE TYPE "TaxAmountRounding" AS ENUM ('EXACT', 'ROUND_TO_DOLLAR');

-- AlterTable
ALTER TABLE "business_settings" ADD COLUMN     "tax_amount_rounding" "TaxAmountRounding" NOT NULL DEFAULT 'EXACT';

-- AlterTable
ALTER TABLE "tax_returns" ADD COLUMN     "extended_due_on" DATE,
ADD COLUMN     "extension_filed_on" DATE;

-- AlterTable
ALTER TABLE "tax_statuses" ADD COLUMN     "workflow_status" "TaxReturnWorkflowStatus";


-- ---------- Rules (Tax Returns Review 2, the lead's approval of Nov 15) ----------
-- File Extension (recorded, never submitted here): the day it was filed and the new deadline are
-- set together, the new deadline after the original one when there is one.
ALTER TABLE tax_returns ADD CONSTRAINT tax_returns_extension
  CHECK ((extension_filed_on IS NULL) = (extended_due_on IS NULL)
     AND (extended_due_on IS NULL OR due_on IS NULL OR extended_due_on > due_on));

-- TX-F36: the workflow status the seeded labels stand for (exact names only; others stay null).
UPDATE tax_statuses SET workflow_status = (CASE name
    WHEN 'Waiting for documents' THEN 'WAITING_ON_CLIENT'
    WHEN 'Documents received' THEN 'IN_PREPARATION'
    WHEN 'In preparation' THEN 'IN_PREPARATION'
    WHEN 'Ready for review' THEN 'READY_FOR_REVIEW'
    WHEN 'Filed' THEN 'TRANSMITTED'
    WHEN 'Accepted' THEN 'ACCEPTED' END)::"TaxReturnWorkflowStatus"
  WHERE name IN ('Waiting for documents', 'Documents received', 'In preparation',
                 'Ready for review', 'Filed', 'Accepted');

-- In Correction: the preparer's step after a rejection. Its place is preparation's, so leaving
-- Rejected for it needs a reason (as going back did), and the client sees In Progress
-- (tax_return_client_status's ELSE).
CREATE OR REPLACE FUNCTION tax_return_step(s "TaxReturnWorkflowStatus") RETURNS int
  LANGUAGE sql
  IMMUTABLE
  AS $$
  SELECT CASE s WHEN 'IN_PREPARATION' THEN 1 WHEN 'IN_CORRECTION' THEN 1
                WHEN 'READY_FOR_REVIEW' THEN 2
                WHEN 'READY_FOR_SIGNATURE' THEN 3 WHEN 'READY_TO_FILE' THEN 4
                WHEN 'TRANSMITTED' THEN 5 WHEN 'REJECTED' THEN 6 WHEN 'ACCEPTED' THEN 7
                WHEN 'CLOSED' THEN 8 END
$$;

-- As r37_tax_return_workflow's, with one rule added: a rejected return goes to In Correction
-- before Ready for Review, never straight to review (Octavia, Review 2).
CREATE OR REPLACE FUNCTION tax_returns_0_workflow() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  derived "TaxReturnWorkflowStatus";
  original_first_filed timestamptz;
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- A caller that sets only `status` (today's API) gets the step that matches it.
    IF NEW.workflow_status = 'IN_PREPARATION' AND NEW.status <> 'IN_PROGRESS' THEN
      NEW.workflow_status := CASE NEW.status WHEN 'FILED' THEN 'TRANSMITTED'
        WHEN 'ACCEPTED' THEN 'ACCEPTED' WHEN 'REJECTED' THEN 'REJECTED' ELSE 'CLOSED' END;
    END IF;
  ELSE
    IF NEW.workflow_status IS DISTINCT FROM OLD.workflow_status THEN
      IF OLD.workflow_status IN ('TRANSMITTED', 'ACCEPTED', 'CLOSED')
         AND NOT (OLD.workflow_status = 'TRANSMITTED' AND NEW.workflow_status IN ('ACCEPTED', 'REJECTED', 'CLOSED'))
         AND NOT (OLD.workflow_status = 'ACCEPTED' AND NEW.workflow_status = 'CLOSED') THEN
        RAISE EXCEPTION 'tax returns: a return that was filed cannot go from % to %', OLD.workflow_status, NEW.workflow_status
          USING ERRCODE = 'check_violation';
      END IF;
      IF OLD.workflow_status = 'REJECTED' AND NEW.workflow_status = 'READY_FOR_REVIEW' THEN
        RAISE EXCEPTION 'tax returns: a rejected return goes to In Correction before review'
          USING ERRCODE = 'check_violation';
      END IF;
      IF tax_return_step(NEW.workflow_status) < tax_return_step(OLD.workflow_status)
         AND (NEW.status_reason IS NULL OR NEW.status_reason IS NOT DISTINCT FROM OLD.status_reason) THEN
        RAISE EXCEPTION 'tax returns: moving back a step needs a reason'
          USING ERRCODE = 'check_violation';
      END IF;
    ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
      derived := CASE NEW.status WHEN 'FILED' THEN 'TRANSMITTED' WHEN 'ACCEPTED' THEN 'ACCEPTED'
        WHEN 'REJECTED' THEN 'REJECTED' WHEN 'COMPLETED' THEN 'CLOSED'
        ELSE CASE WHEN tax_return_step(NEW.workflow_status) <= 4 OR NEW.workflow_status = 'WAITING_ON_CLIENT'
                  THEN NEW.workflow_status ELSE 'IN_PREPARATION' END END;
      NEW.workflow_status := derived;
    END IF;
  END IF;
  NEW.status := tax_return_client_status(NEW.workflow_status);

  IF NEW.amends_return_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.amends_return_id IS DISTINCT FROM OLD.amends_return_id) THEN
    SELECT r.first_filed_at INTO original_first_filed FROM tax_returns r
      WHERE r.business_id = NEW.business_id AND r.id = NEW.amends_return_id;
    IF original_first_filed IS NULL THEN
      RAISE EXCEPTION 'tax returns: an amended return amends a return that was filed'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END
$$;
