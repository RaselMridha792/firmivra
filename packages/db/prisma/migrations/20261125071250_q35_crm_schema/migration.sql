-- CreateEnum
CREATE TYPE "SalesNurtureJourneyStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "SalesNurtureEnrollmentStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'STOPPED', 'FAILED');

-- CreateEnum
CREATE TYPE "SalesNurtureExecutionStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "SalesDemoRequestStatus" AS ENUM ('PENDING', 'SCHEDULED', 'COMPLETED', 'CANCELLED', 'NO_SHOW');

-- CreateEnum
CREATE TYPE "SalesDemoAppointmentStatus" AS ENUM ('SCHEDULED', 'COMPLETED', 'CANCELLED', 'NO_SHOW');

-- CreateTable
CREATE TABLE "sales_lead_consents" (
    "id" UUID NOT NULL,
    "contact_id" UUID NOT NULL,
    "consented" BOOLEAN NOT NULL DEFAULT false,
    "consented_at" TIMESTAMPTZ(3),
    "consent_source" TEXT,
    "suppressed" BOOLEAN NOT NULL DEFAULT false,
    "suppressed_at" TIMESTAMPTZ(3),
    "suppression_reason" TEXT,
    "updated_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "sales_lead_consents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_nurture_journeys" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "SalesNurtureJourneyStatus" NOT NULL DEFAULT 'DRAFT',
    "current_version_id" UUID,
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "sales_nurture_journeys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_nurture_journey_versions" (
    "id" UUID NOT NULL,
    "journey_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "steps" JSONB NOT NULL,
    "published_at" TIMESTAMPTZ(3),
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sales_nurture_journey_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_nurture_enrollments" (
    "id" UUID NOT NULL,
    "journey_id" UUID NOT NULL,
    "version_id" UUID NOT NULL,
    "contact_id" UUID NOT NULL,
    "status" "SalesNurtureEnrollmentStatus" NOT NULL DEFAULT 'ACTIVE',
    "enrolled_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(3),
    "stopped_at" TIMESTAMPTZ(3),
    "stop_reason" TEXT,
    "enrolled_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "sales_nurture_enrollments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_nurture_executions" (
    "id" UUID NOT NULL,
    "enrollment_id" UUID NOT NULL,
    "step_index" INTEGER NOT NULL,
    "status" "SalesNurtureExecutionStatus" NOT NULL DEFAULT 'PENDING',
    "scheduled_at" TIMESTAMPTZ(3) NOT NULL,
    "sent_at" TIMESTAMPTZ(3),
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "sales_nurture_executions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_demo_requests" (
    "id" UUID NOT NULL,
    "contact_id" UUID NOT NULL,
    "opportunity_id" UUID,
    "topic" TEXT,
    "status" "SalesDemoRequestStatus" NOT NULL DEFAULT 'PENDING',
    "preferred_time" TEXT,
    "notes" TEXT,
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "sales_demo_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_demo_appointments" (
    "id" UUID NOT NULL,
    "request_id" UUID NOT NULL,
    "scheduled_at" TIMESTAMPTZ(3) NOT NULL,
    "duration_minutes" INTEGER NOT NULL DEFAULT 30,
    "video_link" TEXT,
    "status" "SalesDemoAppointmentStatus" NOT NULL DEFAULT 'SCHEDULED',
    "notes" TEXT,
    "follow_up_id" UUID,
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "sales_demo_appointments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sales_lead_consents_contact_id_key" ON "sales_lead_consents"("contact_id");

-- CreateIndex
CREATE INDEX "sales_lead_consents_suppressed_idx" ON "sales_lead_consents"("suppressed");

-- CreateIndex
CREATE INDEX "sales_nurture_journeys_status_idx" ON "sales_nurture_journeys"("status");

-- CreateIndex
CREATE UNIQUE INDEX "sales_nurture_journey_versions_journey_id_id_key" ON "sales_nurture_journey_versions"("journey_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "sales_nurture_journey_versions_journey_id_version_key" ON "sales_nurture_journey_versions"("journey_id", "version");

-- CreateIndex
CREATE INDEX "sales_nurture_enrollments_status_idx" ON "sales_nurture_enrollments"("status");

-- CreateIndex
CREATE INDEX "sales_nurture_enrollments_contact_id_idx" ON "sales_nurture_enrollments"("contact_id");

-- CreateIndex
CREATE UNIQUE INDEX "sales_nurture_enrollments_journey_id_contact_id_key" ON "sales_nurture_enrollments"("journey_id", "contact_id");

-- CreateIndex
CREATE INDEX "sales_nurture_executions_status_scheduled_at_idx" ON "sales_nurture_executions"("status", "scheduled_at");

-- CreateIndex
CREATE UNIQUE INDEX "sales_nurture_executions_enrollment_id_step_index_key" ON "sales_nurture_executions"("enrollment_id", "step_index");

-- CreateIndex
CREATE INDEX "sales_demo_requests_status_idx" ON "sales_demo_requests"("status");

-- CreateIndex
CREATE INDEX "sales_demo_requests_contact_id_idx" ON "sales_demo_requests"("contact_id");

-- CreateIndex
CREATE INDEX "sales_demo_appointments_status_scheduled_at_idx" ON "sales_demo_appointments"("status", "scheduled_at");

-- CreateIndex
CREATE INDEX "sales_demo_appointments_request_id_idx" ON "sales_demo_appointments"("request_id");

-- AddForeignKey
ALTER TABLE "sales_lead_consents" ADD CONSTRAINT "sales_lead_consents_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "sales_contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_nurture_journey_versions" ADD CONSTRAINT "sales_nurture_journey_versions_journey_id_fkey" FOREIGN KEY ("journey_id") REFERENCES "sales_nurture_journeys"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_nurture_enrollments" ADD CONSTRAINT "sales_nurture_enrollments_journey_id_fkey" FOREIGN KEY ("journey_id") REFERENCES "sales_nurture_journeys"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_nurture_enrollments" ADD CONSTRAINT "sales_nurture_enrollments_journey_id_version_id_fkey" FOREIGN KEY ("journey_id", "version_id") REFERENCES "sales_nurture_journey_versions"("journey_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_nurture_enrollments" ADD CONSTRAINT "sales_nurture_enrollments_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "sales_contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_nurture_executions" ADD CONSTRAINT "sales_nurture_executions_enrollment_id_fkey" FOREIGN KEY ("enrollment_id") REFERENCES "sales_nurture_enrollments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_demo_requests" ADD CONSTRAINT "sales_demo_requests_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "sales_contacts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_demo_requests" ADD CONSTRAINT "sales_demo_requests_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "sales_opportunities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_demo_appointments" ADD CONSTRAINT "sales_demo_appointments_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "sales_demo_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_demo_appointments" ADD CONSTRAINT "sales_demo_appointments_follow_up_id_fkey" FOREIGN KEY ("follow_up_id") REFERENCES "sales_follow_ups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------- Rules ----------
-- A journey's current version is one of its own versions.
ALTER TABLE "sales_nurture_journeys" ADD CONSTRAINT "sales_nurture_journeys_current_version_fkey"
  FOREIGN KEY ("id", "current_version_id")
  REFERENCES "sales_nurture_journey_versions"("journey_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

ALTER TABLE sales_nurture_journeys ADD CONSTRAINT sales_nurture_journeys_values
  CHECK (length(btrim(name)) BETWEEN 1 AND 200);
ALTER TABLE sales_nurture_journey_versions ADD CONSTRAINT sales_nurture_journey_versions_values
  CHECK (version >= 1 AND jsonb_typeof(steps) = 'array');
ALTER TABLE sales_nurture_executions ADD CONSTRAINT sales_nurture_executions_values
  CHECK (step_index >= 0 AND retry_count >= 0);
ALTER TABLE sales_demo_appointments ADD CONSTRAINT sales_demo_appointments_values
  CHECK (duration_minutes BETWEEN 5 AND 480);
ALTER TABLE sales_nurture_enrollments ADD CONSTRAINT sales_nurture_enrollments_stopped
  CHECK (status <> 'STOPPED' OR stopped_at IS NOT NULL);

-- A published version never changes (steps, number, journey or publish time); a draft may.
CREATE FUNCTION sales_nurture_journey_versions_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF OLD.published_at IS NOT NULL THEN
    RAISE EXCEPTION 'A published journey version cannot change' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER sales_nurture_journey_versions_rules BEFORE UPDATE ON sales_nurture_journey_versions
  FOR EACH ROW EXECUTE FUNCTION sales_nurture_journey_versions_rules();

-- Only a published version can be a journey's current one.
CREATE FUNCTION sales_nurture_journeys_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF NEW.current_version_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM sales_nurture_journey_versions v
    WHERE v.id = NEW.current_version_id AND v.published_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'A journey''s current version must be published' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER sales_nurture_journeys_rules BEFORE INSERT OR UPDATE ON sales_nurture_journeys
  FOR EACH ROW EXECUTE FUNCTION sales_nurture_journeys_rules();

-- ---------- Grants ----------
-- Kept, never deleted: journeys are archived, enrollments stopped, demos cancelled. Versions
-- are inserted and published, never deleted.
GRANT SELECT, INSERT, UPDATE ON sales_lead_consents, sales_nurture_journeys,
  sales_nurture_journey_versions, sales_nurture_enrollments, sales_nurture_executions,
  sales_demo_requests, sales_demo_appointments TO firmivra_app;

-- ---------- Row-level security ----------
-- Platform data, like the rest of sales_*: the Super Admin team (admin scope) and the platform's
-- jobs (platform scope). No firm scope reaches any of them.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['sales_lead_consents', 'sales_nurture_journeys',
    'sales_nurture_journey_versions', 'sales_nurture_enrollments', 'sales_nurture_executions',
    'sales_demo_requests', 'sales_demo_appointments'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR ALL USING (app_is_sales_team()) '
                   'WITH CHECK (app_is_sales_team())', t || '_team', t);
  END LOOP;
END
$$;
