-- R33 (Rasel, Oct 14): a second logo for light backgrounds (footer, portal, emails) and the two
-- lines under the firm sidebar. logo_key stays the logo for dark backgrounds (the sidebar).
-- The table's RLS policies and table-level grants already cover new columns.

-- AlterTable
ALTER TABLE "business_settings" ADD COLUMN     "logo_light_key" TEXT,
ADD COLUMN     "sidebar_slogan" TEXT,
ADD COLUMN     "sidebar_motto" TEXT;

-- Plain text, short: the API validates the same limit; the database refuses anything longer.
ALTER TABLE business_settings ADD CONSTRAINT business_settings_sidebar_slogan
  CHECK (char_length(sidebar_slogan) <= 80);
ALTER TABLE business_settings ADD CONSTRAINT business_settings_sidebar_motto
  CHECK (char_length(sidebar_motto) <= 80);
