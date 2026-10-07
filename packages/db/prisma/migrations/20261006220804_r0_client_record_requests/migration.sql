-- For R10 (Rasel's decisions on the lead's #42 review, Oct 7). Steps 3 and 4 are merged, so this
-- is a follow-up migration in the step 10 PR:
-- - tasks.kind: a client's "Request Name Change" from the portal is a NAME_CHANGE task, and a
--   client has at most one open one (the API answers 409 NAME_CHANGE_PENDING).
-- - engagements.cancel_request_reason: the client's own words when asking to cancel, only with
--   cancel_requested_at (the firm's reason stays in cancellation_reason).
-- - client_profiles.ein_enc and ein_last4: a business client's EIN, encrypted with the firm's key
--   (field-encryption helper), never plain; only the last 4 is ever shown.

-- CreateEnum
CREATE TYPE "TaskKind" AS ENUM ('GENERAL', 'NAME_CHANGE');

-- AlterTable
ALTER TABLE "client_profiles" ADD COLUMN     "ein_enc" BYTEA,
ADD COLUMN     "ein_last4" TEXT;

-- AlterTable
ALTER TABLE "engagements" ADD COLUMN     "cancel_request_reason" TEXT;

-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "kind" "TaskKind" NOT NULL DEFAULT 'GENERAL';


-- One open name change request per client (SQL only: Prisma ignores partial indexes).
CREATE UNIQUE INDEX tasks_one_open_name_change ON tasks (business_id, client_id)
  WHERE kind = 'NAME_CHANGE' AND status = 'OPEN';

ALTER TABLE engagements ADD CONSTRAINT engagements_cancel_request_reason
  CHECK (cancel_request_reason IS NULL
         OR (cancel_requested_at IS NOT NULL AND btrim(cancel_request_reason) <> ''
             AND char_length(cancel_request_reason) <= 500));

ALTER TABLE client_profiles ADD CONSTRAINT client_profiles_ein_last4
  CHECK (ein_last4 ~ '^[0-9]{4}$');
