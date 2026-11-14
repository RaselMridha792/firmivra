-- r1_tax_plan_workflow_values (R1, Nov 14; Tax Planning Review 2 approved workflow, the lead's
-- approval under Rasel's packages/db delegation until Nov 17): the new enum values on their own,
-- so r1_tax_plan_workflow can use them (Postgres refuses a new value in the transaction that
-- added it).
-- - TaxPlanStatus: UNDER_REVIEW (internal review by the chosen reviewer) and CLIENT_APPROVED (the
--   client approved an exact version). READY_FOR_REVIEW keeps its screen name, Needs Review: the
--   client asked a question or for information, a revision or a meeting.
-- - TaxPlanEventKind: REVIEW_REQUESTED, INFO_REQUESTED, CLIENT_REQUEST, APPROVED, DELIVERED.
-- - PlanVersionEvent: DELIVERED, the snapshot delivered to the client.
-- Safe on dev: values added only; no row changes.

ALTER TYPE "TaxPlanStatus" ADD VALUE 'UNDER_REVIEW';
ALTER TYPE "TaxPlanStatus" ADD VALUE 'CLIENT_APPROVED';

ALTER TYPE "TaxPlanEventKind" ADD VALUE 'REVIEW_REQUESTED';
ALTER TYPE "TaxPlanEventKind" ADD VALUE 'INFO_REQUESTED';
ALTER TYPE "TaxPlanEventKind" ADD VALUE 'CLIENT_REQUEST';
ALTER TYPE "TaxPlanEventKind" ADD VALUE 'APPROVED';
ALTER TYPE "TaxPlanEventKind" ADD VALUE 'DELIVERED';

ALTER TYPE "PlanVersionEvent" ADD VALUE 'DELIVERED';
