-- CreateEnum
CREATE TYPE "AdvisoryRecommendationStatus" AS ENUM ('PROPOSED', 'ACCEPTED', 'IN_PROGRESS', 'IMPLEMENTED', 'NOT_APPLICABLE', 'DECLINED');

-- CreateEnum
CREATE TYPE "AdvisoryActionStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'DONE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AdvisoryPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH');

-- CreateEnum
CREATE TYPE "AdvisoryAssigneeKind" AS ENUM ('STAFF', 'CLIENT', 'TEAM');

-- CreateTable
CREATE TABLE "advisory_recommendations" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "advisory_client_id" UUID NOT NULL,
    "plan_id" UUID,
    "goal_id" UUID,
    "title" TEXT NOT NULL,
    "category" TEXT,
    "rationale" TEXT,
    "impact_label" TEXT,
    "impact_cents" INTEGER,
    "status" "AdvisoryRecommendationStatus" NOT NULL DEFAULT 'PROPOSED',
    "client_visible" BOOLEAN NOT NULL DEFAULT false,
    "decided_at" TIMESTAMPTZ(3),
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "advisory_recommendations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "advisory_action_items" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "advisory_client_id" UUID NOT NULL,
    "plan_id" UUID,
    "goal_id" UUID,
    "milestone_id" UUID,
    "title" TEXT NOT NULL,
    "details" TEXT,
    "assignee_kind" "AdvisoryAssigneeKind" NOT NULL DEFAULT 'STAFF',
    "assignee_user_id" UUID,
    "due_on" DATE,
    "priority" "AdvisoryPriority" NOT NULL DEFAULT 'NORMAL',
    "status" "AdvisoryActionStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "client_visible" BOOLEAN NOT NULL DEFAULT false,
    "completed_at" TIMESTAMPTZ(3),
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "advisory_action_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "advisory_recommendations_business_id_advisory_client_id_sta_idx" ON "advisory_recommendations"("business_id", "advisory_client_id", "status");

-- CreateIndex
CREATE INDEX "advisory_action_items_business_id_advisory_client_id_status_idx" ON "advisory_action_items"("business_id", "advisory_client_id", "status");

-- CreateIndex
CREATE INDEX "advisory_action_items_business_id_assignee_user_id_status_idx" ON "advisory_action_items"("business_id", "assignee_user_id", "status");

-- CreateIndex
CREATE INDEX "advisory_action_items_business_id_due_on_idx" ON "advisory_action_items"("business_id", "due_on");

-- CreateIndex
CREATE UNIQUE INDEX "advisory_milestones_business_id_id_key" ON "advisory_milestones"("business_id", "id");

-- AddForeignKey
ALTER TABLE "advisory_recommendations" ADD CONSTRAINT "advisory_recommendations_business_id_advisory_client_id_fkey" FOREIGN KEY ("business_id", "advisory_client_id") REFERENCES "advisory_clients"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "advisory_recommendations" ADD CONSTRAINT "advisory_recommendations_business_id_plan_id_fkey" FOREIGN KEY ("business_id", "plan_id") REFERENCES "advisory_plans"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "advisory_recommendations" ADD CONSTRAINT "advisory_recommendations_business_id_goal_id_fkey" FOREIGN KEY ("business_id", "goal_id") REFERENCES "advisory_goals"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "advisory_action_items" ADD CONSTRAINT "advisory_action_items_business_id_advisory_client_id_fkey" FOREIGN KEY ("business_id", "advisory_client_id") REFERENCES "advisory_clients"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "advisory_action_items" ADD CONSTRAINT "advisory_action_items_business_id_plan_id_fkey" FOREIGN KEY ("business_id", "plan_id") REFERENCES "advisory_plans"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "advisory_action_items" ADD CONSTRAINT "advisory_action_items_business_id_goal_id_fkey" FOREIGN KEY ("business_id", "goal_id") REFERENCES "advisory_goals"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "advisory_action_items" ADD CONSTRAINT "advisory_action_items_business_id_milestone_id_fkey" FOREIGN KEY ("business_id", "milestone_id") REFERENCES "advisory_milestones"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Grants: recommendations and action items are never deleted.
GRANT SELECT, INSERT, UPDATE ON advisory_recommendations, advisory_action_items TO firmivra_app;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['advisory_recommendations', 'advisory_action_items'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I ON %I USING (business_id = app_current_business_id())'
                   ' WITH CHECK (business_id = app_current_business_id())', t || '_business', t);
  END LOOP;
END
$$;

-- Shape
ALTER TABLE advisory_recommendations ADD CONSTRAINT advisory_recommendations_values
  CHECK (esign_text_ok(title, 300)
         AND (category IS NULL OR category ~ '^[a-z][a-z0-9_]{0,59}$')
         AND (rationale IS NULL OR esign_text_ok(rationale, 2000))
         AND (impact_label IS NULL OR esign_text_ok(impact_label, 100))
         AND (impact_cents IS NULL OR impact_cents >= 0)
         AND (status = 'PROPOSED') = (decided_at IS NULL));

ALTER TABLE advisory_action_items ADD CONSTRAINT advisory_action_items_values
  CHECK (esign_text_ok(title, 300) AND (details IS NULL OR esign_text_ok(details, 2000))
         -- Only a staff item names a person; a client or team item names none.
         AND (assignee_kind = 'STAFF') = (assignee_user_id IS NOT NULL)
         AND (status = 'DONE') = (completed_at IS NOT NULL));

-- A recommendation's or action item's plan, goal and milestone belong to the same advisory client.
CREATE FUNCTION advisory_links_same_client() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  rec jsonb := to_jsonb(NEW);
  milestone_id uuid := (rec ->> 'milestone_id')::uuid;
BEGIN
  IF NEW.plan_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM advisory_plans p WHERE p.business_id = NEW.business_id AND p.id = NEW.plan_id
          AND p.advisory_client_id = NEW.advisory_client_id) THEN
    RAISE EXCEPTION 'ADVISORY_LINK_PLAN: the plan belongs to another advisory client'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.goal_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM advisory_goals g WHERE g.business_id = NEW.business_id AND g.id = NEW.goal_id
          AND g.advisory_client_id = NEW.advisory_client_id) THEN
    RAISE EXCEPTION 'ADVISORY_LINK_GOAL: the goal belongs to another advisory client'
      USING ERRCODE = 'check_violation';
  END IF;
  IF milestone_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM advisory_milestones m JOIN advisory_goals g
         ON g.business_id = m.business_id AND g.id = m.goal_id
        WHERE m.business_id = NEW.business_id AND m.id = milestone_id
          AND g.advisory_client_id = NEW.advisory_client_id) THEN
    RAISE EXCEPTION 'ADVISORY_LINK_MILESTONE: the milestone belongs to another advisory client'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER advisory_recommendations_links BEFORE INSERT OR UPDATE ON advisory_recommendations
  FOR EACH ROW EXECUTE FUNCTION advisory_links_same_client();
CREATE TRIGGER advisory_action_items_links BEFORE INSERT OR UPDATE ON advisory_action_items
  FOR EACH ROW EXECUTE FUNCTION advisory_links_same_client();
