-- r1_recurring_custom_interval (R1, Oct 28; Rasel's tap of Oct 28 12:07:10Z): a CUSTOM recurring
-- invoice keeps its interval, every interval_count (1 to 52) weeks, months or years. Both are set
-- exactly when the frequency is CUSTOM. CUSTOM is a recurring invoice's own: never a service's
-- billing frequency. Same RLS as recurring_invoices (columns on that table). No backfill.

-- CreateEnum
CREATE TYPE "RecurringIntervalUnit" AS ENUM ('WEEK', 'MONTH', 'YEAR');

-- AlterTable
ALTER TABLE "recurring_invoices" ADD COLUMN     "interval_count" SMALLINT,
ADD COLUMN     "interval_unit" "RecurringIntervalUnit";

-- ---------- Data rules Prisma cannot express ----------

ALTER TABLE recurring_invoices ADD CONSTRAINT recurring_invoices_custom_interval
  CHECK (CASE WHEN frequency = 'CUSTOM'
              THEN interval_count IS NOT NULL AND interval_unit IS NOT NULL AND interval_count BETWEEN 1 AND 52
              ELSE interval_count IS NULL AND interval_unit IS NULL END);

ALTER TABLE services ADD CONSTRAINT services_billing_frequency_not_custom
  CHECK (billing_frequency IS DISTINCT FROM 'CUSTOM');
