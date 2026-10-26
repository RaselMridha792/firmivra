-- r1_signup_policy (R1, Oct 25; Rasel's tap of Oct 25 12:48 UTC, R55's "Client Sign-ups" request in
-- docs/work/R55-oct25-review.md, with Rasel's answers): the firm's sign-up approval
-- mode on business_settings, versioned: each change raises the version, and who changed it last is
-- a member of the firm. Existing firms stay MANUAL, version 1.


-- AlterTable
ALTER TABLE "business_settings" ADD COLUMN     "client_signup_mode" "ClientSignupMode" NOT NULL DEFAULT 'MANUAL',
ADD COLUMN     "client_signup_policy_changed_at" TIMESTAMPTZ(3),
ADD COLUMN     "client_signup_policy_changed_by_user_id" UUID,
ADD COLUMN     "client_signup_policy_version" INTEGER NOT NULL DEFAULT 1;

-- AddForeignKey
ALTER TABLE "business_settings" ADD CONSTRAINT "business_settings_business_id_client_signup_policy_changed_fkey" FOREIGN KEY ("business_id", "client_signup_policy_changed_by_user_id") REFERENCES "memberships"("business_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------- Data rules Prisma cannot express ----------
ALTER TABLE business_settings ADD CONSTRAINT business_settings_client_signup_policy_version_positive
  CHECK (client_signup_policy_version >= 1);
