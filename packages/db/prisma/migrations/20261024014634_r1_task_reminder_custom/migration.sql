-- R1 (Rasel, Oct 24; Octavia's Tasks review A3, Custom reminders): a task reminder can also be a
-- number of minutes, hours or days before the due date and time, in the firm's time zone. A
-- Custom rule keeps its length in minutes_before and the unit it was typed in, has no time of
-- day, and its days_before is its whole days (minutes_before / 1440), so anything that reads only
-- days (an older API task during a rollout, today's screens) still sees a valid rule. Existing
-- rows are days rules (unit NULL): they stay valid with no backfill and no row rewritten. Each
-- rule once: equal days rules (an empty time counted once, which the old unique index let
-- through) and equal Custom lengths are refused. task_reminders keeps its policy and grants.
-- Safe on dev: lock_timeout makes it fail fast instead of making app requests wait; the new
-- columns have no default (no rewrite); every existing row has unit NULL and passes the CHECK;
-- the API has always refused equal days rules and the seeds use distinct days, so the days index
-- builds; validating the CHECK and building the indexes read every row whatever the RLS policy;
-- a type is usable in the transaction that creates it (only ADD VALUE waits for a commit).
SET LOCAL lock_timeout = '10s';

-- CreateEnum
CREATE TYPE "TaskReminderUnit" AS ENUM ('MINUTES', 'HOURS', 'DAYS');

-- AlterTable
ALTER TABLE "task_reminders" ADD COLUMN     "minutes_before" INTEGER,
ADD COLUMN     "unit" "TaskReminderUnit";

-- ---------- A days rule, or Custom ----------
-- Custom: 1 to 525,600 minutes (365 days), a whole number of its unit, no time of day, and its
-- whole days in days_before. "minutes_before IS NOT NULL" is spelled out because a comparison
-- with NULL would let a CHECK pass.
ALTER TABLE task_reminders ADD CONSTRAINT task_reminders_custom
  CHECK ((unit IS NULL AND minutes_before IS NULL)
         OR (unit IS NOT NULL AND minutes_before IS NOT NULL AND time_of_day IS NULL
             AND minutes_before BETWEEN 1 AND 525600
             AND minutes_before % (CASE unit WHEN 'HOURS' THEN 60 WHEN 'DAYS' THEN 1440 ELSE 1 END) = 0
             AND days_before = minutes_before / 1440));

-- ---------- Each rule once ----------
-- Partial indexes, in SQL only (Prisma's schema keeps the older unique index, which they make
-- redundant but never contradict: a Custom rule's time is always NULL).
CREATE UNIQUE INDEX task_reminders_one_days_rule ON task_reminders
  (business_id, task_id, days_before, time_of_day) NULLS NOT DISTINCT WHERE unit IS NULL;
CREATE UNIQUE INDEX task_reminders_one_custom_rule ON task_reminders
  (business_id, task_id, minutes_before) WHERE unit IS NOT NULL;
