-- R56 (Rasel's approval, Nov 14; R1's handoff): Bookkeeping report types REFUND and SETTLEMENT
-- (Octavia's Review 2, RP01). In a migration of their own, as ADD VALUE cannot share a transaction
-- with a use of the new values. Safe on dev: adds enum values only.

ALTER TYPE "BookkeepingReportType" ADD VALUE 'REFUND';
ALTER TYPE "BookkeepingReportType" ADD VALUE 'SETTLEMENT';
