-- Step 8 follow-up (Rasel, Oct 6, from the developers' field lists): when the appointment
-- reminder went out. A reschedule clears it, so the new time gets its own reminder.

-- AlterTable
ALTER TABLE "appointments" ADD COLUMN     "reminder_sent_at" TIMESTAMPTZ(3);

-- Same as r0_appointments, plus: a reschedule clears reminder_sent_at.
CREATE OR REPLACE FUNCTION appointments_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.id <> OLD.id OR NEW.business_id <> OLD.business_id OR NEW.client_id <> OLD.client_id
       OR NEW.created_at <> OLD.created_at THEN
      RAISE EXCEPTION 'appointments: the client of an appointment cannot change'
        USING ERRCODE = 'check_violation';
    END IF;
    IF OLD.status = 'CANCELLED' AND (NEW.status <> 'CANCELLED'
       OR NEW.starts_at <> OLD.starts_at OR NEW.ends_at <> OLD.ends_at) THEN
      RAISE EXCEPTION 'appointments: a cancelled appointment is final; book a new one'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.starts_at <> OLD.starts_at OR NEW.ends_at <> OLD.ends_at THEN
      NEW.rescheduled_at := now();
      NEW.reschedule_count := OLD.reschedule_count + 1;
      NEW.reminder_sent_at := NULL;
    ELSIF NEW.rescheduled_at IS DISTINCT FROM OLD.rescheduled_at
          OR NEW.reschedule_count <> OLD.reschedule_count THEN
      RAISE EXCEPTION 'appointments: the reschedule record is kept by the database'
        USING ERRCODE = 'check_violation';
    END IF;
  ELSIF NEW.rescheduled_at IS NOT NULL OR NEW.reschedule_count <> 0 THEN
    RAISE EXCEPTION 'appointments: the reschedule record is kept by the database'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.status <> 'CANCELLED' AND NEW.ends_at > NEW.starts_at
     AND (TG_OP = 'INSERT' OR NEW.starts_at <> OLD.starts_at OR NEW.ends_at <> OLD.ends_at
          OR NEW.staff_user_id <> OLD.staff_user_id OR NEW.status <> OLD.status)
     AND EXISTS (SELECT 1 FROM blocked_times b
                 WHERE b.business_id = NEW.business_id
                   AND (b.user_id = NEW.staff_user_id OR b.user_id IS NULL)
                   AND tstzrange(b.starts_at, b.ends_at, '[)') && tstzrange(NEW.starts_at, NEW.ends_at, '[)')) THEN
    RAISE EXCEPTION 'appointments: the time overlaps blocked time for this staff member or the firm'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
