-- R38 (Rasel, Oct 14), Compliance & Deadlines, part 1 (docs/mockups/firm-workspace/compliance/
-- source): the deadline list and the Add/Edit Deadline form. A deadline belongs to a client and
-- keeps the rule's date apart from the date worked to, a reasoned override, its extension and
-- payment dates, completion evidence and reminders. Tasks
-- gain deadline_id and template_id: at most one task per deadline and template (idempotent
-- generation). Overdue and Due Soon are derived, not stored.

-- CreateEnum
CREATE TYPE "DeadlineType" AS ENUM ('TAX_FILING', 'ESTIMATED_TAX', 'ELECTION', 'BOOKKEEPING', 'PAYROLL', 'SALES_TAX', 'STATE_FILING', 'ANNUAL_REPORT', 'LICENSE_PERMIT', 'ADVISORY', 'OTHER');

-- CreateEnum
CREATE TYPE "DeadlineSource" AS ENUM ('GOVERNMENT', 'FIRM', 'CLIENT_SPECIFIC', 'IMPORTED');

-- CreateEnum
CREATE TYPE "DeadlineStatus" AS ENUM ('UPCOMING', 'IN_PROGRESS', 'WAITING_ON_CLIENT', 'COMPLETED', 'NOT_APPLICABLE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "JurisdictionLevel" AS ENUM ('FEDERAL', 'STATE', 'LOCAL', 'INTERNAL');

-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "deadline_id" UUID,
ADD COLUMN     "template_id" UUID;

-- CreateTable
CREATE TABLE "compliance_deadlines" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "engagement_id" UUID,
    "name" TEXT NOT NULL,
    "type" "DeadlineType" NOT NULL,
    "source" "DeadlineSource" NOT NULL DEFAULT 'FIRM',
    "description" TEXT,
    "internal_notes" TEXT,
    "client_notes" TEXT,
    "entity_type" TEXT,
    "tax_year" INTEGER,
    "filing_period" TEXT,
    "related_form" TEXT,
    "agency" TEXT,
    "jurisdiction" "JurisdictionLevel",
    "state" TEXT,
    "statutory_due_on" DATE,
    "due_on" DATE NOT NULL,
    "due_time" TIME(0),
    "due_overridden" BOOLEAN NOT NULL DEFAULT false,
    "due_override_reason" TEXT,
    "extension_filed_on" DATE,
    "extended_due_on" DATE,
    "payment_due_on" DATE,
    "priority" "TaskPriority" NOT NULL DEFAULT 'MEDIUM',
    "status" "DeadlineStatus" NOT NULL DEFAULT 'UPCOMING',
    "assigned_user_id" UUID,
    "client_visible" BOOLEAN NOT NULL DEFAULT false,
    "create_task" BOOLEAN NOT NULL DEFAULT false,
    "task_template_id" UUID,
    "completed_at" TIMESTAMPTZ(3),
    "completed_by_user_id" UUID,
    "filed_on" DATE,
    "confirmation_number" TEXT,
    "not_applicable_reason" TEXT,
    "created_by_user_id" UUID,
    "archived_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "compliance_deadlines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "compliance_deadline_reminders" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "deadline_id" UUID NOT NULL,
    "days_before" INTEGER NOT NULL,
    "in_app" BOOLEAN NOT NULL DEFAULT true,
    "channels" "DeliveryChannel"[] DEFAULT ARRAY[]::"DeliveryChannel"[],
    "last_fired_for" DATE,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "compliance_deadline_reminders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "compliance_deadlines_business_id_status_due_on_idx" ON "compliance_deadlines"("business_id", "status", "due_on");

-- CreateIndex
CREATE INDEX "compliance_deadlines_business_id_client_id_due_on_idx" ON "compliance_deadlines"("business_id", "client_id", "due_on");

-- CreateIndex
CREATE INDEX "compliance_deadlines_business_id_assigned_user_id_status_idx" ON "compliance_deadlines"("business_id", "assigned_user_id", "status");

-- CreateIndex
CREATE INDEX "compliance_deadlines_business_id_type_idx" ON "compliance_deadlines"("business_id", "type");

-- CreateIndex
CREATE UNIQUE INDEX "compliance_deadlines_business_id_id_key" ON "compliance_deadlines"("business_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "compliance_deadline_reminders_business_id_deadline_id_days__key" ON "compliance_deadline_reminders"("business_id", "deadline_id", "days_before");

-- CreateIndex
CREATE UNIQUE INDEX "task_templates_business_id_id_key" ON "task_templates"("business_id", "id");

-- CreateIndex
CREATE INDEX "tasks_business_id_deadline_id_idx" ON "tasks"("business_id", "deadline_id");

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_business_id_deadline_id_fkey" FOREIGN KEY ("business_id", "deadline_id") REFERENCES "compliance_deadlines"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_business_id_template_id_fkey" FOREIGN KEY ("business_id", "template_id") REFERENCES "task_templates"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compliance_deadlines" ADD CONSTRAINT "compliance_deadlines_business_id_client_id_fkey" FOREIGN KEY ("business_id", "client_id") REFERENCES "clients"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compliance_deadlines" ADD CONSTRAINT "compliance_deadlines_business_id_client_id_engagement_id_fkey" FOREIGN KEY ("business_id", "client_id", "engagement_id") REFERENCES "engagements"("business_id", "client_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compliance_deadlines" ADD CONSTRAINT "compliance_deadlines_business_id_assigned_user_id_fkey" FOREIGN KEY ("business_id", "assigned_user_id") REFERENCES "memberships"("business_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compliance_deadlines" ADD CONSTRAINT "compliance_deadlines_business_id_task_template_id_fkey" FOREIGN KEY ("business_id", "task_template_id") REFERENCES "task_templates"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compliance_deadline_reminders" ADD CONSTRAINT "compliance_deadline_reminders_business_id_deadline_id_fkey" FOREIGN KEY ("business_id", "deadline_id") REFERENCES "compliance_deadlines"("business_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ---------- Grants, RLS, policy ----------
-- Deadlines are archived, never deleted; reminders come and go.
GRANT SELECT, INSERT, UPDATE ON compliance_deadlines TO firmivra_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance_deadline_reminders TO firmivra_app;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['compliance_deadlines', 'compliance_deadline_reminders'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I ON %I USING (business_id = app_current_business_id())'
                   ' WITH CHECK (business_id = app_current_business_id())', t || '_business', t);
  END LOOP;
END
$$;

-- ---------- Shape ----------
ALTER TABLE compliance_deadlines ADD CONSTRAINT compliance_deadlines_shape
  CHECK (btrim(name) <> '' AND char_length(name) <= 200
         AND char_length(description) <= 2000 AND char_length(internal_notes) <= 5000
         AND char_length(client_notes) <= 2000 AND char_length(confirmation_number) <= 100
         AND (state IS NULL OR state ~ '^[A-Z]{2}$')
         AND (tax_year IS NULL OR tax_year BETWEEN 2000 AND 2100)
         -- A reason for an override, and only then.
         AND due_overridden = (btrim(coalesce(due_override_reason, '')) <> '')
         -- An extension has its filed date and new date together, and does not shorten the deadline.
         AND (extension_filed_on IS NULL) = (extended_due_on IS NULL)
         AND (extended_due_on IS NULL OR extended_due_on >= due_on)
         AND (create_task OR task_template_id IS NULL)
         -- Completed has its time; not applicable has its reason (kept, with the row).
         AND (status = 'COMPLETED') = (completed_at IS NOT NULL)
         AND (status <> 'NOT_APPLICABLE' OR btrim(coalesce(not_applicable_reason, '')) <> ''));

ALTER TABLE compliance_deadline_reminders ADD CONSTRAINT compliance_deadline_reminders_shape
  CHECK (days_before BETWEEN 0 AND 365 AND cardinality(channels) <= 2
         AND (in_app OR cardinality(channels) > 0));
-- One task per deadline and template, so making them again (a retry) finds the first.
CREATE UNIQUE INDEX tasks_one_per_deadline_template ON tasks (business_id, deadline_id, template_id)
  WHERE deadline_id IS NOT NULL AND template_id IS NOT NULL;

-- ---------- Same client: a deadline keeps its client, and so do its tasks ----------
CREATE FUNCTION compliance_deadline_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF TG_TABLE_NAME = 'compliance_deadlines' THEN
    IF NEW.client_id <> OLD.client_id THEN
      RAISE EXCEPTION 'compliance deadlines: a deadline cannot change client'
        USING ERRCODE = 'check_violation';
    END IF;
  ELSIF NOT EXISTS (SELECT 1 FROM compliance_deadlines d
                     WHERE d.business_id = NEW.business_id AND d.id = NEW.deadline_id
                       AND d.client_id = NEW.client_id) THEN
    RAISE EXCEPTION 'tasks: a task of a deadline is of the deadline''s client'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER compliance_deadlines_rules BEFORE UPDATE OF client_id ON compliance_deadlines
  FOR EACH ROW EXECUTE FUNCTION compliance_deadline_rules();
CREATE TRIGGER tasks_deadline_client BEFORE INSERT OR UPDATE OF deadline_id, client_id ON tasks
  FOR EACH ROW WHEN (NEW.deadline_id IS NOT NULL) EXECUTE FUNCTION compliance_deadline_rules();
