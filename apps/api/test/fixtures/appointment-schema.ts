/** Test-only proposed table contracts. Rasel supplies production migrations. */
export const appointmentSchema = [
  `CREATE EXTENSION IF NOT EXISTS btree_gist`,
  `CREATE TABLE IF NOT EXISTS appointment_types (id uuid PRIMARY KEY,business_id uuid NOT NULL REFERENCES businesses(id),name text NOT NULL,duration_minutes int NOT NULL CHECK(duration_minutes BETWEEN 1 AND 480),buffer_before_minutes int NOT NULL CHECK(buffer_before_minutes BETWEEN 0 AND 120),buffer_after_minutes int NOT NULL CHECK(buffer_after_minutes BETWEEN 0 AND 120),allowed_methods text[] NOT NULL,client_booking_enabled boolean NOT NULL,active boolean NOT NULL,is_intro_call boolean NOT NULL DEFAULT false,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),UNIQUE(business_id,id),CHECK(NOT is_intro_call OR (duration_minutes=5 AND allowed_methods=ARRAY['PHONE']::text[])))`,
  `CREATE TABLE IF NOT EXISTS working_hours (id uuid PRIMARY KEY,business_id uuid NOT NULL REFERENCES businesses(id),provider_membership_id uuid NOT NULL,weekday int NOT NULL CHECK(weekday BETWEEN 0 AND 6),start_minute int NOT NULL CHECK(start_minute BETWEEN 0 AND 1439),end_minute int NOT NULL CHECK(end_minute BETWEEN 1 AND 1440 AND end_minute>start_minute),FOREIGN KEY(business_id,provider_membership_id) REFERENCES memberships(business_id,id))`,
  `CREATE TABLE IF NOT EXISTS blocked_times (id uuid PRIMARY KEY,business_id uuid NOT NULL REFERENCES businesses(id),provider_membership_id uuid NOT NULL,starts_at timestamptz NOT NULL,ends_at timestamptz NOT NULL CHECK(ends_at>starts_at),reason text,created_at timestamptz NOT NULL DEFAULT now(),FOREIGN KEY(business_id,provider_membership_id) REFERENCES memberships(business_id,id))`,
  `CREATE TABLE IF NOT EXISTS appointments (id uuid PRIMARY KEY,business_id uuid NOT NULL REFERENCES businesses(id),client_id uuid NOT NULL,client_name text NOT NULL,provider_membership_id uuid NOT NULL,provider_name text NOT NULL,type_id uuid NOT NULL,type_name text NOT NULL,starts_at timestamptz NOT NULL,ends_at timestamptz NOT NULL CHECK(ends_at>starts_at),occupied_starts_at timestamptz NOT NULL CHECK(occupied_starts_at<=starts_at),occupied_ends_at timestamptz NOT NULL CHECK(occupied_ends_at>=ends_at),buffer_before_minutes int NOT NULL,buffer_after_minutes int NOT NULL,timezone text NOT NULL,method text NOT NULL CHECK(method IN ('PHONE','VIDEO','IN_PERSON')),location text,meeting_url text,instructions text,status text NOT NULL CHECK(status IN ('BOOKED','CANCELLED','COMPLETED','NO_SHOW')),version int NOT NULL CHECK(version>0),created_by_user_id uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),UNIQUE(business_id,id),FOREIGN KEY(business_id,client_id) REFERENCES clients(business_id,id),FOREIGN KEY(business_id,provider_membership_id) REFERENCES memberships(business_id,id),FOREIGN KEY(business_id,type_id) REFERENCES appointment_types(business_id,id),CONSTRAINT appointments_no_overlap EXCLUDE USING gist(business_id WITH =,provider_membership_id WITH =,tstzrange(occupied_starts_at,occupied_ends_at,'[)') WITH &&) WHERE (status='BOOKED'))`,
  `CREATE INDEX IF NOT EXISTS appointment_page ON appointments(business_id,created_at DESC,id DESC)`,
  `CREATE TABLE IF NOT EXISTS appointment_histories (id uuid PRIMARY KEY,business_id uuid NOT NULL REFERENCES businesses(id),appointment_id uuid NOT NULL,action text NOT NULL,actor_user_id uuid REFERENCES users(id),previous_starts_at timestamptz,previous_ends_at timestamptz,previous_status text,new_starts_at timestamptz NOT NULL,new_ends_at timestamptz NOT NULL,new_status text NOT NULL,reason text,created_at timestamptz NOT NULL DEFAULT now(),FOREIGN KEY(business_id,appointment_id) REFERENCES appointments(business_id,id))`,
  `CREATE TABLE IF NOT EXISTS appointment_reminders (id uuid PRIMARY KEY,business_id uuid NOT NULL REFERENCES businesses(id),appointment_id uuid NOT NULL,appointment_version int NOT NULL,recipient_user_id uuid NOT NULL REFERENCES users(id),kind text NOT NULL,event_key text NOT NULL,due_at timestamptz NOT NULL,next_attempt_at timestamptz NOT NULL,lease_until timestamptz,lease_token uuid,attempts int NOT NULL DEFAULT 0,status text NOT NULL CHECK(status IN ('PENDING','PROCESSING','QUEUED','CANCELLED')),last_error_code text,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(business_id,event_key),FOREIGN KEY(business_id,appointment_id) REFERENCES appointments(business_id,id))`,
  `CREATE INDEX IF NOT EXISTS appointment_reminder_due ON appointment_reminders(business_id,status,next_attempt_at,due_at)`,
  ...[
    'appointment_types',
    'working_hours',
    'blocked_times',
    'appointments',
    'appointment_histories',
    'appointment_reminders',
  ].flatMap((table) => [
    `ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`,
    `ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`,
    `DROP POLICY IF EXISTS fixture_firm ON ${table}`,
    `CREATE POLICY fixture_firm ON ${table} USING(app_scope()='business' AND business_id=app_current_business_id()) WITH CHECK(app_scope()='business' AND business_id=app_current_business_id())`,
    `GRANT SELECT,INSERT ON ${table} TO firmivra_app`,
    ...(table === 'appointment_histories'
      ? [`REVOKE UPDATE,DELETE ON ${table} FROM firmivra_app`]
      : [
          `GRANT UPDATE ON ${table} TO firmivra_app`,
          ...(['working_hours', 'blocked_times'].includes(table)
            ? [`GRANT DELETE ON ${table} TO firmivra_app`]
            : [`REVOKE DELETE ON ${table} FROM firmivra_app`]),
        ]),
  ]),
];
