-- Step 10 follow-up (Rasel, Oct 6): the icon on each external link card (External Links mockup).

-- AlterTable
ALTER TABLE "content_items" ADD COLUMN     "icon_key" TEXT;

-- A design-system icon name, never a URL (no arbitrary remote images).
ALTER TABLE content_items ADD CONSTRAINT content_items_icon_key
  CHECK (icon_key ~ '^[a-z0-9][a-z0-9_-]{0,63}$');
