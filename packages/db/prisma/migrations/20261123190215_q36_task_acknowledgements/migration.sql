-- CreateTable
CREATE TABLE "task_acknowledgements" (
    "business_id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "assignee_user_id" UUID NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "due_at" TIMESTAMPTZ(3),
    "acknowledged_at" TIMESTAMPTZ(3),
    "acknowledged_by_user_id" UUID,
    "reminder_sent_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "task_acknowledgements_pkey" PRIMARY KEY ("business_id","task_id","assignee_user_id")
);

-- CreateIndex
CREATE INDEX "task_acknowledgements_business_id_assignee_user_id_acknowle_idx" ON "task_acknowledgements"("business_id", "assignee_user_id", "acknowledged_at");

-- CreateIndex
CREATE INDEX "task_acknowledgements_business_id_required_due_at_reminder__idx" ON "task_acknowledgements"("business_id", "required", "due_at", "reminder_sent_at");

-- AddForeignKey
ALTER TABLE "task_acknowledgements" ADD CONSTRAINT "task_acknowledgements_business_id_task_id_fkey" FOREIGN KEY ("business_id", "task_id") REFERENCES "tasks"("business_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_acknowledgements" ADD CONSTRAINT "task_acknowledgements_business_id_assignee_user_id_fkey" FOREIGN KEY ("business_id", "assignee_user_id") REFERENCES "memberships"("business_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_acknowledgements" ADD CONSTRAINT "task_acknowledgements_business_id_acknowledged_by_user_id_fkey" FOREIGN KEY ("business_id", "acknowledged_by_user_id") REFERENCES "memberships"("business_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Required acknowledgements have a deadline. Older tasks have no required acknowledgement state.
ALTER TABLE task_acknowledgements
  ADD CONSTRAINT task_acknowledgements_required_state CHECK (
    (required AND due_at IS NOT NULL)
    OR (NOT required AND due_at IS NULL AND acknowledged_at IS NULL
        AND acknowledged_by_user_id IS NULL AND reminder_sent_at IS NULL)
  ),
  ADD CONSTRAINT task_acknowledgements_recorder_pair CHECK (
    (acknowledged_at IS NULL) = (acknowledged_by_user_id IS NULL)
  ),
  ADD CONSTRAINT task_acknowledgements_reminder_due CHECK (
    reminder_sent_at IS NULL OR reminder_sent_at >= due_at
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON task_acknowledgements TO firmivra_app;

ALTER TABLE task_acknowledgements ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_acknowledgements FORCE ROW LEVEL SECURITY;
CREATE POLICY task_acknowledgements_business ON task_acknowledgements
  USING (business_id = app_current_business_id())
  WITH CHECK (business_id = app_current_business_id());
