-- CreateTable
CREATE TABLE "sales_lead_consents" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "contact_id" UUID NOT NULL,
    "consented" BOOLEAN NOT NULL DEFAULT false,
    "consented_at" TIMESTAMPTZ(3),
    "consent_source" TEXT,
    "suppressed" BOOLEAN NOT NULL DEFAULT false,
    "suppressed_at" TIMESTAMPTZ(3),
    "suppression_reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "sales_lead_consents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_nurture_journeys" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "current_version_id" UUID,
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "sales_nurture_journeys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_nurture_journey_versions" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
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
    "business_id" UUID NOT NULL,
    "journey_id" UUID NOT NULL,
    "version_id" UUID NOT NULL,
    "contact_id" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
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
    "business_id" UUID NOT NULL,
    "enrollment_id" UUID NOT NULL,
    "step_index" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
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
    "business_id" UUID NOT NULL,
    "contact_id" UUID NOT NULL,
    "opportunity_id" UUID,
    "topic" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
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
    "business_id" UUID NOT NULL,
    "request_id" UUID NOT NULL,
    "scheduled_at" TIMESTAMPTZ(3) NOT NULL,
    "duration_minutes" INTEGER NOT NULL DEFAULT 30,
    "video_link" TEXT,
    "status" TEXT NOT NULL DEFAULT 'SCHEDULED',
    "notes" TEXT,
    "follow_up_task_id" UUID,
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "sales_demo_appointments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sales_lead_consents_contact_id_key" ON "sales_lead_consents"("contact_id");

-- CreateIndex
CREATE INDEX "sales_lead_consents_business_id_suppressed_idx" ON "sales_lead_consents"("business_id", "suppressed");

-- CreateIndex
CREATE INDEX "sales_lead_consents_business_id_consented_idx" ON "sales_lead_consents"("business_id", "consented");

