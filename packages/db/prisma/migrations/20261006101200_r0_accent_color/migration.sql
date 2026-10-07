-- Step 2 follow-up (Rasel, Oct 6): an optional second portal colour next to the brand colour.
-- The API (R3) sends its default when it is empty.

-- AlterTable
ALTER TABLE "business_settings" ADD COLUMN     "accent_color" TEXT;

ALTER TABLE business_settings ADD CONSTRAINT business_settings_accent_color
  CHECK (accent_color ~ '^#[0-9A-Fa-f]{6}$');
