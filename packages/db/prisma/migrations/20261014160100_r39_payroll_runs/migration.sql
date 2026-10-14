-- CreateEnum
CREATE TYPE "PayrollRunStatus" AS ENUM ('NOT_STARTED', 'DRAFT', 'IN_PROGRESS', 'READY_FOR_REVIEW', 'APPROVED', 'SUBMITTED', 'PROCESSING', 'COMPLETED', 'NEEDS_ATTENTION');

-- CreateTable
CREATE TABLE "payroll_runs" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "payroll_client_id" UUID NOT NULL,
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "pay_date" DATE NOT NULL,
    "frequency" "PayrollFrequency" NOT NULL,
    "status" "PayrollRunStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "step" INTEGER NOT NULL DEFAULT 1,
    "include_contractors" BOOLEAN NOT NULL DEFAULT true,
    "provider_run_id" TEXT,
    "provider_status" TEXT,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "figures_confirmed" BOOLEAN NOT NULL DEFAULT false,
    "employee_count" INTEGER,
    "regular_pay_cents" INTEGER,
    "overtime_pay_cents" INTEGER,
    "other_earnings_cents" INTEGER,
    "gross_cents" INTEGER,
    "employee_taxes_cents" INTEGER,
    "deductions_cents" INTEGER,
    "net_cents" INTEGER,
    "employer_taxes_cents" INTEGER,
    "employer_benefits_cents" INTEGER,
    "employer_costs_cents" INTEGER,
    "total_cost_cents" INTEGER,
    "prepared_by_user_id" UUID,
    "ready_at" TIMESTAMPTZ(3),
    "approved_at" TIMESTAMPTZ(3),
    "approved_by_user_id" UUID,
    "submitted_at" TIMESTAMPTZ(3),
    "submitted_by_user_id" UUID,
    "provider_confirmation" TEXT,
    "reopened_at" TIMESTAMPTZ(3),
    "reopen_reason" TEXT,
    "completed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "payroll_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "payroll_runs_business_id_status_pay_date_idx" ON "payroll_runs"("business_id", "status", "pay_date");

-- CreateIndex
CREATE INDEX "payroll_runs_business_id_payroll_client_id_pay_date_idx" ON "payroll_runs"("business_id", "payroll_client_id", "pay_date");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_runs_business_id_id_key" ON "payroll_runs"("business_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_runs_payroll_client_id_period_start_period_end_key" ON "payroll_runs"("payroll_client_id", "period_start", "period_end");

-- AddForeignKey
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_business_id_payroll_client_id_fkey" FOREIGN KEY ("business_id", "payroll_client_id") REFERENCES "payroll_clients"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Grants: runs are completed or reopened, never deleted.
GRANT SELECT, INSERT, UPDATE ON payroll_runs TO firmivra_app;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['payroll_runs'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I ON %I USING (business_id = app_current_business_id())'
                   ' WITH CHECK (business_id = app_current_business_id())', t || '_business', t);
  END LOOP;
END
$$;

