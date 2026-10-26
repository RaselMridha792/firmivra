-- r1_engagement_catalog_service (R1, Oct 26; Rasel's word: "the SH9 column"): R56's SH9 request
-- (docs/specs/review-2026-10-26/CHANGE-LIST.md: the Plan / Service dropdown from Services & Pricing
-- by stable id). A client's plan was kept only as text (engagements.package), so renaming the
-- catalog service broke the match. engagements.catalog_service_id links the firm's own catalog
-- service (the composite key keeps it in the firm); package keeps the saved name. The plan
-- endpoints set it; nothing here charges or invoices. No backfill.


-- AlterTable
ALTER TABLE "engagements" ADD COLUMN     "catalog_service_id" UUID;

-- CreateIndex
CREATE INDEX "engagements_business_id_catalog_service_id_idx" ON "engagements"("business_id", "catalog_service_id");

-- AddForeignKey
ALTER TABLE "engagements" ADD CONSTRAINT "engagements_business_id_catalog_service_id_fkey" FOREIGN KEY ("business_id", "catalog_service_id") REFERENCES "services"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

