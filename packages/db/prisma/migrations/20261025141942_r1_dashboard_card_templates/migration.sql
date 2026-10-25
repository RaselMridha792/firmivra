-- r1_dashboard_card_templates (R1, Oct 25; Rasel's tap of Oct 25 12:48 UTC, "Approve all three",
-- 2 of 3: R55's D4 request in docs/work/R55-oct25-review.md, with Rasel's answers): the firm's
-- Dashboard service-card templates, one per slot. The three fixed cards are never rows. A card is
-- turned off with enabled = false, never deleted (no DELETE grant). A new table only.

-- CreateEnum
CREATE TYPE "DashboardCardMetric" AS ENUM ('ACTIVE_ENGAGEMENTS', 'ENGAGEMENTS_IN_STATUS', 'COMPLETED_IN_PERIOD');

-- CreateTable
CREATE TABLE "dashboard_card_templates" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "slot" SMALLINT NOT NULL,
    "service_id" UUID,
    "metric" "DashboardCardMetric" NOT NULL,
    "status_key" TEXT,
    "label" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by_user_id" UUID NOT NULL,
    "updated_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "dashboard_card_templates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "dashboard_card_templates_business_id_slot_key" ON "dashboard_card_templates"("business_id", "slot");

-- AddForeignKey
ALTER TABLE "dashboard_card_templates" ADD CONSTRAINT "dashboard_card_templates_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dashboard_card_templates" ADD CONSTRAINT "dashboard_card_templates_business_id_service_id_fkey" FOREIGN KEY ("business_id", "service_id") REFERENCES "services"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dashboard_card_templates" ADD CONSTRAINT "dashboard_card_templates_business_id_created_by_user_id_fkey" FOREIGN KEY ("business_id", "created_by_user_id") REFERENCES "memberships"("business_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dashboard_card_templates" ADD CONSTRAINT "dashboard_card_templates_business_id_updated_by_user_id_fkey" FOREIGN KEY ("business_id", "updated_by_user_id") REFERENCES "memberships"("business_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;



-- ---------- Grants, RLS ----------
GRANT SELECT, INSERT, UPDATE ON dashboard_card_templates TO firmivra_app;
ALTER TABLE dashboard_card_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE dashboard_card_templates FORCE ROW LEVEL SECURITY;
CREATE POLICY dashboard_card_templates_business ON dashboard_card_templates
  USING (business_id = app_current_business_id())
  WITH CHECK (business_id = app_current_business_id());

-- ---------- Data rules Prisma cannot express ----------
ALTER TABLE dashboard_card_templates ADD CONSTRAINT dashboard_card_templates_slot
  CHECK (slot BETWEEN 1 AND 6);
ALTER TABLE dashboard_card_templates ADD CONSTRAINT dashboard_card_templates_label
  CHECK (label = btrim(label) AND char_length(label) BETWEEN 1 AND 40);
-- The status the metric counts: none for ACTIVE_ENGAGEMENTS, required (and not blank) for the others.
ALTER TABLE dashboard_card_templates ADD CONSTRAINT dashboard_card_templates_status_key
  CHECK ((metric = 'ACTIVE_ENGAGEMENTS') = (status_key IS NULL)
         AND (status_key IS NULL OR char_length(btrim(status_key)) >= 1));
ALTER TABLE dashboard_card_templates ADD CONSTRAINT dashboard_card_templates_version_positive
  CHECK (version >= 1);
