-- Step 7 follow-up (Rasel, Oct 6, from the developers' field lists): a stable event key, so a
-- retried job can't create a second bell item for the same person.

-- AlterTable
ALTER TABLE "notifications" ADD COLUMN     "event_key" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "notifications_business_id_recipient_user_id_event_key_key" ON "notifications"("business_id", "recipient_user_id", "event_key");

ALTER TABLE notifications ADD CONSTRAINT notifications_event_key
  CHECK (btrim(event_key) <> '' AND length(event_key) <= 200);

-- Same as r0_notifications, plus: the event key never changes either.
CREATE OR REPLACE FUNCTION notifications_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT app_is_firm_user(NEW.business_id, NEW.recipient_user_id) THEN
      RAISE EXCEPTION 'notifications: the recipient must be a member or client of the firm'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.id <> OLD.id OR NEW.business_id <> OLD.business_id
     OR NEW.recipient_user_id <> OLD.recipient_user_id OR NEW.category <> OLD.category
     OR NEW.type <> OLD.type OR NEW.entity_type <> OLD.entity_type OR NEW.entity_id <> OLD.entity_id
     OR NEW.payload <> OLD.payload OR NEW.event_key IS DISTINCT FROM OLD.event_key
     OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'notifications: only read_at can change'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
