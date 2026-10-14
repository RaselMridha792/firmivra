-- R38 (Rasel, Oct 14), Bookkeeping, part 1 (docs/mockups/firm-workspace/bookkeeping/source, both
-- guides): the firm's Bookkeeping settings, what Bookkeeping adds to a client's Bookkeeping
-- engagement (cadence, next report date, workflow status with its reason, reviewer, pause and
-- archive, the client's own settings) and the activity history. Bookkeeping has no accounting
-- integration in this round: nothing here is ledger data. The engagement is the enrolment; a
-- profile exists only for an engagement of the Bookkeeping service.

-- CreateEnum
CREATE TYPE "BookkeepingStatus" AS ENUM ('ON_TRACK', 'NEEDS_ATTENTION', 'MISSING_DOCUMENTS', 'OVERDUE', 'NOT_STARTED');

-- CreateEnum
CREATE TYPE "StatusSource" AS ENUM ('MANUAL', 'AUTOMATIC');

-- CreateEnum
CREATE TYPE "ReportCadence" AS ENUM ('MONTHLY', 'QUARTERLY', 'ANNUAL', 'CUSTOM');

-- CreateEnum
CREATE TYPE "BookkeepingActivityKind" AS ENUM ('STATUS_CHANGE', 'ASSIGNMENT', 'PLAN_CHANGE', 'PAUSE', 'RESUME', 'ARCHIVE', 'SYNC', 'DOCUMENT_REQUEST', 'REPORT', 'CLOSE', 'RECONCILIATION', 'CONTACT', 'NOTE', 'OTHER');

-- CreateTable
CREATE TABLE "bookkeeping_settings" (
    "business_id" UUID NOT NULL,
    "default_cadence" "ReportCadence" NOT NULL DEFAULT 'MONTHLY',
    "close_target_day" INTEGER NOT NULL DEFAULT 10,
    "upcoming_report_days" INTEGER NOT NULL DEFAULT 14,
    "stale_sync_hours" INTEGER NOT NULL DEFAULT 48,
    "recon_tolerance_cents" INTEGER NOT NULL DEFAULT 0,
    "status_rules" JSONB NOT NULL DEFAULT '{}',
    "reminder_defaults" JSONB NOT NULL DEFAULT '[]',
    "report_schedule" JSONB NOT NULL DEFAULT '[]',
    "document_checklist" JSONB NOT NULL DEFAULT '[]',
    "close_checklist" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "bookkeeping_settings_pkey" PRIMARY KEY ("business_id")
);

-- CreateTable
CREATE TABLE "bookkeeping_profiles" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "engagement_id" UUID NOT NULL,
    "cadence" "ReportCadence" NOT NULL DEFAULT 'MONTHLY',
    "cadence_months" INTEGER,
    "close_target_day" INTEGER,
    "next_report_due_on" DATE,
    "status" "BookkeepingStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "status_source" "StatusSource" NOT NULL DEFAULT 'AUTOMATIC',
    "status_reason" TEXT,
    "status_changed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewer_user_id" UUID,
    "paused_at" TIMESTAMPTZ(3),
    "pause_reason" TEXT,
    "archived_at" TIMESTAMPTZ(3),
    "portal_defaults" JSONB NOT NULL DEFAULT '{}',
    "report_schedule" JSONB,
    "document_checklist" JSONB,
    "categorization_rules" JSONB NOT NULL DEFAULT '[]',
    "alerts" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "bookkeeping_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bookkeeping_activity" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "engagement_id" UUID NOT NULL,
    "kind" "BookkeepingActivityKind" NOT NULL,
    "summary" TEXT NOT NULL,
    "details" JSONB NOT NULL DEFAULT '{}',
    "actor_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bookkeeping_activity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "bookkeeping_profiles_business_id_status_idx" ON "bookkeeping_profiles"("business_id", "status");

-- CreateIndex
CREATE INDEX "bookkeeping_profiles_business_id_next_report_due_on_idx" ON "bookkeeping_profiles"("business_id", "next_report_due_on");

-- CreateIndex
CREATE UNIQUE INDEX "bookkeeping_profiles_business_id_id_key" ON "bookkeeping_profiles"("business_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "bookkeeping_profiles_business_id_engagement_id_key" ON "bookkeeping_profiles"("business_id", "engagement_id");

-- CreateIndex
CREATE INDEX "bookkeeping_activity_business_id_engagement_id_created_at_idx" ON "bookkeeping_activity"("business_id", "engagement_id", "created_at");

-- AddForeignKey
ALTER TABLE "bookkeeping_settings" ADD CONSTRAINT "bookkeeping_settings_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookkeeping_profiles" ADD CONSTRAINT "bookkeeping_profiles_business_id_engagement_id_fkey" FOREIGN KEY ("business_id", "engagement_id") REFERENCES "engagements"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookkeeping_profiles" ADD CONSTRAINT "bookkeeping_profiles_business_id_reviewer_user_id_fkey" FOREIGN KEY ("business_id", "reviewer_user_id") REFERENCES "memberships"("business_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookkeeping_activity" ADD CONSTRAINT "bookkeeping_activity_business_id_engagement_id_fkey" FOREIGN KEY ("business_id", "engagement_id") REFERENCES "engagements"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------- Grants, RLS, policy ----------
-- Profiles are paused or archived, never deleted; the activity history is insert-only.
GRANT SELECT, INSERT, UPDATE ON bookkeeping_settings, bookkeeping_profiles TO firmivra_app;
GRANT SELECT, INSERT ON bookkeeping_activity TO firmivra_app;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['bookkeeping_settings', 'bookkeeping_profiles',
    'bookkeeping_activity'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I ON %I USING (business_id = app_current_business_id())'
                   ' WITH CHECK (business_id = app_current_business_id())', t || '_business', t);
  END LOOP;
END
$$;

-- ---------- Shape ----------
ALTER TABLE bookkeeping_settings ADD CONSTRAINT bookkeeping_settings_shape
  CHECK (close_target_day BETWEEN 1 AND 28 AND upcoming_report_days BETWEEN 1 AND 90
         AND stale_sync_hours BETWEEN 1 AND 720 AND recon_tolerance_cents BETWEEN 0 AND 100000
         AND jsonb_typeof(status_rules) = 'object'
         AND jsonb_typeof(reminder_defaults) = 'array' AND jsonb_array_length(reminder_defaults) <= 10
         AND jsonb_typeof(report_schedule) = 'array' AND jsonb_array_length(report_schedule) <= 30
         AND jsonb_typeof(document_checklist) = 'array' AND jsonb_array_length(document_checklist) <= 50
         AND jsonb_typeof(close_checklist) = 'array' AND jsonb_array_length(close_checklist) <= 30
         AND pg_column_size(close_checklist) <= 20000 AND pg_column_size(document_checklist) <= 20000);

ALTER TABLE bookkeeping_profiles ADD CONSTRAINT bookkeeping_profiles_shape
  CHECK ((cadence = 'CUSTOM') = (cadence_months IS NOT NULL)
         AND (cadence_months IS NULL OR cadence_months BETWEEN 1 AND 24)
         AND (close_target_day IS NULL OR close_target_day BETWEEN 1 AND 28)
         AND char_length(status_reason) <= 300 AND char_length(pause_reason) <= 500
         AND jsonb_typeof(portal_defaults) = 'object' AND jsonb_typeof(alerts) = 'object'
         AND jsonb_typeof(categorization_rules) = 'array'
         AND jsonb_array_length(categorization_rules) <= 200
         AND pg_column_size(categorization_rules) <= 60000
         AND (report_schedule IS NULL OR jsonb_typeof(report_schedule) = 'array')
         AND (document_checklist IS NULL OR jsonb_typeof(document_checklist) = 'array')
         -- A paused service says why.
         AND (paused_at IS NULL OR btrim(coalesce(pause_reason, '')) <> ''));

ALTER TABLE bookkeeping_activity ADD CONSTRAINT bookkeeping_activity_shape
  CHECK (btrim(summary) <> '' AND char_length(summary) <= 300
         AND jsonb_typeof(details) = 'object' AND pg_column_size(details) <= 4000);

-- ---------- A profile is of a Bookkeeping engagement, and keeps it ----------
CREATE FUNCTION bookkeeping_profiles_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.engagement_id <> OLD.engagement_id THEN
    RAISE EXCEPTION 'bookkeeping: a profile cannot move to another engagement'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status IS DISTINCT FROM (CASE WHEN TG_OP = 'UPDATE' THEN OLD.status END)
     OR TG_OP = 'INSERT' THEN
    NEW.status_changed_at := now();
  END IF;
  IF TG_OP = 'INSERT' AND NOT EXISTS (
       SELECT 1 FROM engagements e JOIN services s
         ON s.business_id = e.business_id AND s.id = e.service_id
        WHERE e.business_id = NEW.business_id AND e.id = NEW.engagement_id
          AND s.kind = 'BOOKKEEPING') THEN
    RAISE EXCEPTION 'bookkeeping: a profile belongs to an engagement of the Bookkeeping service'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER bookkeeping_profiles_rules BEFORE INSERT OR UPDATE ON bookkeeping_profiles
  FOR EACH ROW EXECUTE FUNCTION bookkeeping_profiles_rules();

-- The activity of an engagement is only for a Bookkeeping engagement.
CREATE FUNCTION bookkeeping_activity_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM bookkeeping_profiles p
                  WHERE p.business_id = NEW.business_id AND p.engagement_id = NEW.engagement_id) THEN
    RAISE EXCEPTION 'bookkeeping: activity belongs to an engagement with a bookkeeping profile'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER bookkeeping_activity_rules BEFORE INSERT ON bookkeeping_activity
  FOR EACH ROW EXECUTE FUNCTION bookkeeping_activity_rules();
