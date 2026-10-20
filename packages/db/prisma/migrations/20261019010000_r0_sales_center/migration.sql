-- r0_sales_center (R0, Oct 19, Super Admin schema stage D1): the Sales Center's targets and the
-- Leads / CRM import. Sales targets and goals: a metric's goal for the company, a team (a platform
-- department) or a rep over a month, quarter, year or custom range; attainment is computed by the
-- API from B5's records, never stored. Lead import batches: the file, where its leads go, how
-- duplicates are handled (B5's normalized email and phone), and one outcome per row (no row data),
-- with the counts kept by the database. Platform data: only the Super Admin team and the platform's
-- import job reach it. Contract note: docs/work/R0-stage-d1-sales-center.md.

-- CreateEnum
CREATE TYPE "SalesTargetScope" AS ENUM ('COMPANY', 'TEAM', 'REP');

-- CreateEnum
CREATE TYPE "SalesTargetMetric" AS ENUM ('NEW_LEADS', 'DEMOS_SCHEDULED', 'TRIALS_STARTED', 'WON_DEALS', 'REVENUE_WON', 'CONVERSION_RATE', 'OUTBOUND_ACTIVITIES');

-- CreateEnum
CREATE TYPE "SalesTargetPeriod" AS ENUM ('MONTH', 'QUARTER', 'YEAR', 'CUSTOM');

-- CreateEnum
CREATE TYPE "SalesImportStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SalesImportDuplicateMode" AS ENUM ('SKIP', 'ATTACH_TO_EXISTING');

-- CreateEnum
CREATE TYPE "SalesImportRowOutcome" AS ENUM ('IMPORTED', 'DUPLICATE', 'SKIPPED', 'FAILED');

-- CreateEnum
CREATE TYPE "SalesImportMatch" AS ENUM ('EMAIL', 'PHONE', 'EMAIL_AND_PHONE');

-- CreateTable
CREATE TABLE "sales_targets" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "scope" "SalesTargetScope" NOT NULL,
    "department_id" UUID,
    "user_id" UUID,
    "metric" "SalesTargetMetric" NOT NULL,
    "target_value" INTEGER NOT NULL,
    "period_type" "SalesTargetPeriod" NOT NULL,
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "note" TEXT,
    "archived_at" TIMESTAMPTZ(3),
    "created_by_user_id" UUID,
    "updated_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "sales_targets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_lead_imports" (
    "id" UUID NOT NULL,
    "file_name" TEXT NOT NULL,
    "file_size_bytes" INTEGER NOT NULL,
    "file_sha256" TEXT,
    "s3_key" TEXT,
    "status" "SalesImportStatus" NOT NULL DEFAULT 'PENDING',
    "duplicate_mode" "SalesImportDuplicateMode" NOT NULL DEFAULT 'SKIP',
    "pipeline_id" UUID NOT NULL,
    "stage_id" UUID,
    "default_source" "SalesLeadSource" NOT NULL DEFAULT 'OTHER',
    "assigned_to_user_id" UUID,
    "column_mapping" JSONB NOT NULL DEFAULT '{}',
    "total_rows" INTEGER NOT NULL DEFAULT 0,
    "imported_count" INTEGER NOT NULL DEFAULT 0,
    "duplicate_count" INTEGER NOT NULL DEFAULT 0,
    "skipped_count" INTEGER NOT NULL DEFAULT 0,
    "failed_count" INTEGER NOT NULL DEFAULT 0,
    "failure_code" TEXT,
    "started_at" TIMESTAMPTZ(3),
    "finished_at" TIMESTAMPTZ(3),
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "sales_lead_imports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_lead_import_rows" (
    "id" UUID NOT NULL,
    "import_id" UUID NOT NULL,
    "row_number" INTEGER NOT NULL,
    "outcome" "SalesImportRowOutcome" NOT NULL,
    "contact_id" UUID,
    "opportunity_id" UUID,
    "matched_by" "SalesImportMatch",
    "reason_code" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sales_lead_import_rows_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sales_targets_period_start_period_end_idx" ON "sales_targets"("period_start", "period_end");

-- CreateIndex
CREATE INDEX "sales_targets_department_id_idx" ON "sales_targets"("department_id");

-- CreateIndex
CREATE INDEX "sales_targets_user_id_idx" ON "sales_targets"("user_id");

-- CreateIndex
CREATE INDEX "sales_lead_imports_status_idx" ON "sales_lead_imports"("status");

-- CreateIndex
CREATE INDEX "sales_lead_imports_created_at_idx" ON "sales_lead_imports"("created_at");

-- CreateIndex
CREATE INDEX "sales_lead_imports_file_sha256_idx" ON "sales_lead_imports"("file_sha256");

-- CreateIndex
CREATE INDEX "sales_lead_import_rows_contact_id_idx" ON "sales_lead_import_rows"("contact_id");

-- CreateIndex
CREATE INDEX "sales_lead_import_rows_opportunity_id_idx" ON "sales_lead_import_rows"("opportunity_id");

-- CreateIndex
CREATE UNIQUE INDEX "sales_lead_import_rows_import_id_row_number_key" ON "sales_lead_import_rows"("import_id", "row_number");

-- AddForeignKey
ALTER TABLE "sales_targets" ADD CONSTRAINT "sales_targets_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "platform_departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_targets" ADD CONSTRAINT "sales_targets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "platform_admins"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_lead_imports" ADD CONSTRAINT "sales_lead_imports_pipeline_id_fkey" FOREIGN KEY ("pipeline_id") REFERENCES "sales_pipelines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_lead_imports" ADD CONSTRAINT "sales_lead_imports_pipeline_id_stage_id_fkey" FOREIGN KEY ("pipeline_id", "stage_id") REFERENCES "sales_pipeline_stages"("pipeline_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_lead_imports" ADD CONSTRAINT "sales_lead_imports_assigned_to_user_id_fkey" FOREIGN KEY ("assigned_to_user_id") REFERENCES "platform_admins"("user_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_lead_import_rows" ADD CONSTRAINT "sales_lead_import_rows_import_id_fkey" FOREIGN KEY ("import_id") REFERENCES "sales_lead_imports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_lead_import_rows" ADD CONSTRAINT "sales_lead_import_rows_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "sales_contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_lead_import_rows" ADD CONSTRAINT "sales_lead_import_rows_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "sales_opportunities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------- Values ----------
-- A target belongs to exactly one subject: the company, one team (a platform department) or one
-- rep. Calendar periods start and end on their boundaries (dates inclusive); a custom range is at
-- most 366 days. A rate is in basis points.
ALTER TABLE sales_targets ADD CONSTRAINT sales_targets_values
  CHECK (platform_text_ok(name, 120) AND (note IS NULL OR platform_text_ok(note, 1000))
         AND CASE scope
               WHEN 'COMPANY' THEN department_id IS NULL AND user_id IS NULL
               WHEN 'TEAM' THEN department_id IS NOT NULL AND user_id IS NULL
               ELSE user_id IS NOT NULL AND department_id IS NULL
             END
         AND target_value > 0 AND (metric <> 'CONVERSION_RATE' OR target_value <= 10000)
         AND CASE period_type
               WHEN 'MONTH' THEN period_start = date_trunc('month', period_start::timestamp)::date
                 AND period_end = (period_start::timestamp + interval '1 month' - interval '1 day')::date
               WHEN 'QUARTER' THEN period_start = date_trunc('quarter', period_start::timestamp)::date
                 AND period_end = (period_start::timestamp + interval '3 months' - interval '1 day')::date
               WHEN 'YEAR' THEN period_start = date_trunc('year', period_start::timestamp)::date
                 AND period_end = (period_start::timestamp + interval '1 year' - interval '1 day')::date
               ELSE period_end >= period_start AND period_end - period_start <= 365
             END);

-- One live target per subject, metric and period (archive the old one to replace it).
CREATE UNIQUE INDEX sales_targets_one_live ON sales_targets
  (scope, coalesce(department_id, '00000000-0000-0000-0000-000000000000'::uuid),
   coalesce(user_id, '00000000-0000-0000-0000-000000000000'::uuid), metric, period_start, period_end)
  WHERE archived_at IS NULL;

-- The file is up to 50 MB and 100,000 rows; its key sits under the platform's import prefix. Each
-- row ends as exactly one outcome, so a completed batch's counts add up to its rows. Times follow
-- the status.
ALTER TABLE sales_lead_imports ADD CONSTRAINT sales_lead_imports_values
  CHECK (platform_text_ok(file_name, 255) AND file_size_bytes BETWEEN 1 AND 52428800
         AND (file_sha256 IS NULL OR file_sha256 ~ '^[0-9a-f]{64}$')
         AND (s3_key IS NULL OR (char_length(s3_key) <= 512
              AND s3_key ~ '^platform/sales-imports/[A-Za-z0-9._/-]+$' AND s3_key !~ '\.\.'))
         AND jsonb_typeof(column_mapping) = 'object' AND octet_length(column_mapping::text) <= 20000
         AND total_rows BETWEEN 0 AND 100000
         AND imported_count >= 0 AND duplicate_count >= 0 AND skipped_count >= 0 AND failed_count >= 0
         AND imported_count + duplicate_count + skipped_count + failed_count <= total_rows
         AND (status <> 'COMPLETED'
              OR imported_count + duplicate_count + skipped_count + failed_count = total_rows)
         AND (status = 'FAILED') = (failure_code IS NOT NULL)
         AND (failure_code IS NULL OR failure_code ~ '^[a-z][a-z0-9_]{0,59}$')
         AND (status <> 'PENDING' OR started_at IS NULL)
         AND (status IN ('PENDING', 'CANCELLED') OR started_at IS NOT NULL)
         AND (status IN ('COMPLETED', 'FAILED', 'CANCELLED')) = (finished_at IS NOT NULL));

-- A row's outcome carries what it needs and nothing else; never the row's data.
ALTER TABLE sales_lead_import_rows ADD CONSTRAINT sales_lead_import_rows_values
  CHECK (row_number >= 1
         AND (outcome IN ('SKIPPED', 'FAILED')) = (reason_code IS NOT NULL)
         AND (reason_code IS NULL OR reason_code ~ '^[a-z][a-z0-9_]{0,59}$')
         AND (outcome = 'DUPLICATE') = (matched_by IS NOT NULL)
         AND (outcome IN ('IMPORTED', 'DUPLICATE') OR (contact_id IS NULL AND opportunity_id IS NULL)));

-- ---------- Rules ----------
-- Targets: the database stamps who and when. The subject, metric and period never change (archive
-- and create another); archiving is once and final, with the database's time. A team target needs
-- an active department.
CREATE FUNCTION sales_targets_rules() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public, pg_temp
  AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.archived_at IS NOT NULL THEN
      RAISE EXCEPTION 'sales targets: a new target is live' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.department_id IS NOT NULL AND NOT EXISTS (
         SELECT 1 FROM platform_departments d WHERE d.id = NEW.department_id AND d.is_active) THEN
      RAISE EXCEPTION 'sales targets: the team must be an active department'
        USING ERRCODE = 'check_violation';
    END IF;
    NEW.created_at := now();
    NEW.created_by_user_id := app_current_admin_id();
  ELSE
    IF OLD.archived_at IS NOT NULL THEN
      RAISE EXCEPTION 'sales targets: an archived target never changes' USING ERRCODE = 'check_violation';
    END IF;
    IF (NEW.id, NEW.scope, NEW.department_id, NEW.user_id, NEW.metric, NEW.period_type,
        NEW.period_start, NEW.period_end, NEW.created_at, NEW.created_by_user_id)
       IS DISTINCT FROM (OLD.id, OLD.scope, OLD.department_id, OLD.user_id, OLD.metric, OLD.period_type,
        OLD.period_start, OLD.period_end, OLD.created_at, OLD.created_by_user_id) THEN
      RAISE EXCEPTION 'sales targets: the subject, metric and period never change; archive it and create another'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.archived_at IS NOT NULL THEN
      NEW.archived_at := now();
    END IF;
  END IF;
  NEW.updated_at := now();
  NEW.updated_by_user_id := app_current_admin_id();
  RETURN NEW;
END
$$;
CREATE TRIGGER sales_targets_rules BEFORE INSERT OR UPDATE ON sales_targets
  FOR EACH ROW EXECUTE FUNCTION sales_targets_rules();

-- Imports: a batch starts PENDING and empty. Its setup changes while PENDING; it moves PENDING to
-- PROCESSING or CANCELLED, then PROCESSING to COMPLETED or FAILED, and a finished batch never
-- changes (only its owner may be cleared, when that admin is removed). The database stamps the
-- times, and the counts move only with a row outcome (sales_lead_import_rows_count). New records go
-- into an active stage of an active pipeline.
CREATE FUNCTION sales_lead_imports_rules() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public, pg_temp
  AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'PENDING' OR NEW.started_at IS NOT NULL OR NEW.finished_at IS NOT NULL
       OR NEW.failure_code IS NOT NULL OR NEW.imported_count <> 0 OR NEW.duplicate_count <> 0
       OR NEW.skipped_count <> 0 OR NEW.failed_count <> 0 THEN
      RAISE EXCEPTION 'sales imports: a batch starts PENDING, with no counts' USING ERRCODE = 'check_violation';
    END IF;
    NEW.created_at := now();
    NEW.created_by_user_id := app_current_admin_id();
  ELSE
    IF (NEW.id, NEW.created_at, NEW.created_by_user_id)
       IS DISTINCT FROM (OLD.id, OLD.created_at, OLD.created_by_user_id) THEN
      RAISE EXCEPTION 'sales imports: id and creation never change' USING ERRCODE = 'check_violation';
    END IF;
    IF (NEW.imported_count, NEW.duplicate_count, NEW.skipped_count, NEW.failed_count)
       IS DISTINCT FROM (OLD.imported_count, OLD.duplicate_count, OLD.skipped_count, OLD.failed_count)
       AND coalesce(current_setting('app.sales_import_counting', true), '') <> 'on' THEN
      RAISE EXCEPTION 'sales imports: the counts come from the row outcomes' USING ERRCODE = 'check_violation';
    END IF;
    IF OLD.status IN ('COMPLETED', 'FAILED', 'CANCELLED') THEN
      IF NEW.assigned_to_user_id IS NULL AND OLD.assigned_to_user_id IS NOT NULL
         AND (to_jsonb(NEW) - 'assigned_to_user_id' - 'updated_at')
             = (to_jsonb(OLD) - 'assigned_to_user_id' - 'updated_at') THEN
        NEW.updated_at := now();
        RETURN NEW;
      END IF;
      RAISE EXCEPTION 'sales imports: a % batch never changes', OLD.status USING ERRCODE = 'check_violation';
    END IF;
    IF NOT ((OLD.status = 'PENDING' AND NEW.status IN ('PENDING', 'PROCESSING', 'CANCELLED'))
            OR (OLD.status = 'PROCESSING' AND NEW.status IN ('PROCESSING', 'COMPLETED', 'FAILED'))) THEN
      RAISE EXCEPTION 'sales imports: % cannot become %', OLD.status, NEW.status
        USING ERRCODE = 'check_violation';
    END IF;
    IF OLD.status <> 'PENDING'
       AND ((NEW.file_name, NEW.file_size_bytes, NEW.file_sha256, NEW.s3_key, NEW.duplicate_mode,
             NEW.pipeline_id, NEW.stage_id, NEW.default_source, NEW.column_mapping)
            IS DISTINCT FROM (OLD.file_name, OLD.file_size_bytes, OLD.file_sha256, OLD.s3_key,
             OLD.duplicate_mode, OLD.pipeline_id, OLD.stage_id, OLD.default_source, OLD.column_mapping)
            OR (NEW.assigned_to_user_id IS DISTINCT FROM OLD.assigned_to_user_id
                AND NEW.assigned_to_user_id IS NOT NULL)) THEN
      RAISE EXCEPTION 'sales imports: the file and its settings change only while PENDING'
        USING ERRCODE = 'check_violation';
    END IF;
    NEW.started_at := CASE WHEN OLD.status = 'PENDING' AND NEW.status = 'PROCESSING' THEN now()
                           ELSE OLD.started_at END;
    NEW.finished_at := CASE WHEN NEW.status IN ('COMPLETED', 'FAILED', 'CANCELLED') THEN now()
                            ELSE OLD.finished_at END;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM sales_pipelines p WHERE p.id = NEW.pipeline_id AND p.is_active)
     AND (TG_OP = 'INSERT' OR NEW.pipeline_id IS DISTINCT FROM OLD.pipeline_id) THEN
    RAISE EXCEPTION 'sales imports: the pipeline must be active' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.stage_id IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.stage_id IS DISTINCT FROM OLD.stage_id)
     AND NOT EXISTS (SELECT 1 FROM sales_pipeline_stages s
                     WHERE s.id = NEW.stage_id AND s.is_active AND s.stage_type = 'ACTIVE') THEN
    RAISE EXCEPTION 'sales imports: new leads start in an active stage of type ACTIVE'
      USING ERRCODE = 'check_violation';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END
