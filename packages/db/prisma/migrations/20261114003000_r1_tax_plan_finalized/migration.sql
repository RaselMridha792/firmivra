-- R1 (Rasel's approval in R1's window, Nov 14; Tax Planning Review 2 C27, S2): a plan's
-- FINALIZED status, shown as such in every view. On its own: a new enum value cannot be used in
-- the transaction that adds it (r1_tax_planning_review2 follows). No row changes.

-- AlterEnum
ALTER TYPE "TaxPlanStatus" ADD VALUE 'FINALIZED' AFTER 'READY_FOR_REVIEW';