-- CreateIndex
CREATE INDEX "sales_nurture_journeys_business_id_status_idx" ON "sales_nurture_journeys"("business_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "sales_nurture_journeys_business_id_id_key" ON "sales_nurture_journeys"("business_id", "id");

-- CreateIndex
CREATE INDEX "sales_nurture_journey_versions_business_id_journey_id_publi_idx" ON "sales_nurture_journey_versions"("business_id", "journey_id", "published_at");

-- CreateIndex
CREATE UNIQUE INDEX "sales_nurture_journey_versions_business_id_id_key" ON "sales_nurture_journey_versions"("business_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "sales_nurture_journey_versions_business_id_journey_id_versi_key" ON "sales_nurture_journey_versions"("business_id", "journey_id", "version");

-- CreateIndex
CREATE INDEX "sales_nurture_enrollments_business_id_status_idx" ON "sales_nurture_enrollments"("business_id", "status");

-- CreateIndex
CREATE INDEX "sales_nurture_enrollments_business_id_contact_id_idx" ON "sales_nurture_enrollments"("business_id", "contact_id");

-- CreateIndex
CREATE UNIQUE INDEX "sales_nurture_enrollments_business_id_id_key" ON "sales_nurture_enrollments"("business_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "sales_nurture_enrollments_business_id_journey_id_contact_id_key" ON "sales_nurture_enrollments"("business_id", "journey_id", "contact_id");

-- CreateIndex
CREATE INDEX "sales_nurture_executions_business_id_status_scheduled_at_idx" ON "sales_nurture_executions"("business_id", "status", "scheduled_at");

-- CreateIndex
CREATE UNIQUE INDEX "sales_nurture_executions_business_id_enrollment_id_step_ind_key" ON "sales_nurture_executions"("business_id", "enrollment_id", "step_index");

-- CreateIndex
CREATE INDEX "sales_demo_requests_business_id_status_idx" ON "sales_demo_requests"("business_id", "status");

-- CreateIndex
CREATE INDEX "sales_demo_requests_business_id_contact_id_idx" ON "sales_demo_requests"("business_id", "contact_id");

-- CreateIndex
CREATE UNIQUE INDEX "sales_demo_requests_business_id_id_key" ON "sales_demo_requests"("business_id", "id");

-- CreateIndex
CREATE INDEX "sales_demo_appointments_business_id_status_scheduled_at_idx" ON "sales_demo_appointments"("business_id", "status", "scheduled_at");

-- CreateIndex
CREATE INDEX "sales_demo_appointments_business_id_request_id_idx" ON "sales_demo_appointments"("business_id", "request_id");

-- AddForeignKey
ALTER TABLE "sales_lead_consents" ADD CONSTRAINT "sales_lead_consents_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "sales_contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_nurture_journey_versions" ADD CONSTRAINT "sales_nurture_journey_versions_business_id_journey_id_fkey" FOREIGN KEY ("business_id", "journey_id") REFERENCES "sales_nurture_journeys"("business_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_nurture_enrollments" ADD CONSTRAINT "sales_nurture_enrollments_business_id_journey_id_fkey" FOREIGN KEY ("business_id", "journey_id") REFERENCES "sales_nurture_journeys"("business_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_nurture_enrollments" ADD CONSTRAINT "sales_nurture_enrollments_business_id_version_id_fkey" FOREIGN KEY ("business_id", "version_id") REFERENCES "sales_nurture_journey_versions"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_nurture_enrollments" ADD CONSTRAINT "sales_nurture_enrollments_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "sales_contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_nurture_executions" ADD CONSTRAINT "sales_nurture_executions_business_id_enrollment_id_fkey" FOREIGN KEY ("business_id", "enrollment_id") REFERENCES "sales_nurture_enrollments"("business_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_demo_requests" ADD CONSTRAINT "sales_demo_requests_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "sales_contacts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_demo_requests" ADD CONSTRAINT "sales_demo_requests_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "sales_opportunities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_demo_appointments" ADD CONSTRAINT "sales_demo_appointments_business_id_request_id_fkey" FOREIGN KEY ("business_id", "request_id") REFERENCES "sales_demo_requests"("business_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;
GRANT SELECT, INSERT, UPDATE, DELETE ON sales_lead_consents TO firmivra_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON sales_nurture_journeys TO firmivra_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON sales_nurture_journey_versions TO firmivra_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON sales_nurture_enrollments TO firmivra_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON sales_nurture_executions TO firmivra_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON sales_demo_requests TO firmivra_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON sales_demo_appointments TO firmivra_app;

ALTER TABLE sales_lead_consents ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_lead_consents FORCE ROW LEVEL SECURITY;
CREATE POLICY sales_lead_consents_business ON sales_lead_consents
  USING (business_id = app_current_business_id())
  WITH CHECK (business_id = app_current_business_id());

ALTER TABLE sales_nurture_journeys ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_nurture_journeys FORCE ROW LEVEL SECURITY;
CREATE POLICY sales_nurture_journeys_business ON sales_nurture_journeys
  USING (business_id = app_current_business_id())
  WITH CHECK (business_id = app_current_business_id());

ALTER TABLE sales_nurture_journey_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_nurture_journey_versions FORCE ROW LEVEL SECURITY;
CREATE POLICY sales_nurture_journey_versions_business ON sales_nurture_journey_versions
  USING (business_id = app_current_business_id())
  WITH CHECK (business_id = app_current_business_id());

ALTER TABLE sales_nurture_enrollments ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_nurture_enrollments FORCE ROW LEVEL SECURITY;
CREATE POLICY sales_nurture_enrollments_business ON sales_nurture_enrollments
  USING (business_id = app_current_business_id())
  WITH CHECK (business_id = app_current_business_id());

ALTER TABLE sales_nurture_executions ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_nurture_executions FORCE ROW LEVEL SECURITY;
CREATE POLICY sales_nurture_executions_business ON sales_nurture_executions
  USING (business_id = app_current_business_id())
  WITH CHECK (business_id = app_current_business_id());

ALTER TABLE sales_demo_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_demo_requests FORCE ROW LEVEL SECURITY;
CREATE POLICY sales_demo_requests_business ON sales_demo_requests
  USING (business_id = app_current_business_id())
  WITH CHECK (business_id = app_current_business_id());

ALTER TABLE sales_demo_appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_demo_appointments FORCE ROW LEVEL SECURITY;
CREATE POLICY sales_demo_appointments_business ON sales_demo_appointments
  USING (business_id = app_current_business_id())
  WITH CHECK (business_id = app_current_business_id());