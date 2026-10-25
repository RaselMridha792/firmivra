-- r1_signup_account_columns (R1, Oct 25; Rasel's tap of Oct 25 12:48 UTC, R55's "Client Sign-ups" request in
-- docs/work/R55-oct25-review.md, with Rasel's answers): the sign-up enums, and each
-- request's version, match flag, policy version and automatic flag on client_accounts. Existing rows
-- stay UNCHECKED, version 1, not automatic (no backfill; the API treats UNCHECKED on an ACTIVE
-- account as nothing to review). One busy table per migration, so none waits on another.


-- CreateEnum
CREATE TYPE "ClientSignupMode" AS ENUM ('MANUAL', 'AUTOMATIC');

-- CreateEnum
CREATE TYPE "SignupMatchStatus" AS ENUM ('UNCHECKED', 'NO_MATCH', 'POTENTIAL_MATCH', 'NOT_A_MATCH', 'LINKED', 'RESTORED');

-- CreateEnum
CREATE TYPE "SignupCandidateResolution" AS ENUM ('OPEN', 'NOT_A_MATCH', 'VERIFIED');

-- CreateEnum
CREATE TYPE "SignupContactRef" AS ENUM ('CLIENT_PHONE', 'CLIENT_EMAIL', 'CLIENT_CONTACT');

-- CreateEnum
CREATE TYPE "SignupCallOutcome" AS ENUM ('REACHED', 'NOT_REACHED');

-- CreateEnum
CREATE TYPE "SignupIdentityResult" AS ENUM ('VERIFIED', 'NOT_VERIFIED');

-- CreateEnum
CREATE TYPE "SignupPermissionScope" AS ENUM ('RESTORE_ACCESS', 'LINK_RECORD', 'BOTH');

-- CreateEnum
CREATE TYPE "SignupOperationKind" AS ENUM ('APPROVE', 'DECLINE', 'LINK_EXISTING', 'RESTORE_ACCESS', 'NOT_A_MATCH', 'KEEP_PENDING', 'INVITE_DELIVERY', 'RECOVERY_DELIVERY', 'POLICY_CHANGE');

-- CreateEnum
CREATE TYPE "SignupOperationStatus" AS ENUM ('COMMITTED', 'PENDING', 'SUCCEEDED', 'FAILED');

-- AlterTable
ALTER TABLE "client_accounts" ADD COLUMN     "decided_automatically" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "decision_policy_version" INTEGER,
ADD COLUMN     "match_checked_at" TIMESTAMPTZ(3),
ADD COLUMN     "match_status" "SignupMatchStatus" NOT NULL DEFAULT 'UNCHECKED',
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- ---------- Data rules Prisma cannot express ----------
ALTER TABLE client_accounts ADD CONSTRAINT client_accounts_version_positive CHECK (version >= 1);
ALTER TABLE client_accounts ADD CONSTRAINT client_accounts_decision_policy_version_positive
  CHECK (decision_policy_version IS NULL OR decision_policy_version >= 1);
