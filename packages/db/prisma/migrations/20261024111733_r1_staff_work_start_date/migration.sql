-- r1_staff_work_start_date (R1, Oct 24; Rasel's block, R60's "Column request for R1", request
-- 10, Staff Management SM11): staff_profiles.work_start_date, the day the person starts work,
-- apart from hire_date and the account's access start (access_starts_on). Create Staff step 4 and
-- Edit Staff show it. Safe on dev: a nullable column with no default (no rewrite); only
-- staff_profiles is touched.

-- AlterTable
ALTER TABLE "staff_profiles" ADD COLUMN     "work_start_date" DATE;