ALTER TABLE payroll_runs ADD CONSTRAINT payroll_runs_values
  CHECK (period_end >= period_start AND step BETWEEN 1 AND 5
         AND source IN ('provider', 'manual')
         AND (provider_run_id IS NULL OR char_length(provider_run_id) <= 100)
         AND (provider_status IS NULL OR provider_status ~ '^[a-z][a-z0-9_]{0,59}$')
         AND (provider_confirmation IS NULL OR char_length(provider_confirmation) BETWEEN 1 AND 100)
         AND (reopen_reason IS NULL OR esign_text_ok(reopen_reason, 500))
         AND (employee_count IS NULL OR employee_count >= 0)
         -- Every figure is a non-negative amount in cents, or empty.
         AND coalesce(regular_pay_cents, 0) >= 0 AND coalesce(overtime_pay_cents, 0) >= 0
         AND coalesce(other_earnings_cents, 0) >= 0 AND coalesce(gross_cents, 0) >= 0
         AND coalesce(employee_taxes_cents, 0) >= 0 AND coalesce(deductions_cents, 0) >= 0
         AND coalesce(net_cents, 0) >= 0 AND coalesce(employer_taxes_cents, 0) >= 0
         AND coalesce(employer_benefits_cents, 0) >= 0 AND coalesce(employer_costs_cents, 0) >= 0
         AND coalesce(total_cost_cents, 0) >= 0
         -- The sums hold wherever all their parts are there.
         AND (num_nulls(regular_pay_cents, overtime_pay_cents, other_earnings_cents, gross_cents) > 0
              OR gross_cents = regular_pay_cents + overtime_pay_cents + other_earnings_cents)
         AND (num_nulls(gross_cents, employee_taxes_cents, deductions_cents, net_cents) > 0
              OR net_cents = gross_cents - employee_taxes_cents - deductions_cents)
         AND (num_nulls(employer_taxes_cents, employer_benefits_cents, employer_costs_cents) > 0
              OR employer_costs_cents = employer_taxes_cents + employer_benefits_cents)
         AND (num_nulls(gross_cents, employer_costs_cents, total_cost_cents) > 0
              OR total_cost_cents = gross_cents + employer_costs_cents)
         -- A confirmed figure set needs the gross; each status needs the facts that got it there.
         AND (NOT figures_confirmed OR gross_cents IS NOT NULL)
         AND (status NOT IN ('READY_FOR_REVIEW', 'APPROVED', 'SUBMITTED', 'PROCESSING', 'COMPLETED') OR ready_at IS NOT NULL)
         AND (status NOT IN ('APPROVED', 'SUBMITTED', 'PROCESSING', 'COMPLETED')
              OR (approved_at IS NOT NULL AND approved_by_user_id IS NOT NULL))
         AND (status NOT IN ('SUBMITTED', 'PROCESSING', 'COMPLETED') OR submitted_at IS NOT NULL)
         AND (status = 'COMPLETED') = (completed_at IS NOT NULL));

-- A run moves along the workflow; a reopen (back to IN_PROGRESS) needs a reason; a COMPLETED run
-- is a record and never changes.
CREATE FUNCTION payroll_runs_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF OLD.status = 'COMPLETED' THEN
    RAISE EXCEPTION 'PAYROLL_RUN_COMPLETED: a completed payroll run does not change'
      USING ERRCODE = 'check_violation';
  END IF;
  IF (NEW.payroll_client_id, NEW.period_start, NEW.period_end) IS DISTINCT FROM
     (OLD.payroll_client_id, OLD.period_start, OLD.period_end) THEN
    RAISE EXCEPTION 'PAYROLL_RUN_PERIOD: a run keeps its client and period'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NOT ((OLD.status = 'NOT_STARTED' AND NEW.status IN ('DRAFT', 'IN_PROGRESS'))
         OR (OLD.status = 'DRAFT' AND NEW.status = 'IN_PROGRESS')
         OR (OLD.status = 'IN_PROGRESS' AND NEW.status IN ('DRAFT', 'READY_FOR_REVIEW'))
         OR (OLD.status = 'READY_FOR_REVIEW' AND NEW.status IN ('APPROVED', 'IN_PROGRESS'))
         OR (OLD.status = 'APPROVED' AND NEW.status IN ('SUBMITTED', 'COMPLETED', 'IN_PROGRESS'))
         OR (OLD.status = 'SUBMITTED' AND NEW.status IN ('PROCESSING', 'COMPLETED', 'NEEDS_ATTENTION'))
         OR (OLD.status = 'PROCESSING' AND NEW.status IN ('COMPLETED', 'NEEDS_ATTENTION'))
         OR (OLD.status = 'NEEDS_ATTENTION' AND NEW.status IN ('IN_PROGRESS', 'SUBMITTED', 'COMPLETED'))) THEN
      RAISE EXCEPTION 'PAYROLL_RUN_STATUS: % cannot become %', OLD.status, NEW.status
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.status = 'IN_PROGRESS' AND OLD.status IN ('READY_FOR_REVIEW', 'APPROVED', 'NEEDS_ATTENTION') THEN
      IF NEW.reopen_reason IS NULL OR NEW.reopened_at IS NULL THEN
        RAISE EXCEPTION 'PAYROLL_RUN_REOPEN: reopening needs a reason'
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER payroll_runs_rules BEFORE UPDATE ON payroll_runs
  FOR EACH ROW EXECUTE FUNCTION payroll_runs_rules();
