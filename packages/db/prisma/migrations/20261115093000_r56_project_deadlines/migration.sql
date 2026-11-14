-- Tax Planning Review 2, approved addition "Project Deadlines" (R56; the lead's approval under
-- Rasel's db delegation, Nov 14): a staff member's own deadline (name, date and time,
-- description, service, optional client, several reminders), private to its owner or shared
-- with chosen coworkers, kept apart from the Tax Calendar (compliance_deadlines) and the Super
-- Admin's mandatory deadlines. Who sees which is the API's rule; RLS keeps each firm's rows.

-- CreateEnum
CREATE TYPE "ProjectDeadlineArea" AS ENUM ('TAX_PLANNING');

-- CreateEnum
CREATE TYPE "ProjectDeadlineVisibility" AS ENUM ('PRIVATE', 'SHARED');

-- CreateTable
CREATE TABLE "project_deadlines" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "area" "ProjectDeadlineArea" NOT NULL DEFAULT 'TAX_PLANNING',
    "name" TEXT NOT NULL,
    "due_at" TIMESTAMPTZ(3) NOT NULL,
    "description" TEXT,
    "service_id" UUID NOT NULL,
    "client_id" UUID,
    "owner_user_id" UUID NOT NULL,
    "visibility" "ProjectDeadlineVisibility" NOT NULL DEFAULT 'PRIVATE',
    "completed_at" TIMESTAMPTZ(3),
    "completed_by_user_id" UUID,
    "archived_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "project_deadlines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_deadline_shares" (
    "business_id" UUID NOT NULL,
    "deadline_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_deadline_shares_pkey" PRIMARY KEY ("business_id","deadline_id","user_id")
);

-- CreateTable
CREATE TABLE "project_deadline_reminders" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "deadline_id" UUID NOT NULL,
    "minutes_before" INTEGER NOT NULL,
    "unit" "TaskReminderUnit" NOT NULL,
    "in_app" BOOLEAN NOT NULL DEFAULT true,
    "channels" "DeliveryChannel"[] DEFAULT ARRAY[]::"DeliveryChannel"[],
    "sent_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_deadline_reminders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "project_deadlines_business_id_area_due_at_idx" ON "project_deadlines"("business_id", "area", "due_at");

-- CreateIndex
CREATE INDEX "project_deadlines_business_id_owner_user_id_due_at_idx" ON "project_deadlines"("business_id", "owner_user_id", "due_at");

-- CreateIndex
CREATE UNIQUE INDEX "project_deadlines_business_id_id_key" ON "project_deadlines"("business_id", "id");

-- CreateIndex
CREATE INDEX "project_deadline_shares_business_id_user_id_idx" ON "project_deadline_shares"("business_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "project_deadline_reminders_business_id_deadline_id_minutes__key" ON "project_deadline_reminders"("business_id", "deadline_id", "minutes_before");

-- AddForeignKey
ALTER TABLE "project_deadlines" ADD CONSTRAINT "project_deadlines_business_id_service_id_fkey" FOREIGN KEY ("business_id", "service_id") REFERENCES "services"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_deadlines" ADD CONSTRAINT "project_deadlines_business_id_client_id_fkey" FOREIGN KEY ("business_id", "client_id") REFERENCES "clients"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_deadlines" ADD CONSTRAINT "project_deadlines_business_id_owner_user_id_fkey" FOREIGN KEY ("business_id", "owner_user_id") REFERENCES "memberships"("business_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_deadlines" ADD CONSTRAINT "project_deadlines_business_id_completed_by_user_id_fkey" FOREIGN KEY ("business_id", "completed_by_user_id") REFERENCES "memberships"("business_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_deadline_shares" ADD CONSTRAINT "project_deadline_shares_business_id_deadline_id_fkey" FOREIGN KEY ("business_id", "deadline_id") REFERENCES "project_deadlines"("business_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_deadline_shares" ADD CONSTRAINT "project_deadline_shares_business_id_user_id_fkey" FOREIGN KEY ("business_id", "user_id") REFERENCES "memberships"("business_id", "user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_deadline_reminders" ADD CONSTRAINT "project_deadline_reminders_business_id_deadline_id_fkey" FOREIGN KEY ("business_id", "deadline_id") REFERENCES "project_deadlines"("business_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------- Grants and RLS ----------
-- Tax Planning Review 2 (Project Deadlines): every row is its firm's. Who sees a deadline (its
-- owner; a SHARED one also the coworkers it is shared with) is the API's rule on top.
GRANT SELECT, INSERT, UPDATE, DELETE ON project_deadlines TO firmivra_app;
ALTER TABLE project_deadlines ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_deadlines FORCE ROW LEVEL SECURITY;
CREATE POLICY project_deadlines_business ON project_deadlines
  USING (business_id = app_current_business_id())
  WITH CHECK (business_id = app_current_business_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON project_deadline_shares TO firmivra_app;
ALTER TABLE project_deadline_shares ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_deadline_shares FORCE ROW LEVEL SECURITY;
CREATE POLICY project_deadline_shares_business ON project_deadline_shares
  USING (business_id = app_current_business_id())
  WITH CHECK (business_id = app_current_business_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON project_deadline_reminders TO firmivra_app;
ALTER TABLE project_deadline_reminders ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_deadline_reminders FORCE ROW LEVEL SECURITY;
CREATE POLICY project_deadline_reminders_business ON project_deadline_reminders
  USING (business_id = app_current_business_id())
  WITH CHECK (business_id = app_current_business_id());

-- ---------- Shape ----------
-- A name with words (at most 200 characters) and an optional description (at most 4,000).
ALTER TABLE project_deadlines ADD CONSTRAINT project_deadlines_name
  CHECK (char_length(btrim(name)) >= 1 AND char_length(name) <= 200
         AND app_no_hidden_characters(name));
ALTER TABLE project_deadlines ADD CONSTRAINT project_deadlines_description
  CHECK (description IS NULL OR (char_length(btrim(description)) >= 1
         AND char_length(description) <= 4000));
-- Completed when and by whom, together or not at all.
ALTER TABLE project_deadlines ADD CONSTRAINT project_deadlines_completed_together
  CHECK ((completed_at IS NULL) = (completed_by_user_id IS NULL));
-- At the due time (0) up to a year before it.
ALTER TABLE project_deadline_reminders ADD CONSTRAINT project_deadline_reminders_minutes
  CHECK (minutes_before BETWEEN 0 AND 525600);
-- The reminder job looks only at reminders still to send.
CREATE INDEX project_deadline_reminders_unsent ON project_deadline_reminders (business_id, deadline_id)
  WHERE sent_at IS NULL;
