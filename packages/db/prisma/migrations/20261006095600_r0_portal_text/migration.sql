-- Step 2 follow-up (Rasel, Oct 6; PROJECT-DRAFT-v2.md line 108): the setup wizard's client portal
-- step. Null portal name means the firm's name.

-- AlterTable
ALTER TABLE "business_settings" ADD COLUMN     "portal_header" TEXT,
ADD COLUMN     "portal_name" TEXT,
ADD COLUMN     "welcome_message" TEXT;

ALTER TABLE business_settings ADD CONSTRAINT business_settings_portal_text
  CHECK (length(portal_name) BETWEEN 1 AND 120 AND btrim(portal_name) <> ''
         AND length(portal_header) <= 200 AND length(welcome_message) <= 2000);
