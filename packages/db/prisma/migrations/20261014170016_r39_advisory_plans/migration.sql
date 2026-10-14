-- CreateEnum
CREATE TYPE "AdvisoryPlanStatus" AS ENUM ('DRAFT', 'IN_REVIEW', 'FINALIZED', 'SENT', 'IN_PROGRESS', 'COMPLETED', 'ARCHIVED');

-- CreateTable
CREATE TABLE "advisory_plans" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "advisory_client_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "target_year" INTEGER NOT NULL,
    "plan_type" TEXT,
    "status" "AdvisoryPlanStatus" NOT NULL DEFAULT 'DRAFT',
    "step" INTEGER NOT NULL DEFAULT 1,
    "current_version" INTEGER NOT NULL DEFAULT 0,
    "profile" JSONB NOT NULL DEFAULT '{}',
    "assessment" JSONB NOT NULL DEFAULT '{}',
    "strategy" JSONB NOT NULL DEFAULT '{}',
    "finalized_at" TIMESTAMPTZ(3),
    "sent_at" TIMESTAMPTZ(3),
    "sent_by_user_id" UUID,
    "created_by_user_id" UUID NOT NULL,
    "updated_by_user_id" UUID,
    "archived_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "advisory_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "advisory_plan_versions" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    "version_no" INTEGER NOT NULL,
    "content" JSONB NOT NULL,
    "source_data_as_of" DATE,
    "created_by_user_id" UUID NOT NULL,
    "delivered_at" TIMESTAMPTZ(3),
    "delivered_channel" TEXT,
    "delivered_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "advisory_plan_versions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "advisory_plans_business_id_advisory_client_id_target_year_idx" ON "advisory_plans"("business_id", "advisory_client_id", "target_year");

-- CreateIndex
CREATE INDEX "advisory_plans_business_id_status_idx" ON "advisory_plans"("business_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "advisory_plans_business_id_id_key" ON "advisory_plans"("business_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "advisory_plan_versions_plan_id_version_no_key" ON "advisory_plan_versions"("plan_id", "version_no");

-- AddForeignKey
ALTER TABLE "advisory_plans" ADD CONSTRAINT "advisory_plans_business_id_advisory_client_id_fkey" FOREIGN KEY ("business_id", "advisory_client_id") REFERENCES "advisory_clients"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "advisory_plan_versions" ADD CONSTRAINT "advisory_plan_versions_business_id_plan_id_fkey" FOREIGN KEY ("business_id", "plan_id") REFERENCES "advisory_plans"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Grants: plans are archived; versions are insert-only (their delivery is set once).
GRANT SELECT, INSERT, UPDATE ON advisory_plans, advisory_plan_versions TO firmivra_app;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['advisory_plans', 'advisory_plan_versions'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I ON %I USING (business_id = app_current_business_id())'
                   ' WITH CHECK (business_id = app_current_business_id())', t || '_business', t);
  END LOOP;
END
$$;

-- Shape
ALTER TABLE advisory_plans ADD CONSTRAINT advisory_plans_values
  CHECK (esign_text_ok(name, 200) AND target_year BETWEEN 2000 AND 2100
         AND (plan_type IS NULL OR esign_text_ok(plan_type, 60))
         AND step BETWEEN 1 AND 5 AND current_version >= 0
         AND jsonb_typeof(profile) = 'object' AND jsonb_typeof(assessment) = 'object'
         AND jsonb_typeof(strategy) = 'object'
         AND pg_column_size(profile) <= 50000 AND pg_column_size(assessment) <= 50000
         AND pg_column_size(strategy) <= 50000
         -- The EIN lives on the client's profile, masked; no plan document may carry one.
         AND profile::text !~ '"(ein|EIN|ssn|SSN|tax_?[iI]d)([_A-Z][A-Za-z0-9_]*)?"\s*:'
         AND (status NOT IN ('FINALIZED', 'SENT', 'IN_PROGRESS', 'COMPLETED') OR finalized_at IS NOT NULL)
         AND (status <> 'SENT' OR sent_at IS NOT NULL)
         AND (status = 'ARCHIVED') = (archived_at IS NOT NULL));

ALTER TABLE advisory_plan_versions ADD CONSTRAINT advisory_plan_versions_values
  CHECK (version_no >= 1 AND jsonb_typeof(content) = 'object' AND pg_column_size(content) <= 500000
         AND (delivered_channel IS NULL OR delivered_channel IN ('portal', 'email', 'download'))
         AND (delivered_at IS NULL) = (delivered_channel IS NULL)
         AND (delivered_at IS NULL) = (delivered_by_user_id IS NULL));

-- A version is numbered in order from 1, and only its delivery is set, once.
CREATE FUNCTION advisory_plan_versions_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.version_no <> coalesce((SELECT max(v.version_no) FROM advisory_plan_versions v
                                    WHERE v.plan_id = NEW.plan_id), 0) + 1 THEN
      RAISE EXCEPTION 'PLAN_VERSION_ORDER: versions are numbered 1, 2, 3 in order'
        USING ERRCODE = 'check_violation';
    END IF;
  ELSIF OLD.delivered_at IS NOT NULL
        OR (to_jsonb(NEW) - 'delivered_at' - 'delivered_channel' - 'delivered_by_user_id')
           IS DISTINCT FROM (to_jsonb(OLD) - 'delivered_at' - 'delivered_channel' - 'delivered_by_user_id') THEN
    RAISE EXCEPTION 'PLAN_VERSION_FROZEN: a plan version never changes; its delivery is set once'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER advisory_plan_versions_rules BEFORE INSERT OR UPDATE ON advisory_plan_versions
  FOR EACH ROW EXECUTE FUNCTION advisory_plan_versions_rules();
