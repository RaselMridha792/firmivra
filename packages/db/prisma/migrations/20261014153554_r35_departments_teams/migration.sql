-- r35_departments_teams (R35, Rasel Oct 14): departments, teams and who is in them (Staff
-- Management, Teams & Departments). Every new table is a firm table: business_id, same-firm
-- foreign keys, RLS enabled and forced with the business policy, and grants for what the screens
-- do. Departments and teams are never deleted (INACTIVE or ARCHIVED instead).

-- CreateEnum
CREATE TYPE "StaffGroupStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "TeamMemberKind" AS ENUM ('PRIMARY', 'BACKUP', 'MEMBER');

-- CreateTable
CREATE TABLE "departments" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "head_membership_id" UUID,
    "status" "StaffGroupStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "departments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "teams" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "department_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "lead_membership_id" UUID,
    "status" "StaffGroupStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "teams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "team_members" (
    "business_id" UUID NOT NULL,
    "team_id" UUID NOT NULL,
    "membership_id" UUID NOT NULL,
    "kind" "TeamMemberKind" NOT NULL DEFAULT 'MEMBER',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "team_members_pkey" PRIMARY KEY ("team_id","membership_id")
);

-- CreateTable
CREATE TABLE "member_departments" (
    "business_id" UUID NOT NULL,
    "membership_id" UUID NOT NULL,
    "department_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "member_departments_pkey" PRIMARY KEY ("membership_id","department_id")
);

