-- R37 (Rasel, Oct 14), Tax Returns: review. tax_return_approvals are the required review steps
-- (who decided, when, which draft); tax_return_checklist_items are the preparation list, the
-- review list and the manual final validation's results, with warnings acknowledged by a person.
-- A return that has such records reaches READY_TO_FILE (or beyond) only when its validation has
-- no error and no open warning and every approval step is approved; a return without them
-- (today's) is unaffected.

-- CreateEnum
CREATE TYPE "TaxApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'RETURNED', 'INVALIDATED');

-- CreateEnum
CREATE TYPE "TaxChecklistSection" AS ENUM ('PREPARATION', 'REVIEW', 'VALIDATION');

-- CreateEnum
CREATE TYPE "TaxCheckResult" AS ENUM ('OPEN', 'DONE', 'VALID', 'INFO', 'WARNING', 'ERROR');

-- CreateTable
CREATE TABLE "tax_return_approvals" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "tax_return_id" UUID NOT NULL,
    "step" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL,
    "assigned_user_id" UUID,
    "status" "TaxApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "decided_at" TIMESTAMPTZ(3),
    "decided_by_user_id" UUID,
    "approved_document_id" UUID,
    "note" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tax_return_approvals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_return_checklist_items" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "tax_return_id" UUID NOT NULL,
    "section" "TaxChecklistSection" NOT NULL,
    "label" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "result" "TaxCheckResult" NOT NULL DEFAULT 'OPEN',
    "note" TEXT,
    "acknowledged_at" TIMESTAMPTZ(3),
    "acknowledged_by_user_id" UUID,
    "updated_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "tax_return_checklist_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tax_return_approvals_business_id_tax_return_id_sort_order_idx" ON "tax_return_approvals"("business_id", "tax_return_id", "sort_order");

-- CreateIndex
CREATE INDEX "tax_return_approvals_business_id_assigned_user_id_status_idx" ON "tax_return_approvals"("business_id", "assigned_user_id", "status");

-- CreateIndex
CREATE INDEX "tax_return_checklist_items_business_id_tax_return_id_sectio_idx" ON "tax_return_checklist_items"("business_id", "tax_return_id", "section", "sort_order");

-- AddForeignKey
ALTER TABLE "tax_return_approvals" ADD CONSTRAINT "tax_return_approvals_business_id_tax_return_id_fkey" FOREIGN KEY ("business_id", "tax_return_id") REFERENCES "tax_returns"("business_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_return_approvals" ADD CONSTRAINT "tax_return_approvals_business_id_assigned_user_id_fkey" FOREIGN KEY ("business_id", "assigned_user_id") REFERENCES "memberships"("business_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_return_approvals" ADD CONSTRAINT "tax_return_approvals_business_id_decided_by_user_id_fkey" FOREIGN KEY ("business_id", "decided_by_user_id") REFERENCES "memberships"("business_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_return_approvals" ADD CONSTRAINT "tax_return_approvals_business_id_approved_document_id_fkey" FOREIGN KEY ("business_id", "approved_document_id") REFERENCES "documents"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_return_checklist_items" ADD CONSTRAINT "tax_return_checklist_items_business_id_tax_return_id_fkey" FOREIGN KEY ("business_id", "tax_return_id") REFERENCES "tax_returns"("business_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_return_checklist_items" ADD CONSTRAINT "tax_return_checklist_items_business_id_acknowledged_by_use_fkey" FOREIGN KEY ("business_id", "acknowledged_by_user_id") REFERENCES "memberships"("business_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_return_checklist_items" ADD CONSTRAINT "tax_return_checklist_items_business_id_updated_by_user_id_fkey" FOREIGN KEY ("business_id", "updated_by_user_id") REFERENCES "memberships"("business_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------- Grants and RLS ----------
-- Approvals are never deleted; checklist lines are working notes and can be removed.
GRANT SELECT, INSERT, UPDATE ON tax_return_approvals TO firmivra_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON tax_return_checklist_items TO firmivra_app;
ALTER TABLE tax_return_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE tax_return_approvals FORCE ROW LEVEL SECURITY;
ALTER TABLE tax_return_checklist_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE tax_return_checklist_items FORCE ROW LEVEL SECURITY;
CREATE POLICY tax_return_approvals_business ON tax_return_approvals
  USING (business_id = app_current_business_id())
  WITH CHECK (business_id = app_current_business_id());
CREATE POLICY tax_return_checklist_items_business ON tax_return_checklist_items
  USING (business_id = app_current_business_id())
  WITH CHECK (business_id = app_current_business_id());

-- ---------- Shape ----------
ALTER TABLE tax_return_approvals ADD CONSTRAINT tax_return_approvals_text
  CHECK (char_length(btrim(step)) >= 1 AND char_length(step) <= 100 AND app_no_hidden_characters(step)
     AND (note IS NULL OR (char_length(btrim(note)) >= 1 AND char_length(note) <= 2000)));
-- Pending has no decision; every other state keeps who and when; sending back says why.
ALTER TABLE tax_return_approvals ADD CONSTRAINT tax_return_approvals_decision
  CHECK ((status = 'PENDING') = (decided_at IS NULL)
     AND (decided_at IS NULL) = (decided_by_user_id IS NULL)
     AND (status <> 'RETURNED' OR note IS NOT NULL));

ALTER TABLE tax_return_checklist_items ADD CONSTRAINT tax_return_checklist_items_text
  CHECK (char_length(btrim(label)) >= 1 AND char_length(label) <= 200 AND app_no_hidden_characters(label)
     AND (note IS NULL OR (char_length(btrim(note)) >= 1 AND char_length(note) <= 1000)));
-- The two lists are open or done; the validation's results are valid, info, warning or error.
ALTER TABLE tax_return_checklist_items ADD CONSTRAINT tax_return_checklist_items_result
  CHECK ((section = 'VALIDATION') = (result IN ('VALID', 'INFO', 'WARNING', 'ERROR')));
-- Only a warning is acknowledged, by someone, at some time.
ALTER TABLE tax_return_checklist_items ADD CONSTRAINT tax_return_checklist_items_ack
  CHECK ((acknowledged_at IS NULL) = (acknowledged_by_user_id IS NULL)
     AND (acknowledged_at IS NULL OR result = 'WARNING'));

-- ---------- Rules ----------
-- A step stays with its return; a decided step changes only to INVALIDATED, once, from APPROVED
-- (a material change); the reviewed draft is one of the return's client's documents.
CREATE FUNCTION tax_return_approvals_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF NEW.approved_document_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.approved_document_id IS DISTINCT FROM OLD.approved_document_id)
     AND NOT EXISTS (SELECT 1 FROM documents d JOIN tax_returns r ON r.client_id = d.client_id
                     WHERE d.business_id = NEW.business_id AND d.id = NEW.approved_document_id
                       AND r.business_id = NEW.business_id AND r.id = NEW.tax_return_id) THEN
    RAISE EXCEPTION 'tax return approvals: the reviewed draft is a document of the return''s client'
      USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'INSERT' THEN
    RETURN NEW;
  END IF;
  IF NEW.id <> OLD.id OR NEW.business_id <> OLD.business_id OR NEW.tax_return_id <> OLD.tax_return_id
     OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'tax return approvals: the return of a step cannot change'
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status <> 'PENDING' AND NOT (OLD.status = 'APPROVED' AND NEW.status = 'INVALIDATED'
       AND NEW.decided_at = OLD.decided_at AND NEW.decided_by_user_id = OLD.decided_by_user_id
       AND NEW.step = OLD.step AND NEW.note IS NOT DISTINCT FROM OLD.note) THEN
    RAISE EXCEPTION 'tax return approvals: a decided step does not change'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER tax_return_approvals_rules
  BEFORE INSERT OR UPDATE ON tax_return_approvals
  FOR EACH ROW EXECUTE FUNCTION tax_return_approvals_rules();

-- A line stays with its return and section; a result that leaves WARNING loses its
-- acknowledgment (a new warning is acknowledged anew).
CREATE FUNCTION tax_return_checklist_items_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.id <> OLD.id OR NEW.business_id <> OLD.business_id OR NEW.tax_return_id <> OLD.tax_return_id
       OR NEW.section <> OLD.section OR NEW.created_at <> OLD.created_at THEN
      RAISE EXCEPTION 'tax return checklist: the return and section of a line cannot change'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.result <> OLD.result THEN
      NEW.acknowledged_at := NULL;
      NEW.acknowledged_by_user_id := NULL;
    END IF;
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER tax_return_checklist_items_rules
  BEFORE INSERT OR UPDATE ON tax_return_checklist_items
  FOR EACH ROW EXECUTE FUNCTION tax_return_checklist_items_rules();

-- Ready to file: a return that has validation results needs the manual final validation done,
-- no ERROR and no unacknowledged WARNING; one that has approval steps needs every live step
-- APPROVED. Fires after tax_returns_0_workflow settled the step; a return without these records
-- is unaffected.
CREATE FUNCTION tax_returns_2_ready() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF tax_return_step(NEW.workflow_status) >= 4 AND tax_return_step(OLD.workflow_status) < 4 THEN
    IF EXISTS (SELECT 1 FROM tax_return_checklist_items c
               WHERE c.business_id = NEW.business_id AND c.tax_return_id = NEW.id
                 AND c.section = 'VALIDATION')
       AND (NEW.final_validated_at IS NULL OR EXISTS (
              SELECT 1 FROM tax_return_checklist_items c
              WHERE c.business_id = NEW.business_id AND c.tax_return_id = NEW.id
                AND c.section = 'VALIDATION'
                AND (c.result = 'ERROR' OR (c.result = 'WARNING' AND c.acknowledged_at IS NULL)))) THEN
      RAISE EXCEPTION 'tax returns: finish the final validation (no errors, warnings acknowledged) before ready to file'
        USING ERRCODE = 'check_violation';
    END IF;
    IF EXISTS (SELECT 1 FROM tax_return_approvals a
               WHERE a.business_id = NEW.business_id AND a.tax_return_id = NEW.id
                 AND a.status IN ('PENDING', 'RETURNED')) THEN
      RAISE EXCEPTION 'tax returns: every review step must be approved before ready to file'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER tax_returns_2_ready
  BEFORE UPDATE ON tax_returns
  FOR EACH ROW EXECUTE FUNCTION tax_returns_2_ready();
