-- Duplicate client email (Rasel, Oct 7): one email per firm, archived clients included, so a firm
-- restores the old record instead of making a second one. Emails are already lower-case (CHECK),
-- so this is case-insensitive. The API checks first and turns a unique violation into the same
-- 409 DUPLICATE_EMAIL. Clients without an email are not affected.

-- DropIndex
DROP INDEX "clients_business_id_email_idx";

-- CreateIndex
CREATE UNIQUE INDEX "clients_business_id_email_key" ON "clients"("business_id", "email");
