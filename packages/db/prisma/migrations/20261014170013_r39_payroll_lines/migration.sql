-- CreateEnum
CREATE TYPE "PayrollLineStatus" AS ENUM ('READY', 'WARNING', 'ERROR', 'PENDING_CHANGE', 'EXCLUDED');

-- CreateEnum
CREATE TYPE "PayrollIssueSeverity" AS ENUM ('INFO', 'WARNING', 'ERROR');

-- CreateTable
CREATE TABLE "payroll_run_lines" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "worker_id" UUID NOT NULL,
    "hours" DECIMAL(7,2) NOT NULL DEFAULT 0,
    "regular_pay_cents" INTEGER NOT NULL DEFAULT 0,
    "overtime_pay_cents" INTEGER NOT NULL DEFAULT 0,
    "other_earnings_cents" INTEGER NOT NULL DEFAULT 0,
    "deductions_cents" INTEGER NOT NULL DEFAULT 0,
    "total_pay_cents" INTEGER NOT NULL DEFAULT 0,
    "status" "PayrollLineStatus" NOT NULL DEFAULT 'READY',
    "note" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "payroll_run_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_run_issues" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "worker_id" UUID,
    "severity" "PayrollIssueSeverity" NOT NULL,
    "code" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "resolved_at" TIMESTAMPTZ(3),
    "resolved_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payroll_run_issues_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "payroll_run_lines_business_id_worker_id_idx" ON "payroll_run_lines"("business_id", "worker_id");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_run_lines_run_id_worker_id_key" ON "payroll_run_lines"("run_id", "worker_id");

-- CreateIndex
CREATE INDEX "payroll_run_issues_business_id_run_id_severity_idx" ON "payroll_run_issues"("business_id", "run_id", "severity");

-- AddForeignKey
ALTER TABLE "payroll_run_lines" ADD CONSTRAINT "payroll_run_lines_business_id_run_id_fkey" FOREIGN KEY ("business_id", "run_id") REFERENCES "payroll_runs"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_run_lines" ADD CONSTRAINT "payroll_run_lines_business_id_worker_id_fkey" FOREIGN KEY ("business_id", "worker_id") REFERENCES "payroll_workers"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_run_issues" ADD CONSTRAINT "payroll_run_issues_business_id_run_id_fkey" FOREIGN KEY ("business_id", "run_id") REFERENCES "payroll_runs"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_run_issues" ADD CONSTRAINT "payroll_run_issues_business_id_worker_id_fkey" FOREIGN KEY ("business_id", "worker_id") REFERENCES "payroll_workers"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Grants: lines can be removed while a run is prepared; issues are resolved.
GRANT SELECT, INSERT, UPDATE, DELETE ON payroll_run_lines TO firmivra_app;
GRANT SELECT, INSERT, UPDATE ON payroll_run_issues TO firmivra_app;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['payroll_run_lines', 'payroll_run_issues'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I ON %I USING (business_id = app_current_business_id())'
                   ' WITH CHECK (business_id = app_current_business_id())', t || '_business', t);
  END LOOP;
END
$$;

-- Shape
ALTER TABLE payroll_run_lines ADD CONSTRAINT payroll_run_lines_values
  CHECK (hours >= 0 AND hours < 1000 AND regular_pay_cents >= 0 AND overtime_pay_cents >= 0
         AND other_earnings_cents >= 0 AND deductions_cents >= 0
         AND total_pay_cents = regular_pay_cents + overtime_pay_cents + other_earnings_cents - deductions_cents
         AND (note IS NULL OR esign_text_ok(note, 300)));

-- Messages name no pay, SSN or bank detail: short text with no long digit runs.
ALTER TABLE payroll_run_issues ADD CONSTRAINT payroll_run_issues_values
  CHECK (code ~ '^[a-z][a-z0-9_]{0,59}$' AND esign_text_ok(message, 300)
         AND message !~ '[0-9]{6,}'
         AND (resolved_at IS NULL) = (resolved_by_user_id IS NULL));

-- A line belongs to a worker of the run's own payroll client, and changes only while the run is prepared.
CREATE FUNCTION payroll_run_lines_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  r payroll_runs%ROWTYPE;
  row_ payroll_run_lines%ROWTYPE := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
BEGIN
  SELECT * INTO r FROM payroll_runs p WHERE p.business_id = row_.business_id AND p.id = row_.run_id;
  IF r.status NOT IN ('NOT_STARTED', 'DRAFT', 'IN_PROGRESS') THEN
    RAISE EXCEPTION 'PAYROLL_RUN_LOCKED: the lines of a run change only while it is prepared'
      USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP <> 'DELETE' AND NOT EXISTS (
       SELECT 1 FROM payroll_workers w
        WHERE w.business_id = NEW.business_id AND w.id = NEW.worker_id
          AND w.payroll_client_id = r.payroll_client_id) THEN
    RAISE EXCEPTION 'PAYROLL_LINE_WORKER: the worker belongs to another payroll client'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN row_;
END
$$;
CREATE TRIGGER payroll_run_lines_rules BEFORE INSERT OR UPDATE OR DELETE ON payroll_run_lines
  FOR EACH ROW EXECUTE FUNCTION payroll_run_lines_rules();

-- An issue names a worker of the run's payroll client, and only its resolution changes.
CREATE FUNCTION payroll_run_issues_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.worker_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM payroll_runs r JOIN payroll_workers w
         ON w.business_id = r.business_id AND w.payroll_client_id = r.payroll_client_id
        WHERE r.business_id = NEW.business_id AND r.id = NEW.run_id AND w.id = NEW.worker_id) THEN
    RAISE EXCEPTION 'PAYROLL_ISSUE_WORKER: the worker belongs to another payroll client'
      USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'UPDATE' AND (to_jsonb(NEW) - 'resolved_at' - 'resolved_by_user_id')
                          IS DISTINCT FROM (to_jsonb(OLD) - 'resolved_at' - 'resolved_by_user_id') THEN
    RAISE EXCEPTION 'PAYROLL_ISSUE_FROZEN: only the resolution of an issue changes'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER payroll_run_issues_rules BEFORE INSERT OR UPDATE ON payroll_run_issues
  FOR EACH ROW EXECUTE FUNCTION payroll_run_issues_rules();

-- A run with an unresolved error, or a line in ERROR, is not approved.
CREATE FUNCTION payroll_runs_approval_blockers() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF NEW.status = 'APPROVED' AND OLD.status IS DISTINCT FROM 'APPROVED' AND (
       EXISTS (SELECT 1 FROM payroll_run_issues i
                WHERE i.business_id = NEW.business_id AND i.run_id = NEW.id
                  AND i.severity = 'ERROR' AND i.resolved_at IS NULL)
    OR EXISTS (SELECT 1 FROM payroll_run_lines l
                WHERE l.business_id = NEW.business_id AND l.run_id = NEW.id AND l.status = 'ERROR')) THEN
    RAISE EXCEPTION 'PAYROLL_RUN_BLOCKED: resolve the errors before approving'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER payroll_runs_approval_blockers BEFORE UPDATE ON payroll_runs
  FOR EACH ROW EXECUTE FUNCTION payroll_runs_approval_blockers();
