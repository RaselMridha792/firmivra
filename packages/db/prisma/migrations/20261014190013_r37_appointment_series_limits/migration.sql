-- R37 (Rasel, Oct 14), Appointments: repeating appointments, buffers, booking limits, one-day
-- availability changes, time off, and the firm's appointment settings. A series records how an
-- appointment repeats (each occurrence is its own appointment with series_id). Buffers are
-- minutes kept free around an appointment; the staff double-booking rule now counts them.
-- availability_overrides change one day of a staff member's weekly hours. blocked_times.kind
-- tells time off from other blocked time. appointment_settings holds the firm's defaults and its
-- master email for copies of notices.

-- CreateEnum
CREATE TYPE "BlockedTimeKind" AS ENUM ('BLOCKED', 'TIME_OFF');

-- CreateEnum
CREATE TYPE "RecurrenceFrequency" AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY');

-- AlterTable
ALTER TABLE "appointment_types" ADD COLUMN     "buffer_after_minutes" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "buffer_before_minutes" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "max_advance_days" INTEGER,
ADD COLUMN     "min_notice_minutes" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "appointments" ADD COLUMN     "buffer_after_minutes" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "buffer_before_minutes" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "series_id" UUID;

-- AlterTable
ALTER TABLE "blocked_times" ADD COLUMN     "kind" "BlockedTimeKind" NOT NULL DEFAULT 'BLOCKED';

