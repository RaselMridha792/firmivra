-- Appointments Review 2, P1 rows 1 and 2 (Rasel, Nov 14): an Other Video Meeting names its
-- platform, a type offers up to four meeting methods, and a booking window can be hours.

-- Row 1: the platform of an Other Video Meeting (Teams, Google Meet...), 1 to 60 characters,
-- set exactly when the type offers OTHER_VIDEO or the appointment is one.
ALTER TABLE "appointment_types" ADD COLUMN "max_window_hours" INTEGER,
ADD COLUMN "other_video_platform" TEXT;
ALTER TABLE "appointments" ADD COLUMN "other_video_platform" TEXT;

ALTER TABLE appointment_types ADD CONSTRAINT appointment_types_other_video_platform
  CHECK ((other_video_platform IS NOT NULL) = ('OTHER_VIDEO' = ANY (meeting_methods))
     AND (other_video_platform IS NULL
          OR (char_length(other_video_platform) BETWEEN 1 AND 60 AND btrim(other_video_platform) <> '')));
ALTER TABLE appointments ADD CONSTRAINT appointments_other_video_platform
  CHECK ((other_video_platform IS NOT NULL) = (location_kind = 'OTHER_VIDEO')
     AND (other_video_platform IS NULL
          OR (char_length(other_video_platform) BETWEEN 1 AND 60 AND btrim(other_video_platform) <> '')));

-- With OTHER_VIDEO a type may offer all four methods (was 1 to 3).
ALTER TABLE appointment_types DROP CONSTRAINT appointment_types_meeting_methods;
ALTER TABLE appointment_types ADD CONSTRAINT appointment_types_meeting_methods
  CHECK (meeting_methods IS NOT NULL AND array_ndims(meeting_methods) = 1
     AND cardinality(meeting_methods) BETWEEN 1 AND 4 AND app_array_distinct(meeting_methods)
     AND meeting_methods[1] = location_kind);

-- Row 2: a booking window in hours (2 to 17,520, that is up to 730 days, as max_advance_days);
-- when set, the API uses it instead of max_advance_days.
ALTER TABLE appointment_types ADD CONSTRAINT appointment_types_max_window_hours
  CHECK (max_window_hours IS NULL OR max_window_hours BETWEEN 2 AND 17520);
