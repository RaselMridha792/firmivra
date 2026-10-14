-- R37 (Rasel, Oct 14), Tax Returns: the firm's workflow on a return (list, workspace, review).
-- tax_returns gets workflow_status (nine steps), preparer and reviewer, filing status, due date,
-- amendment link and reason, the quarterly estimate, the manual final validation, import facts,
-- archive and the author of the last change; tax_return_history records each change of step or
-- people. `status` (what the client sees) and workflow_status are kept together by the database,
-- whichever one a write changes, so today's API keeps working. Status tracking only: nothing is
-- sent to the IRS or a state.

-- CreateEnum
CREATE TYPE "TaxReturnWorkflowStatus" AS ENUM ('IN_PREPARATION', 'WAITING_ON_CLIENT', 'READY_FOR_REVIEW', 'READY_FOR_SIGNATURE', 'READY_TO_FILE', 'TRANSMITTED', 'ACCEPTED', 'REJECTED', 'CLOSED');

-- CreateEnum
CREATE TYPE "TaxpayerFilingStatus" AS ENUM ('SINGLE', 'MARRIED_FILING_JOINTLY', 'MARRIED_FILING_SEPARATELY', 'HEAD_OF_HOUSEHOLD', 'QUALIFYING_SURVIVING_SPOUSE');

-- CreateEnum
CREATE TYPE "TaxEstimateStatus" AS ENUM ('NOT_STARTED', 'CALCULATED', 'SENT_TO_CLIENT', 'SCHEDULED', 'PAID');

-- AlterTable
ALTER TABLE "tax_returns" ADD COLUMN     "amend_reason" TEXT,
ADD COLUMN     "amends_return_id" UUID,
ADD COLUMN     "archived_at" TIMESTAMPTZ(3),
ADD COLUMN     "due_on" DATE,
ADD COLUMN     "estimate_amount_cents" INTEGER,
ADD COLUMN     "estimate_paid_on" DATE,
ADD COLUMN     "estimate_status" "TaxEstimateStatus",
ADD COLUMN     "filing_status" "TaxpayerFilingStatus",
ADD COLUMN     "final_validated_at" TIMESTAMPTZ(3),
ADD COLUMN     "final_validated_by_user_id" UUID,
ADD COLUMN     "import_source" TEXT,
ADD COLUMN     "imported_at" TIMESTAMPTZ(3),
ADD COLUMN     "preparer_user_id" UUID,
ADD COLUMN     "reviewer_user_id" UUID,
ADD COLUMN     "status_reason" TEXT,
ADD COLUMN     "updated_by_user_id" UUID,
ADD COLUMN     "workflow_status" "TaxReturnWorkflowStatus" NOT NULL DEFAULT 'IN_PREPARATION';

-- CreateTable
CREATE TABLE "tax_return_history" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "business_id" UUID NOT NULL,
    "tax_return_id" UUID NOT NULL,
    "workflow_status" "TaxReturnWorkflowStatus" NOT NULL,
    "preparer_user_id" UUID,
    "reviewer_user_id" UUID,
    "reason" TEXT,
    "changed_by_user_id" UUID,
    "changed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
    "seq" BIGSERIAL NOT NULL,

    CONSTRAINT "tax_return_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tax_return_history_business_id_tax_return_id_seq_idx" ON "tax_return_history"("business_id", "tax_return_id", "seq");

-- CreateIndex
CREATE INDEX "tax_return_history_business_id_changed_at_idx" ON "tax_return_history"("business_id", "changed_at");

-- CreateIndex
CREATE INDEX "tax_returns_business_id_tax_year_workflow_status_idx" ON "tax_returns"("business_id", "tax_year", "workflow_status");

-- CreateIndex
CREATE INDEX "tax_returns_business_id_preparer_user_id_workflow_status_idx" ON "tax_returns"("business_id", "preparer_user_id", "workflow_status");

-- CreateIndex
CREATE INDEX "tax_returns_business_id_reviewer_user_id_idx" ON "tax_returns"("business_id", "reviewer_user_id");

-- CreateIndex
CREATE INDEX "tax_returns_business_id_updated_at_idx" ON "tax_returns"("business_id", "updated_at");

