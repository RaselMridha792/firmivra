-- CreateEnum
CREATE TYPE "AdvisoryGoalStatus" AS ENUM ('NOT_STARTED', 'PLANNING', 'IN_PROGRESS', 'ON_TRACK', 'AT_RISK', 'OVERDUE', 'COMPLETED', 'CANCELLED');

-- CreateTable
CREATE TABLE "advisory_goals" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "advisory_client_id" UUID NOT NULL,
    "plan_id" UUID,
    "workstream_id" UUID,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "area" TEXT,
    "target_date" DATE,
    "status" "AdvisoryGoalStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "progress_percent" INTEGER NOT NULL DEFAULT 0,
    "owner_user_id" UUID,
    "completed_at" TIMESTAMPTZ(3),
    "archived_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "advisory_goals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "advisory_milestones" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "goal_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "target_date" DATE,
    "status" "AdvisoryGoalStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "progress_percent" INTEGER NOT NULL DEFAULT 0,
    "owner_user_id" UUID,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "completed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "advisory_milestones_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "advisory_goals_business_id_advisory_client_id_status_idx" ON "advisory_goals"("business_id", "advisory_client_id", "status");

-- CreateIndex
CREATE INDEX "advisory_goals_business_id_target_date_idx" ON "advisory_goals"("business_id", "target_date");

-- CreateIndex
CREATE UNIQUE INDEX "advisory_goals_business_id_id_key" ON "advisory_goals"("business_id", "id");

-- CreateIndex
CREATE INDEX "advisory_milestones_business_id_goal_id_sort_order_idx" ON "advisory_milestones"("business_id", "goal_id", "sort_order");

-- AddForeignKey
ALTER TABLE "advisory_goals" ADD CONSTRAINT "advisory_goals_business_id_advisory_client_id_fkey" FOREIGN KEY ("business_id", "advisory_client_id") REFERENCES "advisory_clients"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "advisory_goals" ADD CONSTRAINT "advisory_goals_business_id_plan_id_fkey" FOREIGN KEY ("business_id", "plan_id") REFERENCES "advisory_plans"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "advisory_goals" ADD CONSTRAINT "advisory_goals_business_id_workstream_id_fkey" FOREIGN KEY ("business_id", "workstream_id") REFERENCES "advisory_workstreams"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "advisory_milestones" ADD CONSTRAINT "advisory_milestones_business_id_goal_id_fkey" FOREIGN KEY ("business_id", "goal_id") REFERENCES "advisory_goals"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Grants: goals are archived and milestones ended, never deleted.
GRANT SELECT, INSERT, UPDATE ON advisory_goals, advisory_milestones TO firmivra_app;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['advisory_goals', 'advisory_milestones'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I ON %I USING (business_id = app_current_business_id())'
                   ' WITH CHECK (business_id = app_current_business_id())', t || '_business', t);
  END LOOP;
END
$$;

-- Shape
ALTER TABLE advisory_goals ADD CONSTRAINT advisory_goals_values
  CHECK (esign_text_ok(title, 300) AND (description IS NULL OR esign_text_ok(description, 2000))
         AND (area IS NULL OR area ~ '^[a-z][a-z0-9_]{0,59}$')
         AND progress_percent BETWEEN 0 AND 100
         AND (status <> 'NOT_STARTED' OR progress_percent = 0)
         AND (status <> 'COMPLETED' OR progress_percent = 100)
         AND (status = 'COMPLETED') = (completed_at IS NOT NULL));

ALTER TABLE advisory_milestones ADD CONSTRAINT advisory_milestones_values
  CHECK (esign_text_ok(title, 300) AND progress_percent BETWEEN 0 AND 100
         AND (status <> 'NOT_STARTED' OR progress_percent = 0)
         AND (status <> 'COMPLETED' OR progress_percent = 100)
         AND (status = 'COMPLETED') = (completed_at IS NOT NULL));

-- A goal's plan and workstream belong to the same advisory client.
CREATE FUNCTION advisory_goals_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF NEW.plan_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM advisory_plans p WHERE p.business_id = NEW.business_id AND p.id = NEW.plan_id
          AND p.advisory_client_id = NEW.advisory_client_id) THEN
    RAISE EXCEPTION 'ADVISORY_GOAL_PLAN: the plan belongs to another advisory client'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.workstream_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM advisory_workstreams w WHERE w.business_id = NEW.business_id AND w.id = NEW.workstream_id
          AND w.advisory_client_id = NEW.advisory_client_id) THEN
    RAISE EXCEPTION 'ADVISORY_GOAL_WORKSTREAM: the service belongs to another advisory client'
      USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.advisory_client_id IS DISTINCT FROM OLD.advisory_client_id THEN
    RAISE EXCEPTION 'ADVISORY_GOAL_CLIENT: a goal keeps its advisory client'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER advisory_goals_rules BEFORE INSERT OR UPDATE ON advisory_goals
  FOR EACH ROW EXECUTE FUNCTION advisory_goals_rules();