-- CreateTable
CREATE TABLE "appointment_series" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "frequency" "RecurrenceFrequency" NOT NULL,
    "interval_count" INTEGER NOT NULL DEFAULT 1,
    "by_weekdays" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "until_date" DATE,
    "occurrence_count" INTEGER,
    "time_zone" TEXT NOT NULL,
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "appointment_series_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "availability_overrides" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "starts_at" TIME(0),
    "ends_at" TIME(0),
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "availability_overrides_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "appointment_settings" (
    "business_id" UUID NOT NULL,
    "default_buffer_minutes" INTEGER NOT NULL DEFAULT 0,
    "booking_min_notice_minutes" INTEGER NOT NULL DEFAULT 0,
    "booking_max_advance_days" INTEGER,
    "copy_email" TEXT,
    "copy_enabled" BOOLEAN NOT NULL DEFAULT true,
    "copy_reminders" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "appointment_settings_pkey" PRIMARY KEY ("business_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "appointment_series_business_id_id_key" ON "appointment_series"("business_id", "id");

-- CreateIndex
CREATE INDEX "availability_overrides_business_id_user_id_date_idx" ON "availability_overrides"("business_id", "user_id", "date");

-- CreateIndex
CREATE INDEX "appointments_business_id_series_id_idx" ON "appointments"("business_id", "series_id");

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_business_id_series_id_fkey" FOREIGN KEY ("business_id", "series_id") REFERENCES "appointment_series"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointment_series" ADD CONSTRAINT "appointment_series_business_id_created_by_user_id_fkey" FOREIGN KEY ("business_id", "created_by_user_id") REFERENCES "memberships"("business_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "availability_overrides" ADD CONSTRAINT "availability_overrides_business_id_user_id_fkey" FOREIGN KEY ("business_id", "user_id") REFERENCES "memberships"("business_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointment_settings" ADD CONSTRAINT "appointment_settings_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------- Grants and RLS ----------
-- A series is a record; overrides come and go; settings are one row.
GRANT SELECT, INSERT ON appointment_series TO firmivra_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON availability_overrides TO firmivra_app;
GRANT SELECT, INSERT, UPDATE ON appointment_settings TO firmivra_app;
ALTER TABLE appointment_series ENABLE ROW LEVEL SECURITY;
ALTER TABLE appointment_series FORCE ROW LEVEL SECURITY;
ALTER TABLE availability_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE availability_overrides FORCE ROW LEVEL SECURITY;
ALTER TABLE appointment_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE appointment_settings FORCE ROW LEVEL SECURITY;
CREATE POLICY appointment_series_business ON appointment_series
  USING (business_id = app_current_business_id())
  WITH CHECK (business_id = app_current_business_id());
CREATE POLICY availability_overrides_business ON availability_overrides
  USING (business_id = app_current_business_id())
  WITH CHECK (business_id = app_current_business_id());
CREATE POLICY appointment_settings_business ON appointment_settings
  USING (business_id = app_current_business_id())
  WITH CHECK (business_id = app_current_business_id());

-- ---------- Shape ----------
CREATE FUNCTION app_ints_distinct(v integer[]) RETURNS boolean
  LANGUAGE sql
  IMMUTABLE
  AS $$ SELECT (SELECT count(DISTINCT w) FROM unnest(v) w) = coalesce(cardinality(v), 0) $$;

ALTER TABLE appointment_series ADD CONSTRAINT appointment_series_rule
  CHECK (interval_count BETWEEN 1 AND 12
     AND (until_date IS NULL) <> (occurrence_count IS NULL)
     AND (occurrence_count IS NULL OR occurrence_count BETWEEN 1 AND 52)
     AND app_valid_time_zone(time_zone)
     AND (frequency = 'WEEKLY' OR cardinality(by_weekdays) = 0)
     AND by_weekdays <@ ARRAY[0, 1, 2, 3, 4, 5, 6]
     AND app_ints_distinct(by_weekdays));

ALTER TABLE availability_overrides ADD CONSTRAINT availability_overrides_hours
  CHECK ((starts_at IS NULL) = (ends_at IS NULL) AND (starts_at IS NULL OR ends_at > starts_at));

ALTER TABLE appointments ADD CONSTRAINT appointments_buffers
  CHECK (buffer_before_minutes BETWEEN 0 AND 240 AND buffer_after_minutes BETWEEN 0 AND 240);
ALTER TABLE appointment_types ADD CONSTRAINT appointment_types_booking_rules
  CHECK (buffer_before_minutes BETWEEN 0 AND 240 AND buffer_after_minutes BETWEEN 0 AND 240
     AND min_notice_minutes BETWEEN 0 AND 43200
     AND (max_advance_days IS NULL OR max_advance_days BETWEEN 1 AND 730));

ALTER TABLE appointment_settings ADD CONSTRAINT appointment_settings_rules
  CHECK (default_buffer_minutes BETWEEN 0 AND 240
     AND booking_min_notice_minutes BETWEEN 0 AND 43200
     AND (booking_max_advance_days IS NULL OR booking_max_advance_days BETWEEN 1 AND 730)
     AND (copy_email IS NULL OR (copy_email = lower(copy_email) AND char_length(copy_email) <= 254
          AND copy_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'))
     AND (NOT copy_reminders OR copy_email IS NOT NULL));

-- ---------- Rules ----------
-- The staff rule counts the buffers: a member's live appointments, each with its buffers, never
-- overlap. Times in whole seconds from the epoch (an immutable form of the timestamp: the zone
-- plays no part in an epoch), so back-to-back with no buffer is still fine (half-open ranges).
CREATE FUNCTION app_epoch_seconds(ts timestamptz) RETURNS bigint
  LANGUAGE sql
  IMMUTABLE
  PARALLEL SAFE
  AS $$ SELECT floor(extract(epoch FROM ts))::bigint $$;

ALTER TABLE appointments DROP CONSTRAINT appointments_no_double_booking_staff;
ALTER TABLE appointments ADD CONSTRAINT appointments_no_double_booking_staff
  EXCLUDE USING gist (business_id WITH =, staff_user_id WITH =,
                      int8range(app_epoch_seconds(starts_at) - buffer_before_minutes * 60,
                                app_epoch_seconds(ends_at) + buffer_after_minutes * 60, '[)') WITH &&)
  WHERE (status <> 'CANCELLED');
