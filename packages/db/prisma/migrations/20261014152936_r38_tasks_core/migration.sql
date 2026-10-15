-- R38 (Rasel, Oct 14), Tasks module, part 1 (docs/mockups/firm-workspace/task/source): the Tasks
-- list and the Create/Edit Task form. Adds to the existing tasks table the fields the screens
-- show (priority, progress, type, service, start, due time, all day, client visibility, internal
-- notes, blocked reason, one prerequisite task, archive), the firm's task types and additional
-- assignees. tasks keeps its policy and grants (table-level, so they cover the new columns).

-- CreateEnum
CREATE TYPE "TaskProgress" AS ENUM ('NOT_STARTED', 'PENDING', 'IN_PROGRESS', 'WAITING', 'BLOCKED');

-- CreateEnum
CREATE TYPE "TaskPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "all_day" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "archived_at" TIMESTAMPTZ(3),
ADD COLUMN     "blocked_reason" TEXT,
ADD COLUMN     "client_visible" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "completed_by_user_id" UUID,
ADD COLUMN     "depends_on_task_id" UUID,
ADD COLUMN     "due_time" TIME(0),
ADD COLUMN     "internal_notes" TEXT,
ADD COLUMN     "priority" "TaskPriority" NOT NULL DEFAULT 'MEDIUM',
ADD COLUMN     "progress" "TaskProgress" NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "service_id" UUID,
ADD COLUMN     "start_on" DATE,
ADD COLUMN     "type_id" UUID;

-- CreateTable
CREATE TABLE "task_types" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "archived_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "task_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_assignees" (
    "business_id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_assignees_pkey" PRIMARY KEY ("task_id","user_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "task_types_business_id_id_key" ON "task_types"("business_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "task_types_business_id_name_key" ON "task_types"("business_id", "name");

-- CreateIndex
CREATE INDEX "task_assignees_business_id_user_id_idx" ON "task_assignees"("business_id", "user_id");

-- CreateIndex
CREATE INDEX "tasks_business_id_status_due_on_idx" ON "tasks"("business_id", "status", "due_on");

-- CreateIndex
CREATE INDEX "tasks_business_id_depends_on_task_id_idx" ON "tasks"("business_id", "depends_on_task_id");

-- CreateIndex
CREATE UNIQUE INDEX "tasks_business_id_id_key" ON "tasks"("business_id", "id");

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_business_id_type_id_fkey" FOREIGN KEY ("business_id", "type_id") REFERENCES "task_types"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_business_id_service_id_fkey" FOREIGN KEY ("business_id", "service_id") REFERENCES "services"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_business_id_depends_on_task_id_fkey" FOREIGN KEY ("business_id", "depends_on_task_id") REFERENCES "tasks"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_types" ADD CONSTRAINT "task_types_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_assignees" ADD CONSTRAINT "task_assignees_business_id_task_id_fkey" FOREIGN KEY ("business_id", "task_id") REFERENCES "tasks"("business_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_assignees" ADD CONSTRAINT "task_assignees_business_id_user_id_fkey" FOREIGN KEY ("business_id", "user_id") REFERENCES "memberships"("business_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------- Grants, RLS, policy ----------
-- Task types are archived, never deleted (tasks point at them); collaborators come and go.
GRANT SELECT, INSERT, UPDATE ON task_types TO firmivra_app;
GRANT SELECT, INSERT, DELETE ON task_assignees TO firmivra_app;

ALTER TABLE task_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_types FORCE ROW LEVEL SECURITY;
CREATE POLICY task_types_business ON task_types
  USING (business_id = app_current_business_id())
  WITH CHECK (business_id = app_current_business_id());

ALTER TABLE task_assignees ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_assignees FORCE ROW LEVEL SECURITY;
CREATE POLICY task_assignees_business ON task_assignees
  USING (business_id = app_current_business_id())
  WITH CHECK (business_id = app_current_business_id());

-- ---------- Shape ----------
ALTER TABLE task_types ADD CONSTRAINT task_types_name
  CHECK (btrim(name) <> '' AND char_length(name) <= 80);
ALTER TABLE tasks ADD CONSTRAINT tasks_due_time
  CHECK (due_time IS NULL OR (due_on IS NOT NULL AND NOT all_day));
ALTER TABLE tasks ADD CONSTRAINT tasks_start_before_due
  CHECK (start_on IS NULL OR due_on IS NULL OR start_on <= due_on);
ALTER TABLE tasks ADD CONSTRAINT tasks_text_limits
  CHECK (char_length(internal_notes) <= 5000 AND char_length(blocked_reason) <= 500
         AND char_length(details) <= 2000);
ALTER TABLE tasks ADD CONSTRAINT tasks_not_its_own_prerequisite
  CHECK (depends_on_task_id IS NULL OR depends_on_task_id <> id);

-- ---------- A prerequisite chain never loops ----------
-- Walks the chain from the new prerequisite; reaching the task itself would close a cycle.
CREATE FUNCTION tasks_no_dependency_cycle() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF EXISTS (
    WITH RECURSIVE chain(id) AS (
      SELECT NEW.depends_on_task_id
      UNION
      SELECT t.depends_on_task_id FROM tasks t JOIN chain c ON t.id = c.id
       WHERE t.business_id = NEW.business_id AND t.depends_on_task_id IS NOT NULL
    )
    SELECT 1 FROM chain WHERE id = NEW.id
  ) THEN
    RAISE EXCEPTION 'tasks: a task cannot depend on itself through other tasks'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER tasks_no_dependency_cycle
  BEFORE UPDATE OF depends_on_task_id ON tasks
  FOR EACH ROW WHEN (NEW.depends_on_task_id IS NOT NULL
                     AND NEW.depends_on_task_id IS DISTINCT FROM OLD.depends_on_task_id)
  EXECUTE FUNCTION tasks_no_dependency_cycle();
