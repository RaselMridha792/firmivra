-- R38 (Rasel, Oct 14), Compliance & Deadlines, part 4: the compliance log and the firm's
-- Compliance settings (docs/mockups/firm-workspace/compliance/source, Frame 3 "Logs" and the
-- Settings button). The log is append-only and holds ids, counts and short safe messages, never
-- client data. One settings row per firm.

-- CreateEnum
CREATE TYPE "ComplianceLogKind" AS ENUM ('IMPORT', 'VERIFY', 'PUBLISH', 'ROLLBACK', 'GENERATE', 'OVERRIDE', 'ERROR');

-- CreateEnum
CREATE TYPE "LogOutcome" AS ENUM ('SUCCESS', 'FAILED', 'SKIPPED');

-- CreateTable
CREATE TABLE "compliance_logs" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "kind" "ComplianceLogKind" NOT NULL,
    "outcome" "LogOutcome" NOT NULL,
    "calendar_id" UUID,
    "deadline_id" UUID,
    "recurrence_id" UUID,
    "message" TEXT,
    "details" JSONB NOT NULL DEFAULT '{}',
    "actor_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "compliance_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "compliance_settings" (
    "business_id" UUID NOT NULL,
    "due_soon_days" INTEGER NOT NULL DEFAULT 14,
    "at_risk_days" INTEGER NOT NULL DEFAULT 7,
    "stale_calendar_days" INTEGER NOT NULL DEFAULT 90,
    "default_reminders" JSONB NOT NULL DEFAULT '[]',
    "send_past_due_notice" BOOLEAN NOT NULL DEFAULT false,
    "escalate_to_manager" BOOLEAN NOT NULL DEFAULT false,
    "escalate_after_days" INTEGER NOT NULL DEFAULT 3,
    "task_templates" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "compliance_settings_pkey" PRIMARY KEY ("business_id")
);

-- CreateIndex
CREATE INDEX "compliance_logs_business_id_created_at_idx" ON "compliance_logs"("business_id", "created_at");

-- CreateIndex
CREATE INDEX "compliance_logs_business_id_kind_outcome_idx" ON "compliance_logs"("business_id", "kind", "outcome");

-- AddForeignKey
ALTER TABLE "compliance_logs" ADD CONSTRAINT "compliance_logs_business_id_calendar_id_fkey" FOREIGN KEY ("business_id", "calendar_id") REFERENCES "compliance_calendars"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compliance_logs" ADD CONSTRAINT "compliance_logs_business_id_deadline_id_fkey" FOREIGN KEY ("business_id", "deadline_id") REFERENCES "compliance_deadlines"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compliance_logs" ADD CONSTRAINT "compliance_logs_business_id_recurrence_id_fkey" FOREIGN KEY ("business_id", "recurrence_id") REFERENCES "compliance_recurrences"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compliance_settings" ADD CONSTRAINT "compliance_settings_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------- Grants, RLS, policy ----------
-- The log is insert-only: nothing is changed or removed once written.
GRANT SELECT, INSERT ON compliance_logs TO firmivra_app;
GRANT SELECT, INSERT, UPDATE ON compliance_settings TO firmivra_app;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['compliance_logs', 'compliance_settings'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I ON %I USING (business_id = app_current_business_id())'
                   ' WITH CHECK (business_id = app_current_business_id())', t || '_business', t);
  END LOOP;
END
$$;

-- ---------- Shape ----------
ALTER TABLE compliance_logs ADD CONSTRAINT compliance_logs_shape
  CHECK (char_length(message) <= 500 AND jsonb_typeof(details) = 'object'
         AND pg_column_size(details) <= 4000);

ALTER TABLE compliance_settings ADD CONSTRAINT compliance_settings_shape
  CHECK (due_soon_days BETWEEN 1 AND 90 AND at_risk_days BETWEEN 1 AND 90
         AND stale_calendar_days BETWEEN 7 AND 730 AND escalate_after_days BETWEEN 1 AND 60
         AND jsonb_typeof(default_reminders) = 'array' AND jsonb_array_length(default_reminders) <= 10
         AND jsonb_typeof(task_templates) = 'object');
