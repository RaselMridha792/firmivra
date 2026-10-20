-- r0_mrr_history (R0, Oct 19, Super Admin schema gaps; part of stage D2): MRR history for the
-- Super Admin Subscriptions and Dashboard screens. Each subscription change records the
-- subscription's MRR after it (set by the billing service), and a daily platform rollup keeps
-- the platform's MRR, its counts and MRR by plan (written by the platform's daily job). Past MRR
-- can't be rebuilt from the changes alone, because plan prices change. Platform data: the team
-- reads it, only the platform's job writes the rollup. Contract: docs/work/R0-schema.md (queue).

-- AlterTable
ALTER TABLE "platform_subscription_changes" ADD COLUMN     "mrr_cents" INTEGER;

-- CreateTable
CREATE TABLE "platform_mrr_daily" (
    "day" DATE NOT NULL,
    "mrr_cents" INTEGER NOT NULL,
    "active_count" INTEGER NOT NULL DEFAULT 0,
    "trial_count" INTEGER NOT NULL DEFAULT 0,
    "past_due_count" INTEGER NOT NULL DEFAULT 0,
    "new_count" INTEGER NOT NULL DEFAULT 0,
    "churned_count" INTEGER NOT NULL DEFAULT 0,
    "mrr_by_plan" JSONB NOT NULL DEFAULT '{}',
    "computed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_mrr_daily_pkey" PRIMARY KEY ("day")
);


-- ---------- Values ----------
ALTER TABLE platform_subscription_changes ADD CONSTRAINT platform_subscription_changes_mrr
  CHECK (mrr_cents IS NULL OR mrr_cents >= 0);

-- Amounts and counts are never negative; MRR by plan is an object of non-negative numbers.
ALTER TABLE platform_mrr_daily ADD CONSTRAINT platform_mrr_daily_values
  CHECK (mrr_cents >= 0 AND active_count >= 0 AND trial_count >= 0 AND past_due_count >= 0
         AND new_count >= 0 AND churned_count >= 0
         AND jsonb_typeof(mrr_by_plan) = 'object' AND pg_column_size(mrr_by_plan) <= 10000
         AND NOT jsonb_path_exists(mrr_by_plan, '$.* ? (@.type() != "number" || @ < 0)'));

-- ---------- Rules ----------
-- The database stamps when a day was computed (B9's rollup stamp).
CREATE TRIGGER platform_mrr_daily_stamp BEFORE INSERT OR UPDATE ON platform_mrr_daily
  FOR EACH ROW EXECUTE FUNCTION platform_rollup_stamp();

-- ---------- Grants ----------
-- The job inserts a day and may recompute it; days are never deleted.
GRANT SELECT, INSERT, UPDATE ON platform_mrr_daily TO firmivra_app;

-- ---------- Row-level security ----------
-- As B9's rollups: the team and the platform read; only the platform's job writes. No firm scope.
ALTER TABLE platform_mrr_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_mrr_daily FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_mrr_daily_read ON platform_mrr_daily FOR SELECT
  USING (app_scope() = 'platform' OR app_is_admin() OR app_is_platform_member());
CREATE POLICY platform_mrr_daily_insert ON platform_mrr_daily FOR INSERT
  WITH CHECK (app_scope() = 'platform');
CREATE POLICY platform_mrr_daily_update ON platform_mrr_daily FOR UPDATE
  USING (app_scope() = 'platform') WITH CHECK (app_scope() = 'platform');
