-- R37 (Rasel, Oct 14), Appointments: reminders, offices and rooms. An appointment can have
-- several reminders (email, SMS or portal, each an offset before the start); the database keeps
-- their due time and starts them over when the appointment is rescheduled. Appointment types
-- keep default reminders. The firm's offices and their rooms are chosen on an in-person
-- appointment, and a room is never double booked. appointments.reminder_sent_at stays until the
-- sender uses these rows.

-- CreateEnum
CREATE TYPE "ReminderChannel" AS ENUM ('EMAIL', 'SMS', 'PORTAL');

-- AlterTable
ALTER TABLE "appointment_types" ADD COLUMN     "reminder_defaults" JSONB NOT NULL DEFAULT '[]';

-- AlterTable
ALTER TABLE "appointments" ADD COLUMN     "office_id" UUID,
ADD COLUMN     "room_id" UUID;

-- CreateTable
CREATE TABLE "appointment_reminders" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "appointment_id" UUID NOT NULL,
    "channel" "ReminderChannel" NOT NULL,
    "offset_minutes" INTEGER NOT NULL,
    "due_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "appointment_reminders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "firm_offices" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "address_line1" TEXT,
    "city" TEXT,
    "state" TEXT,
    "postal_code" TEXT,
    "is_main" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "archived_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "firm_offices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "firm_rooms" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "office_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "archived_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "firm_rooms_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "appointment_reminders_business_id_due_at_idx" ON "appointment_reminders"("business_id", "due_at");

-- CreateIndex
CREATE UNIQUE INDEX "appointment_reminders_business_id_appointment_id_channel_of_key" ON "appointment_reminders"("business_id", "appointment_id", "channel", "offset_minutes");

