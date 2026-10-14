-- R38 (Rasel, Oct 14), Tasks module, part 2: a task's checklist, reminder rules and attached
-- documents (Create/Edit Task form sections 5 to 8). A required checklist item must be done
-- before the task can be completed. An attachment is one of the task client's documents, and is
-- shown to the client only when approved separately and never when the document is INTERNAL.
-- Deleting a document removes its attachment rows.

-- CreateTable
CREATE TABLE "task_checklist_items" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "completed_at" TIMESTAMPTZ(3),
    "completed_by_user_id" UUID,
    "assigned_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "task_checklist_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_reminders" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "days_before" INTEGER NOT NULL,
    "time_of_day" TIME(0),
    "in_app" BOOLEAN NOT NULL DEFAULT true,
    "channels" "DeliveryChannel"[] DEFAULT ARRAY[]::"DeliveryChannel"[],
    "last_fired_for" DATE,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "task_reminders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_attachments" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "client_visible" BOOLEAN NOT NULL DEFAULT false,
    "added_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "task_checklist_items_business_id_task_id_position_idx" ON "task_checklist_items"("business_id", "task_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "task_reminders_business_id_task_id_days_before_time_of_day_key" ON "task_reminders"("business_id", "task_id", "days_before", "time_of_day");

-- CreateIndex
CREATE INDEX "task_attachments_business_id_document_id_idx" ON "task_attachments"("business_id", "document_id");

-- CreateIndex
CREATE UNIQUE INDEX "task_attachments_business_id_task_id_document_id_key" ON "task_attachments"("business_id", "task_id", "document_id");

-- AddForeignKey
ALTER TABLE "task_checklist_items" ADD CONSTRAINT "task_checklist_items_business_id_task_id_fkey" FOREIGN KEY ("business_id", "task_id") REFERENCES "tasks"("business_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_checklist_items" ADD CONSTRAINT "task_checklist_items_business_id_assigned_user_id_fkey" FOREIGN KEY ("business_id", "assigned_user_id") REFERENCES "memberships"("business_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_reminders" ADD CONSTRAINT "task_reminders_business_id_task_id_fkey" FOREIGN KEY ("business_id", "task_id") REFERENCES "tasks"("business_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_attachments" ADD CONSTRAINT "task_attachments_business_id_task_id_fkey" FOREIGN KEY ("business_id", "task_id") REFERENCES "tasks"("business_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_attachments" ADD CONSTRAINT "task_attachments_business_id_document_id_fkey" FOREIGN KEY ("business_id", "document_id") REFERENCES "documents"("business_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ---------- Grants, RLS, policy ----------
GRANT SELECT, INSERT, UPDATE, DELETE ON task_checklist_items, task_reminders, task_attachments
  TO firmivra_app;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['task_checklist_items', 'task_reminders', 'task_attachments'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I ON %I USING (business_id = app_current_business_id())'
                   ' WITH CHECK (business_id = app_current_business_id())', t || '_business', t);
  END LOOP;
END
$$;

-- ---------- Shape ----------
ALTER TABLE task_checklist_items ADD CONSTRAINT task_checklist_items_shape
  CHECK (btrim(label) <> '' AND char_length(label) <= 300 AND position >= 0
         AND (completed_by_user_id IS NULL OR completed_at IS NOT NULL));
ALTER TABLE task_reminders ADD CONSTRAINT task_reminders_shape
  CHECK (days_before BETWEEN 0 AND 365 AND cardinality(channels) <= 2
         AND (in_app OR cardinality(channels) > 0));

-- ---------- A required checklist item must be done before the task ----------
CREATE FUNCTION tasks_required_items_done() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM task_checklist_items i
              WHERE i.business_id = NEW.business_id AND i.task_id = NEW.id
                AND i.required AND i.completed_at IS NULL) THEN
    RAISE EXCEPTION 'tasks: complete the required checklist items first'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER tasks_required_items_done
  BEFORE UPDATE OF status ON tasks
  FOR EACH ROW WHEN (NEW.status = 'DONE' AND OLD.status IS DISTINCT FROM 'DONE')
  EXECUTE FUNCTION tasks_required_items_done();

-- ---------- An attachment is the task client's document, never shown if INTERNAL ----------
CREATE FUNCTION task_attachments_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.task_id <> OLD.task_id OR NEW.document_id <> OLD.document_id) THEN
    RAISE EXCEPTION 'task attachments: an attachment cannot move to another task or document'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM tasks t JOIN documents d
                   ON d.business_id = t.business_id AND d.client_id = t.client_id
                  WHERE t.business_id = NEW.business_id AND t.id = NEW.task_id
                    AND d.id = NEW.document_id
                    AND (NOT NEW.client_visible OR d.direction <> 'INTERNAL')) THEN
    RAISE EXCEPTION 'task attachments: only one of the task client''s documents, and an internal one is never client-visible'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER task_attachments_rules BEFORE INSERT OR UPDATE ON task_attachments
  FOR EACH ROW EXECUTE FUNCTION task_attachments_rules();
