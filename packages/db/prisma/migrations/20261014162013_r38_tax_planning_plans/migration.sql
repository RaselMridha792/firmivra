-- R38 (Rasel, Oct 14), Tax Planning, part 1 (docs/mockups/firm-workspace/tax-planning/source):
-- the strategy library, planning plans (Create / Edit Planning Plan) and the strategies in a
-- plan. A plan keeps its strategies' name, priority, estimate (with the year of the data it used),
-- an authorized override with its reason and the assumptions on the row, so changing the library
-- never rewrites a plan. Estimates are estimates: an unavailable one is null, never invented.

-- CreateEnum
CREATE TYPE "TaxPlanType" AS ENUM ('COMPREHENSIVE', 'FOCUSED');

-- CreateEnum
CREATE TYPE "TaxPlanStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'IN_PROGRESS', 'AWAITING_CLIENT', 'READY_FOR_REVIEW', 'IMPLEMENTED', 'CLOSED');

-- CreateEnum
CREATE TYPE "PlanningGoal" AS ENUM ('REDUCE_TAXABLE_INCOME', 'INCREASE_RETIREMENT_SAVINGS', 'PURCHASE_HOME', 'START_BUSINESS', 'BUY_EQUIPMENT_VEHICLE', 'MINIMIZE_SELF_EMPLOYMENT_TAX', 'PLAN_EDUCATION_EXPENSES', 'BUILD_LONG_TERM_WEALTH', 'PREPARE_LIFE_CHANGES', 'OTHER');

-- CreateEnum
CREATE TYPE "TaxFilingStatus" AS ENUM ('SINGLE', 'MARRIED_FILING_JOINTLY', 'MARRIED_FILING_SEPARATELY', 'HEAD_OF_HOUSEHOLD', 'QUALIFYING_SURVIVING_SPOUSE');

-- CreateEnum
CREATE TYPE "StrategyCategory" AS ENUM ('RETIREMENT', 'DEDUCTIONS', 'BUSINESS', 'CREDITS', 'ENTITY', 'TIMING', 'INVESTMENT', 'ESTATE_OTHER');

-- CreateEnum
CREATE TYPE "PlanStrategyStatus" AS ENUM ('PROPOSED', 'ACCEPTED', 'IN_PROGRESS', 'IMPLEMENTED', 'DECLINED');

-- CreateTable
CREATE TABLE "tax_planning_strategies" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "category" "StrategyCategory" NOT NULL,
    "description" TEXT,
    "default_priority" "TaskPriority" NOT NULL DEFAULT 'MEDIUM',
    "eligibility" JSONB NOT NULL DEFAULT '{}',
    "required_inputs" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "required_documents" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "implementation_checklist" JSONB NOT NULL DEFAULT '[]',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "archived_at" TIMESTAMPTZ(3),
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "tax_planning_strategies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_plans" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "engagement_id" UUID,
    "name" TEXT NOT NULL,
    "plan_year" INTEGER NOT NULL,
    "filing_status" "TaxFilingStatus",
    "entity_type" TEXT,
    "plan_type" "TaxPlanType" NOT NULL DEFAULT 'COMPREHENSIVE',
    "status" "TaxPlanStatus" NOT NULL DEFAULT 'DRAFT',
    "goals" "PlanningGoal"[] DEFAULT ARRAY[]::"PlanningGoal"[],
    "other_goal" TEXT,
    "notes" TEXT,
    "client_notes" TEXT,
    "assigned_user_id" UUID,
    "target_completion_on" DATE,
    "next_discussion_on" DATE,
    "created_by_user_id" UUID,
    "archived_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "tax_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_plan_strategies" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    "strategy_id" UUID,
    "custom_name" TEXT,
    "custom_category" "StrategyCategory",
    "display_name" TEXT NOT NULL,
    "selected" BOOLEAN NOT NULL DEFAULT true,
    "priority" "TaskPriority" NOT NULL DEFAULT 'MEDIUM',
    "status" "PlanStrategyStatus" NOT NULL DEFAULT 'PROPOSED',
    "estimated_savings_cents" INTEGER,
    "estimate_data_year" INTEGER,
    "estimate_calculated_at" TIMESTAMPTZ(3),
    "override_savings_cents" INTEGER,
    "override_reason" TEXT,
    "override_by_user_id" UUID,
    "assumptions" TEXT,
    "implemented_on" DATE,
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "tax_plan_strategies_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tax_planning_strategies_business_id_category_active_idx" ON "tax_planning_strategies"("business_id", "category", "active");

