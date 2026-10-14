-- R38 (Rasel, Oct 14), Tax Planning, part 3: planning opportunities and their history
-- (docs/mockups/firm-workspace/tax-planning/source: Top Planning Opportunities and Planning
-- Opportunity Details, and the guide's sections 11 to 13). An opportunity says why it exists and
-- which data it used, with the tax year and as-of date; it is not a recommendation until staff
-- review it; not applicable and dismissed need a reason; a client has one open opportunity per
-- library strategy and year. Every change is an insert-only event.

-- CreateEnum
CREATE TYPE "OpportunityStatus" AS ENUM ('NEW', 'UNDER_REVIEW', 'ADDED_TO_PLAN', 'ASSIGNED', 'DISCUSSION_SCHEDULED', 'NEEDS_DOCUMENTS', 'NOT_APPLICABLE', 'DISMISSED', 'IMPLEMENTED', 'CLOSED');

-- CreateEnum
CREATE TYPE "OpportunitySource" AS ENUM ('SYSTEM', 'STAFF', 'IMPORTED', 'MANUAL');

-- CreateEnum
CREATE TYPE "OpportunityEventKind" AS ENUM ('SCREENED', 'STATUS', 'ASSIGNED', 'DISCUSSION', 'DOCUMENTS', 'PLAN', 'NOTE');

-- CreateTable
CREATE TABLE "tax_opportunities" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "strategy_id" UUID,
    "name" TEXT NOT NULL,
    "category" "StrategyCategory" NOT NULL,
    "priority" "TaskPriority" NOT NULL DEFAULT 'MEDIUM',
    "description" TEXT,
    "tax_year" INTEGER NOT NULL,
    "status" "OpportunityStatus" NOT NULL DEFAULT 'NEW',
    "source" "OpportunitySource" NOT NULL,
    "rule_id" TEXT,
    "why_explanation" TEXT,
    "data_complete" BOOLEAN NOT NULL DEFAULT true,
    "missing_data" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "last_evaluated_at" TIMESTAMPTZ(3),
    "client_data_used" JSONB NOT NULL DEFAULT '[]',
    "estimated_savings_cents" INTEGER,
    "estimate_basis" TEXT,
    "suggested_action_cents" INTEGER,
    "new_taxable_income_cents" INTEGER,
    "effective_rate_before_bp" INTEGER,
    "effective_rate_after_bp" INTEGER,
    "recommended_actions" JSONB NOT NULL DEFAULT '[]',
    "eligibility" JSONB NOT NULL DEFAULT '[]',
    "documents_needed" JSONB NOT NULL DEFAULT '[]',
    "assigned_user_id" UUID,
    "plan_id" UUID,
    "plan_strategy_id" UUID,
    "discussion_on" DATE,
    "reviewed_at" TIMESTAMPTZ(3),
    "reviewed_by_user_id" UUID,
    "disposition_reason" TEXT,
    "suppressed_until" DATE,
    "implemented_on" DATE,
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "tax_opportunities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_opportunity_events" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "opportunity_id" UUID NOT NULL,
    "kind" "OpportunityEventKind" NOT NULL,
    "from_status" "OpportunityStatus",
    "to_status" "OpportunityStatus",
    "reason" TEXT,
    "details" JSONB NOT NULL DEFAULT '{}',
    "actor_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tax_opportunity_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tax_opportunities_business_id_status_priority_idx" ON "tax_opportunities"("business_id", "status", "priority");

-- CreateIndex
CREATE INDEX "tax_opportunities_business_id_client_id_tax_year_idx" ON "tax_opportunities"("business_id", "client_id", "tax_year");

-- CreateIndex
CREATE INDEX "tax_opportunities_business_id_strategy_id_status_idx" ON "tax_opportunities"("business_id", "strategy_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "tax_opportunities_business_id_id_key" ON "tax_opportunities"("business_id", "id");

-- CreateIndex
CREATE INDEX "tax_opportunity_events_business_id_opportunity_id_created_a_idx" ON "tax_opportunity_events"("business_id", "opportunity_id", "created_at");

-- AddForeignKey
ALTER TABLE "tax_opportunities" ADD CONSTRAINT "tax_opportunities_business_id_client_id_fkey" FOREIGN KEY ("business_id", "client_id") REFERENCES "clients"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_opportunities" ADD CONSTRAINT "tax_opportunities_business_id_strategy_id_fkey" FOREIGN KEY ("business_id", "strategy_id") REFERENCES "tax_planning_strategies"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_opportunities" ADD CONSTRAINT "tax_opportunities_business_id_assigned_user_id_fkey" FOREIGN KEY ("business_id", "assigned_user_id") REFERENCES "memberships"("business_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_opportunities" ADD CONSTRAINT "tax_opportunities_business_id_plan_id_fkey" FOREIGN KEY ("business_id", "plan_id") REFERENCES "tax_plans"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_opportunities" ADD CONSTRAINT "tax_opportunities_business_id_plan_strategy_id_fkey" FOREIGN KEY ("business_id", "plan_strategy_id") REFERENCES "tax_plan_strategies"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_opportunity_events" ADD CONSTRAINT "tax_opportunity_events_business_id_opportunity_id_fkey" FOREIGN KEY ("business_id", "opportunity_id") REFERENCES "tax_opportunities"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------- Grants, RLS, policy ----------
-- Opportunities are closed, never deleted; the history is insert-only.
GRANT SELECT, INSERT, UPDATE ON tax_opportunities TO firmivra_app;
GRANT SELECT, INSERT ON tax_opportunity_events TO firmivra_app;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['tax_opportunities', 'tax_opportunity_events'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I ON %I USING (business_id = app_current_business_id())'
                   ' WITH CHECK (business_id = app_current_business_id())', t || '_business', t);
  END LOOP;
END
$$;

-- ---------- Shape ----------
ALTER TABLE tax_opportunities ADD CONSTRAINT tax_opportunities_shape
  CHECK (btrim(name) <> '' AND char_length(name) <= 200 AND char_length(description) <= 2000
         AND tax_year BETWEEN 2000 AND 2100
         AND char_length(rule_id) <= 80 AND char_length(why_explanation) <= 1000
         AND char_length(estimate_basis) <= 500
         AND cardinality(missing_data) <= 20 AND array_position(missing_data, NULL) IS NULL
         -- Thin data is flagged and says what is missing; complete data has nothing missing.
         AND (data_complete = (cardinality(missing_data) = 0))
         AND jsonb_typeof(client_data_used) = 'array' AND jsonb_array_length(client_data_used) <= 30
         AND jsonb_typeof(recommended_actions) = 'array' AND jsonb_array_length(recommended_actions) <= 20
         AND jsonb_typeof(eligibility) = 'array' AND jsonb_array_length(eligibility) <= 20
         AND jsonb_typeof(documents_needed) = 'array' AND jsonb_array_length(documents_needed) <= 30
         AND (estimated_savings_cents IS NULL OR estimated_savings_cents >= 0)
         AND (suggested_action_cents IS NULL OR suggested_action_cents >= 0)
         AND (new_taxable_income_cents IS NULL OR new_taxable_income_cents >= 0)
         AND (effective_rate_before_bp IS NULL OR effective_rate_before_bp BETWEEN 0 AND 10000)
         AND (effective_rate_after_bp IS NULL OR effective_rate_after_bp BETWEEN 0 AND 10000)
         AND char_length(disposition_reason) <= 500
         -- A reason for not applicable and dismissed, and only then (a reopen clears it).
         AND ((status IN ('NOT_APPLICABLE', 'DISMISSED')) = (btrim(coalesce(disposition_reason, '')) <> ''))
         AND (suppressed_until IS NULL OR status IN ('NOT_APPLICABLE', 'DISMISSED'))
         -- Only a reviewed opportunity goes into a plan, is implemented or closed.
         AND (status NOT IN ('ADDED_TO_PLAN', 'IMPLEMENTED', 'CLOSED') OR reviewed_at IS NOT NULL)
         AND (status <> 'ADDED_TO_PLAN' OR plan_id IS NOT NULL)
         AND (plan_strategy_id IS NULL OR plan_id IS NOT NULL)
         AND ((status = 'IMPLEMENTED') = (implemented_on IS NOT NULL) OR status = 'CLOSED'));
-- A client has one open opportunity per library strategy and year.
CREATE UNIQUE INDEX tax_opportunities_one_open
  ON tax_opportunities (business_id, client_id, strategy_id, tax_year)
  WHERE strategy_id IS NOT NULL AND status NOT IN ('NOT_APPLICABLE', 'DISMISSED', 'CLOSED');

ALTER TABLE tax_opportunity_events ADD CONSTRAINT tax_opportunity_events_shape
  CHECK (char_length(reason) <= 500 AND jsonb_typeof(details) = 'object'
         AND pg_column_size(details) <= 4000
         AND ((kind = 'STATUS') = (to_status IS NOT NULL)));

-- ---------- Rules ----------
CREATE FUNCTION tax_opportunities_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF (NEW.client_id, NEW.strategy_id, NEW.tax_year, NEW.source)
       IS DISTINCT FROM (OLD.client_id, OLD.strategy_id, OLD.tax_year, OLD.source) THEN
      RAISE EXCEPTION 'tax opportunities: an opportunity keeps its client, strategy, year and source'
        USING ERRCODE = 'check_violation';
    END IF;
    -- A closed opportunity is final; an implemented one can only be closed.
    IF OLD.status = 'CLOSED' AND NEW.status <> 'CLOSED' THEN
      RAISE EXCEPTION 'tax opportunities: a closed opportunity cannot be reopened'
        USING ERRCODE = 'check_violation';
    END IF;
    IF OLD.status = 'IMPLEMENTED' AND NEW.status NOT IN ('IMPLEMENTED', 'CLOSED') THEN
      RAISE EXCEPTION 'tax opportunities: an implemented opportunity can only be closed'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF NEW.plan_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM tax_plans p
       WHERE p.business_id = NEW.business_id AND p.id = NEW.plan_id
         AND p.client_id = NEW.client_id) THEN
    RAISE EXCEPTION 'tax opportunities: the plan must be the client''s'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.plan_strategy_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM tax_plan_strategies s
       WHERE s.business_id = NEW.business_id AND s.id = NEW.plan_strategy_id
         AND s.plan_id = NEW.plan_id) THEN
    RAISE EXCEPTION 'tax opportunities: the strategy must be one of the plan''s'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER tax_opportunities_rules BEFORE INSERT OR UPDATE ON tax_opportunities
  FOR EACH ROW EXECUTE FUNCTION tax_opportunities_rules();
