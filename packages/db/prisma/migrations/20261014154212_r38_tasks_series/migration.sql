-- R38 (Rasel, Oct 14), Tasks module, part 4: recurring task series
-- (docs/mockups/firm-workspace/task/source, Frame 3 and the guide's sections 9 to 14). A series'
-- due dates are rows (task_occurrences) with a unique (series, scheduled date), so a scheduler
-- retry can never make a second task for the same date. Past tasks are never rewritten by a
-- series edit: each task is its own row made from a snapshot.

-- CreateEnum
CREATE TYPE "RecurrenceUnit" AS ENUM ('DAY', 'WEEK', 'MONTH', 'QUARTER', 'YEAR');

-- CreateEnum
CREATE TYPE "RecurrenceEnd" AS ENUM ('NEVER', 'AFTER_COUNT', 'ON_DATE');

-- CreateEnum
CREATE TYPE "HolidayRule" AS ENUM ('NONE', 'NEXT_BUSINESS_DAY', 'PREVIOUS_BUSINESS_DAY');

-- CreateEnum
CREATE TYPE "TaskSeriesStatus" AS ENUM ('ACTIVE', 'PAUSED', 'ENDED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "TaskOccurrenceState" AS ENUM ('SCHEDULED', 'GENERATED', 'SKIPPED', 'FAILED');

-- CreateTable
CREATE TABLE "task_series" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "engagement_id" UUID,
    "service_id" UUID,
    "type_id" UUID,
    "title" TEXT NOT NULL,
    "details" TEXT,
    "priority" "TaskPriority" NOT NULL DEFAULT 'MEDIUM',
    "assignment_rule" "TaskAssignmentRule" NOT NULL DEFAULT 'UNASSIGNED',
    "assigned_user_id" UUID,
    "extra_assignee_ids" UUID[] DEFAULT ARRAY[]::UUID[],
    "interval" INTEGER NOT NULL DEFAULT 1,
    "unit" "RecurrenceUnit" NOT NULL,
    "pattern" JSONB NOT NULL DEFAULT '{}',
    "start_on" DATE NOT NULL,
    "end_mode" "RecurrenceEnd" NOT NULL DEFAULT 'NEVER',
    "end_after_count" INTEGER,
    "end_on" DATE,
    "holiday_rule" "HolidayRule" NOT NULL DEFAULT 'NEXT_BUSINESS_DAY',
    "create_at_period_start" BOOLEAN NOT NULL DEFAULT false,
    "lead_days" INTEGER,
    "link_tax_calendar" BOOLEAN NOT NULL DEFAULT false,
    "due_time" TIME(0),
    "client_visible" BOOLEAN NOT NULL DEFAULT false,
    "notify_client" BOOLEAN NOT NULL DEFAULT false,
    "checklist" JSONB NOT NULL DEFAULT '[]',
    "reminders" JSONB NOT NULL DEFAULT '[]',
    "status" "TaskSeriesStatus" NOT NULL DEFAULT 'ACTIVE',
    "paused_at" TIMESTAMPTZ(3),
    "ended_at" TIMESTAMPTZ(3),
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "task_series_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_occurrences" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "series_id" UUID NOT NULL,
    "scheduled_on" DATE NOT NULL,
    "due_on" DATE NOT NULL,
    "state" "TaskOccurrenceState" NOT NULL DEFAULT 'SCHEDULED',
    "task_id" UUID,
    "skip_reason" TEXT,
    "failure_code" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "generated_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "task_occurrences_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "task_series_business_id_client_id_idx" ON "task_series"("business_id", "client_id");

-- CreateIndex
CREATE INDEX "task_series_business_id_status_idx" ON "task_series"("business_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "task_series_business_id_id_key" ON "task_series"("business_id", "id");

-- CreateIndex
CREATE INDEX "task_occurrences_business_id_state_due_on_idx" ON "task_occurrences"("business_id", "state", "due_on");

-- CreateIndex
CREATE UNIQUE INDEX "task_occurrences_business_id_series_id_scheduled_on_key" ON "task_occurrences"("business_id", "series_id", "scheduled_on");

-- CreateIndex
CREATE UNIQUE INDEX "task_occurrences_business_id_task_id_key" ON "task_occurrences"("business_id", "task_id");

-- AddForeignKey
ALTER TABLE "task_series" ADD CONSTRAINT "task_series_business_id_client_id_fkey" FOREIGN KEY ("business_id", "client_id") REFERENCES "clients"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_series" ADD CONSTRAINT "task_series_business_id_client_id_engagement_id_fkey" FOREIGN KEY ("business_id", "client_id", "engagement_id") REFERENCES "engagements"("business_id", "client_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_series" ADD CONSTRAINT "task_series_business_id_service_id_fkey" FOREIGN KEY ("business_id", "service_id") REFERENCES "services"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_series" ADD CONSTRAINT "task_series_business_id_type_id_fkey" FOREIGN KEY ("business_id", "type_id") REFERENCES "task_types"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_series" ADD CONSTRAINT "task_series_business_id_assigned_user_id_fkey" FOREIGN KEY ("business_id", "assigned_user_id") REFERENCES "memberships"("business_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_occurrences" ADD CONSTRAINT "task_occurrences_business_id_series_id_fkey" FOREIGN KEY ("business_id", "series_id") REFERENCES "task_series"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_occurrences" ADD CONSTRAINT "task_occurrences_business_id_task_id_fkey" FOREIGN KEY ("business_id", "task_id") REFERENCES "tasks"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------- Grants, RLS, policy ----------
-- Series are ended or archived, never deleted; occurrences are a record.
GRANT SELECT, INSERT, UPDATE ON task_series, task_occurrences TO firmivra_app;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['task_series', 'task_occurrences'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I ON %I USING (business_id = app_current_business_id())'
                   ' WITH CHECK (business_id = app_current_business_id())', t || '_business', t);
  END LOOP;
END
$$;

-- ---------- Shape ----------
ALTER TABLE task_series ADD CONSTRAINT task_series_shape
  CHECK (btrim(title) <> '' AND char_length(title) <= 200 AND char_length(details) <= 2000
         AND "interval" BETWEEN 1 AND 365 AND jsonb_typeof(pattern) = 'object'
         AND jsonb_typeof(checklist) = 'array' AND jsonb_array_length(checklist) <= 50
         AND jsonb_typeof(reminders) = 'array' AND jsonb_array_length(reminders) <= 10
         AND (lead_days IS NULL OR lead_days BETWEEN 0 AND 90)
         AND cardinality(extra_assignee_ids) <= 20
         AND array_position(extra_assignee_ids, NULL) IS NULL
         AND (assignment_rule = 'SPECIFIC_USER') = (assigned_user_id IS NOT NULL)
         AND (notify_client = false OR client_visible)
         AND (status <> 'PAUSED' OR paused_at IS NOT NULL)
         AND (status NOT IN ('ENDED', 'ARCHIVED') OR ended_at IS NOT NULL));
-- How the series ends: never, after N tasks, or on a date.
ALTER TABLE task_series ADD CONSTRAINT task_series_end
  CHECK ((end_mode = 'NEVER' AND end_after_count IS NULL AND end_on IS NULL)
      OR (end_mode = 'AFTER_COUNT' AND COALESCE(end_after_count BETWEEN 1 AND 1000, false) AND end_on IS NULL)
      OR (end_mode = 'ON_DATE' AND COALESCE(end_on >= start_on, false) AND end_after_count IS NULL));

ALTER TABLE task_occurrences ADD CONSTRAINT task_occurrences_shape
  CHECK (attempts >= 0 AND char_length(skip_reason) <= 500 AND char_length(failure_code) <= 60
         AND (state = 'GENERATED') = (task_id IS NOT NULL)
         AND (state = 'GENERATED') = (generated_at IS NOT NULL)
         AND (state = 'SKIPPED' OR skip_reason IS NULL));

-- ---------- Extra assignees are members of the firm; a task belongs to its series' client ----------
CREATE FUNCTION task_series_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.client_id <> OLD.client_id OR NEW.start_on <> OLD.start_on) THEN
    RAISE EXCEPTION 'task series: the client and the start date cannot change'
      USING ERRCODE = 'check_violation';
  END IF;
  IF cardinality(NEW.extra_assignee_ids) > 0 AND (
       SELECT count(*) FROM memberships m
        WHERE m.business_id = NEW.business_id AND m.user_id = ANY (NEW.extra_assignee_ids))
     <> (SELECT count(DISTINCT x) FROM unnest(NEW.extra_assignee_ids) AS x) THEN
    RAISE EXCEPTION 'task series: every extra assignee must be a member of this firm'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER task_series_rules BEFORE INSERT OR UPDATE ON task_series
  FOR EACH ROW EXECUTE FUNCTION task_series_rules();

CREATE FUNCTION task_occurrences_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.series_id <> OLD.series_id OR NEW.scheduled_on <> OLD.scheduled_on
                           OR (OLD.task_id IS NOT NULL AND NEW.task_id IS DISTINCT FROM OLD.task_id)) THEN
    RAISE EXCEPTION 'task occurrences: the series, the date and a made task never change'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.task_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM task_series s JOIN tasks t ON t.business_id = s.business_id AND t.client_id = s.client_id
        WHERE s.business_id = NEW.business_id AND s.id = NEW.series_id AND t.id = NEW.task_id) THEN
    RAISE EXCEPTION 'task occurrences: the task must be of the series'' client'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER task_occurrences_rules BEFORE INSERT OR UPDATE ON task_occurrences
  FOR EACH ROW EXECUTE FUNCTION task_occurrences_rules();
