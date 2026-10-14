-- R38 (Rasel, Oct 14), Tax Planning, part 2: the figures a plan is built on, plan snapshots,
-- plan documents and Tax Savings Calculator scenarios (docs/mockups/firm-workspace/tax-planning/
-- source and the guide's sections 9, 10, 14 and 19). Historical and projected figures are kept
-- apart and a manual adjustment says why; a finalized, generated or sent plan is kept as an
-- insert-only snapshot; a scenario saved to a plan never changes; every estimate can be null.

-- CreateEnum
CREATE TYPE "PlanInputKind" AS ENUM ('HISTORICAL', 'PROJECTED', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "PlanVersionEvent" AS ENUM ('FINALIZED', 'GENERATED', 'SENT');

-- CreateTable
CREATE TABLE "tax_plan_inputs" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "kind" "PlanInputKind" NOT NULL,
    "tax_year" INTEGER NOT NULL,
    "amount_cents" INTEGER,
    "text_value" TEXT,
    "source" TEXT NOT NULL,
    "as_of" TIMESTAMPTZ(3),
    "note" TEXT,
    "entered_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "tax_plan_inputs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_plan_versions" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "event" "PlanVersionEvent" NOT NULL,
    "tax_year" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "source_data_as_of" TIMESTAMPTZ(3),
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tax_plan_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_plan_documents" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "plan_strategy_id" UUID,
    "category" TEXT,
    "added_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tax_plan_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_savings_scenarios" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "client_id" UUID,
    "plan_id" UUID,
    "name" TEXT,
    "tax_year" INTEGER NOT NULL,
    "filing_status" "TaxFilingStatus",
    "baseline_inputs" JSONB NOT NULL DEFAULT '{}',
    "strategy_inputs" JSONB NOT NULL DEFAULT '{}',
    "baseline_tax_cents" INTEGER,
    "modeled_tax_cents" INTEGER,
    "difference_cents" INTEGER,
    "assumptions" TEXT,
    "saved_to_plan_at" TIMESTAMPTZ(3),
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "tax_savings_scenarios_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tax_plan_inputs_business_id_plan_id_key_kind_tax_year_key" ON "tax_plan_inputs"("business_id", "plan_id", "key", "kind", "tax_year");

-- CreateIndex
CREATE UNIQUE INDEX "tax_plan_versions_business_id_plan_id_version_key" ON "tax_plan_versions"("business_id", "plan_id", "version");

-- CreateIndex
CREATE INDEX "tax_plan_documents_business_id_document_id_idx" ON "tax_plan_documents"("business_id", "document_id");

-- CreateIndex
CREATE UNIQUE INDEX "tax_plan_documents_business_id_plan_id_document_id_key" ON "tax_plan_documents"("business_id", "plan_id", "document_id");

-- CreateIndex
CREATE INDEX "tax_savings_scenarios_business_id_client_id_idx" ON "tax_savings_scenarios"("business_id", "client_id");

-- CreateIndex
CREATE INDEX "tax_savings_scenarios_business_id_plan_id_idx" ON "tax_savings_scenarios"("business_id", "plan_id");

-- AddForeignKey
ALTER TABLE "tax_plan_inputs" ADD CONSTRAINT "tax_plan_inputs_business_id_plan_id_fkey" FOREIGN KEY ("business_id", "plan_id") REFERENCES "tax_plans"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_plan_versions" ADD CONSTRAINT "tax_plan_versions_business_id_plan_id_fkey" FOREIGN KEY ("business_id", "plan_id") REFERENCES "tax_plans"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_plan_documents" ADD CONSTRAINT "tax_plan_documents_business_id_plan_id_fkey" FOREIGN KEY ("business_id", "plan_id") REFERENCES "tax_plans"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_plan_documents" ADD CONSTRAINT "tax_plan_documents_business_id_document_id_fkey" FOREIGN KEY ("business_id", "document_id") REFERENCES "documents"("business_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_plan_documents" ADD CONSTRAINT "tax_plan_documents_business_id_plan_strategy_id_fkey" FOREIGN KEY ("business_id", "plan_strategy_id") REFERENCES "tax_plan_strategies"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_savings_scenarios" ADD CONSTRAINT "tax_savings_scenarios_business_id_client_id_fkey" FOREIGN KEY ("business_id", "client_id") REFERENCES "clients"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_savings_scenarios" ADD CONSTRAINT "tax_savings_scenarios_business_id_plan_id_fkey" FOREIGN KEY ("business_id", "plan_id") REFERENCES "tax_plans"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------- Grants, RLS, policy ----------
-- Snapshots are insert-only; a scenario is never deleted; inputs and documents come and go.
GRANT SELECT, INSERT, UPDATE, DELETE ON tax_plan_inputs, tax_plan_documents TO firmivra_app;
GRANT SELECT, INSERT ON tax_plan_versions TO firmivra_app;
GRANT SELECT, INSERT, UPDATE ON tax_savings_scenarios TO firmivra_app;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['tax_plan_inputs', 'tax_plan_versions', 'tax_plan_documents',
    'tax_savings_scenarios'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I ON %I USING (business_id = app_current_business_id())'
                   ' WITH CHECK (business_id = app_current_business_id())', t || '_business', t);
  END LOOP;
END
$$;

-- ---------- Shape ----------
ALTER TABLE tax_plan_inputs ADD CONSTRAINT tax_plan_inputs_shape
  CHECK (key ~ '^[a-z][a-z0-9_]{1,59}$' AND tax_year BETWEEN 2000 AND 2100
         AND btrim(source) <> '' AND char_length(source) <= 120
         AND char_length(text_value) <= 500 AND char_length(note) <= 500
         -- A figure has its value (never an empty row), and a manual adjustment says why.
         AND (amount_cents IS NOT NULL OR text_value IS NOT NULL)
         AND (kind <> 'ADJUSTMENT' OR btrim(coalesce(note, '')) <> ''));

ALTER TABLE tax_plan_versions ADD CONSTRAINT tax_plan_versions_shape
  CHECK (version >= 1 AND tax_year BETWEEN 2000 AND 2100
         AND jsonb_typeof(snapshot) = 'object' AND pg_column_size(snapshot) <= 400000);

ALTER TABLE tax_plan_documents ADD CONSTRAINT tax_plan_documents_shape
  CHECK (char_length(category) <= 80);

ALTER TABLE tax_savings_scenarios ADD CONSTRAINT tax_savings_scenarios_shape
  CHECK (tax_year BETWEEN 2000 AND 2100 AND char_length(name) <= 120
         AND char_length(assumptions) <= 2000
         AND jsonb_typeof(baseline_inputs) = 'object' AND pg_column_size(baseline_inputs) <= 20000
         AND jsonb_typeof(strategy_inputs) = 'object' AND pg_column_size(strategy_inputs) <= 20000
         -- The result is all there or all unavailable, and the difference is checked.
         AND ((baseline_tax_cents IS NULL) = (modeled_tax_cents IS NULL)
              AND (baseline_tax_cents IS NULL) = (difference_cents IS NULL))
         AND (baseline_tax_cents IS NULL OR
              (baseline_tax_cents >= 0 AND modeled_tax_cents >= 0
               AND difference_cents = baseline_tax_cents - modeled_tax_cents))
         AND ((plan_id IS NULL) = (saved_to_plan_at IS NULL)));

-- ---------- Rules ----------
-- Figures: a historical one is of an earlier year than the plan, a projected one of the plan year
-- or later.
CREATE FUNCTION tax_plan_inputs_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  year integer;
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.plan_id, NEW.key, NEW.kind, NEW.tax_year)
     IS DISTINCT FROM (OLD.plan_id, OLD.key, OLD.kind, OLD.tax_year) THEN
    RAISE EXCEPTION 'tax plans: a figure keeps its plan, key, kind and year'
      USING ERRCODE = 'check_violation';
  END IF;
  SELECT p.plan_year INTO year FROM tax_plans p
   WHERE p.business_id = NEW.business_id AND p.id = NEW.plan_id;
  IF NEW.kind = 'HISTORICAL' AND NEW.tax_year >= year THEN
    RAISE EXCEPTION 'tax plans: a historical figure is of a year before the plan''s'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.kind = 'PROJECTED' AND NEW.tax_year < year THEN
    RAISE EXCEPTION 'tax plans: a projected figure is of the plan year or later'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER tax_plan_inputs_rules BEFORE INSERT OR UPDATE ON tax_plan_inputs
  FOR EACH ROW EXECUTE FUNCTION tax_plan_inputs_rules();

-- Plan documents: the plan client's document, and a strategy of the same plan.
CREATE FUNCTION tax_plan_documents_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.plan_id, NEW.document_id) IS DISTINCT FROM (OLD.plan_id, OLD.document_id) THEN
    RAISE EXCEPTION 'tax plans: a plan document cannot move to another plan or document'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM tax_plans p JOIN documents d
        ON d.business_id = p.business_id AND d.client_id = p.client_id
       WHERE p.business_id = NEW.business_id AND p.id = NEW.plan_id AND d.id = NEW.document_id) THEN
    RAISE EXCEPTION 'tax plans: only one of the plan client''s documents'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.plan_strategy_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM tax_plan_strategies s
       WHERE s.business_id = NEW.business_id AND s.id = NEW.plan_strategy_id
         AND s.plan_id = NEW.plan_id) THEN
    RAISE EXCEPTION 'tax plans: the strategy must be one of this plan''s'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER tax_plan_documents_rules BEFORE INSERT OR UPDATE ON tax_plan_documents
  FOR EACH ROW EXECUTE FUNCTION tax_plan_documents_rules();

-- Scenarios: a plan's scenario is the plan client's; once saved to a plan it never changes.
CREATE FUNCTION tax_savings_scenarios_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.plan_id IS NOT NULL THEN
    RAISE EXCEPTION 'tax scenarios: a scenario saved to a plan is a snapshot and never changes'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.plan_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM tax_plans p
       WHERE p.business_id = NEW.business_id AND p.id = NEW.plan_id
         AND p.client_id IS NOT DISTINCT FROM NEW.client_id) THEN
    RAISE EXCEPTION 'tax scenarios: a scenario saved to a plan is of the plan''s client'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER tax_savings_scenarios_rules BEFORE INSERT OR UPDATE ON tax_savings_scenarios
  FOR EACH ROW EXECUTE FUNCTION tax_savings_scenarios_rules();
