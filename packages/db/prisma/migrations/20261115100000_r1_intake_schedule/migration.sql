-- The intake schedule (R1, Nov 15; Intake Forms Review Two 10c and the reminder schedule that did
-- not exist yet, the lead's approval under Rasel's packages/db delegation until Nov 17). Each form
-- keeps its own schedule, fixed when it is sent (the send's own, else the firm's settings), so a
-- later settings change never moves forms already out: the first reminder in minutes after
-- sent_at, the final reminder and the expiration alert in minutes before expires_at (10c: the
-- final counts back from the expiry). Null: none. A marker per reminder and the alert, set by the
-- API's job with the send, so each goes once; extending the expiration clears the final's and the
-- alert's. intakes keeps FORCE RLS and its table-level grants; nothing new to grant. No backfill:
-- forms already sent get no schedule, so nothing old suddenly emails anyone.

-- AlterTable
ALTER TABLE "intakes" ADD COLUMN     "expiry_alert_minutes" INTEGER,
ADD COLUMN     "expiry_alert_sent_at" TIMESTAMPTZ(3),
ADD COLUMN     "final_reminder_sent_at" TIMESTAMPTZ(3),
ADD COLUMN     "first_reminder_sent_at" TIMESTAMPTZ(3),
ADD COLUMN     "reminder_final_minutes" INTEGER,
ADD COLUMN     "reminder_first_minutes" INTEGER;

-- The same ranges as the firm's settings (intake_settings_ranges, and the alert's 30 minutes to
-- 7 days).
ALTER TABLE intakes ADD CONSTRAINT intakes_schedule_ranges CHECK (
  (reminder_first_minutes IS NULL OR reminder_first_minutes BETWEEN 5 AND 43200)
  AND (reminder_final_minutes IS NULL OR reminder_final_minutes BETWEEN 5 AND 86400)
  AND (expiry_alert_minutes IS NULL OR expiry_alert_minutes BETWEEN 30 AND 10080)
);

-- A marker only on a form that was sent, and never before it was.
ALTER TABLE intakes ADD CONSTRAINT intakes_schedule_sent CHECK (
  (first_reminder_sent_at IS NULL OR (sent_at IS NOT NULL AND first_reminder_sent_at >= sent_at))
  AND (final_reminder_sent_at IS NULL OR (sent_at IS NOT NULL AND final_reminder_sent_at >= sent_at))
  AND (expiry_alert_sent_at IS NULL OR (sent_at IS NOT NULL AND expiry_alert_sent_at >= sent_at))
);

-- The job's scan: open forms that were sent, per firm.
CREATE INDEX intakes_schedule_open ON intakes (business_id, sent_at)
  WHERE status IN ('SENT', 'IN_PROGRESS', 'NEEDS_CORRECTION') AND sent_at IS NOT NULL;