-- CreateIndex
CREATE INDEX "departments_business_id_status_idx" ON "departments"("business_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "departments_business_id_id_key" ON "departments"("business_id", "id");

-- CreateIndex
CREATE INDEX "teams_business_id_department_id_idx" ON "teams"("business_id", "department_id");

-- CreateIndex
CREATE UNIQUE INDEX "teams_business_id_id_key" ON "teams"("business_id", "id");

-- CreateIndex
CREATE INDEX "team_members_business_id_membership_id_idx" ON "team_members"("business_id", "membership_id");

-- CreateIndex
CREATE INDEX "member_departments_business_id_department_id_idx" ON "member_departments"("business_id", "department_id");

-- AddForeignKey
ALTER TABLE "departments" ADD CONSTRAINT "departments_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "departments" ADD CONSTRAINT "departments_business_id_head_membership_id_fkey" FOREIGN KEY ("business_id", "head_membership_id") REFERENCES "memberships"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teams" ADD CONSTRAINT "teams_business_id_department_id_fkey" FOREIGN KEY ("business_id", "department_id") REFERENCES "departments"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teams" ADD CONSTRAINT "teams_business_id_lead_membership_id_fkey" FOREIGN KEY ("business_id", "lead_membership_id") REFERENCES "memberships"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_business_id_team_id_fkey" FOREIGN KEY ("business_id", "team_id") REFERENCES "teams"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_business_id_membership_id_fkey" FOREIGN KEY ("business_id", "membership_id") REFERENCES "memberships"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_departments" ADD CONSTRAINT "member_departments_business_id_membership_id_fkey" FOREIGN KEY ("business_id", "membership_id") REFERENCES "memberships"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_departments" ADD CONSTRAINT "member_departments_business_id_department_id_fkey" FOREIGN KEY ("business_id", "department_id") REFERENCES "departments"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------- Grants: nothing here is deleted but a place in a team or department ----------
GRANT SELECT, INSERT, UPDATE ON departments, teams TO firmivra_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON team_members, member_departments TO firmivra_app;

-- ---------- Enable and force RLS; the business policy ----------
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['departments', 'teams', 'team_members', 'member_departments'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I ON %I USING (business_id = app_current_business_id())'
                   ' WITH CHECK (business_id = app_current_business_id())', t || '_business', t);
  END LOOP;
END
$$;

-- ---------- Shape ----------
-- A name: something in it, one line, up to 80 characters. A description: up to 500, line breaks
-- and tabs allowed, no other control characters (C0 or C1).
CREATE FUNCTION staff_group_name_ok(v text) RETURNS boolean
  LANGUAGE sql IMMUTABLE
  AS $$ SELECT v ~ '[^[:space:]]' AND char_length(v) <= 80 AND v !~ '[\x01-\x1F\x7F-\x9F]' $$;
CREATE FUNCTION staff_group_description_ok(v text) RETURNS boolean
  LANGUAGE sql IMMUTABLE
  AS $$ SELECT v IS NULL OR (char_length(v) <= 500 AND v !~ '[\x01-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]') $$;

ALTER TABLE departments ADD CONSTRAINT departments_name CHECK (staff_group_name_ok(name));
ALTER TABLE departments ADD CONSTRAINT departments_description
  CHECK (staff_group_description_ok(description));
ALTER TABLE teams ADD CONSTRAINT teams_name CHECK (staff_group_name_ok(name));
ALTER TABLE teams ADD CONSTRAINT teams_description CHECK (staff_group_description_ok(description));

-- Names are unique per firm among departments (and teams) not archived, ignoring case and the
-- spaces around them, so "Tax" and " tax" cannot both be listed.
CREATE UNIQUE INDEX departments_business_id_name_key ON departments (business_id, lower(btrim(name)))
  WHERE status <> 'ARCHIVED';
CREATE UNIQUE INDEX teams_business_id_name_key ON teams (business_id, lower(btrim(name)))
  WHERE status <> 'ARCHIVED';

-- One primary team and one backup team per member.
CREATE UNIQUE INDEX team_members_one_primary ON team_members (business_id, membership_id)
  WHERE kind = 'PRIMARY';
CREATE UNIQUE INDEX team_members_one_backup ON team_members (business_id, membership_id)
  WHERE kind = 'BACKUP';

-- ---------- Rules on change ----------
-- New places go only to ACTIVE groups: a team is created in (or moved to) an ACTIVE department,
-- and members join ACTIVE teams and departments. Existing places stay when a group is
-- deactivated or archived, so history is kept; the API warns and offers to move them. A place
-- never moves to another member or group: remove it and add a new one.
CREATE FUNCTION staff_groups_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF TG_TABLE_NAME = 'teams' THEN
    IF (TG_OP = 'INSERT' OR NEW.department_id <> OLD.department_id)
       AND NOT EXISTS (SELECT 1 FROM departments d
                       WHERE d.id = NEW.department_id AND d.status = 'ACTIVE') THEN
      RAISE EXCEPTION 'teams: a team belongs to an ACTIVE department' USING ERRCODE = 'check_violation';
    END IF;
  ELSIF TG_TABLE_NAME = 'team_members' THEN
    IF TG_OP = 'UPDATE' AND (NEW.team_id <> OLD.team_id OR NEW.membership_id <> OLD.membership_id) THEN
      RAISE EXCEPTION 'team_members: only kind can change' USING ERRCODE = 'check_violation';
    END IF;
    IF TG_OP = 'INSERT'
       AND NOT EXISTS (SELECT 1 FROM teams t WHERE t.id = NEW.team_id AND t.status = 'ACTIVE') THEN
      RAISE EXCEPTION 'team_members: members join an ACTIVE team' USING ERRCODE = 'check_violation';
    END IF;
  ELSIF TG_TABLE_NAME = 'member_departments' THEN
    IF TG_OP = 'UPDATE' THEN
      RAISE EXCEPTION 'member_departments: remove the place and add a new one'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM departments d
                   WHERE d.id = NEW.department_id AND d.status = 'ACTIVE') THEN
      RAISE EXCEPTION 'member_departments: members join an ACTIVE department'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER teams_rules BEFORE INSERT OR UPDATE ON teams
  FOR EACH ROW EXECUTE FUNCTION staff_groups_rules();
CREATE TRIGGER team_members_rules BEFORE INSERT OR UPDATE ON team_members
  FOR EACH ROW EXECUTE FUNCTION staff_groups_rules();
CREATE TRIGGER member_departments_rules BEFORE INSERT OR UPDATE ON member_departments
  FOR EACH ROW EXECUTE FUNCTION staff_groups_rules();
