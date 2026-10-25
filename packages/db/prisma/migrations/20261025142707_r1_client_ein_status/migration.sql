-- r1_client_ein_status (R1, Oct 25; Rasel's tap of Oct 25 12:48 UTC, "Approve all three", 3 of 3:
-- R56's B15 request in docs/work/R56-super-admin-api.md, with Rasel's answers): a business
-- client's EIN status on client_profiles, apart from the sealed number, so a status is never saved
-- as an EIN. A number only with HAS_EIN; rows that have a number and no status yet stay valid, so
-- nothing is backfilled. The number stays sealed with the firm's key.

-- CreateEnum
CREATE TYPE "EinStatus" AS ENUM ('HAS_EIN', 'NOT_APPLICABLE', 'TO_BE_APPLIED_FOR');

-- AlterTable
ALTER TABLE "client_profiles" ADD COLUMN     "ein_status" "EinStatus";



-- ---------- Data rules Prisma cannot express ----------
ALTER TABLE client_profiles ADD CONSTRAINT client_profiles_ein_only_with_has_ein
  CHECK (ein_enc IS NULL OR ein_status IS NULL OR ein_status = 'HAS_EIN');
