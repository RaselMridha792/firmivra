-- R37 (Rasel, Oct 14), Appointments: what the calendar, list and Schedule Appointment screens
-- need on an appointment: the related service, a time zone, an all-day flag, a colour, internal
-- notes, client instructions, a confirmation time (empty = Pending) and a booking key. Appointment
-- types get a description, a service and a colour. Not here, because the API and screens must
-- change first (see the PR): an appointment without a client (internal meetings, a lead's
-- appointment), LocationKind OTHER, DRAFT, recurrence, offices and rooms, reminders and buffers.

-- CreateEnum
CREATE TYPE "CalendarColor" AS ENUM ('BLUE', 'GREEN', 'AMBER', 'RED', 'PURPLE', 'GRAY');

-- AlterTable
ALTER TABLE "appointment_types" ADD COLUMN     "color" "CalendarColor",
ADD COLUMN     "description" TEXT,
ADD COLUMN     "service_id" UUID;

-- AlterTable
ALTER TABLE "appointments" ADD COLUMN     "all_day" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "client_instructions" TEXT,
ADD COLUMN     "color" "CalendarColor",
ADD COLUMN     "confirmed_at" TIMESTAMPTZ(3),
ADD COLUMN     "idempotency_key" UUID,
ADD COLUMN     "internal_notes" TEXT,
ADD COLUMN     "service_id" UUID,
ADD COLUMN     "time_zone" TEXT;

-- CreateIndex
CREATE INDEX "appointments_business_id_starts_at_idx" ON "appointments"("business_id", "starts_at");

-- CreateIndex
CREATE UNIQUE INDEX "appointments_business_id_idempotency_key_key" ON "appointments"("business_id", "idempotency_key");

-- AddForeignKey
ALTER TABLE "appointment_types" ADD CONSTRAINT "appointment_types_business_id_service_id_fkey" FOREIGN KEY ("business_id", "service_id") REFERENCES "services"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_business_id_service_id_fkey" FOREIGN KEY ("business_id", "service_id") REFERENCES "services"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------- Shape ----------
-- A day-long entry may run up to 25 hours (a daylight saving day); anything else 12.
ALTER TABLE appointments DROP CONSTRAINT appointments_range;
ALTER TABLE appointments ADD CONSTRAINT appointments_range
  CHECK (ends_at > starts_at
     AND (ends_at <= starts_at + interval '12 hours'
          OR (all_day AND ends_at <= starts_at + interval '25 hours')));
ALTER TABLE appointments ADD CONSTRAINT appointments_notes
  CHECK ((internal_notes IS NULL OR (char_length(btrim(internal_notes)) >= 1 AND char_length(internal_notes) <= 5000))
     AND (client_instructions IS NULL OR (char_length(btrim(client_instructions)) >= 1
          AND char_length(client_instructions) <= 2000)));

-- An IANA time zone name (Area/City), one the database knows.
CREATE FUNCTION app_valid_time_zone(tz text) RETURNS boolean
  LANGUAGE plpgsql
  STABLE
  AS $$
BEGIN
  IF tz IS NULL OR tz !~ '^[A-Za-z_]+(/[A-Za-z0-9_+-]+){1,2}$' THEN
    RETURN false;
  END IF;
  PERFORM now() AT TIME ZONE tz;
  RETURN true;
EXCEPTION WHEN OTHERS THEN
  RETURN false;
END
$$;
ALTER TABLE appointments ADD CONSTRAINT appointments_time_zone
  CHECK (time_zone IS NULL OR app_valid_time_zone(time_zone));

ALTER TABLE appointment_types ADD CONSTRAINT appointment_types_description
  CHECK (description IS NULL OR (char_length(btrim(description)) >= 1 AND char_length(description) <= 500
         AND app_no_hidden_characters(description)));
