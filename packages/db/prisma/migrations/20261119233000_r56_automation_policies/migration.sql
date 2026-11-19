-- R56, Automations Review Two R11-R13 (lead's decisions, Nov 19; Rasel approved this db change in
-- R56's window): firm-wide automation policies on automation_settings.
--   missed_run_policy, missed_run_window_days (R11): what the engine does with what fell due while it
--     could not run. RUN_ONCE (the default) runs each missed occurrence once on recovery, which is what
--     the engine does today; SKIP drops what was due while it was down; REPLAY_WINDOW replays only what
--     fell due within the last missed_run_window_days days. A rule may override it in its own
--     settings (JSON); the firm default applies otherwise.
--   conflict_policy (R12): two rules asking for incompatible changes to one record in the same scan.
--     PRIORITY_THEN_OLDEST (the default): the higher priority rule wins, then the older rule; the
--     other's action is skipped and logged. SKIP_BOTH: neither changes the record; both are logged.
--   paused_at, paused_by_user_id (R13): a firm-wide emergency pause. While paused_at is set, nothing
--     new is dispatched; actions already running finish. Set together, cleared together. The API
--     writes the audit entry (actor and time); Owner and Admin only.
-- Additive only: every column has a constant default or is NULL, so existing rows keep today's
-- behaviour with no backfill and no table rewrite (it locks automation_settings only). Policies and
-- grants are table-wide and cover the new columns; RLS is unchanged.

-- CreateEnum
CREATE TYPE "AutomationMissedRunPolicy" AS ENUM ('RUN_ONCE', 'SKIP', 'REPLAY_WINDOW');

-- CreateEnum
CREATE TYPE "AutomationConflictPolicy" AS ENUM ('PRIORITY_THEN_OLDEST', 'SKIP_BOTH');

-- AlterTable
ALTER TABLE "automation_settings" ADD COLUMN     "conflict_policy" "AutomationConflictPolicy" NOT NULL DEFAULT 'PRIORITY_THEN_OLDEST',
ADD COLUMN     "missed_run_policy" "AutomationMissedRunPolicy" NOT NULL DEFAULT 'RUN_ONCE',
ADD COLUMN     "missed_run_window_days" INTEGER NOT NULL DEFAULT 7,
ADD COLUMN     "paused_at" TIMESTAMPTZ(3),
ADD COLUMN     "paused_by_user_id" UUID;

-- A replay window of 1 to 90 days; a pause names who paused, and only while paused.
ALTER TABLE automation_settings ADD CONSTRAINT automation_settings_policies
  CHECK (missed_run_window_days BETWEEN 1 AND 90
         AND (paused_at IS NULL) = (paused_by_user_id IS NULL));