-- CreateIndex
CREATE UNIQUE INDEX "firm_offices_business_id_id_key" ON "firm_offices"("business_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "firm_rooms_business_id_office_id_id_key" ON "firm_rooms"("business_id", "office_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "firm_rooms_business_id_office_id_name_key" ON "firm_rooms"("business_id", "office_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "appointments_business_id_id_key" ON "appointments"("business_id", "id");

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_business_id_office_id_fkey" FOREIGN KEY ("business_id", "office_id") REFERENCES "firm_offices"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_business_id_office_id_room_id_fkey" FOREIGN KEY ("business_id", "office_id", "room_id") REFERENCES "firm_rooms"("business_id", "office_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointment_reminders" ADD CONSTRAINT "appointment_reminders_business_id_appointment_id_fkey" FOREIGN KEY ("business_id", "appointment_id") REFERENCES "appointments"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "firm_offices" ADD CONSTRAINT "firm_offices_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "firm_rooms" ADD CONSTRAINT "firm_rooms_business_id_office_id_fkey" FOREIGN KEY ("business_id", "office_id") REFERENCES "firm_offices"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------- Grants and RLS ----------
-- A reminder schedule is replaced when the appointment's reminders are edited; offices and
-- rooms are archived, never deleted.
GRANT SELECT, INSERT, UPDATE, DELETE ON appointment_reminders TO firmivra_app;
GRANT SELECT, INSERT, UPDATE ON firm_offices, firm_rooms TO firmivra_app;
ALTER TABLE appointment_reminders ENABLE ROW LEVEL SECURITY;
ALTER TABLE appointment_reminders FORCE ROW LEVEL SECURITY;
ALTER TABLE firm_offices ENABLE ROW LEVEL SECURITY;
ALTER TABLE firm_offices FORCE ROW LEVEL SECURITY;
ALTER TABLE firm_rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE firm_rooms FORCE ROW LEVEL SECURITY;
CREATE POLICY appointment_reminders_business ON appointment_reminders
  USING (business_id = app_current_business_id())
  WITH CHECK (business_id = app_current_business_id());
CREATE POLICY firm_offices_business ON firm_offices
  USING (business_id = app_current_business_id())
  WITH CHECK (business_id = app_current_business_id());
CREATE POLICY firm_rooms_business ON firm_rooms
  USING (business_id = app_current_business_id())
  WITH CHECK (business_id = app_current_business_id());

-- ---------- Shape ----------
ALTER TABLE appointment_reminders ADD CONSTRAINT appointment_reminders_offset
  CHECK (offset_minutes BETWEEN 0 AND 43200);
ALTER TABLE appointment_types ADD CONSTRAINT appointment_types_reminder_defaults
  CHECK (jsonb_typeof(reminder_defaults) = 'array' AND jsonb_array_length(reminder_defaults) <= 10);

ALTER TABLE firm_offices ADD CONSTRAINT firm_offices_text
  CHECK (char_length(btrim(name)) >= 1 AND char_length(name) <= 100 AND app_no_hidden_characters(name)
     AND (address_line1 IS NULL OR (char_length(btrim(address_line1)) >= 1 AND char_length(address_line1) <= 200))
     AND (city IS NULL OR (char_length(btrim(city)) >= 1 AND char_length(city) <= 100))
     AND (state IS NULL OR (char_length(btrim(state)) >= 1 AND char_length(state) <= 100))
     AND (postal_code IS NULL OR (char_length(btrim(postal_code)) >= 1 AND char_length(postal_code) <= 20)));
ALTER TABLE firm_offices ADD CONSTRAINT firm_offices_main_live
  CHECK (NOT is_main OR archived_at IS NULL);
CREATE UNIQUE INDEX firm_offices_live_name ON firm_offices (business_id, lower(btrim(name)))
  WHERE archived_at IS NULL;
CREATE UNIQUE INDEX firm_offices_one_main ON firm_offices (business_id)
  WHERE is_main AND archived_at IS NULL;
ALTER TABLE firm_rooms ADD CONSTRAINT firm_rooms_name
  CHECK (char_length(btrim(name)) >= 1 AND char_length(name) <= 100 AND app_no_hidden_characters(name));

-- A room or office means an in-person appointment; a room is of the appointment's office; and two
-- live appointments never share a room at the same time (half-open ranges, like staff).
ALTER TABLE appointments ADD CONSTRAINT appointments_place
  CHECK ((office_id IS NULL AND room_id IS NULL) OR location_kind = 'IN_PERSON');
ALTER TABLE appointments ADD CONSTRAINT appointments_room_of_office
  CHECK (room_id IS NULL OR office_id IS NOT NULL);
ALTER TABLE appointments ADD CONSTRAINT appointments_no_double_booking_room
  EXCLUDE USING gist (business_id WITH =, room_id WITH =,
                      tstzrange(starts_at, ends_at, '[)') WITH &&)
  WHERE (room_id IS NOT NULL AND status <> 'CANCELLED');

-- ---------- Rules ----------
-- A reminder's due time is the appointment's start minus its offset, kept by the database.
CREATE FUNCTION appointment_reminders_due() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.appointment_id <> OLD.appointment_id OR NEW.channel <> OLD.channel
     OR NEW.offset_minutes <> OLD.offset_minutes) THEN
    RAISE EXCEPTION 'appointment reminders: replace a reminder instead of changing it'
      USING ERRCODE = 'check_violation';
  END IF;
  SELECT a.starts_at - make_interval(mins => NEW.offset_minutes) INTO NEW.due_at
    FROM appointments a WHERE a.business_id = NEW.business_id AND a.id = NEW.appointment_id;
  RETURN NEW;
END
$$;

CREATE TRIGGER appointment_reminders_due
  BEFORE INSERT OR UPDATE ON appointment_reminders
  FOR EACH ROW EXECUTE FUNCTION appointment_reminders_due();

-- A reschedule lets every reminder go out again (the update also recomputes its due time).
CREATE FUNCTION appointments_r37_reminders() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF NEW.starts_at <> OLD.starts_at THEN
    UPDATE appointment_reminders SET sent_at = NULL
     WHERE business_id = NEW.business_id AND appointment_id = NEW.id;
  END IF;
  RETURN NULL;
END
$$;

CREATE TRIGGER appointments_r37_reminders
  AFTER UPDATE OF starts_at ON appointments
  FOR EACH ROW EXECUTE FUNCTION appointments_r37_reminders();

-- Offices and rooms stay with their firm and are archived once, for good.
CREATE FUNCTION firm_places_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.id <> OLD.id OR NEW.business_id <> OLD.business_id THEN
      RAISE EXCEPTION 'places: the firm of an office or room cannot change'
        USING ERRCODE = 'check_violation';
    END IF;
    IF OLD.archived_at IS NOT NULL AND NEW.archived_at IS DISTINCT FROM OLD.archived_at THEN
      RAISE EXCEPTION 'places: an archived office or room stays archived'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER firm_offices_rules BEFORE UPDATE ON firm_offices
  FOR EACH ROW EXECUTE FUNCTION firm_places_rules();
CREATE TRIGGER firm_rooms_rules BEFORE UPDATE ON firm_rooms
  FOR EACH ROW EXECUTE FUNCTION firm_places_rules();
