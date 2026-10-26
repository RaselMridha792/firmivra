-- r1_tax_filing_details (R1, Oct 26; Rasel's tap for Octavia's Oct 25 reviews, 2 of 4, first of two
-- migrations): TX-F26 and the manual amounts of the Tax Returns review
-- (docs/specs/review-2026-10-26/CHANGE-LIST.md). Per jurisdiction: the mail tracking number of a
-- paper filing, and where the refund or amount due came from with its version. No backfill: rows
-- from before keep their amounts with neither. Requiring the tracking number before a paper filing
-- is logged as mailed is the API's rule (today's Mark Paper Filed has no such field yet).

-- CreateEnum
CREATE TYPE "TaxAmountSource" AS ENUM ('TAX_SOFTWARE', 'AGENCY_NOTICE', 'STAFF_ESTIMATE');

-- AlterTable
ALTER TABLE "tax_return_filings" ADD COLUMN     "amount_source" "TaxAmountSource",
ADD COLUMN     "amount_version" INTEGER,
ADD COLUMN     "mail_tracking_number" TEXT;



-- ---------- Data rules Prisma cannot express ----------
-- A tracking number is one line of up to 100 characters, and only a paper filing has one.
ALTER TABLE tax_return_filings ADD CONSTRAINT tax_return_filings_mail_tracking
  CHECK (mail_tracking_number IS NULL
      OR (filing_method = 'PAPER' AND char_length(btrim(mail_tracking_number)) >= 1
          AND char_length(mail_tracking_number) <= 100 AND mail_tracking_number !~ '[\r\n]'));
-- The source and the version are set together, only with an amount; versions start at 1.
ALTER TABLE tax_return_filings ADD CONSTRAINT tax_return_filings_amount_source
  CHECK ((amount_source IS NULL) = (amount_version IS NULL)
     AND (amount_version IS NULL OR amount_version >= 1)
     AND (amount_source IS NULL OR amount_status IS NOT NULL));
