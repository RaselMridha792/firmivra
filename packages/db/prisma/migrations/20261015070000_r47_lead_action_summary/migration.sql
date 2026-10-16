-- R47 (Rasel, Oct 15), second step: the Leads design's next actions and a longer activity
-- summary, so the Leads contract (R43) needs nothing the database lacks.
-- LeadActionType gets SMS (before APPOINTMENT) and CLOSE_LEAD ("No further action"). Nothing is
-- renamed or removed. leads_next_action is unchanged: every next action, CLOSE_LEAD too, has a
-- time (for CLOSE_LEAD, when the lead is closed). The new values are not used by any check,
-- index or policy here (a new value cannot be used in the transaction that adds it).
-- lead_activities.summary may hold up to 1,000 characters instead of 200 (a logged call's
-- summary). Widening only: every row that passed the old rule passes the new one; the rest of
-- the rule is the same.

-- AlterEnum
ALTER TYPE "LeadActionType" ADD VALUE IF NOT EXISTS 'SMS' BEFORE 'APPOINTMENT';
ALTER TYPE "LeadActionType" ADD VALUE IF NOT EXISTS 'CLOSE_LEAD';

-- Widen the summary in lead_activities_text (R37), keeping its other parts as they were.
ALTER TABLE lead_activities DROP CONSTRAINT lead_activities_text;
ALTER TABLE lead_activities ADD CONSTRAINT lead_activities_text
  CHECK ((summary IS NULL OR (char_length(btrim(summary)) >= 1 AND char_length(summary) <= 1000
          AND app_no_hidden_characters(summary)))
     AND (body IS NULL OR (char_length(btrim(body)) >= 1 AND char_length(body) <= 5000))
     AND (kind <> 'NOTE' OR body IS NOT NULL)
     AND (kind = 'STATUS_CHANGED') = (status IS NOT NULL)
     AND jsonb_typeof(metadata) = 'object');
