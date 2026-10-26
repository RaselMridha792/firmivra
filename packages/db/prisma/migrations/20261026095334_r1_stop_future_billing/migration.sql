-- r1_stop_future_billing (R1, Oct 26; Rasel's tap for Octavia's Oct 25 reviews, 1 of 4: SH10 and
-- PY-F13 in docs/specs/review-2026-10-26/CHANGE-LIST.md): Stop Future Billing on a client's
-- service, separate from pausing it. The stop date defaults to the next billing date in the API
-- (a custom date is allowed); it is set exactly when the flag is on. Existing services stay
-- billing as before (false, no date). The billing job reads it; nothing here bills or refunds.

-- AlterTable
ALTER TABLE "engagements" ADD COLUMN     "billing_stops_on" DATE,
ADD COLUMN     "stop_future_billing" BOOLEAN NOT NULL DEFAULT false;



-- ---------- Data rules Prisma cannot express ----------
ALTER TABLE engagements ADD CONSTRAINT engagements_billing_stop_date
  CHECK (stop_future_billing = (billing_stops_on IS NOT NULL));
