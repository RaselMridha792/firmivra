-- R1 (Rasel's approval in R1's window, Nov 7; Oct 31 Super Admin review SA-APP-F02): the In Review
-- status, in its own migration because Postgres cannot use a new enum value in the transaction that
-- adds it (r1_firm_application_review, next, uses it). Safe on dev: catalog only.
ALTER TYPE "FirmApplicationStatus" ADD VALUE 'IN_REVIEW' AFTER 'PENDING_REVIEW';
