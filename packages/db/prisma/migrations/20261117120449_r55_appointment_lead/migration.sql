-- r55_appointment_lead (R55, Nov 17; P4-1 of the master list, approved by Rasel through the lead
-- on Nov 17): an appointment for a lead (Leads Review Two 26 and 17). Until now an appointment had
-- to have a client, so a lead was converted before it could be booked. A lead's own appointment
-- has a lead and no client; at the lead's conversion it takes the new client and keeps the lead as
-- where it came from. A lead-only appointment is about no engagement and no tax plan (the composite
-- foreign keys do not apply while client_id is empty). Same RLS as before: appointments already has
-- forced RLS per firm, and the portal reads only its own client's appointments (by client_id), so a
-- lead-only appointment is never in a portal. No backfill: every existing row has a client.


-- AlterTable
ALTER TABLE "appointments" ADD COLUMN     "lead_id" UUID,
ALTER COLUMN "client_id" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "appointments_business_id_lead_id_idx" ON "appointments"("business_id", "lead_id");

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_business_id_lead_id_fkey" FOREIGN KEY ("business_id", "lead_id") REFERENCES "leads"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------- Data rules Prisma cannot express ----------

-- A client, a lead or both (a converted lead's); a lead-only one has no engagement or tax plan.
ALTER TABLE appointments ADD CONSTRAINT appointments_client_or_lead
  CHECK (num_nonnulls(client_id, lead_id) >= 1
         AND (client_id IS NOT NULL OR (engagement_id IS NULL AND tax_plan_id IS NULL)));

-- A lead is not double booked either (appointments_no_double_booking_client covers every row with
-- a client, a converted lead's too).
ALTER TABLE appointments ADD CONSTRAINT appointments_no_double_booking_lead
  EXCLUDE USING gist (business_id WITH =, lead_id WITH =,
                      tstzrange(starts_at, ends_at, '[)') WITH &&)
  WHERE (status <> 'CANCELLED' AND client_id IS NULL);

-- appointments_rules (r0_appointment_reminder), with the client and lead rules made exact: the
-- lead never changes, and the client never changes except once, from empty to the new client when
-- a lead-only appointment's lead converts. IS DISTINCT FROM, since client_id may now be empty (with
-- <> a change from or to empty would pass). Everything else is as before.
CREATE OR REPLACE FUNCTION appointments_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.id <> OLD.id OR NEW.business_id <> OLD.business_id OR NEW.created_at <> OLD.created_at
       OR NEW.lead_id IS DISTINCT FROM OLD.lead_id
       OR (NEW.client_id IS DISTINCT FROM OLD.client_id
           AND NOT (OLD.client_id IS NULL AND NEW.client_id IS NOT NULL
                    AND OLD.lead_id IS NOT NULL)) THEN
      RAISE EXCEPTION 'appointments: the client of an appointment cannot change, nor its lead'
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