$$;
CREATE TRIGGER sales_lead_imports_rules BEFORE INSERT OR UPDATE ON sales_lead_imports
  FOR EACH ROW EXECUTE FUNCTION sales_lead_imports_rules();

-- Row outcomes: written while the batch is PROCESSING, numbered within its total, insert-only. An
-- imported row names the contact and opportunity it created; a duplicate names the contact it
-- matched, and an opportunity only when the batch attaches to existing contacts. The opportunity
-- is the contact's, in the batch's pipeline.
CREATE FUNCTION sales_lead_import_rows_rules() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public, pg_temp
  AS $$
DECLARE
  batch sales_lead_imports;
BEGIN
  SELECT * INTO batch FROM sales_lead_imports WHERE id = NEW.import_id FOR UPDATE;
  IF batch.status IS DISTINCT FROM 'PROCESSING' THEN
    RAISE EXCEPTION 'sales import rows: the batch must be PROCESSING' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.row_number > batch.total_rows THEN
    RAISE EXCEPTION 'sales import rows: row % is past the batch''s % rows', NEW.row_number, batch.total_rows
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.outcome IN ('IMPORTED', 'DUPLICATE') AND NEW.contact_id IS NULL THEN
    RAISE EXCEPTION 'sales import rows: an % row names its contact', NEW.outcome
      USING ERRCODE = 'check_violation';
  END IF;
  IF (NEW.outcome = 'IMPORTED' OR (NEW.outcome = 'DUPLICATE' AND batch.duplicate_mode = 'ATTACH_TO_EXISTING'))
     <> (NEW.opportunity_id IS NOT NULL) THEN
    RAISE EXCEPTION 'sales import rows: an opportunity comes with an imported row, or a duplicate attached to its contact'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.opportunity_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM sales_opportunities o
       WHERE o.id = NEW.opportunity_id AND o.contact_id = NEW.contact_id
         AND o.pipeline_id = batch.pipeline_id) THEN
    RAISE EXCEPTION 'sales import rows: the opportunity must be the contact''s, in the batch''s pipeline'
      USING ERRCODE = 'check_violation';
  END IF;
  NEW.created_at := now();
  RETURN NEW;
