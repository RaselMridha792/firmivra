-- r1_tax_validation_issues (R1, Oct 26; Rasel's tap for Octavia's Oct 25 reviews, 3 of 4): TX-F19
-- of the Tax Returns review (docs/specs/review-2026-10-26/CHANGE-LIST.md). A reviewer's validation
-- issue: the note, its severity (a MANUAL_WARNING never blocks), who must resolve it, the draft
-- it was found in and the review step it belongs to, both of the same return. Resolved, never
-- deleted (no DELETE grant). A new table; the checklist only gains a unique key for the link.

-- CreateEnum
CREATE TYPE "TaxIssueSeverity" AS ENUM ('ERROR', 'MANUAL_WARNING', 'INFO');

-- CreateTable
CREATE TABLE "tax_return_validation_issues" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "tax_return_id" UUID NOT NULL,
    "severity" "TaxIssueSeverity" NOT NULL,
    "note" TEXT NOT NULL,
    "responsible_user_id" UUID,
    "draft_document_id" UUID,
    "checklist_item_id" UUID,
    "created_by_user_id" UUID NOT NULL,
    "resolved_at" TIMESTAMPTZ(3),
    "resolved_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "tax_return_validation_issues_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tax_return_validation_issues_business_id_tax_return_id_reso_idx" ON "tax_return_validation_issues"("business_id", "tax_return_id", "resolved_at");

-- CreateIndex
CREATE INDEX "tax_return_validation_issues_business_id_responsible_user_i_idx" ON "tax_return_validation_issues"("business_id", "responsible_user_id", "resolved_at");

-- CreateIndex
CREATE INDEX "tax_return_validation_issues_business_id_checklist_item_id_idx" ON "tax_return_validation_issues"("business_id", "checklist_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "tax_return_checklist_items_business_id_tax_return_id_id_key" ON "tax_return_checklist_items"("business_id", "tax_return_id", "id");

-- AddForeignKey
ALTER TABLE "tax_return_validation_issues" ADD CONSTRAINT "tax_return_validation_issues_business_id_tax_return_id_fkey" FOREIGN KEY ("business_id", "tax_return_id") REFERENCES "tax_returns"("business_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_return_validation_issues" ADD CONSTRAINT "tax_return_validation_issues_business_id_responsible_user__fkey" FOREIGN KEY ("business_id", "responsible_user_id") REFERENCES "memberships"("business_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_return_validation_issues" ADD CONSTRAINT "tax_return_validation_issues_business_id_tax_return_id_dra_fkey" FOREIGN KEY ("business_id", "tax_return_id", "draft_document_id") REFERENCES "tax_return_documents"("business_id", "tax_return_id", "document_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_return_validation_issues" ADD CONSTRAINT "tax_return_validation_issues_business_id_tax_return_id_che_fkey" FOREIGN KEY ("business_id", "tax_return_id", "checklist_item_id") REFERENCES "tax_return_checklist_items"("business_id", "tax_return_id", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_return_validation_issues" ADD CONSTRAINT "tax_return_validation_issues_business_id_created_by_user_i_fkey" FOREIGN KEY ("business_id", "created_by_user_id") REFERENCES "memberships"("business_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_return_validation_issues" ADD CONSTRAINT "tax_return_validation_issues_business_id_resolved_by_user__fkey" FOREIGN KEY ("business_id", "resolved_by_user_id") REFERENCES "memberships"("business_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;




-- ---------- Access ----------
GRANT SELECT, INSERT, UPDATE ON tax_return_validation_issues TO firmivra_app;
ALTER TABLE tax_return_validation_issues ENABLE ROW LEVEL SECURITY;
ALTER TABLE tax_return_validation_issues FORCE ROW LEVEL SECURITY;
CREATE POLICY tax_return_validation_issues_business ON tax_return_validation_issues
  USING (business_id = app_current_business_id())
  WITH CHECK (business_id = app_current_business_id());

-- ---------- Data rules Prisma cannot express ----------
ALTER TABLE tax_return_validation_issues ADD CONSTRAINT tax_return_validation_issues_note
  CHECK (char_length(btrim(note)) >= 1 AND char_length(note) <= 2000);
-- Resolved says when and by whom, together, never before it was raised.
ALTER TABLE tax_return_validation_issues ADD CONSTRAINT tax_return_validation_issues_resolved
  CHECK ((resolved_at IS NULL) = (resolved_by_user_id IS NULL)
     AND (resolved_at IS NULL OR resolved_at >= created_at));

-- An issue stays with its return and keeps who raised it and when.
CREATE FUNCTION tax_return_validation_issues_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF NEW.id <> OLD.id OR NEW.business_id <> OLD.business_id OR NEW.tax_return_id <> OLD.tax_return_id
     OR NEW.created_by_user_id <> OLD.created_by_user_id OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'tax return validation issues: the return and who raised an issue cannot change'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER tax_return_validation_issues_rules
  BEFORE UPDATE ON tax_return_validation_issues
  FOR EACH ROW EXECUTE FUNCTION tax_return_validation_issues_rules();
