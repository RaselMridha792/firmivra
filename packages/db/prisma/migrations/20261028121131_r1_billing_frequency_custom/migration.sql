-- r1_billing_frequency_custom (R1, Oct 28; Rasel's tap of Oct 28 12:07:10Z): IP-F05, a recurring
-- invoice that repeats every N weeks, months or years (docs/specs/review-2026-10-27/CHANGE-LIST.md).
-- The new value only: Postgres can't use an enum value in the transaction that adds it, so the
-- columns and the rules that name CUSTOM are the next migration, r1_recurring_custom_interval.

-- AlterEnum
ALTER TYPE "BillingFrequency" ADD VALUE 'CUSTOM';
