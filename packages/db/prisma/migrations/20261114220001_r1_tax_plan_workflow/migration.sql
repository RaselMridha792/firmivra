-- r1_tax_plan_workflow (R1, Nov 14; Tax Planning Review 2 approved workflow, the lead's approval
-- under Rasel's packages/db delegation until Nov 17), after r1_tax_plan_workflow_values:
-- - tax_plans.reviewer_user_id and review_requested_at: Send for Internal Review's chosen reviewer
--   (a member of the same firm) and when.
-- - tax_plans.delivered_at and delivered_version: Deliver to Client, a fact apart from the status
--   (Delivered and Implemented never imply each other). Both or neither.
-- - tax_plan_approvals: the client's approval of one exact version (tax_plan_versions) with its
--   date. One per version, insert-only for the app. MANUAL (documented by staff) needs who
--   recorded it and a note on how it was documented, with an optional proof document; PORTAL is
--   kept for the portal's own approval. Never dated after the firm's today.
-- - tax_plan_requests: a request on a plan either way. The firm asks for INFORMATION or a
--   DOCUMENT and says who asked; a client sends a QUESTION, INFORMATION, a REVISION or MEETING
--   request. Never deleted by the app.
-- Both tables: the firm's RLS, the client tied to the plan (3-column foreign key).
-- Safe on dev: new nullable columns with no default (no rewrite), two new tables; no backfill.
-- CreateEnum
CREATE TYPE "TaxPlanApprovalMethod" AS ENUM ('PORTAL', 'MANUAL');

-- CreateEnum
CREATE TYPE "TaxPlanRequestDirection" AS ENUM ('FIRM_TO_CLIENT', 'CLIENT_TO_FIRM');

-- CreateEnum
CREATE TYPE "TaxPlanRequestKind" AS ENUM ('INFORMATION', 'DOCUMENT', 'QUESTION', 'REVISION', 'MEETING');

-- CreateEnum
CREATE TYPE "TaxPlanRequestStatus" AS ENUM ('OPEN', 'ANSWERED', 'CLOSED');

-- AlterTable
ALTER TABLE "tax_plans" ADD COLUMN     "delivered_at" TIMESTAMPTZ(3),
ADD COLUMN     "delivered_version" INTEGER,
ADD COLUMN     "review_requested_at" TIMESTAMPTZ(3),
ADD COLUMN     "reviewer_user_id" UUID;

-- CreateTable
CREATE TABLE "tax_plan_approvals" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "method" "TaxPlanApprovalMethod" NOT NULL,
    "approved_on" DATE NOT NULL,
    "note" TEXT,
    "document_id" UUID,
    "recorded_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tax_plan_approvals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_plan_requests" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    "direction" "TaxPlanRequestDirection" NOT NULL,
    "kind" "TaxPlanRequestKind" NOT NULL,
    "body" TEXT NOT NULL,
    "status" "TaxPlanRequestStatus" NOT NULL DEFAULT 'OPEN',
    "response" TEXT,
    "document_id" UUID,
    "requested_by_user_id" UUID,
    "answered_at" TIMESTAMPTZ(3),
    "closed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "tax_plan_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tax_plan_approvals_business_id_plan_id_version_key" ON "tax_plan_approvals"("business_id", "plan_id", "version");

-- CreateIndex
CREATE INDEX "tax_plan_requests_business_id_plan_id_status_idx" ON "tax_plan_requests"("business_id", "plan_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "tax_plan_requests_business_id_id_key" ON "tax_plan_requests"("business_id", "id");

-- AddForeignKey
ALTER TABLE "tax_plans" ADD CONSTRAINT "tax_plans_business_id_reviewer_user_id_fkey" FOREIGN KEY ("business_id", "reviewer_user_id") REFERENCES "memberships"("business_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_plan_approvals" ADD CONSTRAINT "tax_plan_approvals_business_id_client_id_plan_id_fkey" FOREIGN KEY ("business_id", "client_id", "plan_id") REFERENCES "tax_plans"("business_id", "client_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_plan_approvals" ADD CONSTRAINT "tax_plan_approvals_business_id_plan_id_version_fkey" FOREIGN KEY ("business_id", "plan_id", "version") REFERENCES "tax_plan_versions"("business_id", "plan_id", "version") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_plan_approvals" ADD CONSTRAINT "tax_plan_approvals_business_id_document_id_fkey" FOREIGN KEY ("business_id", "document_id") REFERENCES "documents"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_plan_approvals" ADD CONSTRAINT "tax_plan_approvals_business_id_recorded_by_user_id_fkey" FOREIGN KEY ("business_id", "recorded_by_user_id") REFERENCES "memberships"("business_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_plan_requests" ADD CONSTRAINT "tax_plan_requests_business_id_client_id_plan_id_fkey" FOREIGN KEY ("business_id", "client_id", "plan_id") REFERENCES "tax_plans"("business_id", "client_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_plan_requests" ADD CONSTRAINT "tax_plan_requests_business_id_document_id_fkey" FOREIGN KEY ("business_id", "document_id") REFERENCES "documents"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_plan_requests" ADD CONSTRAINT "tax_plan_requests_business_id_requested_by_user_id_fkey" FOREIGN KEY ("business_id", "requested_by_user_id") REFERENCES "memberships"("business_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;



-- ---------- Grants, RLS ----------
-- Approvals are insert-only; requests are answered and closed, never deleted.
GRANT SELECT, INSERT ON tax_plan_approvals TO firmivra_app;
GRANT SELECT, INSERT, UPDATE ON tax_plan_requests TO firmivra_app;
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['tax_plan_approvals', 'tax_plan_requests'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I ON %I USING (business_id = app_current_business_id())'
                   ' WITH CHECK (business_id = app_current_business_id())', t || '_business', t);
  END LOOP;
END
$$;

-- ---------- Data rules Prisma cannot express ----------
ALTER TABLE tax_plans ADD CONSTRAINT tax_plans_review_and_delivery
  CHECK ((review_requested_at IS NULL OR reviewer_user_id IS NOT NULL)
     AND ((delivered_at IS NULL) = (delivered_version IS NULL))
     AND (delivered_version IS NULL OR delivered_version >= 1));

ALTER TABLE tax_plan_approvals ADD CONSTRAINT tax_plan_approvals_shape
  CHECK (version >= 1
     AND (note IS NULL OR char_length(btrim(note)) BETWEEN 1 AND 2000)
     AND (method <> 'MANUAL' OR (note IS NOT NULL AND recorded_by_user_id IS NOT NULL)));

-- Never dated after the firm's today (its time zone, as every planning date).
CREATE FUNCTION tax_plan_approvals_rules() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public, pg_temp
  AS $$
DECLARE
  today date;
BEGIN
  SELECT (now() AT TIME ZONE COALESCE(
            (SELECT timezone FROM business_settings WHERE business_id = NEW.business_id),
            'America/New_York'))::date
    INTO today;
  IF NEW.approved_on > today THEN
    RAISE EXCEPTION 'tax plan approvals: the approval date cannot be after today'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER tax_plan_approvals_rules
  BEFORE INSERT ON tax_plan_approvals
  FOR EACH ROW EXECUTE FUNCTION tax_plan_approvals_rules();

ALTER TABLE tax_plan_requests ADD CONSTRAINT tax_plan_requests_shape
  CHECK (char_length(btrim(body)) BETWEEN 1 AND 4000
     AND (response IS NULL OR char_length(response) <= 4000)
     AND ((direction = 'FIRM_TO_CLIENT' AND kind IN ('INFORMATION', 'DOCUMENT')
           AND requested_by_user_id IS NOT NULL)
       OR (direction = 'CLIENT_TO_FIRM' AND kind IN ('QUESTION', 'INFORMATION', 'REVISION', 'MEETING')))
     AND (status <> 'ANSWERED' OR answered_at IS NOT NULL)
     AND (status <> 'CLOSED' OR closed_at IS NOT NULL));
