-- CreateEnum
CREATE TYPE "AppointmentStatus" AS ENUM ('SCHEDULED', 'CANCELLED', 'COMPLETED', 'NO_SHOW');

-- CreateEnum
CREATE TYPE "LocationKind" AS ENUM ('IN_PERSON', 'PHONE', 'VIDEO');

-- CreateTable
CREATE TABLE "appointment_types" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "duration_minutes" INTEGER NOT NULL,
    "location_kind" "LocationKind" NOT NULL DEFAULT 'VIDEO',
    "client_bookable" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "archived_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "appointment_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "working_hours" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "weekday" INTEGER NOT NULL,
    "starts_at" TIME(0) NOT NULL,
    "ends_at" TIME(0) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "working_hours_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "blocked_times" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "user_id" UUID,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "ends_at" TIMESTAMPTZ(3) NOT NULL,
    "reason" TEXT,
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "blocked_times_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "appointments" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "engagement_id" UUID,
    "staff_user_id" UUID NOT NULL,
    "type_id" UUID,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "ends_at" TIMESTAMPTZ(3) NOT NULL,
    "status" "AppointmentStatus" NOT NULL DEFAULT 'SCHEDULED',
    "location_kind" "LocationKind" NOT NULL,
    "location_details" TEXT,
    "booked_by_user_id" UUID,
    "booked_by_client" BOOLEAN NOT NULL DEFAULT false,
    "rescheduled_at" TIMESTAMPTZ(3),
    "reschedule_count" INTEGER NOT NULL DEFAULT 0,
    "cancelled_at" TIMESTAMPTZ(3),
    "cancel_reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "appointments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "appointment_types_business_id_name_key" ON "appointment_types"("business_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "appointment_types_business_id_id_key" ON "appointment_types"("business_id", "id");

-- CreateIndex
CREATE INDEX "working_hours_business_id_user_id_weekday_idx" ON "working_hours"("business_id", "user_id", "weekday");

-- CreateIndex
CREATE INDEX "blocked_times_business_id_user_id_starts_at_idx" ON "blocked_times"("business_id", "user_id", "starts_at");

-- CreateIndex
CREATE INDEX "appointments_business_id_staff_user_id_starts_at_idx" ON "appointments"("business_id", "staff_user_id", "starts_at");

-- CreateIndex
CREATE INDEX "appointments_business_id_client_id_starts_at_idx" ON "appointments"("business_id", "client_id", "starts_at");

-- AddForeignKey
ALTER TABLE "appointment_types" ADD CONSTRAINT "appointment_types_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "working_hours" ADD CONSTRAINT "working_hours_business_id_user_id_fkey" FOREIGN KEY ("business_id", "user_id") REFERENCES "memberships"("business_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blocked_times" ADD CONSTRAINT "blocked_times_business_id_user_id_fkey" FOREIGN KEY ("business_id", "user_id") REFERENCES "memberships"("business_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_business_id_client_id_fkey" FOREIGN KEY ("business_id", "client_id") REFERENCES "clients"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_business_id_client_id_engagement_id_fkey" FOREIGN KEY ("business_id", "client_id", "engagement_id") REFERENCES "engagements"("business_id", "client_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_business_id_staff_user_id_fkey" FOREIGN KEY ("business_id", "staff_user_id") REFERENCES "memberships"("business_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_business_id_type_id_fkey" FOREIGN KEY ("business_id", "type_id") REFERENCES "appointment_types"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ==================== R0 step 8: row-level security and data rules ====================
-- Appointment types, staff working hours, blocked time and appointments.

-- GiST operator classes for uuid equality, so one exclusion constraint can say "same firm,
-- same staff member, overlapping time". A trusted extension: RDS allows the database owner.
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ---------- Grants ----------
-- A type that appointments use cannot be deleted (foreign key); archive it instead.
GRANT SELECT, INSERT, UPDATE, DELETE ON appointment_types, working_hours, blocked_times TO firmivra_app;
-- Appointments are cancelled, never deleted.
GRANT SELECT, INSERT, UPDATE ON appointments TO firmivra_app;

-- ---------- Enable and force RLS ----------
ALTER TABLE appointment_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE appointment_types FORCE ROW LEVEL SECURITY;
ALTER TABLE working_hours     ENABLE ROW LEVEL SECURITY;
ALTER TABLE working_hours     FORCE ROW LEVEL SECURITY;
ALTER TABLE blocked_times     ENABLE ROW LEVEL SECURITY;
ALTER TABLE blocked_times     FORCE ROW LEVEL SECURITY;
ALTER TABLE appointments      ENABLE ROW LEVEL SECURITY;
ALTER TABLE appointments      FORCE ROW LEVEL SECURITY;

-- ---------- Tenant tables: only the current business ----------
CREATE POLICY appointment_types_business ON appointment_types
  USING (business_id = app_current_business_id())
  WITH CHECK (business_id = app_current_business_id());

CREATE POLICY working_hours_business ON working_hours
  USING (business_id = app_current_business_id())
  WITH CHECK (business_id = app_current_business_id());

CREATE POLICY blocked_times_business ON blocked_times
  USING (business_id = app_current_business_id())
  WITH CHECK (business_id = app_current_business_id());

CREATE POLICY appointments_business ON appointments
  USING (business_id = app_current_business_id())
  WITH CHECK (business_id = app_current_business_id());

-- ---------- Data rules Prisma cannot express ----------
ALTER TABLE appointment_types ADD CONSTRAINT appointment_types_name_not_blank
  CHECK (btrim(name) <> '');
ALTER TABLE appointment_types ADD CONSTRAINT appointment_types_duration
  CHECK (duration_minutes BETWEEN 5 AND 480);

ALTER TABLE working_hours ADD CONSTRAINT working_hours_weekday CHECK (weekday BETWEEN 0 AND 6);
ALTER TABLE working_hours ADD CONSTRAINT working_hours_range CHECK (ends_at > starts_at);

ALTER TABLE blocked_times ADD CONSTRAINT blocked_times_range CHECK (ends_at > starts_at);

ALTER TABLE appointments ADD CONSTRAINT appointments_range
  CHECK (ends_at > starts_at AND ends_at <= starts_at + interval '12 hours');
ALTER TABLE appointments ADD CONSTRAINT appointments_cancelled_at
  CHECK ((status = 'CANCELLED') = (cancelled_at IS NOT NULL));
ALTER TABLE appointments ADD CONSTRAINT appointments_reschedule_count
  CHECK (reschedule_count >= 0);

-- No double booking: a staff member, and a client, can each have only one live appointment at a
-- time. Half-open ranges, so back-to-back appointments (10:00-10:30, 10:30-11:00) are fine.
ALTER TABLE appointments ADD CONSTRAINT appointments_no_double_booking_staff
  EXCLUDE USING gist (business_id WITH =, staff_user_id WITH =,
                      tstzrange(starts_at, ends_at, '[)') WITH &&)
  WHERE (status <> 'CANCELLED');
ALTER TABLE appointments ADD CONSTRAINT appointments_no_double_booking_client
  EXCLUDE USING gist (business_id WITH =, client_id WITH =,
                      tstzrange(starts_at, ends_at, '[)') WITH &&)
  WHERE (status <> 'CANCELLED');

-- Not over blocked time (an inverted range is left to the CHECK above, for a clear error);
-- the client stays the client; cancelled is final; the database counts
-- reschedules (new times on a live appointment).
CREATE FUNCTION appointments_rules() RETURNS trigger
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

CREATE TRIGGER appointments_rules
  BEFORE INSERT OR UPDATE ON appointments
  FOR EACH ROW EXECUTE FUNCTION appointments_rules();
