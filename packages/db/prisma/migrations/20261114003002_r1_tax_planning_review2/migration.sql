-- R1 (Rasel's approval in R1's window, Nov 14; Tax Planning Review 2, S1 and S3 to S6; FINALIZED
-- is r1_tax_plan_finalized, S2's value).
-- S1 (C27): tax_plan_events, a plan's history (status changes, reopen and revise with a reason,
--   finalize, send, archive, restore), insert-only.
-- S2 (C27): a CLOSED plan changes only by reopening (its status) or by archiving.
-- S3 (C12): appointments.tax_plan_id, a discussion's plan; S4 (C15): tasks.tax_plan_id, an
--   implementation task's plan. Each the same client's plan (a three-column foreign key).
-- S5 (C11): a CLOSED opportunity reopens to UNDER_REVIEW (its events keep the earlier reasons).
-- S6 (C17): tax_planning_resources, the firm's own or edited planning resources.
-- No backfill. Safe on dev: two nullable columns, two new empty tables, one unique index on
-- tax_plans (its id is already unique), and two trigger functions replaced in place.

-- CreateEnum
CREATE TYPE "TaxPlanEventKind" AS ENUM ('STATUS', 'REOPEN', 'REVISE', 'FINALIZE', 'SEND', 'ARCHIVE', 'RESTORE');

-- CreateEnum
CREATE TYPE "PlanningResourceKind" AS ENUM ('PDF', 'CHECKLIST', 'GUIDE', 'VIDEO', 'ARTICLE');

-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "tax_plan_id" UUID;

-- AlterTable
ALTER TABLE "appointments" ADD COLUMN     "tax_plan_id" UUID;

-- CreateTable
CREATE TABLE "tax_plan_events" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    "kind" "TaxPlanEventKind" NOT NULL,
    "from_status" "TaxPlanStatus",
    "to_status" "TaxPlanStatus",
    "version" INTEGER,
    "reason" TEXT,
    "actor_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tax_plan_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_planning_resources" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "catalog_key" TEXT,
    "title" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "kind" "PlanningResourceKind" NOT NULL,
    "summary" TEXT,
    "body" TEXT,
    "client_facing" BOOLEAN NOT NULL DEFAULT false,
    "archived_at" TIMESTAMPTZ(3),
    "created_by_user_id" UUID,
    "updated_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "tax_planning_resources_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tax_plan_events_business_id_plan_id_created_at_idx" ON "tax_plan_events"("business_id", "plan_id", "created_at");

-- CreateIndex
CREATE INDEX "tax_planning_resources_business_id_archived_at_idx" ON "tax_planning_resources"("business_id", "archived_at");

-- CreateIndex
CREATE UNIQUE INDEX "tax_planning_resources_business_id_id_key" ON "tax_planning_resources"("business_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "tax_planning_resources_business_id_catalog_key_key" ON "tax_planning_resources"("business_id", "catalog_key");

-- CreateIndex
CREATE INDEX "tasks_business_id_tax_plan_id_idx" ON "tasks"("business_id", "tax_plan_id");

-- CreateIndex
CREATE INDEX "appointments_business_id_tax_plan_id_idx" ON "appointments"("business_id", "tax_plan_id");

-- CreateIndex
CREATE UNIQUE INDEX "tax_plans_business_id_client_id_id_key" ON "tax_plans"("business_id", "client_id", "id");

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_business_id_client_id_tax_plan_id_fkey" FOREIGN KEY ("business_id", "client_id", "tax_plan_id") REFERENCES "tax_plans"("business_id", "client_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_business_id_client_id_tax_plan_id_fkey" FOREIGN KEY ("business_id", "client_id", "tax_plan_id") REFERENCES "tax_plans"("business_id", "client_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_plan_events" ADD CONSTRAINT "tax_plan_events_business_id_plan_id_fkey" FOREIGN KEY ("business_id", "plan_id") REFERENCES "tax_plans"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------- Grants, RLS ----------
-- Events are insert-only; resources are archived, never deleted.
GRANT SELECT, INSERT ON tax_plan_events TO firmivra_app;
GRANT SELECT, INSERT, UPDATE ON tax_planning_resources TO firmivra_app;
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['tax_plan_events', 'tax_planning_resources'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I ON %I USING (business_id = app_current_business_id())'
                   ' WITH CHECK (business_id = app_current_business_id())', t || '_business', t);
  END LOOP;
END
$$;

-- ---------- Data rules Prisma cannot express ----------
-- S1: a reopen or revise always says why; a status change names the status it went to.
ALTER TABLE tax_plan_events ADD CONSTRAINT tax_plan_events_shape
  CHECK ((reason IS NULL OR char_length(btrim(reason)) BETWEEN 1 AND 1000)
     AND (kind NOT IN ('REOPEN', 'REVISE') OR reason IS NOT NULL)
     AND (kind <> 'STATUS' OR to_status IS NOT NULL)
     AND (version IS NULL OR version >= 1));

-- S3, S4: a draft task has no client yet, so the same-client foreign key would not check it: a
-- task that names a plan has a client.
ALTER TABLE tasks ADD CONSTRAINT tasks_tax_plan_has_client
  CHECK (tax_plan_id IS NULL OR client_id IS NOT NULL);

-- S6: a built-in resource is edited by its catalog key; text within its limits.
ALTER TABLE tax_planning_resources ADD CONSTRAINT tax_planning_resources_shape
  CHECK ((catalog_key IS NULL OR catalog_key ~ '^[a-z][a-z0-9-]{1,79}$')
     AND char_length(btrim(title)) BETWEEN 1 AND 200
     AND char_length(btrim(category)) BETWEEN 1 AND 100
     AND (summary IS NULL OR char_length(summary) <= 1000)
     AND (body IS NULL OR char_length(body) <= 20000));

-- S2: as before (a plan keeps its client; its engagement is a Tax Planning one), and a CLOSED plan
-- changes only its status (reopening) or archived_at; anything else is refused until it reopens.
CREATE OR REPLACE FUNCTION tax_plans_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.client_id <> OLD.client_id THEN
    RAISE EXCEPTION 'tax plans: a plan cannot change client' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'CLOSED'
     AND (to_jsonb(NEW) - ARRAY['status', 'archived_at', 'updated_at'])
       IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['status', 'archived_at', 'updated_at']) THEN
    RAISE EXCEPTION 'tax plans: a closed plan changes only by reopening'
      USING ERRCODE = 'check_violation';
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

-- S5: as before, but a CLOSED opportunity reopens to UNDER_REVIEW (only there); an implemented one
-- still only closes.
CREATE OR REPLACE FUNCTION tax_opportunities_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF (NEW.client_id, NEW.strategy_id, NEW.tax_year, NEW.source)
       IS DISTINCT FROM (OLD.client_id, OLD.strategy_id, OLD.tax_year, OLD.source) THEN
      RAISE EXCEPTION 'tax opportunities: an opportunity keeps its client, strategy, year and source'
        USING ERRCODE = 'check_violation';
    END IF;
    IF OLD.status = 'CLOSED' AND NEW.status NOT IN ('CLOSED', 'UNDER_REVIEW') THEN
      RAISE EXCEPTION 'tax opportunities: a closed opportunity reopens only to Under Review'
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
