-- r1_staff_work_schedules (R1, Oct 24; Rasel's block, R60's "Column request for R1", request 11,
-- Staff Management SM8): a firm's saved work schedules, offered on Create Staff, like the saved
-- job titles (r1_intake_staff_settings). Owner and Admin add, rename and archive them; members
-- read. A staff record keeps its own work_schedule text. Filled once from each firm's distinct
-- staff-record schedules.
-- Safe on dev: a new table; its foreign keys take short locks on businesses and memberships; the
-- backfill only reads staff_profiles, each firm in its own scope (RLS is forced and the migration
-- role does not bypass it on RDS).

-- CreateTable
CREATE TABLE "staff_work_schedules" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "created_by_user_id" UUID,
    "archived_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "staff_work_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "staff_work_schedules_business_id_idx" ON "staff_work_schedules"("business_id");

-- CreateIndex
CREATE UNIQUE INDEX "staff_work_schedules_business_id_id_key" ON "staff_work_schedules"("business_id", "id");

-- AddForeignKey
ALTER TABLE "staff_work_schedules" ADD CONSTRAINT "staff_work_schedules_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_work_schedules" ADD CONSTRAINT "staff_work_schedules_business_id_created_by_user_id_fkey" FOREIGN KEY ("business_id", "created_by_user_id") REFERENCES "memberships"("business_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------- Grants, RLS, policy ----------
-- Schedules are archived, never deleted.
GRANT SELECT, INSERT, UPDATE ON staff_work_schedules TO firmivra_app;
ALTER TABLE staff_work_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_work_schedules FORCE ROW LEVEL SECURITY;
CREATE POLICY staff_work_schedules_business ON staff_work_schedules
  USING (business_id = app_current_business_id())
  WITH CHECK (business_id = app_current_business_id());

-- ---------- Shape ----------
ALTER TABLE staff_work_schedules ADD CONSTRAINT staff_work_schedules_name
  CHECK (name = btrim(name) AND char_length(name) BETWEEN 1 AND 80);
CREATE UNIQUE INDEX staff_work_schedules_active_name_key
  ON staff_work_schedules (business_id, lower(name)) WHERE archived_at IS NULL;

-- ---------- Filled once from the staff records ----------
-- The first spelling of each schedule, ignoring case and outer spaces (every stored schedule is at
-- most 80 characters: staff_profiles_rules).
DO $$
DECLARE
  firm uuid;
  firms uuid[];
BEGIN
  PERFORM set_config('app.scope', 'platform', true);
  SELECT coalesce(array_agg(id), '{}') INTO firms FROM businesses;
  FOREACH firm IN ARRAY firms LOOP
    PERFORM set_config('app.scope', 'business', true);
    PERFORM set_config('app.current_business_id', firm::text, true);
    INSERT INTO staff_work_schedules (id, business_id, name, created_at, updated_at)
    SELECT gen_random_uuid(), firm, t.name, now(), now()
      FROM (SELECT DISTINCT ON (lower(btrim(p.work_schedule))) btrim(p.work_schedule) AS name
              FROM staff_profiles p
             WHERE p.business_id = firm AND char_length(btrim(p.work_schedule)) BETWEEN 1 AND 80
             ORDER BY lower(btrim(p.work_schedule)), p.created_at) t;
  END LOOP;
  PERFORM set_config('app.scope', '', true);
  PERFORM set_config('app.current_business_id', '', true);
END
$$;
