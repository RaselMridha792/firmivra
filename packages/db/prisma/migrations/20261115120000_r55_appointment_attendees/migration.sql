-- R55 Appointments A1 (approved by the lead under Rasel's delegation, Nov 15): group
-- appointments. appointment_attendees holds the other clients in one appointment; the
-- appointment's own client (appointments.client_id) stays its primary attendee. At most 20 per
-- appointment, never the appointment's own client, added or removed only while it is SCHEDULED
-- (an ended appointment keeps its attendees as its history; a cascade from the appointment's own
-- deletion still removes them). Under the firm's RLS. Safe on dev: one new empty table.

-- CreateTable
CREATE TABLE "appointment_attendees" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "appointment_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "added_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "appointment_attendees_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "appointment_attendees_business_id_client_id_idx" ON "appointment_attendees"("business_id", "client_id");

-- CreateIndex
CREATE UNIQUE INDEX "appointment_attendees_appointment_id_client_id_key" ON "appointment_attendees"("appointment_id", "client_id");

-- AddForeignKey
ALTER TABLE "appointment_attendees" ADD CONSTRAINT "appointment_attendees_business_id_appointment_id_fkey" FOREIGN KEY ("business_id", "appointment_id") REFERENCES "appointments"("business_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointment_attendees" ADD CONSTRAINT "appointment_attendees_business_id_client_id_fkey" FOREIGN KEY ("business_id", "client_id") REFERENCES "clients"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointment_attendees" ADD CONSTRAINT "appointment_attendees_business_id_added_by_user_id_fkey" FOREIGN KEY ("business_id", "added_by_user_id") REFERENCES "memberships"("business_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------- Access ----------
GRANT SELECT, INSERT, UPDATE, DELETE ON appointment_attendees TO firmivra_app;
ALTER TABLE appointment_attendees ENABLE ROW LEVEL SECURITY;
ALTER TABLE appointment_attendees FORCE ROW LEVEL SECURITY;
CREATE POLICY appointment_attendees_business ON appointment_attendees
  USING (business_id = app_current_business_id())
  WITH CHECK (business_id = app_current_business_id());

-- ---------- Data rules Prisma cannot express ----------
CREATE FUNCTION appointment_attendees_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  appt record;
  taken integer;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'appointment attendees: an attendee is added or removed, never changed'
      USING ERRCODE = 'check_violation';
  END IF;
  -- The appointment held, so parallel adds count one by one and its status can't change meanwhile.
  SELECT a.client_id, a.status INTO appt
    FROM appointments a
    WHERE a.id = (CASE TG_OP WHEN 'DELETE' THEN OLD.appointment_id ELSE NEW.appointment_id END)
    FOR UPDATE;
  IF TG_OP = 'DELETE' THEN
    -- Gone already: a cascade from the appointment's own deletion.
    IF FOUND AND appt.status <> 'SCHEDULED' THEN
      RAISE EXCEPTION 'appointment attendees: an ended appointment keeps its attendees'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;
  IF NOT FOUND OR appt.status <> 'SCHEDULED' THEN
    RAISE EXCEPTION 'appointment attendees: only a scheduled appointment takes attendees'
      USING ERRCODE = 'check_violation';
  END IF;
  IF appt.client_id = NEW.client_id THEN
    RAISE EXCEPTION 'appointment attendees: the appointment''s own client is its primary attendee'
      USING ERRCODE = 'check_violation';
  END IF;
  SELECT count(*) INTO taken FROM appointment_attendees WHERE appointment_id = NEW.appointment_id;
  IF taken >= 20 THEN
    RAISE EXCEPTION 'appointment attendees: at most 20 per appointment'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER appointment_attendees_rules
  BEFORE INSERT OR UPDATE OR DELETE ON appointment_attendees
  FOR EACH ROW EXECUTE FUNCTION appointment_attendees_rules();
