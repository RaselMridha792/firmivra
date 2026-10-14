-- CreateEnum
CREATE TYPE "PayrollClientStatus" AS ENUM ('ON_TRACK', 'PROCESSING', 'ACTION_REQUIRED', 'PAST_DUE', 'NOT_STARTED', 'ON_HOLD', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "PayrollFrequency" AS ENUM ('WEEKLY', 'BIWEEKLY', 'SEMI_MONTHLY', 'MONTHLY');

-- CreateEnum
CREATE TYPE "PayrollActivityKind" AS ENUM ('PAYROLL_REVIEW', 'CLIENT_CALL', 'PROVIDER_ISSUE', 'NOTICE_FOLLOW_UP', 'DOCUMENT_FOLLOW_UP', 'OTHER');

-- CreateTable
CREATE TABLE "payroll_clients" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "engagement_id" UUID NOT NULL,
    "status" "PayrollClientStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "frequency" "PayrollFrequency",
    "provider_key" TEXT,
    "connection_id" UUID,
    "industry" TEXT,
    "employee_count" INTEGER,
    "employee_count_at" TIMESTAMPTZ(3),
    "next_payroll_on" DATE,
    "next_payroll_source" TEXT,
    "last_run_on" DATE,
    "last_synced_at" TIMESTAMPTZ(3),
    "last_sync_attempt_at" TIMESTAMPTZ(3),
    "assigned_user_id" UUID,
    "service_since" DATE,
    "paused_at" TIMESTAMPTZ(3),
    "archived_at" TIMESTAMPTZ(3),
    "settings" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "payroll_clients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_client_changes" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "payroll_client_id" UUID NOT NULL,
    "field" TEXT NOT NULL,
    "old_value" TEXT,
    "new_value" TEXT,
    "reason" TEXT,
    "changed_by_user_id" UUID,
    "changed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payroll_client_changes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_activities" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "payroll_client_id" UUID NOT NULL,
    "kind" "PayrollActivityKind" NOT NULL,
    "summary" TEXT NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "logged_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payroll_activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_settings" (
    "business_id" UUID NOT NULL,
    "default_assignee_id" UUID,
    "reminder_days_before" INTEGER NOT NULL DEFAULT 3,
    "stale_after_hours" INTEGER NOT NULL DEFAULT 48,
    "settings" JSONB NOT NULL DEFAULT '{}',
    "updated_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "payroll_settings_pkey" PRIMARY KEY ("business_id")
);

-- CreateIndex
CREATE INDEX "payroll_clients_business_id_status_idx" ON "payroll_clients"("business_id", "status");

-- CreateIndex
CREATE INDEX "payroll_clients_business_id_next_payroll_on_idx" ON "payroll_clients"("business_id", "next_payroll_on");

-- CreateIndex
CREATE INDEX "payroll_clients_business_id_assigned_user_id_idx" ON "payroll_clients"("business_id", "assigned_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_clients_business_id_id_key" ON "payroll_clients"("business_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_clients_business_id_engagement_id_key" ON "payroll_clients"("business_id", "engagement_id");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_clients_business_id_client_id_engagement_id_key" ON "payroll_clients"("business_id", "client_id", "engagement_id");

-- CreateIndex
CREATE INDEX "payroll_client_changes_business_id_payroll_client_id_change_idx" ON "payroll_client_changes"("business_id", "payroll_client_id", "changed_at");

-- CreateIndex
CREATE INDEX "payroll_activities_business_id_payroll_client_id_occurred_a_idx" ON "payroll_activities"("business_id", "payroll_client_id", "occurred_at");

-- AddForeignKey
ALTER TABLE "payroll_clients" ADD CONSTRAINT "payroll_clients_business_id_client_id_fkey" FOREIGN KEY ("business_id", "client_id") REFERENCES "clients"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_clients" ADD CONSTRAINT "payroll_clients_business_id_client_id_engagement_id_fkey" FOREIGN KEY ("business_id", "client_id", "engagement_id") REFERENCES "engagements"("business_id", "client_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_clients" ADD CONSTRAINT "payroll_clients_business_id_connection_id_fkey" FOREIGN KEY ("business_id", "connection_id") REFERENCES "integration_connections"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_client_changes" ADD CONSTRAINT "payroll_client_changes_business_id_payroll_client_id_fkey" FOREIGN KEY ("business_id", "payroll_client_id") REFERENCES "payroll_clients"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_activities" ADD CONSTRAINT "payroll_activities_business_id_payroll_client_id_fkey" FOREIGN KEY ("business_id", "payroll_client_id") REFERENCES "payroll_clients"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Grants: a payroll client is paused or archived, never deleted; its history and log are insert-only.
GRANT SELECT, INSERT, UPDATE ON payroll_clients, payroll_settings TO firmivra_app;
GRANT SELECT, INSERT ON payroll_client_changes, payroll_activities TO firmivra_app;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['payroll_clients', 'payroll_client_changes', 'payroll_activities', 'payroll_settings'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I ON %I USING (business_id = app_current_business_id())'
                   ' WITH CHECK (business_id = app_current_business_id())', t || '_business', t);
  END LOOP;
END
$$;

-- Shape
ALTER TABLE payroll_clients ADD CONSTRAINT payroll_clients_values
  CHECK ((provider_key IS NULL OR provider_key ~ '^[a-z][a-z0-9_]{1,39}$')
         AND (industry IS NULL OR esign_text_ok(industry, 100))
         AND (employee_count IS NULL OR employee_count >= 0)
         AND (employee_count IS NULL) = (employee_count_at IS NULL)
         AND (next_payroll_on IS NULL) = (next_payroll_source IS NULL)
         AND (next_payroll_source IS NULL OR next_payroll_source IN ('provider', 'schedule'))
         AND jsonb_typeof(settings) = 'object' AND pg_column_size(settings) <= 20000
         AND (status = 'ON_HOLD') = (paused_at IS NOT NULL)
         AND (status = 'ARCHIVED') = (archived_at IS NOT NULL));

ALTER TABLE payroll_client_changes ADD CONSTRAINT payroll_client_changes_values
  CHECK (field ~ '^[a-z][a-z0-9_]{0,39}$'
         AND (old_value IS NULL OR char_length(old_value) <= 200)
         AND (new_value IS NULL OR char_length(new_value) <= 200)
         AND old_value IS DISTINCT FROM new_value
         AND (reason IS NULL OR esign_text_ok(reason, 500)));

ALTER TABLE payroll_activities ADD CONSTRAINT payroll_activities_values
  CHECK (esign_text_ok(summary, 1000));

ALTER TABLE payroll_settings ADD CONSTRAINT payroll_settings_values
  CHECK (reminder_days_before BETWEEN 0 AND 30 AND stale_after_hours BETWEEN 1 AND 720
         AND jsonb_typeof(settings) = 'object' AND pg_column_size(settings) <= 20000);

-- The engagement is a payroll service, and the connection (if any) is the chosen provider's.
CREATE FUNCTION payroll_clients_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NOT EXISTS (
       SELECT 1 FROM engagements e JOIN services s ON s.business_id = e.business_id AND s.id = e.service_id
        WHERE e.business_id = NEW.business_id AND e.id = NEW.engagement_id AND s.kind = 'PAYROLL') THEN
    RAISE EXCEPTION 'PAYROLL_ENGAGEMENT: the engagement is not a payroll service'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.connection_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM integration_connections c
        WHERE c.business_id = NEW.business_id AND c.id = NEW.connection_id
          AND c.provider = NEW.provider_key) THEN
    RAISE EXCEPTION 'PAYROLL_CONNECTION: the connection is not the chosen provider''s'
      USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.client_id, NEW.engagement_id) IS DISTINCT FROM (OLD.client_id, OLD.engagement_id) THEN
    RAISE EXCEPTION 'PAYROLL_FROZEN: a payroll client keeps its client and engagement'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER payroll_clients_rules BEFORE INSERT OR UPDATE ON payroll_clients
  FOR EACH ROW EXECUTE FUNCTION payroll_clients_rules();
