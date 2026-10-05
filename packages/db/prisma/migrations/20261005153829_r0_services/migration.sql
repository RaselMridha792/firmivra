-- CreateEnum
CREATE TYPE "ServiceKind" AS ENUM ('ANNUAL_TAX', 'QUARTERLY_TAX', 'BOOKKEEPING', 'PAYROLL', 'TAX_PLANNING', 'BUSINESS_DEVELOPMENT', 'OTHER');

-- CreateEnum
CREATE TYPE "BillingInterval" AS ENUM ('ONE_TIME', 'MONTHLY', 'QUARTERLY', 'YEARLY');

-- CreateEnum
CREATE TYPE "EngagementStatus" AS ENUM ('PENDING', 'ACTIVE', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('OPEN', 'DONE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ReportKind" AS ENUM ('REPORT', 'RECONCILIATION', 'ESTIMATE', 'PROJECTION');

-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('DRAFT', 'PUBLISHED');

-- CreateTable
CREATE TABLE "services" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "kind" "ServiceKind" NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "billing_interval" "BillingInterval" NOT NULL DEFAULT 'ONE_TIME',
    "packages" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "stages" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "archived_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "services_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "engagements" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "service_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "tax_year" INTEGER,
    "period_start" DATE,
    "period_end" DATE,
    "package" TEXT,
    "status" "EngagementStatus" NOT NULL DEFAULT 'ACTIVE',
    "stage" TEXT,
    "billing_interval" "BillingInterval" NOT NULL DEFAULT 'ONE_TIME',
    "next_billing_on" DATE,
    "assigned_user_id" UUID,
    "completed_at" TIMESTAMPTZ(3),
    "cancel_requested_at" TIMESTAMPTZ(3),
    "cancelled_at" TIMESTAMPTZ(3),
    "cancellation_reason" TEXT,
    "updated_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "engagements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "engagement_status_history" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "business_id" UUID NOT NULL,
    "engagement_id" UUID NOT NULL,
    "status" "EngagementStatus" NOT NULL,
    "stage" TEXT,
    "changed_by_user_id" UUID,
    "changed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "engagement_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tasks" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "engagement_id" UUID,
    "title" TEXT NOT NULL,
    "details" TEXT,
    "status" "TaskStatus" NOT NULL DEFAULT 'OPEN',
    "due_on" DATE,
    "assigned_user_id" UUID,
    "completed_at" TIMESTAMPTZ(3),
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notes" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "engagement_id" UUID,
    "body" TEXT NOT NULL,
    "author_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "engagement_reports" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "engagement_id" UUID NOT NULL,
    "kind" "ReportKind" NOT NULL,
    "title" TEXT NOT NULL,
    "period_label" TEXT,
    "status" "ReportStatus" NOT NULL DEFAULT 'DRAFT',
    "data" JSONB NOT NULL DEFAULT '{}',
    "published_at" TIMESTAMPTZ(3),
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "engagement_reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "services_business_id_name_key" ON "services"("business_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "services_business_id_id_key" ON "services"("business_id", "id");

-- CreateIndex
CREATE INDEX "engagements_business_id_status_assigned_user_id_idx" ON "engagements"("business_id", "status", "assigned_user_id");

-- CreateIndex
CREATE INDEX "engagements_business_id_service_id_idx" ON "engagements"("business_id", "service_id");

-- CreateIndex
CREATE UNIQUE INDEX "engagements_business_id_id_key" ON "engagements"("business_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "engagements_business_id_client_id_id_key" ON "engagements"("business_id", "client_id", "id");

-- CreateIndex
CREATE INDEX "engagement_status_history_business_id_engagement_id_changed_idx" ON "engagement_status_history"("business_id", "engagement_id", "changed_at");

-- CreateIndex
CREATE INDEX "tasks_business_id_client_id_idx" ON "tasks"("business_id", "client_id");

-- CreateIndex
CREATE INDEX "tasks_business_id_engagement_id_idx" ON "tasks"("business_id", "engagement_id");

-- CreateIndex
CREATE INDEX "tasks_business_id_assigned_user_id_status_idx" ON "tasks"("business_id", "assigned_user_id", "status");

-- CreateIndex
CREATE INDEX "notes_business_id_client_id_created_at_idx" ON "notes"("business_id", "client_id", "created_at");

-- CreateIndex
CREATE INDEX "notes_business_id_engagement_id_idx" ON "notes"("business_id", "engagement_id");

-- CreateIndex
CREATE INDEX "engagement_reports_business_id_engagement_id_status_idx" ON "engagement_reports"("business_id", "engagement_id", "status");

-- AddForeignKey
ALTER TABLE "services" ADD CONSTRAINT "services_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "engagements" ADD CONSTRAINT "engagements_business_id_client_id_fkey" FOREIGN KEY ("business_id", "client_id") REFERENCES "clients"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "engagements" ADD CONSTRAINT "engagements_business_id_service_id_fkey" FOREIGN KEY ("business_id", "service_id") REFERENCES "services"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "engagements" ADD CONSTRAINT "engagements_business_id_assigned_user_id_fkey" FOREIGN KEY ("business_id", "assigned_user_id") REFERENCES "memberships"("business_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "engagement_status_history" ADD CONSTRAINT "engagement_status_history_business_id_engagement_id_fkey" FOREIGN KEY ("business_id", "engagement_id") REFERENCES "engagements"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_business_id_client_id_fkey" FOREIGN KEY ("business_id", "client_id") REFERENCES "clients"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_business_id_client_id_engagement_id_fkey" FOREIGN KEY ("business_id", "client_id", "engagement_id") REFERENCES "engagements"("business_id", "client_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_business_id_assigned_user_id_fkey" FOREIGN KEY ("business_id", "assigned_user_id") REFERENCES "memberships"("business_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notes" ADD CONSTRAINT "notes_business_id_client_id_fkey" FOREIGN KEY ("business_id", "client_id") REFERENCES "clients"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notes" ADD CONSTRAINT "notes_business_id_client_id_engagement_id_fkey" FOREIGN KEY ("business_id", "client_id", "engagement_id") REFERENCES "engagements"("business_id", "client_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "engagement_reports" ADD CONSTRAINT "engagement_reports_business_id_engagement_id_fkey" FOREIGN KEY ("business_id", "engagement_id") REFERENCES "engagements"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ==================== R0 step 4: row-level security and data rules ====================
-- Services, engagements and their status history, tasks, internal notes, workspace reports.

-- ---------- Grants ----------
-- A service that engagements use cannot be deleted (foreign key); archive it instead.
GRANT SELECT, INSERT, UPDATE, DELETE ON services, tasks, notes TO firmivra_app;
-- Engagements are the core record of client work: never deleted (retention).
GRANT SELECT, INSERT, UPDATE ON engagements TO firmivra_app;
-- History is written by the trigger below (as the app role) and never changed.
GRANT SELECT, INSERT ON engagement_status_history TO firmivra_app;
-- Reports: only drafts can be deleted (policy below).
GRANT SELECT, INSERT, UPDATE, DELETE ON engagement_reports TO firmivra_app;

-- ---------- Enable and force RLS ----------
ALTER TABLE services                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE services                  FORCE ROW LEVEL SECURITY;
ALTER TABLE engagements               ENABLE ROW LEVEL SECURITY;
ALTER TABLE engagements               FORCE ROW LEVEL SECURITY;
ALTER TABLE engagement_status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE engagement_status_history FORCE ROW LEVEL SECURITY;
ALTER TABLE tasks                     ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks                     FORCE ROW LEVEL SECURITY;
ALTER TABLE notes                     ENABLE ROW LEVEL SECURITY;
ALTER TABLE notes                     FORCE ROW LEVEL SECURITY;
ALTER TABLE engagement_reports        ENABLE ROW LEVEL SECURITY;
ALTER TABLE engagement_reports        FORCE ROW LEVEL SECURITY;

-- ---------- Tenant tables: only the current business ----------
CREATE POLICY services_business ON services
  USING (business_id = app_current_business_id())
  WITH CHECK (business_id = app_current_business_id());

CREATE POLICY engagements_business ON engagements
  USING (business_id = app_current_business_id())
  WITH CHECK (business_id = app_current_business_id());

CREATE POLICY engagement_status_history_business ON engagement_status_history
  USING (business_id = app_current_business_id())
  WITH CHECK (business_id = app_current_business_id());

CREATE POLICY tasks_business ON tasks
  USING (business_id = app_current_business_id())
  WITH CHECK (business_id = app_current_business_id());

CREATE POLICY notes_business ON notes
  USING (business_id = app_current_business_id())
  WITH CHECK (business_id = app_current_business_id());

-- Reports: all of the current business's rows, except that a published report is never deleted.
CREATE POLICY engagement_reports_select ON engagement_reports FOR SELECT
  USING (business_id = app_current_business_id());
CREATE POLICY engagement_reports_insert ON engagement_reports FOR INSERT
  WITH CHECK (business_id = app_current_business_id());
CREATE POLICY engagement_reports_update ON engagement_reports FOR UPDATE
  USING (business_id = app_current_business_id())
  WITH CHECK (business_id = app_current_business_id());
CREATE POLICY engagement_reports_delete_draft ON engagement_reports FOR DELETE
  USING (business_id = app_current_business_id() AND status = 'DRAFT');

-- ---------- Data rules Prisma cannot express ----------
ALTER TABLE services ADD CONSTRAINT services_name_not_blank CHECK (btrim(name) <> '');
ALTER TABLE engagements ADD CONSTRAINT engagements_title_not_blank CHECK (btrim(title) <> '');
ALTER TABLE engagements ADD CONSTRAINT engagements_tax_year CHECK (tax_year BETWEEN 2000 AND 2100);
ALTER TABLE engagements ADD CONSTRAINT engagements_period CHECK (period_end >= period_start);
-- Only a recurring engagement has a next billing date.
ALTER TABLE engagements ADD CONSTRAINT engagements_next_billing_recurring
  CHECK (billing_interval <> 'ONE_TIME' OR next_billing_on IS NULL);
ALTER TABLE engagements ADD CONSTRAINT engagements_completed_at
  CHECK (status <> 'COMPLETED' OR completed_at IS NOT NULL);
ALTER TABLE engagements ADD CONSTRAINT engagements_cancelled_at
  CHECK (status <> 'CANCELLED' OR cancelled_at IS NOT NULL);
ALTER TABLE tasks ADD CONSTRAINT tasks_title_not_blank CHECK (btrim(title) <> '');
ALTER TABLE tasks ADD CONSTRAINT tasks_done_completed_at CHECK (status <> 'DONE' OR completed_at IS NOT NULL);
ALTER TABLE notes ADD CONSTRAINT notes_body_not_blank CHECK (btrim(body) <> '');
ALTER TABLE engagement_reports ADD CONSTRAINT engagement_reports_title_not_blank CHECK (btrim(title) <> '');
ALTER TABLE engagement_reports ADD CONSTRAINT engagement_reports_published_at
  CHECK ((status = 'PUBLISHED') = (published_at IS NOT NULL));

-- Lifecycle rules and the status tracker:
-- - an engagement stays with its client and service;
-- - its stage is one of the service's stages;
-- - a cancelled engagement can be reactivated only within 90 days of cancelled_at;
-- - every new engagement, and every change of status or stage, gets a history row.
CREATE FUNCTION engagements_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.id <> OLD.id OR NEW.business_id <> OLD.business_id OR NEW.client_id <> OLD.client_id
       OR NEW.service_id <> OLD.service_id THEN
      RAISE EXCEPTION 'engagements: the client and service of an engagement cannot change'
        USING ERRCODE = 'check_violation';
    END IF;
    IF OLD.status = 'CANCELLED' AND NEW.status <> 'CANCELLED'
       AND OLD.cancelled_at <= now() - interval '90 days' THEN
      RAISE EXCEPTION 'engagements: a cancelled engagement can be reactivated only within 90 days'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF NEW.stage IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.stage IS DISTINCT FROM OLD.stage)
     AND NOT EXISTS (SELECT 1 FROM services s
                     WHERE s.id = NEW.service_id AND NEW.stage = ANY (s.stages)) THEN
    RAISE EXCEPTION 'engagements: the stage must be one of the service''s stages'
      USING ERRCODE = 'check_violation';
  END IF;

  IF TG_OP = 'INSERT' OR NEW.status <> OLD.status OR NEW.stage IS DISTINCT FROM OLD.stage THEN
    INSERT INTO engagement_status_history (business_id, engagement_id, status, stage, changed_by_user_id)
    VALUES (NEW.business_id, NEW.id, NEW.status, NEW.stage, NEW.updated_by_user_id);
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER engagements_rules
  AFTER INSERT OR UPDATE ON engagements
  FOR EACH ROW EXECUTE FUNCTION engagements_rules();