-- CreateIndex
CREATE UNIQUE INDEX "tax_planning_strategies_business_id_id_key" ON "tax_planning_strategies"("business_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "tax_planning_strategies_business_id_name_key" ON "tax_planning_strategies"("business_id", "name");

-- CreateIndex
CREATE INDEX "tax_plans_business_id_status_idx" ON "tax_plans"("business_id", "status");

-- CreateIndex
CREATE INDEX "tax_plans_business_id_client_id_plan_year_idx" ON "tax_plans"("business_id", "client_id", "plan_year");

-- CreateIndex
CREATE INDEX "tax_plans_business_id_assigned_user_id_status_idx" ON "tax_plans"("business_id", "assigned_user_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "tax_plans_business_id_id_key" ON "tax_plans"("business_id", "id");

-- CreateIndex
CREATE INDEX "tax_plan_strategies_business_id_plan_id_position_idx" ON "tax_plan_strategies"("business_id", "plan_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "tax_plan_strategies_business_id_id_key" ON "tax_plan_strategies"("business_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "tax_plan_strategies_business_id_plan_id_strategy_id_key" ON "tax_plan_strategies"("business_id", "plan_id", "strategy_id");

-- AddForeignKey
ALTER TABLE "tax_plans" ADD CONSTRAINT "tax_plans_business_id_client_id_fkey" FOREIGN KEY ("business_id", "client_id") REFERENCES "clients"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_plans" ADD CONSTRAINT "tax_plans_business_id_client_id_engagement_id_fkey" FOREIGN KEY ("business_id", "client_id", "engagement_id") REFERENCES "engagements"("business_id", "client_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_plans" ADD CONSTRAINT "tax_plans_business_id_assigned_user_id_fkey" FOREIGN KEY ("business_id", "assigned_user_id") REFERENCES "memberships"("business_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_plan_strategies" ADD CONSTRAINT "tax_plan_strategies_business_id_plan_id_fkey" FOREIGN KEY ("business_id", "plan_id") REFERENCES "tax_plans"("business_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_plan_strategies" ADD CONSTRAINT "tax_plan_strategies_business_id_strategy_id_fkey" FOREIGN KEY ("business_id", "strategy_id") REFERENCES "tax_planning_strategies"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------- Grants, RLS, policy ----------
-- Strategies and plans are made inactive or archived, never deleted; a strategy can be taken
-- out of a plan.
GRANT SELECT, INSERT, UPDATE ON tax_planning_strategies, tax_plans TO firmivra_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON tax_plan_strategies TO firmivra_app;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['tax_planning_strategies', 'tax_plans', 'tax_plan_strategies'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I ON %I USING (business_id = app_current_business_id())'
                   ' WITH CHECK (business_id = app_current_business_id())', t || '_business', t);
  END LOOP;
END
$$;

-- ---------- Shape ----------
-- True when no value appears twice (nulls count as values).
CREATE FUNCTION r38_all_distinct(items anyarray) RETURNS boolean
  LANGUAGE sql IMMUTABLE
  AS $$ SELECT cardinality(items) = (SELECT count(DISTINCT x) FROM unnest(items) AS x) $$;

ALTER TABLE tax_planning_strategies ADD CONSTRAINT tax_planning_strategies_shape
  CHECK (btrim(name) <> '' AND char_length(name) <= 120 AND char_length(description) <= 2000
         AND jsonb_typeof(eligibility) = 'object' AND pg_column_size(eligibility) <= 10000
         AND jsonb_typeof(implementation_checklist) = 'array'
         AND jsonb_array_length(implementation_checklist) <= 30
         AND cardinality(required_inputs) <= 30 AND cardinality(required_documents) <= 30
         AND array_position(required_inputs, NULL) IS NULL
         AND array_position(required_documents, NULL) IS NULL
         AND (archived_at IS NULL OR NOT active));

ALTER TABLE tax_plans ADD CONSTRAINT tax_plans_shape
  CHECK (btrim(name) <> '' AND char_length(name) <= 200
         AND plan_year BETWEEN 2000 AND 2100
         AND char_length(notes) <= 5000 AND char_length(client_notes) <= 2000
         AND cardinality(goals) <= 10 AND r38_all_distinct(goals)
         -- The client's own goal goes with the OTHER goal, and only then.
         AND ((other_goal IS NULL) OR ('OTHER' = ANY (goals) AND btrim(other_goal) <> ''
                                       AND char_length(other_goal) <= 200)));

ALTER TABLE tax_plan_strategies ADD CONSTRAINT tax_plan_strategies_shape
  CHECK (btrim(display_name) <> '' AND char_length(display_name) <= 200
         -- A library strategy, or a custom one with its name and category.
         AND (strategy_id IS NULL) = (custom_name IS NOT NULL)
         AND (strategy_id IS NULL) = (custom_category IS NOT NULL)
         AND (custom_name IS NULL OR btrim(custom_name) <> '')
         AND (estimated_savings_cents IS NULL OR estimated_savings_cents >= 0)
         AND (estimate_data_year IS NULL OR
              (estimated_savings_cents IS NOT NULL AND estimate_data_year BETWEEN 2000 AND 2100))
         -- An override has its amount, its reason and who made it.
         AND ((override_savings_cents IS NULL) = (override_by_user_id IS NULL))
         AND ((override_savings_cents IS NULL) = (btrim(coalesce(override_reason, '')) = ''))
         AND (override_savings_cents IS NULL OR override_savings_cents >= 0)
         AND char_length(override_reason) <= 500 AND char_length(assumptions) <= 2000
         AND ((status = 'IMPLEMENTED') = (implemented_on IS NOT NULL))
         AND position >= 0);
-- One library strategy per plan (the table's unique ignores nulls), and one custom name.
CREATE UNIQUE INDEX tax_plan_strategies_one_custom_name
  ON tax_plan_strategies (business_id, plan_id, lower(custom_name)) WHERE custom_name IS NOT NULL;

-- ---------- Rules ----------
CREATE FUNCTION tax_plans_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.client_id <> OLD.client_id THEN
    RAISE EXCEPTION 'tax plans: a plan cannot change client' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.engagement_id IS NOT NULL AND (TG_OP = 'INSERT'
       OR NEW.engagement_id IS DISTINCT FROM OLD.engagement_id)
     AND NOT EXISTS (SELECT 1 FROM engagements e JOIN services s
          ON s.business_id = e.business_id AND s.id = e.service_id
         WHERE e.business_id = NEW.business_id AND e.id = NEW.engagement_id
           AND s.kind = 'TAX_PLANNING') THEN
    RAISE EXCEPTION 'tax plans: the engagement must be a Tax Planning engagement'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER tax_plans_rules BEFORE INSERT OR UPDATE ON tax_plans
  FOR EACH ROW EXECUTE FUNCTION tax_plans_rules();

-- A library strategy is added to a plan only while it is active; it never moves to another plan.
CREATE FUNCTION tax_plan_strategies_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.plan_id, NEW.strategy_id) IS DISTINCT FROM (OLD.plan_id, OLD.strategy_id) THEN
    RAISE EXCEPTION 'tax plans: a plan strategy keeps its plan and library strategy'
      USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'INSERT' AND NEW.strategy_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM tax_planning_strategies s
        WHERE s.business_id = NEW.business_id AND s.id = NEW.strategy_id
          AND s.active AND s.archived_at IS NULL) THEN
    RAISE EXCEPTION 'tax plans: only an active strategy can be added to a plan'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER tax_plan_strategies_rules BEFORE INSERT OR UPDATE ON tax_plan_strategies
  FOR EACH ROW EXECUTE FUNCTION tax_plan_strategies_rules();
