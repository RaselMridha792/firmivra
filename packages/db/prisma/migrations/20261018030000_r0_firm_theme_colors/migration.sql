-- Firm theme colours (Rasel, Oct 18): four optional colours next to the brand and accent colours,
-- for the sidebar, primary text, secondary text and buttons. Null means the screens derive the
-- colour from the brand colour, which is the look before these columns existed. R55 builds the
-- API and the settings screen. business_settings already has FORCE RLS (the firm's own row only)
-- and table-level grants to the app role, so the new columns need no policy or grant of their own.

-- AlterTable
ALTER TABLE "business_settings" ADD COLUMN     "button_color" TEXT,
ADD COLUMN     "sidebar_color" TEXT,
ADD COLUMN     "text_primary_color" TEXT,
ADD COLUMN     "text_secondary_color" TEXT;

-- `#rrggbb`, like brand_color and accent_color; contrast is the API's rule.
ALTER TABLE business_settings
  ADD CONSTRAINT business_settings_sidebar_color CHECK (sidebar_color ~ '^#[0-9A-Fa-f]{6}$'),
  ADD CONSTRAINT business_settings_text_primary_color CHECK (text_primary_color ~ '^#[0-9A-Fa-f]{6}$'),
  ADD CONSTRAINT business_settings_text_secondary_color CHECK (text_secondary_color ~ '^#[0-9A-Fa-f]{6}$'),
  ADD CONSTRAINT business_settings_button_color CHECK (button_color ~ '^#[0-9A-Fa-f]{6}$');
