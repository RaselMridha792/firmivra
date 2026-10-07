-- My Profile "Additional information" (Rasel, Oct 7; R10 step 4, from the client-portal mockup).
-- Step 3 is merged, so this is a follow-up migration in the open PR. The client may edit these.

-- CreateEnum
CREATE TYPE "ContactMethod" AS ENUM ('EMAIL', 'PHONE', 'TEXT');

-- AlterTable
ALTER TABLE "client_profiles" ADD COLUMN     "additional_info" TEXT,
ADD COLUMN     "preferred_contact_method" "ContactMethod",
ADD COLUMN     "referral_source" TEXT;

ALTER TABLE client_profiles ADD CONSTRAINT client_profiles_referral_source
  CHECK (btrim(referral_source) <> '' AND char_length(referral_source) <= 200);
ALTER TABLE client_profiles ADD CONSTRAINT client_profiles_additional_info
  CHECK (char_length(additional_info) <= 2000);
