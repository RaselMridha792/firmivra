-- CreateEnum
CREATE TYPE "AdvisoryFinancialSource" AS ENUM ('MANUAL', 'BOOKKEEPING', 'PAYROLL', 'BANK', 'UPLOADED');

-- CreateTable
CREATE TABLE "advisory_financial_snapshots" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "advisory_client_id" UUID NOT NULL,
    "plan_id" UUID,
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "revenue_cents" INTEGER,
    "expenses_cents" INTEGER,
    "net_profit_cents" INTEGER,
    "cash_flow_cents" INTEGER,
    "debt_cents" INTEGER,
    "budget_revenue_cents" INTEGER,
    "budget_expenses_cents" INTEGER,
    "headcount" INTEGER,
    "source" "AdvisoryFinancialSource" NOT NULL DEFAULT 'MANUAL',
    "as_of" DATE NOT NULL,
    "overridden" BOOLEAN NOT NULL DEFAULT false,
    "override_reason" TEXT,
    "overridden_by_user_id" UUID,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "advisory_financial_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "advisory_financial_snapshots_business_id_advisory_client_id_idx" ON "advisory_financial_snapshots"("business_id", "advisory_client_id", "period_end");

-- AddForeignKey
ALTER TABLE "advisory_financial_snapshots" ADD CONSTRAINT "advisory_financial_snapshots_business_id_advisory_client_i_fkey" FOREIGN KEY ("business_id", "advisory_client_id") REFERENCES "advisory_clients"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "advisory_financial_snapshots" ADD CONSTRAINT "advisory_financial_snapshots_business_id_plan_id_fkey" FOREIGN KEY ("business_id", "plan_id") REFERENCES "advisory_plans"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Grants: figures are insert-only; a correction is a new row.
GRANT SELECT, INSERT ON advisory_financial_snapshots TO firmivra_app;
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['advisory_financial_snapshots'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I ON %I USING (business_id = app_current_business_id())'
                   ' WITH CHECK (business_id = app_current_business_id())', t || '_business', t);
  END LOOP;
END
$$;

-- Shape
ALTER TABLE advisory_financial_snapshots ADD CONSTRAINT advisory_financial_snapshots_values
  CHECK (period_end >= period_start
         AND coalesce(revenue_cents, 0) >= 0 AND coalesce(expenses_cents, 0) >= 0
         AND coalesce(debt_cents, 0) >= 0 AND coalesce(headcount, 0) >= 0
         AND (num_nulls(revenue_cents, expenses_cents, net_profit_cents) > 0
              OR net_profit_cents = revenue_cents - expenses_cents)
         AND (NOT overridden OR (override_reason IS NOT NULL AND overridden_by_user_id IS NOT NULL))
         AND (override_reason IS NULL OR esign_text_ok(override_reason, 500)));

-- A snapshot's plan belongs to the same advisory client.
CREATE FUNCTION advisory_financial_snapshots_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF NEW.plan_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM advisory_plans p WHERE p.business_id = NEW.business_id AND p.id = NEW.plan_id
          AND p.advisory_client_id = NEW.advisory_client_id) THEN
    RAISE EXCEPTION 'ADVISORY_SNAPSHOT_PLAN: the plan belongs to another advisory client'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER advisory_financial_snapshots_rules BEFORE INSERT ON advisory_financial_snapshots
  FOR EACH ROW EXECUTE FUNCTION advisory_financial_snapshots_rules();