END
$$;
CREATE TRIGGER sales_lead_import_rows_rules BEFORE INSERT ON sales_lead_import_rows
  FOR EACH ROW EXECUTE FUNCTION sales_lead_import_rows_rules();

-- Each outcome adds one to its batch's count (the only way the counts move).
CREATE FUNCTION sales_lead_import_rows_count() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public, pg_temp
  AS $$
BEGIN
  PERFORM set_config('app.sales_import_counting', 'on', true);
  UPDATE sales_lead_imports
  SET imported_count = imported_count + (NEW.outcome = 'IMPORTED')::int,
      duplicate_count = duplicate_count + (NEW.outcome = 'DUPLICATE')::int,
      skipped_count = skipped_count + (NEW.outcome = 'SKIPPED')::int,
      failed_count = failed_count + (NEW.outcome = 'FAILED')::int
  WHERE id = NEW.import_id;
  PERFORM set_config('app.sales_import_counting', '', true);
  RETURN NULL;
END
$$;
CREATE TRIGGER sales_lead_import_rows_count AFTER INSERT ON sales_lead_import_rows
  FOR EACH ROW EXECUTE FUNCTION sales_lead_import_rows_count();

-- ---------- Grants ----------
-- Targets are archived and batches cancelled, never deleted; row outcomes are insert-only.
GRANT SELECT, INSERT, UPDATE ON sales_targets, sales_lead_imports TO firmivra_app;
GRANT SELECT, INSERT ON sales_lead_import_rows TO firmivra_app;

-- ---------- Row-level security ----------
-- The Super Admin team (admin scope) and the platform's import job (platform scope), as for B5's
-- sales tables (app_is_sales_team). Which targets and imports a team member sees is the API's
-- check (platform_members.scope_type and the sales.* keys). No firm scope reaches them.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['sales_targets', 'sales_lead_imports', 'sales_lead_import_rows'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR ALL USING (app_is_sales_team()) '
                   'WITH CHECK (app_is_sales_team())', t || '_team', t);
  END LOOP;
END
$$;
