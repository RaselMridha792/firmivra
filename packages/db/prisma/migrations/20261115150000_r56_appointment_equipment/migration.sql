-- Appointments Review 2, approved addition A2 "Resource management and booking" (R56; the
-- lead's approval under Rasel's db delegation, Nov 15): equipment, one row per physical item,
-- an office's own or any office's, booked with an appointment. Two live appointments never hold
-- one item at the same time, as for rooms (appointments_no_double_booking_room). Rooms need no
-- change: firm_rooms already exists.

-- CreateTable
CREATE TABLE "firm_equipment" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "office_id" UUID,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "archived_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "firm_equipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "appointment_equipment" (
    "business_id" UUID NOT NULL,
    "appointment_id" UUID NOT NULL,
    "equipment_id" UUID NOT NULL,
    "starts_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ends_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "live" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "appointment_equipment_pkey" PRIMARY KEY ("business_id","appointment_id","equipment_id")
);

-- CreateIndex
CREATE INDEX "firm_equipment_business_id_office_id_idx" ON "firm_equipment"("business_id", "office_id");

-- CreateIndex
CREATE UNIQUE INDEX "firm_equipment_business_id_id_key" ON "firm_equipment"("business_id", "id");

-- CreateIndex
CREATE INDEX "appointment_equipment_business_id_equipment_id_idx" ON "appointment_equipment"("business_id", "equipment_id");

-- AddForeignKey
ALTER TABLE "firm_equipment" ADD CONSTRAINT "firm_equipment_business_id_office_id_fkey" FOREIGN KEY ("business_id", "office_id") REFERENCES "firm_offices"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointment_equipment" ADD CONSTRAINT "appointment_equipment_business_id_appointment_id_fkey" FOREIGN KEY ("business_id", "appointment_id") REFERENCES "appointments"("business_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointment_equipment" ADD CONSTRAINT "appointment_equipment_business_id_equipment_id_fkey" FOREIGN KEY ("business_id", "equipment_id") REFERENCES "firm_equipment"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------- Grants and RLS ----------
-- Appointments Review 2 (A2): every row is its firm's.
GRANT SELECT, INSERT, UPDATE, DELETE ON firm_equipment TO firmivra_app;
ALTER TABLE firm_equipment ENABLE ROW LEVEL SECURITY;
ALTER TABLE firm_equipment FORCE ROW LEVEL SECURITY;
CREATE POLICY firm_equipment_business ON firm_equipment
  USING (business_id = app_current_business_id())
  WITH CHECK (business_id = app_current_business_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON appointment_equipment TO firmivra_app;
ALTER TABLE appointment_equipment ENABLE ROW LEVEL SECURITY;
ALTER TABLE appointment_equipment FORCE ROW LEVEL SECURITY;
CREATE POLICY appointment_equipment_business ON appointment_equipment
  USING (business_id = app_current_business_id())
  WITH CHECK (business_id = app_current_business_id());

-- ---------- Shape ----------
-- A name with words (at most 100 characters), unique among the firm's live equipment, ignoring
-- case; an optional description of at most 500.
ALTER TABLE firm_equipment ADD CONSTRAINT firm_equipment_name
  CHECK (char_length(btrim(name)) >= 1 AND char_length(name) <= 100
         AND app_no_hidden_characters(name));
ALTER TABLE firm_equipment ADD CONSTRAINT firm_equipment_description
  CHECK (description IS NULL OR (char_length(btrim(description)) >= 1
         AND char_length(description) <= 500));
CREATE UNIQUE INDEX firm_equipment_live_name ON firm_equipment (business_id, lower(name))
  WHERE archived_at IS NULL;

-- ---------- One item, one appointment at a time ----------
-- The booked item's time and state are the appointment's: set on insert (whatever is sent) and
-- kept in step when the appointment moves or is cancelled, as appointments.room_id is checked.
CREATE FUNCTION appointment_equipment_from_appointment() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  a appointments%ROWTYPE;
BEGIN
  SELECT * INTO a FROM appointments
    WHERE business_id = NEW.business_id AND id = NEW.appointment_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'appointment equipment: no such appointment' USING ERRCODE = 'foreign_key_violation';
  END IF;
  NEW.starts_at := a.starts_at;
  NEW.ends_at := a.ends_at;
  NEW.live := a.status <> 'CANCELLED';
  RETURN NEW;
END;
$$;
CREATE TRIGGER appointment_equipment_from_appointment
  BEFORE INSERT OR UPDATE ON appointment_equipment
  FOR EACH ROW EXECUTE FUNCTION appointment_equipment_from_appointment();

CREATE FUNCTION appointments_move_equipment() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  UPDATE appointment_equipment
    SET starts_at = NEW.starts_at, ends_at = NEW.ends_at, live = NEW.status <> 'CANCELLED'
    WHERE business_id = NEW.business_id AND appointment_id = NEW.id;
  RETURN NEW;
END;
$$;
CREATE TRIGGER appointments_move_equipment
  AFTER UPDATE OF starts_at, ends_at, status ON appointments
  FOR EACH ROW
  WHEN (OLD.starts_at IS DISTINCT FROM NEW.starts_at OR OLD.ends_at IS DISTINCT FROM NEW.ends_at
        OR OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION appointments_move_equipment();

ALTER TABLE appointment_equipment ADD CONSTRAINT appointment_equipment_no_double_booking
  EXCLUDE USING gist (business_id WITH =, equipment_id WITH =,
                      tstzrange(starts_at, ends_at, '[)') WITH &&)
  WHERE (live);
