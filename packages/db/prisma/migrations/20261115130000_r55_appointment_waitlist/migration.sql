-- R55 Appointments A3 (approved by the lead under Rasel's delegation, Nov 15): the appointment
-- waitlist. appointment_settings gains the on/off switch (off by default) and one mode at a time
-- (automatic confirmation, or staff approval: exclusive by construction). An entry is a client's
-- request for an earlier time for one of their scheduled appointments: one live entry (WAITING,
-- OFFERED, REQUESTED) per appointment; an offer names an earlier time; the status moves forward
-- only. The appointment itself moves only when its entry is MOVED (the API reschedules it in the
-- same transaction), so the original time stands until the new one is confirmed.
-- Safe on dev: two new columns with constant defaults (catalog only), two new enums, one new
-- empty table; no backfill.

-- CreateEnum
CREATE TYPE "AppointmentWaitlistMode" AS ENUM ('AUTO_CONFIRM', 'STAFF_APPROVAL');

-- CreateEnum
CREATE TYPE "AppointmentWaitlistStatus" AS ENUM ('WAITING', 'OFFERED', 'REQUESTED', 'MOVED', 'DECLINED', 'EXPIRED', 'LEFT', 'REJECTED');

-- AlterTable
ALTER TABLE "appointment_settings" ADD COLUMN     "waitlist_enabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "waitlist_mode" "AppointmentWaitlistMode" NOT NULL DEFAULT 'STAFF_APPROVAL';

-- CreateTable
CREATE TABLE "appointment_waitlist_entries" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "appointment_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "status" "AppointmentWaitlistStatus" NOT NULL DEFAULT 'WAITING',
    "offered_starts_at" TIMESTAMPTZ(3),
    "offered_ends_at" TIMESTAMPTZ(3),
    "offered_at" TIMESTAMPTZ(3),
    "offer_expires_at" TIMESTAMPTZ(3),
    "requested_at" TIMESTAMPTZ(3),
    "decided_at" TIMESTAMPTZ(3),
    "decided_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "appointment_waitlist_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "appointment_waitlist_entries_business_id_status_idx" ON "appointment_waitlist_entries"("business_id", "status");

-- CreateIndex
CREATE INDEX "appointment_waitlist_entries_business_id_client_id_idx" ON "appointment_waitlist_entries"("business_id", "client_id");

-- CreateIndex
CREATE INDEX "appointment_waitlist_entries_business_id_appointment_id_idx" ON "appointment_waitlist_entries"("business_id", "appointment_id");

-- AddForeignKey
ALTER TABLE "appointment_waitlist_entries" ADD CONSTRAINT "appointment_waitlist_entries_business_id_appointment_id_fkey" FOREIGN KEY ("business_id", "appointment_id") REFERENCES "appointments"("business_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointment_waitlist_entries" ADD CONSTRAINT "appointment_waitlist_entries_business_id_client_id_fkey" FOREIGN KEY ("business_id", "client_id") REFERENCES "clients"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointment_waitlist_entries" ADD CONSTRAINT "appointment_waitlist_entries_business_id_decided_by_user_i_fkey" FOREIGN KEY ("business_id", "decided_by_user_id") REFERENCES "memberships"("business_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------- Access ----------
GRANT SELECT, INSERT, UPDATE, DELETE ON appointment_waitlist_entries TO firmivra_app;
ALTER TABLE appointment_waitlist_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE appointment_waitlist_entries FORCE ROW LEVEL SECURITY;
CREATE POLICY appointment_waitlist_entries_business ON appointment_waitlist_entries
  USING (business_id = app_current_business_id())
  WITH CHECK (business_id = app_current_business_id());

-- ---------- Data rules Prisma cannot express ----------
-- One live entry per appointment.
CREATE UNIQUE INDEX appointment_waitlist_entries_live ON appointment_waitlist_entries (appointment_id)
  WHERE status IN ('WAITING', 'OFFERED', 'REQUESTED');

-- An offer is its four facts together, while the entry is past WAITING (LEFT leaves from WAITING);
-- the request time from REQUESTED (an automatic move is its own request); the decision with MOVED
-- or REJECTED, the deciding member only then.
ALTER TABLE appointment_waitlist_entries ADD CONSTRAINT appointment_waitlist_entries_shape
  CHECK ((offered_starts_at IS NULL) = (offered_ends_at IS NULL)
     AND (offered_starts_at IS NULL) = (offered_at IS NULL)
     AND (offered_starts_at IS NULL) = (offer_expires_at IS NULL)
     AND (offered_starts_at IS NULL) = (status IN ('WAITING', 'LEFT'))
     AND (offered_ends_at IS NULL OR offered_ends_at > offered_starts_at)
     AND (offer_expires_at IS NULL OR offer_expires_at > offered_at)
     AND (requested_at IS NULL) = (status NOT IN ('REQUESTED', 'MOVED', 'REJECTED'))
     AND (decided_at IS NULL) = (status NOT IN ('MOVED', 'REJECTED'))
     AND (decided_by_user_id IS NULL OR decided_at IS NOT NULL));

CREATE FUNCTION appointment_waitlist_entries_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  appt record;
BEGIN
  SELECT a.client_id, a.status, a.starts_at INTO appt
    FROM appointments a WHERE a.id = NEW.appointment_id FOR SHARE;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'WAITING' THEN
      RAISE EXCEPTION 'appointment waitlist: an entry starts WAITING'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NOT FOUND OR appt.status <> 'SCHEDULED' OR appt.client_id <> NEW.client_id THEN
      RAISE EXCEPTION 'appointment waitlist: only the client of a scheduled appointment waits'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM appointment_settings s
                   WHERE s.business_id = NEW.business_id AND s.waitlist_enabled) THEN
      RAISE EXCEPTION 'appointment waitlist: the firm''s waitlist is off'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.id <> OLD.id OR NEW.business_id <> OLD.business_id
     OR NEW.appointment_id <> OLD.appointment_id OR NEW.client_id <> OLD.client_id
     OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'appointment waitlist: an entry''s appointment and client never change'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
       (OLD.status = 'WAITING' AND NEW.status IN ('OFFERED', 'LEFT'))
    OR (OLD.status = 'OFFERED' AND NEW.status IN ('REQUESTED', 'MOVED', 'DECLINED', 'EXPIRED', 'WAITING'))
    OR (OLD.status = 'REQUESTED' AND NEW.status IN ('MOVED', 'REJECTED', 'WAITING'))) THEN
    RAISE EXCEPTION 'appointment waitlist: % cannot become %', OLD.status, NEW.status
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status = OLD.status AND OLD.status NOT IN ('WAITING', 'OFFERED', 'REQUESTED') THEN
    RAISE EXCEPTION 'appointment waitlist: an ended entry does not change'
      USING ERRCODE = 'check_violation';
  END IF;
  -- An offer is of an earlier time than the appointment's own, while it is still scheduled.
  IF NEW.status = 'OFFERED' AND (OLD.status <> 'OFFERED'
       OR NEW.offered_starts_at IS DISTINCT FROM OLD.offered_starts_at) THEN
    IF NOT FOUND OR appt.status <> 'SCHEDULED' OR NEW.offered_starts_at >= appt.starts_at THEN
      RAISE EXCEPTION 'appointment waitlist: an offer is an earlier time for a scheduled appointment'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER appointment_waitlist_entries_rules
  BEFORE INSERT OR UPDATE ON appointment_waitlist_entries
  FOR EACH ROW EXECUTE FUNCTION appointment_waitlist_entries_rules();
