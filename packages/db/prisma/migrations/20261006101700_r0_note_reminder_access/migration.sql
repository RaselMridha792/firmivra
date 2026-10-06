-- Lead's review of #32 (Oct 7): any session of the firm could read, move or delete a client's
-- note reminder (one policy for the whole firm). Now:
-- - the note's owner, acting for itself (db.forBusiness(id, { actorUserId })), reads, creates,
--   changes and deletes its reminders;
-- - the reminder sender (business scope, no actor) sees only reminders that are due and may only
--   mark an unsent one sent (reminded_at); the trigger refuses anything else;
-- - any other actor (staff, another client login) sees nothing.
-- A new migration rather than an edit of r0_messages, so local databases built on #32 keep working.
DROP POLICY client_note_reminders_business ON client_note_reminders;

CREATE POLICY client_note_reminders_read ON client_note_reminders FOR SELECT
  USING (business_id = app_current_business_id()
         AND (user_id = app_current_actor_id()
              OR (app_current_actor_id() IS NULL AND remind_at <= now())));
CREATE POLICY client_note_reminders_insert ON client_note_reminders FOR INSERT
  WITH CHECK (business_id = app_current_business_id() AND user_id = app_current_actor_id());
CREATE POLICY client_note_reminders_update ON client_note_reminders FOR UPDATE
  USING (business_id = app_current_business_id()
         AND (user_id = app_current_actor_id()
              OR (app_current_actor_id() IS NULL AND remind_at <= now() AND reminded_at IS NULL)))
  WITH CHECK (business_id = app_current_business_id()
              AND (user_id = app_current_actor_id() OR app_current_actor_id() IS NULL));
CREATE POLICY client_note_reminders_delete ON client_note_reminders FOR DELETE
  USING (business_id = app_current_business_id() AND user_id = app_current_actor_id());

-- Same rules as before, plus: anyone but the owner may only mark a due reminder sent.
CREATE OR REPLACE FUNCTION client_note_reminders_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- The note is visible only to its owner acting for itself (policy on client_private_notes).
    IF NOT EXISTS (SELECT 1 FROM client_private_notes n
                   WHERE n.id = NEW.note_id AND n.user_id = NEW.user_id) THEN
      RAISE EXCEPTION 'note reminders: only the note''s owner can set its reminder'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.reminded_at IS NOT NULL THEN
      RAISE EXCEPTION 'note reminders: a new reminder has not been sent yet'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.id <> OLD.id OR NEW.business_id <> OLD.business_id OR NEW.note_id <> OLD.note_id
     OR NEW.user_id <> OLD.user_id OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'note reminders: the note and its owner cannot change'
      USING ERRCODE = 'check_violation';
  END IF;
  IF app_current_actor_id() IS DISTINCT FROM OLD.user_id
     AND (NEW.remind_at <> OLD.remind_at OR OLD.reminded_at IS NOT NULL
          OR NEW.reminded_at IS NULL) THEN
    RAISE EXCEPTION 'note reminders: only the note''s owner changes a reminder; the sender only marks it sent'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.remind_at <> OLD.remind_at THEN
    NEW.reminded_at := NULL;
  END IF;
  RETURN NEW;
END
$$;
