-- CreateEnum
CREATE TYPE "ReportFrequency" AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY', 'ANNUAL');

-- CreateEnum
CREATE TYPE "ReportFormat" AS ENUM ('PDF', 'XLSX', 'CSV');

-- CreateEnum
CREATE TYPE "ReportRunKind" AS ENUM ('VIEW', 'EXPORT', 'SCHEDULED', 'SNAPSHOT');

-- CreateEnum
CREATE TYPE "ReportRunStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED');

-- CreateTable
CREATE TABLE "report_schedules" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "definition_id" UUID,
    "system_key" TEXT,
    "name" TEXT NOT NULL,
    "frequency" "ReportFrequency" NOT NULL,
    "weekday" INTEGER,
    "day_of_month" INTEGER,
    "month_of_year" INTEGER,
    "run_time" TIME(0) NOT NULL,
    "timezone" TEXT NOT NULL,
    "date_preset" TEXT NOT NULL,
    "formats" "ReportFormat"[],
    "deliver_email" BOOLEAN NOT NULL DEFAULT true,
    "deliver_in_app" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "deleted_at" TIMESTAMPTZ(3),
    "next_run_at" TIMESTAMPTZ(3),
    "last_run_at" TIMESTAMPTZ(3),
    "last_status" "ReportRunStatus",
    "consecutive_failures" INTEGER NOT NULL DEFAULT 0,
    "owner_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "report_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report_schedule_recipients" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "schedule_id" UUID NOT NULL,
    "user_id" UUID,
    "email" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "report_schedule_recipients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report_runs" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "definition_id" UUID,
    "system_key" TEXT,
    "schedule_id" UUID,
    "kind" "ReportRunKind" NOT NULL,
    "status" "ReportRunStatus" NOT NULL DEFAULT 'QUEUED',
    "requested_by_user_id" UUID,
    "format" "ReportFormat",
    "range_from" DATE,
    "range_to" DATE,
    "definition_snapshot" JSONB NOT NULL DEFAULT '{}',
    "s3_key" TEXT,
    "row_count" INTEGER,
    "sensitive" BOOLEAN NOT NULL DEFAULT false,
    "error_code" TEXT,
    "started_at" TIMESTAMPTZ(3),
    "finished_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "report_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "report_schedules_business_id_active_next_run_at_idx" ON "report_schedules"("business_id", "active", "next_run_at");

