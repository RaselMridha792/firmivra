-- R38 (Rasel, Oct 14), Tasks module, part 3: task templates (the Task Templates tab and "Use
-- Template" / "Save as Template" on the task forms; guide section 9). A template is what a new
-- task starts with; its checklist and reminders are JSON arrays checked for shape. Archived,
-- never deleted.

-- CreateEnum
CREATE TYPE "TaskAssignmentRule" AS ENUM ('UNASSIGNED', 'SPECIFIC_USER', 'CLIENT_TEAM');

-- CreateTable
CREATE TABLE "task_templates" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "type_id" UUID,
    "service_id" UUID,
    "priority" "TaskPriority" NOT NULL DEFAULT 'MEDIUM',
    "assignment_rule" "TaskAssignmentRule" NOT NULL DEFAULT 'UNASSIGNED',
    "assigned_user_id" UUID,
    "due_offset_days" INTEGER,
    "client_visible_default" BOOLEAN NOT NULL DEFAULT false,
    "checklist" JSONB NOT NULL DEFAULT '[]',
    "reminders" JSONB NOT NULL DEFAULT '[]',
    "recurrence" JSONB,
    "created_by_user_id" UUID,
    "archived_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "task_templates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "task_templates_business_id_name_key" ON "task_templates"("business_id", "name");

-- AddForeignKey
ALTER TABLE "task_templates" ADD CONSTRAINT "task_templates_business_id_type_id_fkey" FOREIGN KEY ("business_id", "type_id") REFERENCES "task_types"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_templates" ADD CONSTRAINT "task_templates_business_id_service_id_fkey" FOREIGN KEY ("business_id", "service_id") REFERENCES "services"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_templates" ADD CONSTRAINT "task_templates_business_id_assigned_user_id_fkey" FOREIGN KEY ("business_id", "assigned_user_id") REFERENCES "memberships"("business_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------- Grants, RLS, policy ----------
-- Templates are archived, never deleted.
GRANT SELECT, INSERT, UPDATE ON task_templates TO firmivra_app;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['task_templates'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I ON %I USING (business_id = app_current_business_id())'
                   ' WITH CHECK (business_id = app_current_business_id())', t || '_business', t);
  END LOOP;
END
$$;

-- ---------- Shape ----------
ALTER TABLE task_templates ADD CONSTRAINT task_templates_shape
  CHECK (btrim(name) <> '' AND char_length(name) <= 120 AND char_length(description) <= 2000
         AND (due_offset_days IS NULL OR due_offset_days BETWEEN 0 AND 730)
         AND jsonb_typeof(checklist) = 'array' AND jsonb_array_length(checklist) <= 50
         AND jsonb_typeof(reminders) = 'array' AND jsonb_array_length(reminders) <= 10
         AND (recurrence IS NULL OR jsonb_typeof(recurrence) = 'object')
         AND (assignment_rule = 'SPECIFIC_USER') = (assigned_user_id IS NOT NULL));