-- CreateIndex
CREATE INDEX "tax_returns_business_id_due_on_idx" ON "tax_returns"("business_id", "due_on");

-- CreateIndex
CREATE INDEX "tax_returns_business_id_amends_return_id_idx" ON "tax_returns"("business_id", "amends_return_id");

-- CreateIndex
CREATE UNIQUE INDEX "tax_returns_business_id_client_id_id_key" ON "tax_returns"("business_id", "client_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "tax_returns_business_id_id_key" ON "tax_returns"("business_id", "id");

-- AddForeignKey
ALTER TABLE "tax_returns" ADD CONSTRAINT "tax_returns_business_id_preparer_user_id_fkey" FOREIGN KEY ("business_id", "preparer_user_id") REFERENCES "memberships"("business_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_returns" ADD CONSTRAINT "tax_returns_business_id_reviewer_user_id_fkey" FOREIGN KEY ("business_id", "reviewer_user_id") REFERENCES "memberships"("business_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_returns" ADD CONSTRAINT "tax_returns_business_id_final_validated_by_user_id_fkey" FOREIGN KEY ("business_id", "final_validated_by_user_id") REFERENCES "memberships"("business_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_returns" ADD CONSTRAINT "tax_returns_business_id_updated_by_user_id_fkey" FOREIGN KEY ("business_id", "updated_by_user_id") REFERENCES "memberships"("business_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_returns" ADD CONSTRAINT "tax_returns_business_id_client_id_amends_return_id_fkey" FOREIGN KEY ("business_id", "client_id", "amends_return_id") REFERENCES "tax_returns"("business_id", "client_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_return_history" ADD CONSTRAINT "tax_return_history_business_id_tax_return_id_fkey" FOREIGN KEY ("business_id", "tax_return_id") REFERENCES "tax_returns"("business_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ---------- Existing returns (local and dev): the step that matches what the client sees ----------
DO $$
DECLARE
  firm uuid;
  firms uuid[];
BEGIN
  PERFORM set_config('app.scope', 'platform', true);
  SELECT coalesce(array_agg(id), '{}') INTO firms FROM businesses;
  FOREACH firm IN ARRAY firms LOOP
    PERFORM set_config('app.scope', 'business', true);
    PERFORM set_config('app.current_business_id', firm::text, true);
    UPDATE tax_returns
       SET workflow_status = CASE status WHEN 'IN_PROGRESS' THEN 'IN_PREPARATION'
                                         WHEN 'FILED' THEN 'TRANSMITTED'
                                         WHEN 'ACCEPTED' THEN 'ACCEPTED'
                                         WHEN 'REJECTED' THEN 'REJECTED'
                                         ELSE 'CLOSED' END::"TaxReturnWorkflowStatus"
     WHERE business_id = firm;
  END LOOP;
  PERFORM set_config('app.scope', '', true);
  PERFORM set_config('app.current_business_id', '', true);
END
$$;

-- ---------- Grants and RLS ----------
-- The app reads the history; the trigger below writes it (as the table owner).
GRANT SELECT ON tax_return_history TO firmivra_app;
ALTER TABLE tax_return_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE tax_return_history FORCE ROW LEVEL SECURITY;
CREATE POLICY tax_return_history_business ON tax_return_history
  USING (business_id = app_current_business_id())
  WITH CHECK (business_id = app_current_business_id());

-- ---------- Shape ----------
ALTER TABLE tax_returns ADD CONSTRAINT tax_returns_filing_status
  CHECK (filing_status IS NULL OR filing_type = 'INDIVIDUAL');
ALTER TABLE tax_returns ADD CONSTRAINT tax_returns_amendment
  CHECK ((amends_return_id IS NULL) = (amend_reason IS NULL)
     AND (amends_return_id IS NULL OR amends_return_id <> id)
     AND (amend_reason IS NULL OR (char_length(btrim(amend_reason)) >= 1 AND char_length(amend_reason) <= 2000)));
-- The estimate belongs to a quarterly return; PAID says when.
ALTER TABLE tax_returns ADD CONSTRAINT tax_returns_estimate
  CHECK ((quarter IS NOT NULL OR (estimate_amount_cents IS NULL AND estimate_status IS NULL AND estimate_paid_on IS NULL))
     AND (estimate_amount_cents IS NULL OR estimate_amount_cents >= 0)
     AND ((estimate_status = 'PAID') = (estimate_paid_on IS NOT NULL)));
ALTER TABLE tax_returns ADD CONSTRAINT tax_returns_final_validation
  CHECK ((final_validated_at IS NULL) = (final_validated_by_user_id IS NULL));
ALTER TABLE tax_returns ADD CONSTRAINT tax_returns_import
  CHECK ((import_source IS NULL) = (imported_at IS NULL)
     AND (import_source IS NULL OR (char_length(btrim(import_source)) >= 1 AND char_length(import_source) <= 100)));
ALTER TABLE tax_returns ADD CONSTRAINT tax_returns_status_reason
  CHECK (status_reason IS NULL OR (char_length(btrim(status_reason)) >= 1 AND char_length(status_reason) <= 500));

-- ---------- Rules ----------
-- The order of the steps, for "moving back needs a reason". WAITING_ON_CLIENT has no place in it.
CREATE FUNCTION tax_return_step(s "TaxReturnWorkflowStatus") RETURNS int
  LANGUAGE sql
  IMMUTABLE
  AS $$
  SELECT CASE s WHEN 'IN_PREPARATION' THEN 1 WHEN 'READY_FOR_REVIEW' THEN 2
                WHEN 'READY_FOR_SIGNATURE' THEN 3 WHEN 'READY_TO_FILE' THEN 4
                WHEN 'TRANSMITTED' THEN 5 WHEN 'REJECTED' THEN 6 WHEN 'ACCEPTED' THEN 7
                WHEN 'CLOSED' THEN 8 END
$$;

-- What the client sees for each step.
CREATE FUNCTION tax_return_client_status(s "TaxReturnWorkflowStatus") RETURNS "TaxReturnStatus"
  LANGUAGE sql
  IMMUTABLE
  AS $$
  SELECT CASE s WHEN 'TRANSMITTED' THEN 'FILED' WHEN 'ACCEPTED' THEN 'ACCEPTED'
                WHEN 'REJECTED' THEN 'REJECTED' WHEN 'CLOSED' THEN 'COMPLETED'
                ELSE 'IN_PROGRESS' END::"TaxReturnStatus"
$$;

-- Runs before tax_returns_rules (triggers fire in name order) so that rule sees the final status.
-- Whichever of workflow_status and status a write changes, the other follows: a step gives its
-- client status; a client status written alone gives the nearest step. TRANSMITTED, ACCEPTED and
-- CLOSED returns only move forward (a rejected one may go back to preparation or to ready to
-- file), and a move back a step needs status_reason (filed and accepted still need filed_on, by
-- the existing check). An amendment's original is a filed return of the same client.
CREATE FUNCTION tax_returns_0_workflow() RETURNS trigger
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

CREATE TRIGGER tax_returns_0_workflow
  BEFORE INSERT OR UPDATE ON tax_returns
  FOR EACH ROW EXECUTE FUNCTION tax_returns_0_workflow();

-- The history: one row for a new return and for every change of step, preparer or reviewer, by
-- the author of that write (updated_by_user_id). Written as the table owner (the app only reads).
CREATE FUNCTION tax_returns_history() RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.workflow_status = OLD.workflow_status
     AND NEW.preparer_user_id IS NOT DISTINCT FROM OLD.preparer_user_id
     AND NEW.reviewer_user_id IS NOT DISTINCT FROM OLD.reviewer_user_id THEN
    RETURN NULL;
  END IF;
  INSERT INTO tax_return_history
    (business_id, tax_return_id, workflow_status, preparer_user_id, reviewer_user_id, reason, changed_by_user_id)
  VALUES
    (NEW.business_id, NEW.id, NEW.workflow_status, NEW.preparer_user_id, NEW.reviewer_user_id,
     CASE WHEN TG_OP = 'UPDATE' AND NEW.workflow_status IS DISTINCT FROM OLD.workflow_status
          THEN NEW.status_reason END,
     NEW.updated_by_user_id);
  RETURN NULL;
END
$$;

CREATE TRIGGER tax_returns_history
  AFTER INSERT OR UPDATE ON tax_returns
  FOR EACH ROW EXECUTE FUNCTION tax_returns_history();
