-- AlterTable
ALTER TABLE "message_settings" ADD COLUMN     "client_email_includes_body" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "client_email_includes_documents" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "client_email_notice" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "messages" ADD COLUMN     "email_includes_body" BOOLEAN,
ADD COLUMN     "email_includes_documents" BOOLEAN,
ADD COLUMN     "email_notice" BOOLEAN;

-- CreateTable
CREATE TABLE "client_message_preferences" (
    "business_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "email_notice" BOOLEAN,
    "email_includes_body" BOOLEAN,
    "email_includes_documents" BOOLEAN,
    "updated_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "client_message_preferences_pkey" PRIMARY KEY ("business_id","client_id")
);

-- AddForeignKey
ALTER TABLE "client_message_preferences" ADD CONSTRAINT "client_message_preferences_business_id_client_id_fkey" FOREIGN KEY ("business_id", "client_id") REFERENCES "clients"("business_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_message_preferences" ADD CONSTRAINT "client_message_preferences_business_id_updated_by_user_id_fkey" FOREIGN KEY ("business_id", "updated_by_user_id") REFERENCES "memberships"("business_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------- Tax Returns Review 2 (Messaging): who may read and write ----------
GRANT SELECT, INSERT, UPDATE, DELETE ON client_message_preferences TO firmivra_app;
ALTER TABLE client_message_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_message_preferences FORCE ROW LEVEL SECURITY;
CREATE POLICY client_message_preferences_business ON client_message_preferences
  USING (business_id = app_current_business_id())
  WITH CHECK (business_id = app_current_business_id());

-- ---------- Shape ----------
-- The email's extras need the email: no message text or documents in an email that is not sent.
ALTER TABLE message_settings ADD CONSTRAINT message_settings_client_email_extras
  CHECK (client_email_notice
         OR (NOT client_email_includes_body AND NOT client_email_includes_documents));
ALTER TABLE client_message_preferences ADD CONSTRAINT client_message_preferences_email_extras
  CHECK (email_notice IS NOT FALSE
         OR (email_includes_body IS NOT TRUE AND email_includes_documents IS NOT TRUE));
-- Only a firm-to-client message has the choices it was sent with; when it does, all three are set,
-- and neither extra without the email.
ALTER TABLE messages ADD CONSTRAINT messages_email_choices
  CHECK (
    (direction = 'FIRM_TO_CLIENT'
       OR (email_notice IS NULL AND email_includes_body IS NULL AND email_includes_documents IS NULL))
    AND ((email_notice IS NULL) = (email_includes_body IS NULL)
         AND (email_notice IS NULL) = (email_includes_documents IS NULL))
    AND (email_notice IS NOT FALSE OR (NOT email_includes_body AND NOT email_includes_documents))
  );
