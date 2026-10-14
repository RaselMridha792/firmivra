-- R38 (Rasel, Oct 14), Automations, part 2: runs, action executions and settings
-- (docs/mockups/firm-workspace/automations/source, Frame 3 "Automation Logs & Rule Activity" and
-- the guide's sections 8 and 11 to 15). A run has a stable id, the rule version it used and a
-- source event key, so the same event never starts a second run for a rule; each action has its
-- own idempotency key and a SUCCEEDED action is never run again, so a retry or re-run repeats
-- only what failed. Logs hold ids, codes and short safe messages, never client data or secrets.

-- CreateEnum
CREATE TYPE "AutomationRunStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCESS', 'PARTIAL_SUCCESS', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "ActionExecutionStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCESS', 'FAILED', 'SKIPPED');

-- CreateTable
CREATE TABLE "automation_runs" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "rule_id" UUID NOT NULL,
    "rule_version_id" UUID NOT NULL,
    "status" "AutomationRunStatus" NOT NULL DEFAULT 'PENDING',
    "dry_run" BOOLEAN NOT NULL DEFAULT false,
    "source_module" "AutomationModule" NOT NULL,
    "source_event_key" TEXT NOT NULL,
    "client_id" UUID,
    "record_kind" TEXT,
    "record_id" UUID,
    "correlation_id" UUID NOT NULL,
    "depth" INTEGER NOT NULL DEFAULT 0,
    "parent_run_id" UUID,
    "started_at" TIMESTAMPTZ(3),
    "finished_at" TIMESTAMPTZ(3),
    "duration_ms" INTEGER,
    "error_code" TEXT,
    "message" TEXT,
    "rerun_count" INTEGER NOT NULL DEFAULT 0,
    "last_rerun_at" TIMESTAMPTZ(3),
    "last_rerun_by_user_id" UUID,
    "last_rerun_reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "automation_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "automation_action_executions" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "action_key" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "action_type" TEXT NOT NULL,
    "status" "ActionExecutionStatus" NOT NULL DEFAULT 'PENDING',
    "idempotency_key" TEXT NOT NULL,
    "scheduled_for" TIMESTAMPTZ(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "retryable" BOOLEAN NOT NULL DEFAULT true,
    "error_code" TEXT,
    "detail" TEXT,
    "result_kind" TEXT,
    "result_id" UUID,
    "started_at" TIMESTAMPTZ(3),
    "finished_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "automation_action_executions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "automation_settings" (
    "business_id" UUID NOT NULL,
    "quiet_start" TIME(0),
    "quiet_end" TIME(0),
    "default_dedupe_days" INTEGER NOT NULL DEFAULT 7,
    "max_depth" INTEGER NOT NULL DEFAULT 3,
    "safety_threshold" INTEGER NOT NULL DEFAULT 500,
    "failure_alert_user_ids" UUID[] DEFAULT ARRAY[]::UUID[],
    "minutes_saved_per_action" INTEGER NOT NULL DEFAULT 5,
    "log_retention_days" INTEGER NOT NULL DEFAULT 365,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "automation_settings_pkey" PRIMARY KEY ("business_id")
);

-- CreateIndex
CREATE INDEX "automation_runs_business_id_created_at_idx" ON "automation_runs"("business_id", "created_at");

-- CreateIndex
CREATE INDEX "automation_runs_business_id_status_created_at_idx" ON "automation_runs"("business_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "automation_runs_business_id_rule_id_created_at_idx" ON "automation_runs"("business_id", "rule_id", "created_at");

-- CreateIndex
CREATE INDEX "automation_runs_business_id_client_id_idx" ON "automation_runs"("business_id", "client_id");

-- CreateIndex
CREATE UNIQUE INDEX "automation_runs_business_id_id_key" ON "automation_runs"("business_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "automation_runs_business_id_rule_id_source_event_key_key" ON "automation_runs"("business_id", "rule_id", "source_event_key");

-- CreateIndex
CREATE INDEX "automation_action_executions_business_id_status_scheduled_f_idx" ON "automation_action_executions"("business_id", "status", "scheduled_for");

-- CreateIndex
CREATE UNIQUE INDEX "automation_action_executions_business_id_run_id_action_key_key" ON "automation_action_executions"("business_id", "run_id", "action_key");

-- CreateIndex
CREATE UNIQUE INDEX "automation_action_executions_business_id_idempotency_key_key" ON "automation_action_executions"("business_id", "idempotency_key");

-- AddForeignKey
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_business_id_rule_id_fkey" FOREIGN KEY ("business_id", "rule_id") REFERENCES "automation_rules"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_business_id_rule_version_id_fkey" FOREIGN KEY ("business_id", "rule_version_id") REFERENCES "automation_rule_versions"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_business_id_client_id_fkey" FOREIGN KEY ("business_id", "client_id") REFERENCES "clients"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_business_id_parent_run_id_fkey" FOREIGN KEY ("business_id", "parent_run_id") REFERENCES "automation_runs"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_action_executions" ADD CONSTRAINT "automation_action_executions_business_id_run_id_fkey" FOREIGN KEY ("business_id", "run_id") REFERENCES "automation_runs"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_settings" ADD CONSTRAINT "automation_settings_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------- Grants, RLS, policy ----------
-- Runs and executions are a record: they are updated while they run, never deleted.
GRANT SELECT, INSERT, UPDATE ON automation_runs, automation_action_executions,
  automation_settings TO firmivra_app;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['automation_runs', 'automation_action_executions',
    'automation_settings'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I ON %I USING (business_id = app_current_business_id())'
                   ' WITH CHECK (business_id = app_current_business_id())', t || '_business', t);
  END LOOP;
END
$$;

-- ---------- Shape ----------
ALTER TABLE automation_runs ADD CONSTRAINT automation_runs_shape
  CHECK (btrim(source_event_key) <> '' AND char_length(source_event_key) <= 200
         AND depth BETWEEN 0 AND 10 AND (duration_ms IS NULL OR duration_ms >= 0)
         AND char_length(error_code) <= 60 AND char_length(message) <= 300
         AND char_length(last_rerun_reason) <= 500 AND rerun_count >= 0
         AND (record_kind IS NULL) = (record_id IS NULL)
         -- A finished run has its end time; one that ran has its start; a re-run has its reason.
         AND ((status IN ('SUCCESS', 'PARTIAL_SUCCESS', 'FAILED', 'SKIPPED')) = (finished_at IS NOT NULL))
         AND (status IN ('PENDING', 'SKIPPED') OR started_at IS NOT NULL)
         AND (rerun_count = 0) = (last_rerun_at IS NULL)
         AND (last_rerun_at IS NULL OR btrim(coalesce(last_rerun_reason, '')) <> '')
         AND (status IN ('FAILED', 'PARTIAL_SUCCESS', 'SKIPPED') OR error_code IS NULL));

ALTER TABLE automation_action_executions ADD CONSTRAINT automation_action_executions_shape
  CHECK (btrim(action_key) <> '' AND char_length(action_key) <= 80 AND position >= 0
         AND btrim(action_type) <> '' AND char_length(action_type) <= 60
         AND btrim(idempotency_key) <> '' AND char_length(idempotency_key) <= 200
         AND attempts >= 0 AND char_length(error_code) <= 60 AND char_length(detail) <= 300
         AND (result_kind IS NULL) = (result_id IS NULL)
         AND ((status IN ('SUCCESS', 'FAILED', 'SKIPPED')) = (finished_at IS NOT NULL))
         AND (status = 'FAILED' OR error_code IS NULL));

ALTER TABLE automation_settings ADD CONSTRAINT automation_settings_shape
  CHECK (default_dedupe_days BETWEEN 0 AND 90 AND max_depth BETWEEN 1 AND 10
         AND safety_threshold BETWEEN 1 AND 100000 AND minutes_saved_per_action BETWEEN 0 AND 240
         AND log_retention_days BETWEEN 90 AND 3650
         AND cardinality(failure_alert_user_ids) <= 20
         AND array_position(failure_alert_user_ids, NULL) IS NULL
         AND (quiet_start IS NULL) = (quiet_end IS NULL));

-- ---------- A run is of its rule's own version; what it started from never changes ----------
CREATE FUNCTION automation_runs_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NOT EXISTS (SELECT 1 FROM automation_rule_versions v
       WHERE v.business_id = NEW.business_id AND v.id = NEW.rule_version_id
         AND v.rule_id = NEW.rule_id) THEN
    RAISE EXCEPTION 'automation runs: the version must be one of the rule''s own'
      USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.rule_id, NEW.rule_version_id, NEW.source_event_key, NEW.dry_run,
       NEW.correlation_id, NEW.depth, NEW.client_id, NEW.record_id)
     IS DISTINCT FROM (OLD.rule_id, OLD.rule_version_id, OLD.source_event_key, OLD.dry_run,
       OLD.correlation_id, OLD.depth, OLD.client_id, OLD.record_id) THEN
    RAISE EXCEPTION 'automation runs: what a run started from never changes'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER automation_runs_rules BEFORE INSERT OR UPDATE ON automation_runs
  FOR EACH ROW EXECUTE FUNCTION automation_runs_rules();

-- ---------- A succeeded action is never run again ----------
CREATE FUNCTION automation_action_executions_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF (NEW.run_id, NEW.action_key, NEW.position, NEW.action_type, NEW.idempotency_key)
     IS DISTINCT FROM (OLD.run_id, OLD.action_key, OLD.position, OLD.action_type, OLD.idempotency_key) THEN
    RAISE EXCEPTION 'automation actions: an action keeps its run, key and type'
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status = 'SUCCESS' AND NEW.status <> 'SUCCESS' THEN
    RAISE EXCEPTION 'automation actions: a succeeded action is never run again'
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status = 'SUCCESS' AND (NEW.attempts, NEW.result_kind, NEW.result_id)
     IS DISTINCT FROM (OLD.attempts, OLD.result_kind, OLD.result_id) THEN
    RAISE EXCEPTION 'automation actions: a succeeded action keeps its result'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER automation_action_executions_rules BEFORE UPDATE ON automation_action_executions
  FOR EACH ROW EXECUTE FUNCTION automation_action_executions_rules();
