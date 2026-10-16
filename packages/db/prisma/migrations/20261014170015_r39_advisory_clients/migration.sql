-- CreateEnum
CREATE TYPE "AdvisoryClientStatus" AS ENUM ('IN_PROGRESS', 'SCHEDULED', 'NEEDS_REVIEW', 'ON_HOLD', 'COMPLETED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "AdvisoryServiceStatus" AS ENUM ('INTERESTED', 'PROPOSED', 'ACCEPTED', 'IN_PROGRESS', 'AWAITING_CLIENT', 'COMPLETED', 'DECLINED', 'ON_HOLD');

-- CreateEnum
CREATE TYPE "AdvisoryServiceRole" AS ENUM ('PRIMARY', 'ADDITIONAL');

-- CreateTable
CREATE TABLE "advisory_clients" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "engagement_id" UUID,
    "status" "AdvisoryClientStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "advisor_user_id" UUID,
    "industry" TEXT,
    "business_stage" TEXT,
    "health_score" INTEGER,
    "health_factors" JSONB NOT NULL DEFAULT '[]',
    "health_computed_at" TIMESTAMPTZ(3),
    "since" DATE,
    "archived_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "advisory_clients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "advisory_workstreams" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "advisory_client_id" UUID NOT NULL,
    "service_id" UUID NOT NULL,
    "role" "AdvisoryServiceRole" NOT NULL DEFAULT 'ADDITIONAL',
    "status" "AdvisoryServiceStatus" NOT NULL DEFAULT 'INTERESTED',
    "package_name" TEXT,
    "started_on" DATE,
    "completed_on" DATE,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "advisory_workstreams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "advisory_settings" (
    "business_id" UUID NOT NULL,
    "health_formula" JSONB NOT NULL DEFAULT '[]',
    "stale_financials_days" INTEGER NOT NULL DEFAULT 120,
    "default_advisor_id" UUID,
    "updated_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "advisory_settings_pkey" PRIMARY KEY ("business_id")
);

-- CreateIndex
CREATE INDEX "advisory_clients_business_id_status_idx" ON "advisory_clients"("business_id", "status");

-- CreateIndex
CREATE INDEX "advisory_clients_business_id_advisor_user_id_idx" ON "advisory_clients"("business_id", "advisor_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "advisory_clients_business_id_id_key" ON "advisory_clients"("business_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "advisory_clients_business_id_client_id_key" ON "advisory_clients"("business_id", "client_id");

-- CreateIndex
CREATE UNIQUE INDEX "advisory_clients_business_id_engagement_id_key" ON "advisory_clients"("business_id", "engagement_id");

-- CreateIndex
CREATE UNIQUE INDEX "advisory_clients_business_id_client_id_engagement_id_key" ON "advisory_clients"("business_id", "client_id", "engagement_id");

-- CreateIndex
CREATE INDEX "advisory_workstreams_business_id_status_idx" ON "advisory_workstreams"("business_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "advisory_workstreams_business_id_id_key" ON "advisory_workstreams"("business_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "advisory_workstreams_advisory_client_id_service_id_key" ON "advisory_workstreams"("advisory_client_id", "service_id");

-- AddForeignKey
ALTER TABLE "advisory_clients" ADD CONSTRAINT "advisory_clients_business_id_client_id_fkey" FOREIGN KEY ("business_id", "client_id") REFERENCES "clients"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "advisory_clients" ADD CONSTRAINT "advisory_clients_business_id_client_id_engagement_id_fkey" FOREIGN KEY ("business_id", "client_id", "engagement_id") REFERENCES "engagements"("business_id", "client_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "advisory_workstreams" ADD CONSTRAINT "advisory_workstreams_business_id_advisory_client_id_fkey" FOREIGN KEY ("business_id", "advisory_client_id") REFERENCES "advisory_clients"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "advisory_workstreams" ADD CONSTRAINT "advisory_workstreams_business_id_service_id_fkey" FOREIGN KEY ("business_id", "service_id") REFERENCES "services"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Grants: advisory clients are archived and workstreams ended, never deleted.
GRANT SELECT, INSERT, UPDATE ON advisory_clients, advisory_workstreams, advisory_settings TO firmivra_app;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['advisory_clients', 'advisory_workstreams', 'advisory_settings'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I ON %I USING (business_id = app_current_business_id())'
                   ' WITH CHECK (business_id = app_current_business_id())', t || '_business', t);
  END LOOP;
END
$$;

-- Shape
ALTER TABLE advisory_clients ADD CONSTRAINT advisory_clients_values
  CHECK ((industry IS NULL OR esign_text_ok(industry, 100))
         AND (business_stage IS NULL OR esign_text_ok(business_stage, 60))
         AND (health_score IS NULL OR health_score BETWEEN 0 AND 100)
         AND (health_score IS NULL) = (health_computed_at IS NULL)
         AND jsonb_typeof(health_factors) = 'array' AND pg_column_size(health_factors) <= 10000
         AND (status = 'ARCHIVED') = (archived_at IS NOT NULL));

ALTER TABLE advisory_workstreams ADD CONSTRAINT advisory_workstreams_values
  CHECK ((package_name IS NULL OR esign_text_ok(package_name, 100))
         AND (started_on IS NULL OR completed_on IS NULL OR completed_on >= started_on));

-- Exactly one primary service focus at most per advisory client (Prisma cannot express this).
CREATE UNIQUE INDEX advisory_workstreams_one_primary ON advisory_workstreams (advisory_client_id)
  WHERE role = 'PRIMARY';

ALTER TABLE advisory_settings ADD CONSTRAINT advisory_settings_values
  CHECK (stale_financials_days BETWEEN 1 AND 1095
         AND jsonb_typeof(health_formula) = 'array' AND jsonb_array_length(health_formula) <= 20
         AND pg_column_size(health_formula) <= 10000);

-- The engagement is a business development service of the same client, and never changes.
CREATE FUNCTION advisory_clients_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF NEW.engagement_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM engagements e JOIN services s ON s.business_id = e.business_id AND s.id = e.service_id
        WHERE e.business_id = NEW.business_id AND e.id = NEW.engagement_id
          AND s.kind = 'BUSINESS_DEVELOPMENT') THEN
    RAISE EXCEPTION 'ADVISORY_ENGAGEMENT: the engagement is not a business development service'
      USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.client_id IS DISTINCT FROM OLD.client_id THEN
    RAISE EXCEPTION 'ADVISORY_FROZEN: an advisory record keeps its client'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER advisory_clients_rules BEFORE INSERT OR UPDATE ON advisory_clients
  FOR EACH ROW EXECUTE FUNCTION advisory_clients_rules();