-- CreateIndex
CREATE UNIQUE INDEX "report_schedules_business_id_id_key" ON "report_schedules"("business_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "report_schedule_recipients_schedule_id_user_id_key" ON "report_schedule_recipients"("schedule_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "report_schedule_recipients_schedule_id_email_key" ON "report_schedule_recipients"("schedule_id", "email");

-- CreateIndex
CREATE UNIQUE INDEX "report_runs_s3_key_key" ON "report_runs"("s3_key");

-- CreateIndex
CREATE INDEX "report_runs_business_id_created_at_idx" ON "report_runs"("business_id", "created_at");

-- CreateIndex
CREATE INDEX "report_runs_business_id_definition_id_idx" ON "report_runs"("business_id", "definition_id");

-- CreateIndex
CREATE INDEX "report_runs_business_id_schedule_id_idx" ON "report_runs"("business_id", "schedule_id");

-- AddForeignKey
ALTER TABLE "report_schedules" ADD CONSTRAINT "report_schedules_business_id_definition_id_fkey" FOREIGN KEY ("business_id", "definition_id") REFERENCES "report_definitions"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_schedule_recipients" ADD CONSTRAINT "report_schedule_recipients_business_id_schedule_id_fkey" FOREIGN KEY ("business_id", "schedule_id") REFERENCES "report_schedules"("business_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_runs" ADD CONSTRAINT "report_runs_business_id_definition_id_fkey" FOREIGN KEY ("business_id", "definition_id") REFERENCES "report_definitions"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_runs" ADD CONSTRAINT "report_runs_business_id_schedule_id_fkey" FOREIGN KEY ("business_id", "schedule_id") REFERENCES "report_schedules"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Grants: schedules are stopped, never deleted; a finished run is a record.
GRANT SELECT, INSERT, UPDATE ON report_schedules, report_runs TO firmivra_app;
GRANT SELECT, INSERT, DELETE ON report_schedule_recipients TO firmivra_app;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['report_schedules', 'report_schedule_recipients', 'report_runs'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I ON %I USING (business_id = app_current_business_id())'
                   ' WITH CHECK (business_id = app_current_business_id())', t || '_business', t);
  END LOOP;
END
$$;

-- Shape
CREATE FUNCTION report_formats_distinct(items text[]) RETURNS boolean
  LANGUAGE sql IMMUTABLE
  AS $$ SELECT count(DISTINCT i) = count(*) FROM unnest(items) AS u(i) $$;

ALTER TABLE report_schedules ADD CONSTRAINT report_schedules_values
  CHECK (esign_text_ok(name, 200)
         AND (num_nonnulls(definition_id, system_key) = 1)
         AND (system_key IS NULL OR system_key ~ '^[a-z][a-z0-9_]{0,59}$')
         AND timezone ~ '^[A-Za-z_]+(/[A-Za-z0-9_+-]+){0,2}$'
         AND date_preset ~ '^[a-z][a-z0-9_]{0,39}$'
         AND cardinality(formats) BETWEEN 1 AND 3 AND array_position(formats, NULL) IS NULL
         AND report_formats_distinct(formats::text[])
         AND (deliver_email OR deliver_in_app)
         AND consecutive_failures >= 0
         -- The day fields each frequency needs, and no others.
         AND ((frequency = 'DAILY' AND num_nonnulls(weekday, day_of_month, month_of_year) = 0)
              OR (frequency = 'WEEKLY' AND coalesce(weekday BETWEEN 0 AND 6, false)
                  AND num_nonnulls(day_of_month, month_of_year) = 0)
              OR (frequency IN ('MONTHLY', 'QUARTERLY') AND coalesce(day_of_month BETWEEN 1 AND 31, false)
                  AND num_nonnulls(weekday, month_of_year) = 0)
              OR (frequency = 'ANNUAL' AND coalesce(day_of_month BETWEEN 1 AND 31, false)
                  AND coalesce(month_of_year BETWEEN 1 AND 12, false) AND weekday IS NULL))
         AND (deleted_at IS NULL OR active = false));

-- A recipient is a firm member or an outside email (lower case), not both.
ALTER TABLE report_schedule_recipients ADD CONSTRAINT report_schedule_recipients_one
  CHECK (num_nonnulls(user_id, email) = 1
         AND (email IS NULL OR (email = lower(email) AND email ~ '^[^@[:space:]]+@[^@[:space:]]+$'
                                AND char_length(email) <= 254)));

ALTER TABLE report_runs ADD CONSTRAINT report_runs_values
  CHECK (num_nonnulls(definition_id, system_key) = 1
         AND (system_key IS NULL OR system_key ~ '^[a-z][a-z0-9_]{0,59}$')
         AND (range_from IS NULL OR range_to IS NULL OR range_from <= range_to)
         AND jsonb_typeof(definition_snapshot) = 'object' AND pg_column_size(definition_snapshot) <= 50000
         AND (row_count IS NULL OR row_count >= 0)
         AND (error_code IS NULL OR error_code ~ '^[a-z][a-z0-9_]{0,59}$')
         AND (status = 'FAILED') = (error_code IS NOT NULL)
         AND (status IN ('QUEUED', 'RUNNING')) = (finished_at IS NULL)
         AND (kind = 'SCHEDULED') = (schedule_id IS NOT NULL)
         AND (kind = 'VIEW' OR format IS NOT NULL OR kind = 'SNAPSHOT')
         AND (s3_key IS NULL OR (starts_with(s3_key, 'tenant/' || business_id || '/reports/')
                                 AND s3_key ~ '^[A-Za-z0-9/._-]+$' AND s3_key !~ '(^|/)\.\.?(/|$)')));

-- A scheduled report goes only to firm members.
CREATE FUNCTION report_schedule_recipients_member() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF NEW.user_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM memberships m WHERE m.business_id = NEW.business_id AND m.user_id = NEW.user_id) THEN
    RAISE EXCEPTION 'REPORT_RECIPIENT_MEMBER: the person is not a member of this firm'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER report_schedule_recipients_member BEFORE INSERT ON report_schedule_recipients
  FOR EACH ROW EXECUTE FUNCTION report_schedule_recipients_member();

-- A finished run never changes.
CREATE FUNCTION report_runs_frozen() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF OLD.status IN ('SUCCEEDED', 'FAILED') THEN
    RAISE EXCEPTION 'REPORT_RUN_FINISHED: a finished report run does not change'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER report_runs_frozen BEFORE UPDATE ON report_runs
  FOR EACH ROW EXECUTE FUNCTION report_runs_frozen();
