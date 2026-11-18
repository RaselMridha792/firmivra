-- r1_portal_review1 (R1, Client Portal Review One; Rasel's approval of Nov 18 in R1's window, one
-- db-only PR merged on its own). Additive only: new enums, enum values, columns with defaults and
-- two tables. No existing row is rewritten (every new column is null or takes its default).
--   CP-1g  business_settings.portal_sign_in_label / portal_sign_up_label: the landing page's
--          button text (null: the default words).
--   CP-3c  client_portal_settings.announcements_enabled: the firm's announcements in the portal.
--   CP-3d  NotificationCategory ANNOUNCEMENTS; client_portal_settings.announcement_email_policy /
--          announcement_sms_policy (PortalChannelPolicy); SMS is never REQUIRED (consent).
--   CP-3i  client_portal_settings.announcements_on_dashboard.
--   CP-5a  PortalModule BUSINESS_RESOURCES (Business Documents & Resources).
--   CP-5b-d portal_tabs: built-in tabs' labels and order, and custom tabs (archived, never deleted);
--          documents.portal_tab_id: a file uploaded through a custom tab keeps the tab.
--   CP-5e  portal_tab_targets: one tag or one client per row.
--   B10    AdvisoryPlanStatus AWAITING_CLIENT_APPROVAL; advisory_plans.client_approved_at /
--          _by_user_id / _version (all or none).
-- A value added to an enum here is never used in this file (PostgreSQL forbids that in the same
-- transaction): the module CHECK below compares text.

-- CreateEnum
CREATE TYPE "PortalChannelPolicy" AS ENUM ('CLIENT_CHOICE', 'REQUIRED', 'OFF');

-- CreateEnum
CREATE TYPE "PortalTabKind" AS ENUM ('BUILT_IN', 'CUSTOM');

-- CreateEnum
CREATE TYPE "PortalTabAudience" AS ENUM ('ALL', 'TAGS', 'CLIENTS');

-- AlterEnum
ALTER TYPE "NotificationCategory" ADD VALUE 'ANNOUNCEMENTS';

-- AlterEnum
ALTER TYPE "PortalModule" ADD VALUE 'BUSINESS_RESOURCES';

-- AlterEnum
ALTER TYPE "AdvisoryPlanStatus" ADD VALUE 'AWAITING_CLIENT_APPROVAL';

-- AlterTable
ALTER TABLE "business_settings" ADD COLUMN     "portal_sign_in_label" TEXT,
ADD COLUMN     "portal_sign_up_label" TEXT;

-- AlterTable
ALTER TABLE "documents" ADD COLUMN     "portal_tab_id" UUID;

-- AlterTable
ALTER TABLE "advisory_plans" ADD COLUMN     "client_approved_at" TIMESTAMPTZ(3),
ADD COLUMN     "client_approved_by_user_id" UUID,
ADD COLUMN     "client_approved_version" INTEGER;

