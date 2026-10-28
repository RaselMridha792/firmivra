-- r1_payment_custom_terms (R1, Oct 28; Rasel's tap of Oct 28 12:07:10Z, the second of two): IP-F02
-- and IP-F13, the firm's own list of payment terms beside the standard ones. Each is a number of
-- days, 1 to 365, at most 12; its terms code is `net_<days>` (the codes invoices, recurring invoices
-- and default_terms already accept). Empty by default. Same RLS as payment_settings (a column on
-- that table). No backfill.

-- AlterTable
ALTER TABLE "payment_settings" ADD COLUMN     "custom_term_days" INTEGER[] DEFAULT ARRAY[]::INTEGER[];

-- ---------- Data rules Prisma cannot express ----------

-- Prisma keeps list columns nullable, so the check also refuses NULL: always a list (maybe empty),
-- one dimension, no NULL element, each 1 to 365, at most 12.
ALTER TABLE payment_settings ADD CONSTRAINT payment_settings_custom_term_days
  CHECK (custom_term_days IS NOT NULL
         AND coalesce(array_ndims(custom_term_days), 1) = 1
         AND cardinality(custom_term_days) <= 12
         AND array_position(custom_term_days, NULL) IS NULL
         AND 1 <= ALL (custom_term_days) AND 365 >= ALL (custom_term_days));
