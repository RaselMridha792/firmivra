-- R1 (Rasel's card "Approve all four", Oct 29 11:19:57Z, last of four; Octavia's Templates review
-- TP-F08): the five structured kinds keep a real structure, not only body text.
-- - TASK, DOCUMENT_REQUEST and INTAKE_ORGANIZER link the template their module already has
--   (task_templates: checklist, due offset, assignee rule; document_request_templates and their
--   items: the requested-document list; intake_templates and their published intake_forms: the
--   organizer fields). Composite foreign keys (restrict), each at most one library row per firm.
-- - TAX_WORKFLOW and BOOKKEEPING have no such table: `structure` holds theirs as a JSON object
--   (tax checklist sections and items; bookkeeping document requests, close checklist and client
--   updates), shape checked by the API (zod in packages/types).
-- - message_template_versions.structure keeps the structure each save had.
-- No backfill: existing rows keep NULL links and structure (body text stays valid). The tables
-- keep their policies and grants (table-wide, so they cover the new columns).
-- Safe on dev: the ADD COLUMNs change only the catalog (nullable, no default); the unique indexes
-- and the check read message_templates once while it is locked; the foreign keys take short locks
-- on task_templates, document_request_templates and intake_templates.

-- AlterTable
ALTER TABLE "message_templates" ADD COLUMN     "document_request_template_id" UUID,
ADD COLUMN     "intake_template_id" UUID,
ADD COLUMN     "structure" JSONB,
ADD COLUMN     "task_template_id" UUID;

-- AlterTable
ALTER TABLE "message_template_versions" ADD COLUMN     "structure" JSONB;

-- CreateIndex
CREATE UNIQUE INDEX "message_templates_business_id_task_template_id_key" ON "message_templates"("business_id", "task_template_id");

-- CreateIndex
CREATE UNIQUE INDEX "message_templates_business_id_document_request_template_id_key" ON "message_templates"("business_id", "document_request_template_id");

-- CreateIndex
CREATE UNIQUE INDEX "message_templates_business_id_intake_template_id_key" ON "message_templates"("business_id", "intake_template_id");

-- AddForeignKey
ALTER TABLE "message_templates" ADD CONSTRAINT "message_templates_business_id_task_template_id_fkey" FOREIGN KEY ("business_id", "task_template_id") REFERENCES "task_templates"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_templates" ADD CONSTRAINT "message_templates_business_id_document_request_template_id_fkey" FOREIGN KEY ("business_id", "document_request_template_id") REFERENCES "document_request_templates"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_templates" ADD CONSTRAINT "message_templates_business_id_intake_template_id_fkey" FOREIGN KEY ("business_id", "intake_template_id") REFERENCES "intake_templates"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------- Data rules Prisma cannot express ----------
-- Each link only on its own kind, and a structure only on the two kinds without a module table.
ALTER TABLE message_templates ADD CONSTRAINT message_templates_structure_by_kind
  CHECK ((task_template_id IS NULL OR kind = 'TASK')
     AND (document_request_template_id IS NULL OR kind = 'DOCUMENT_REQUEST')
     AND (intake_template_id IS NULL OR kind = 'INTAKE_ORGANIZER')
     AND (structure IS NULL
          OR (kind IN ('TAX_WORKFLOW', 'BOOKKEEPING') AND jsonb_typeof(structure) = 'object')));
-- A saved structure is an object, as on the template.
ALTER TABLE message_template_versions ADD CONSTRAINT message_template_versions_structure
  CHECK (structure IS NULL OR jsonb_typeof(structure) = 'object');
