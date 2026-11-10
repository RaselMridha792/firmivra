-- R1 (Rasel's approval in R1's window, Nov 7; Oct 31 Super Admin and Invoices reviews).
-- IP-F10: invoices.archived_at. An invoice is archived, never deleted (the app role has no DELETE
-- on invoices); "Delete" on a never-sent draft archives it.
-- SA-INT-R3: platform_integration_usage_daily.connected_firms_by_plan, connected firms per catalog
-- entry by the firm's current plan code ({"TEAM_PRO": 3}), a JSON object of counts; empty until
-- the rollup counts them. No backfill. Safe on dev: a nullable column and a constant default
-- (catalog only); the check reads the rollup table once.

-- AlterTable
ALTER TABLE "invoices" ADD COLUMN     "archived_at" TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "platform_integration_usage_daily" ADD COLUMN     "connected_firms_by_plan" JSONB NOT NULL DEFAULT '{}';

-- ---------- Data rules Prisma cannot express ----------
-- Plan codes to whole, non-negative counts.
ALTER TABLE platform_integration_usage_daily ADD CONSTRAINT platform_integration_usage_daily_by_plan
  CHECK (jsonb_typeof(connected_firms_by_plan) = 'object'
     AND NOT jsonb_path_exists(connected_firms_by_plan,
           '$.* ? (@.type() != "number" || @ < 0 || @ != @.floor())'));