-- AlterTable
ALTER TABLE "client_portal_settings" ADD COLUMN     "announcement_email_policy" "PortalChannelPolicy" NOT NULL DEFAULT 'CLIENT_CHOICE',
ADD COLUMN     "announcement_sms_policy" "PortalChannelPolicy" NOT NULL DEFAULT 'CLIENT_CHOICE',
ADD COLUMN     "announcements_enabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "announcements_on_dashboard" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "portal_tabs" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "kind" "PortalTabKind" NOT NULL,
    "module" "PortalModule" NOT NULL,
    "label" TEXT,
    "sort_order" INTEGER NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "audience" "PortalTabAudience" NOT NULL DEFAULT 'ALL',
    "archived_at" TIMESTAMPTZ(3),
    "updated_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "portal_tabs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "portal_tab_targets" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "portal_tab_id" UUID NOT NULL,
    "client_id" UUID,
    "tag_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "portal_tab_targets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "portal_tabs_business_id_sort_order_idx" ON "portal_tabs"("business_id", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "portal_tabs_business_id_id_key" ON "portal_tabs"("business_id", "id");

-- CreateIndex
CREATE INDEX "portal_tab_targets_business_id_portal_tab_id_idx" ON "portal_tab_targets"("business_id", "portal_tab_id");

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_business_id_portal_tab_id_fkey" FOREIGN KEY ("business_id", "portal_tab_id") REFERENCES "portal_tabs"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_tabs" ADD CONSTRAINT "portal_tabs_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_tabs" ADD CONSTRAINT "portal_tabs_business_id_updated_by_user_id_fkey" FOREIGN KEY ("business_id", "updated_by_user_id") REFERENCES "memberships"("business_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_tab_targets" ADD CONSTRAINT "portal_tab_targets_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_tab_targets" ADD CONSTRAINT "portal_tab_targets_business_id_portal_tab_id_fkey" FOREIGN KEY ("business_id", "portal_tab_id") REFERENCES "portal_tabs"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_tab_targets" ADD CONSTRAINT "portal_tab_targets_business_id_client_id_fkey" FOREIGN KEY ("business_id", "client_id") REFERENCES "clients"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_tab_targets" ADD CONSTRAINT "portal_tab_targets_business_id_tag_id_fkey" FOREIGN KEY ("business_id", "tag_id") REFERENCES "tags"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "advisory_plans" ADD CONSTRAINT "advisory_plans_client_approved_by_user_id_fkey" FOREIGN KEY ("client_approved_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- CreateIndex
CREATE INDEX "documents_business_id_portal_tab_id_idx" ON "documents"("business_id", "portal_tab_id");

-- ---------- Grants and RLS ----------
-- Every row is its firm's. Tabs are archived, never deleted (no DELETE); a custom tab's targets
-- are replaced when its audience changes (DELETE, no UPDATE).
GRANT SELECT, INSERT, UPDATE ON portal_tabs TO firmivra_app;
ALTER TABLE portal_tabs ENABLE ROW LEVEL SECURITY;
ALTER TABLE portal_tabs FORCE ROW LEVEL SECURITY;
CREATE POLICY portal_tabs_business ON portal_tabs
  USING (business_id = app_current_business_id())
  WITH CHECK (business_id = app_current_business_id());

GRANT SELECT, INSERT, DELETE ON portal_tab_targets TO firmivra_app;
ALTER TABLE portal_tab_targets ENABLE ROW LEVEL SECURITY;
ALTER TABLE portal_tab_targets FORCE ROW LEVEL SECURITY;
CREATE POLICY portal_tab_targets_business ON portal_tab_targets
  USING (business_id = app_current_business_id())
  WITH CHECK (business_id = app_current_business_id());

-- ---------- Shape ----------
-- CP-1g: button text is one short line, or null for the default.
ALTER TABLE business_settings ADD CONSTRAINT business_settings_portal_button_labels
  CHECK ((portal_sign_in_label IS NULL OR (char_length(btrim(portal_sign_in_label)) BETWEEN 1 AND 30
          AND app_no_hidden_characters(portal_sign_in_label)))
     AND (portal_sign_up_label IS NULL OR (char_length(btrim(portal_sign_up_label)) BETWEEN 1 AND 30
          AND app_no_hidden_characters(portal_sign_up_label))));

-- CP-3d: texts need the client's consent, so a firm can never make them required.
ALTER TABLE client_portal_settings ADD CONSTRAINT client_portal_settings_sms_never_required
  CHECK (announcement_sms_policy <> 'REQUIRED');

-- CP-5b to CP-5d: a label is one line of 1 to 40 characters; positions are small.
ALTER TABLE portal_tabs ADD CONSTRAINT portal_tabs_label
  CHECK (label IS NULL OR (char_length(btrim(label)) BETWEEN 1 AND 40
         AND app_no_hidden_characters(label)));
ALTER TABLE portal_tabs ADD CONSTRAINT portal_tabs_sort_order CHECK (sort_order BETWEEN 0 AND 999);
-- A custom tab has its own label and reuses document upload or business resources.
ALTER TABLE portal_tabs ADD CONSTRAINT portal_tabs_custom
  CHECK (kind = 'BUILT_IN' OR (label IS NOT NULL AND module::text IN ('DOCUMENTS', 'BUSINESS_RESOURCES')));
-- A built-in tab's row is only its label and position: its on/off stays in
-- portal_module_visibility, every client may see it, and it is never archived.
ALTER TABLE portal_tabs ADD CONSTRAINT portal_tabs_built_in
  CHECK (kind = 'CUSTOM' OR (audience = 'ALL' AND enabled AND archived_at IS NULL));
-- One row per built-in tab; labels unique among the firm's live tabs, ignoring case.
CREATE UNIQUE INDEX portal_tabs_built_in_once ON portal_tabs (business_id, module)
  WHERE kind = 'BUILT_IN';
CREATE UNIQUE INDEX portal_tabs_live_label ON portal_tabs (business_id, lower(btrim(label)))
  WHERE archived_at IS NULL AND label IS NOT NULL;

-- CP-5e: one tag or one client per row, each once per tab.
ALTER TABLE portal_tab_targets ADD CONSTRAINT portal_tab_targets_one
  CHECK (num_nonnulls(client_id, tag_id) = 1);
CREATE UNIQUE INDEX portal_tab_targets_client_once ON portal_tab_targets (portal_tab_id, client_id)
  WHERE client_id IS NOT NULL;
CREATE UNIQUE INDEX portal_tab_targets_tag_once ON portal_tab_targets (portal_tab_id, tag_id)
  WHERE tag_id IS NOT NULL;

-- B10: the client's approval is all three facts or none, of a real version.
ALTER TABLE advisory_plans ADD CONSTRAINT advisory_plans_client_approval
  CHECK ((client_approved_at IS NULL) = (client_approved_by_user_id IS NULL)
     AND (client_approved_at IS NULL) = (client_approved_version IS NULL)
     AND (client_approved_version IS NULL OR client_approved_version >= 1));
