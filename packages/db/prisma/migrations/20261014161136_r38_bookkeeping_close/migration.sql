-- R38 (Rasel, Oct 14), Bookkeeping, part 3: reporting periods with their close workflow, the
-- close checklist and account reconciliations (docs/mockups/firm-workspace/bookkeeping/source:
-- the workspace's Current Period, Reconciliation and "Close, reconciliation and report review"
-- screens, and the detailed guide's section 6). A period goes NOT_STARTED, IN_PROGRESS,
-- READY_FOR_REVIEW, APPROVED, CLOSED; CLOSED locks it, its checklist and its reconciliations
-- until it is reopened with a reason (which raises the close version). A period closes only with
-- its required checklist steps done. A reconciliation is approved only when its difference (ending
-- minus cleared) is within the tolerance. Income and expense totals are optional: unavailable
-- figures are never invented.

-- CreateEnum
CREATE TYPE "BookkeepingPeriodKind" AS ENUM ('MONTH', 'QUARTER', 'YEAR', 'CUSTOM');

-- CreateEnum
CREATE TYPE "BookkeepingPeriodStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'READY_FOR_REVIEW', 'APPROVED', 'CLOSED');

-- CreateEnum
CREATE TYPE "ReconciliationStatus" AS ENUM ('IN_PROGRESS', 'READY_FOR_REVIEW', 'APPROVED', 'REOPENED');

-- CreateEnum
CREATE TYPE "FiguresSource" AS ENUM ('MANUAL', 'IMPORTED');

-- CreateTable
CREATE TABLE "bookkeeping_periods" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "engagement_id" UUID NOT NULL,
    "kind" "BookkeepingPeriodKind" NOT NULL DEFAULT 'MONTH',
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "label" TEXT NOT NULL,
    "status" "BookkeepingPeriodStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "close_by_on" DATE,
    "ready_for_review_at" TIMESTAMPTZ(3),
    "ready_for_review_by" UUID,
    "approved_at" TIMESTAMPTZ(3),
    "approved_by" UUID,
    "closed_at" TIMESTAMPTZ(3),
    "closed_by" UUID,
    "close_version" INTEGER NOT NULL DEFAULT 1,
    "reopened_at" TIMESTAMPTZ(3),
    "reopened_by" UUID,
    "reopen_reason" TEXT,
    "income_cents" INTEGER,
    "expenses_cents" INTEGER,
    "figures_source" "FiguresSource",
    "figures_as_of" TIMESTAMPTZ(3),
    "uncategorized_count" INTEGER,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "bookkeeping_periods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bookkeeping_close_items" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "period_id" UUID NOT NULL,
    "item_key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "position" INTEGER NOT NULL,
    "completed_at" TIMESTAMPTZ(3),
    "completed_by_user_id" UUID,
    "note" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "bookkeeping_close_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bookkeeping_reconciliations" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "period_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "statement_start" DATE NOT NULL,
    "statement_end" DATE NOT NULL,
    "beginning_balance_cents" INTEGER NOT NULL,
    "ending_balance_cents" INTEGER NOT NULL,
    "cleared_balance_cents" INTEGER NOT NULL DEFAULT 0,
    "cleared_count" INTEGER NOT NULL DEFAULT 0,
    "difference_cents" INTEGER NOT NULL,
    "tolerance_cents" INTEGER NOT NULL DEFAULT 0,
    "exceptions_count" INTEGER NOT NULL DEFAULT 0,
    "statement_document_id" UUID,
    "status" "ReconciliationStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "ready_for_review_at" TIMESTAMPTZ(3),
    "approved_at" TIMESTAMPTZ(3),
    "approved_by" UUID,
    "reopened_at" TIMESTAMPTZ(3),
    "reopened_by" UUID,
    "reopen_reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "bookkeeping_reconciliations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "bookkeeping_periods_business_id_status_close_by_on_idx" ON "bookkeeping_periods"("business_id", "status", "close_by_on");

-- CreateIndex
CREATE UNIQUE INDEX "bookkeeping_periods_business_id_id_key" ON "bookkeeping_periods"("business_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "bookkeeping_periods_business_id_engagement_id_period_start__key" ON "bookkeeping_periods"("business_id", "engagement_id", "period_start", "period_end");

-- CreateIndex
CREATE INDEX "bookkeeping_close_items_business_id_period_id_position_idx" ON "bookkeeping_close_items"("business_id", "period_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "bookkeeping_close_items_business_id_period_id_item_key_key" ON "bookkeeping_close_items"("business_id", "period_id", "item_key");

-- CreateIndex
CREATE INDEX "bookkeeping_reconciliations_business_id_status_idx" ON "bookkeeping_reconciliations"("business_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "bookkeeping_reconciliations_business_id_period_id_account_i_key" ON "bookkeeping_reconciliations"("business_id", "period_id", "account_id");

-- AddForeignKey
ALTER TABLE "bookkeeping_periods" ADD CONSTRAINT "bookkeeping_periods_business_id_engagement_id_fkey" FOREIGN KEY ("business_id", "engagement_id") REFERENCES "engagements"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookkeeping_close_items" ADD CONSTRAINT "bookkeeping_close_items_business_id_period_id_fkey" FOREIGN KEY ("business_id", "period_id") REFERENCES "bookkeeping_periods"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookkeeping_reconciliations" ADD CONSTRAINT "bookkeeping_reconciliations_business_id_period_id_fkey" FOREIGN KEY ("business_id", "period_id") REFERENCES "bookkeeping_periods"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookkeeping_reconciliations" ADD CONSTRAINT "bookkeeping_reconciliations_business_id_account_id_fkey" FOREIGN KEY ("business_id", "account_id") REFERENCES "bookkeeping_accounts"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookkeeping_reconciliations" ADD CONSTRAINT "bookkeeping_reconciliations_business_id_statement_document_fkey" FOREIGN KEY ("business_id", "statement_document_id") REFERENCES "documents"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------- Grants, RLS, policy ----------
-- Periods and reconciliations are a record (never deleted); the checklist is made with the period.
GRANT SELECT, INSERT, UPDATE ON bookkeeping_periods, bookkeeping_close_items,
  bookkeeping_reconciliations TO firmivra_app;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['bookkeeping_periods', 'bookkeeping_close_items',
    'bookkeeping_reconciliations'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I ON %I USING (business_id = app_current_business_id())'
                   ' WITH CHECK (business_id = app_current_business_id())', t || '_business', t);
  END LOOP;
END
$$;

-- ---------- Shape ----------
ALTER TABLE bookkeeping_periods ADD CONSTRAINT bookkeeping_periods_shape
  CHECK (period_end >= period_start AND btrim(label) <> '' AND char_length(label) <= 60
         AND close_version >= 1 AND char_length(reopen_reason) <= 500
         AND (status NOT IN ('READY_FOR_REVIEW', 'APPROVED', 'CLOSED') OR ready_for_review_at IS NOT NULL)
         AND (status NOT IN ('APPROVED', 'CLOSED') OR approved_at IS NOT NULL)
         AND ((status = 'CLOSED') = (closed_at IS NOT NULL))
         -- A reopen has its time and its reason together.
         AND (reopened_at IS NULL OR btrim(coalesce(reopen_reason, '')) <> '')
         -- The totals, their source and date come together, or none of them.
         AND ((income_cents IS NULL) = (expenses_cents IS NULL)
              AND (income_cents IS NULL) = (figures_source IS NULL)
              AND (income_cents IS NULL) = (figures_as_of IS NULL))
         AND (income_cents IS NULL OR (income_cents >= 0 AND expenses_cents >= 0))
         AND (uncategorized_count IS NULL OR uncategorized_count >= 0));

ALTER TABLE bookkeeping_close_items ADD CONSTRAINT bookkeeping_close_items_shape
  CHECK (item_key ~ '^[a-z][a-z0-9_]{1,39}$' AND btrim(label) <> '' AND char_length(label) <= 200
         AND position >= 0 AND char_length(note) <= 500
         AND (completed_by_user_id IS NULL OR completed_at IS NOT NULL));

ALTER TABLE bookkeeping_reconciliations ADD CONSTRAINT bookkeeping_reconciliations_shape
  CHECK (statement_end >= statement_start
         AND cleared_count >= 0 AND exceptions_count >= 0 AND tolerance_cents >= 0
         AND char_length(reopen_reason) <= 500
         -- Ending minus cleared; the stored difference is never taken on trust.
         AND difference_cents = ending_balance_cents - cleared_balance_cents
         -- Approval needs the difference within the tolerance, and no open exceptions.
         AND (status <> 'APPROVED' OR (abs(difference_cents) <= tolerance_cents
                                       AND exceptions_count = 0 AND approved_at IS NOT NULL))
         AND (status NOT IN ('READY_FOR_REVIEW', 'APPROVED') OR ready_for_review_at IS NOT NULL)
         AND (reopened_at IS NULL OR btrim(coalesce(reopen_reason, '')) <> ''));

-- ---------- The close workflow ----------
CREATE FUNCTION bookkeeping_periods_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT EXISTS (SELECT 1 FROM bookkeeping_profiles p
         WHERE p.business_id = NEW.business_id AND p.engagement_id = NEW.engagement_id) THEN
      RAISE EXCEPTION 'bookkeeping: a period belongs to an engagement with a bookkeeping profile'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF (NEW.engagement_id, NEW.period_start, NEW.period_end)
     IS DISTINCT FROM (OLD.engagement_id, OLD.period_start, OLD.period_end) THEN
    RAISE EXCEPTION 'bookkeeping: a period keeps its client and dates'
      USING ERRCODE = 'check_violation';
  END IF;
  -- Closed means locked: only a reopen may touch the row.
  IF OLD.status = 'CLOSED' AND NEW.status = 'CLOSED' THEN
    RAISE EXCEPTION 'bookkeeping: a closed period is locked, reopen it first'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status <> OLD.status THEN
    IF NOT ((OLD.status, NEW.status) IN (
         ('NOT_STARTED', 'IN_PROGRESS'), ('IN_PROGRESS', 'READY_FOR_REVIEW'),
         ('READY_FOR_REVIEW', 'APPROVED'), ('READY_FOR_REVIEW', 'IN_PROGRESS'),
         ('APPROVED', 'CLOSED'), ('APPROVED', 'IN_PROGRESS'), ('CLOSED', 'IN_PROGRESS'))) THEN
      RAISE EXCEPTION 'bookkeeping: a % period cannot become %', OLD.status, NEW.status
        USING ERRCODE = 'check_violation';
    END IF;
    -- Going back (a send-back or a reopen) is explained and dated; a reopen of a closed period
    -- starts a new close version and clears the approval.
    IF OLD.status IN ('APPROVED', 'CLOSED') AND NEW.status = 'IN_PROGRESS' THEN
      IF NEW.reopened_at IS NOT DISTINCT FROM OLD.reopened_at THEN
        RAISE EXCEPTION 'bookkeeping: reopening a period needs a new reopen time and reason'
          USING ERRCODE = 'check_violation';
      END IF;
      IF OLD.status = 'CLOSED' THEN
        NEW.close_version := OLD.close_version + 1;
      END IF;
      NEW.approved_at := NULL; NEW.approved_by := NULL;
      NEW.closed_at := NULL; NEW.closed_by := NULL;
      NEW.ready_for_review_at := NULL; NEW.ready_for_review_by := NULL;
    ELSIF OLD.status = 'READY_FOR_REVIEW' AND NEW.status = 'IN_PROGRESS' THEN
      NEW.ready_for_review_at := NULL; NEW.ready_for_review_by := NULL;
    END IF;
    -- Closing needs every required checklist step done.
    IF NEW.status = 'CLOSED' AND EXISTS (SELECT 1 FROM bookkeeping_close_items i
         WHERE i.business_id = NEW.business_id AND i.period_id = NEW.id
           AND i.required AND i.completed_at IS NULL) THEN
      RAISE EXCEPTION 'bookkeeping: complete the required close steps before closing the period'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER bookkeeping_periods_rules BEFORE INSERT OR UPDATE ON bookkeeping_periods
  FOR EACH ROW EXECUTE FUNCTION bookkeeping_periods_rules();

-- ---------- Checklist and reconciliations: same client, locked with the period ----------
CREATE FUNCTION bookkeeping_period_parts_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  period bookkeeping_periods;
BEGIN
  SELECT * INTO period FROM bookkeeping_periods p
   WHERE p.business_id = NEW.business_id AND p.id = NEW.period_id;
  IF TG_OP = 'UPDATE' AND NEW.period_id <> OLD.period_id THEN
    RAISE EXCEPTION 'bookkeeping: a close step or reconciliation stays in its period'
      USING ERRCODE = 'check_violation';
  END IF;
  IF period.status = 'CLOSED' THEN
    RAISE EXCEPTION 'bookkeeping: the period is closed and locked'
      USING ERRCODE = 'check_violation';
  END IF;
  IF TG_TABLE_NAME = 'bookkeeping_reconciliations' THEN
    IF TG_OP = 'UPDATE' AND NEW.account_id <> OLD.account_id THEN
      RAISE EXCEPTION 'bookkeeping: a reconciliation keeps its account'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM bookkeeping_accounts a
         WHERE a.business_id = NEW.business_id AND a.id = NEW.account_id
           AND a.engagement_id = period.engagement_id) THEN
      RAISE EXCEPTION 'bookkeeping: the account must be the period''s client''s'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.statement_document_id IS NOT NULL AND NOT EXISTS (
         SELECT 1 FROM documents d WHERE d.business_id = NEW.business_id
           AND d.id = NEW.statement_document_id AND d.engagement_id = period.engagement_id) THEN
      RAISE EXCEPTION 'bookkeeping: the statement must be a document of the same client'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER bookkeeping_close_items_rules BEFORE INSERT OR UPDATE ON bookkeeping_close_items
  FOR EACH ROW EXECUTE FUNCTION bookkeeping_period_parts_rules();
CREATE TRIGGER bookkeeping_reconciliations_rules BEFORE INSERT OR UPDATE ON bookkeeping_reconciliations
  FOR EACH ROW EXECUTE FUNCTION bookkeeping_period_parts_rules();
