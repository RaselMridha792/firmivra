-- r1_locations_roles_links (R1, Oct 21, Rasel's block): Settings > Locations on firm_offices
-- (contact, status, time zone, manager, services, hours, scheduled actions, the address
-- duplicate check); appointment types' meeting methods; custom roles and the Business
-- Consultant role; 100 MB per file on the document paths; the document link code settings;
-- secure document links and their one-time codes.

-- CreateEnum
CREATE TYPE "FirmOfficeKind" AS ENUM ('OFFICE', 'VIRTUAL');

-- CreateEnum
CREATE TYPE "FirmOfficeStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "FirmOfficeActionKind" AS ENUM ('DEACTIVATE_LOCATION', 'DEACTIVATE_MANAGER', 'REASSIGN_MANAGER');

-- CreateEnum
CREATE TYPE "FirmOfficeActionStatus" AS ENUM ('PENDING', 'DONE', 'CANCELLED', 'FAILED');

-- CreateEnum
CREATE TYPE "DocumentLinkKind" AS ENUM ('CLIENT', 'INTERNAL');

-- AlterEnum
ALTER TYPE "MembershipRole" ADD VALUE 'BUSINESS_CONSULTANT' BEFORE 'READ_ONLY';

-- AlterTable
ALTER TABLE "appointment_types" ADD COLUMN     "meeting_methods" "LocationKind"[] DEFAULT ARRAY[]::"LocationKind"[];

-- AlterTable
ALTER TABLE "document_settings" ADD COLUMN     "client_link_code_required" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "internal_link_code_required" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "firm_offices" ADD COLUMN     "address_key" TEXT,
ADD COLUMN     "address_line2" TEXT,
ADD COLUMN     "alternate_phone" TEXT,
ADD COLUMN     "email" TEXT,
ADD COLUMN     "kind" "FirmOfficeKind" NOT NULL DEFAULT 'OFFICE',
ADD COLUMN     "manager_user_id" UUID,
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "phone" TEXT,
ADD COLUMN     "photo_key" TEXT,
ADD COLUMN     "status" "FirmOfficeStatus" NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN     "time_zone" TEXT;

-- AlterTable
ALTER TABLE "memberships" ADD COLUMN     "custom_role_id" UUID;

-- CreateTable
CREATE TABLE "firm_office_services" (
    "business_id" UUID NOT NULL,
    "office_id" UUID NOT NULL,
    "service_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "firm_office_services_pkey" PRIMARY KEY ("office_id","service_id")
);

-- CreateTable
CREATE TABLE "firm_office_hours" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "office_id" UUID NOT NULL,
    "weekday" INTEGER NOT NULL,
    "opens_at" TIME(0) NOT NULL,
    "closes_at" TIME(0) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "firm_office_hours_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "firm_office_actions" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "kind" "FirmOfficeActionKind" NOT NULL,
    "office_id" UUID,
    "manager_user_id" UUID,
    "new_manager_user_id" UUID,
    "status" "FirmOfficeActionStatus" NOT NULL DEFAULT 'PENDING',
    "effective_at" TIMESTAMPTZ(3) NOT NULL,
    "original_effective_at" TIMESTAMPTZ(3),
    "created_by_user_id" UUID NOT NULL,
    "updated_by_user_id" UUID,
    "finished_at" TIMESTAMPTZ(3),
    "failure_code" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "firm_office_actions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "custom_roles" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "based_on" "MembershipRole" NOT NULL,
    "archived_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "custom_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "custom_role_permissions" (
    "business_id" UUID NOT NULL,
    "custom_role_id" UUID NOT NULL,
    "module" "PermissionModule" NOT NULL,
    "capability" "PermissionCapability" NOT NULL,
    "granted" BOOLEAN NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "custom_role_permissions_pkey" PRIMARY KEY ("custom_role_id","module","capability")
);

-- CreateTable
CREATE TABLE "document_links" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "kind" "DocumentLinkKind" NOT NULL,
    "client_id" UUID,
    "recipient_user_id" UUID,
    "recipient_email" TEXT,
    "recipient_phone" TEXT,
    "sent_via" "VerificationChannel" NOT NULL,
    "code_required" BOOLEAN NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "failed_attempts" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMPTZ(3),
    "verified_at" TIMESTAMPTZ(3),
    "revoked_at" TIMESTAMPTZ(3),
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_link_codes" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "link_id" UUID NOT NULL,
    "channel" "VerificationChannel" NOT NULL,
    "code_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "consumed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_link_codes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "firm_office_services_business_id_service_id_idx" ON "firm_office_services"("business_id", "service_id");

-- CreateIndex
CREATE INDEX "firm_office_hours_business_id_office_id_idx" ON "firm_office_hours"("business_id", "office_id");

-- CreateIndex
CREATE INDEX "firm_office_actions_business_id_status_effective_at_idx" ON "firm_office_actions"("business_id", "status", "effective_at");

-- CreateIndex
CREATE INDEX "firm_office_actions_business_id_office_id_idx" ON "firm_office_actions"("business_id", "office_id");

-- CreateIndex
CREATE UNIQUE INDEX "custom_roles_business_id_id_key" ON "custom_roles"("business_id", "id");

-- CreateIndex
CREATE INDEX "custom_role_permissions_business_id_custom_role_id_idx" ON "custom_role_permissions"("business_id", "custom_role_id");

-- CreateIndex
CREATE INDEX "document_links_business_id_document_id_idx" ON "document_links"("business_id", "document_id");

-- CreateIndex
CREATE INDEX "document_links_business_id_client_id_idx" ON "document_links"("business_id", "client_id");

-- CreateIndex
CREATE UNIQUE INDEX "document_links_business_id_token_hash_key" ON "document_links"("business_id", "token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "document_links_business_id_id_key" ON "document_links"("business_id", "id");

-- CreateIndex
CREATE INDEX "document_link_codes_business_id_link_id_created_at_idx" ON "document_link_codes"("business_id", "link_id", "created_at");

-- CreateIndex
CREATE INDEX "firm_offices_business_id_manager_user_id_idx" ON "firm_offices"("business_id", "manager_user_id");

-- CreateIndex
CREATE INDEX "memberships_business_id_custom_role_id_idx" ON "memberships"("business_id", "custom_role_id");

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_business_id_custom_role_id_fkey" FOREIGN KEY ("business_id", "custom_role_id") REFERENCES "custom_roles"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "firm_offices" ADD CONSTRAINT "firm_offices_business_id_manager_user_id_fkey" FOREIGN KEY ("business_id", "manager_user_id") REFERENCES "memberships"("business_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "firm_office_services" ADD CONSTRAINT "firm_office_services_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "firm_office_services" ADD CONSTRAINT "firm_office_services_business_id_office_id_fkey" FOREIGN KEY ("business_id", "office_id") REFERENCES "firm_offices"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "firm_office_services" ADD CONSTRAINT "firm_office_services_business_id_service_id_fkey" FOREIGN KEY ("business_id", "service_id") REFERENCES "services"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "firm_office_hours" ADD CONSTRAINT "firm_office_hours_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "firm_office_hours" ADD CONSTRAINT "firm_office_hours_business_id_office_id_fkey" FOREIGN KEY ("business_id", "office_id") REFERENCES "firm_offices"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "firm_office_actions" ADD CONSTRAINT "firm_office_actions_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "firm_office_actions" ADD CONSTRAINT "firm_office_actions_business_id_office_id_fkey" FOREIGN KEY ("business_id", "office_id") REFERENCES "firm_offices"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "firm_office_actions" ADD CONSTRAINT "firm_office_actions_business_id_manager_user_id_fkey" FOREIGN KEY ("business_id", "manager_user_id") REFERENCES "memberships"("business_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "firm_office_actions" ADD CONSTRAINT "firm_office_actions_business_id_new_manager_user_id_fkey" FOREIGN KEY ("business_id", "new_manager_user_id") REFERENCES "memberships"("business_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "firm_office_actions" ADD CONSTRAINT "firm_office_actions_business_id_created_by_user_id_fkey" FOREIGN KEY ("business_id", "created_by_user_id") REFERENCES "memberships"("business_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "firm_office_actions" ADD CONSTRAINT "firm_office_actions_business_id_updated_by_user_id_fkey" FOREIGN KEY ("business_id", "updated_by_user_id") REFERENCES "memberships"("business_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custom_roles" ADD CONSTRAINT "custom_roles_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custom_role_permissions" ADD CONSTRAINT "custom_role_permissions_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custom_role_permissions" ADD CONSTRAINT "custom_role_permissions_business_id_custom_role_id_fkey" FOREIGN KEY ("business_id", "custom_role_id") REFERENCES "custom_roles"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_links" ADD CONSTRAINT "document_links_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_links" ADD CONSTRAINT "document_links_business_id_document_id_fkey" FOREIGN KEY ("business_id", "document_id") REFERENCES "documents"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_links" ADD CONSTRAINT "document_links_business_id_client_id_fkey" FOREIGN KEY ("business_id", "client_id") REFERENCES "clients"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_links" ADD CONSTRAINT "document_links_business_id_recipient_user_id_fkey" FOREIGN KEY ("business_id", "recipient_user_id") REFERENCES "memberships"("business_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_links" ADD CONSTRAINT "document_links_business_id_created_by_user_id_fkey" FOREIGN KEY ("business_id", "created_by_user_id") REFERENCES "memberships"("business_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_link_codes" ADD CONSTRAINT "document_link_codes_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_link_codes" ADD CONSTRAINT "document_link_codes_business_id_link_id_fkey" FOREIGN KEY ("business_id", "link_id") REFERENCES "document_links"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------- Grants and RLS ----------

-- A location's services and hours are replaced as a set (DELETE); the rest is never deleted.
GRANT SELECT, INSERT, UPDATE, DELETE ON firm_office_services, firm_office_hours TO firmivra_app;
GRANT SELECT, INSERT, UPDATE ON firm_office_actions, custom_roles, custom_role_permissions,
  document_links, document_link_codes TO firmivra_app;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['firm_office_services', 'firm_office_hours', 'firm_office_actions',
    'custom_roles', 'custom_role_permissions', 'document_links', 'document_link_codes']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I ON %I USING (business_id = app_current_business_id()) '
      'WITH CHECK (business_id = app_current_business_id())', t || '_business', t);
  END LOOP;
END $$;

-- ---------- Locations (firm_offices and its tables) ----------

-- A location's address for the duplicate check: lower case, every run of anything but letters
-- and digits to one space, and the ZIP to its first 5 digits. Null without a first address line
-- (a virtual location), so those never block each other.
CREATE FUNCTION app_address_key(line1 text, line2 text, city text, state text, postal text)
  RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE WHEN line1 IS NULL OR btrim(line1) = '' THEN NULL ELSE
    btrim(regexp_replace(lower(coalesce(line1, '') || ' ' || coalesce(line2, '') || ' '
      || coalesce(city, '') || ' ' || coalesce(state, '')), '[^a-z0-9]+', ' ', 'g'))
    || '|' || substring(regexp_replace(coalesce(postal, ''), '[^0-9]', '', 'g') FROM 1 FOR 5)
  END
$$;

CREATE FUNCTION firm_offices_address_key() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.address_key := app_address_key(NEW.address_line1, NEW.address_line2, NEW.city, NEW.state,
    NEW.postal_code);
  RETURN NEW;
END
$$;
CREATE TRIGGER firm_offices_address_key BEFORE INSERT OR UPDATE ON firm_offices
  FOR EACH ROW EXECUTE FUNCTION firm_offices_address_key();
UPDATE firm_offices SET address_key = app_address_key(address_line1, address_line2, city, state,
  postal_code);

ALTER TABLE firm_offices ADD CONSTRAINT firm_offices_contact
  CHECK ((address_line2 IS NULL OR (char_length(btrim(address_line2)) >= 1 AND char_length(address_line2) <= 200))
     AND (phone IS NULL OR phone ~ '^\+[1-9][0-9]{6,14}$')
     AND (alternate_phone IS NULL OR alternate_phone ~ '^\+[1-9][0-9]{6,14}$')
     AND (email IS NULL OR (char_length(email) BETWEEN 3 AND 254 AND email = lower(email)
       AND email = btrim(email) AND position('@' IN email) > 1))
     AND (time_zone IS NULL OR app_valid_time_zone(time_zone))
     AND (notes IS NULL OR (char_length(btrim(notes)) >= 1 AND char_length(notes) <= 500))
     AND (photo_key IS NULL OR (starts_with(photo_key, 'tenant/' || business_id || '/offices/')
       AND photo_key ~ '^[A-Za-z0-9/._-]+$' AND photo_key !~ '(^|/)\.\.?(/|$)')));
ALTER TABLE firm_offices ADD CONSTRAINT firm_offices_virtual_no_address
  CHECK (kind <> 'VIRTUAL' OR (address_line1 IS NULL AND address_line2 IS NULL));
ALTER TABLE firm_offices ADD CONSTRAINT firm_offices_main_active
  CHECK (NOT is_main OR status = 'ACTIVE');
ALTER TABLE firm_offices ADD CONSTRAINT firm_offices_address_key_matches
  CHECK (address_key IS NOT DISTINCT FROM app_address_key(address_line1, address_line2, city, state,
    postal_code));
-- "This location already exists": one live location per address. The same name stays blocked
-- by firm_offices_live_name; the same EIN or business name alone never blocks.
CREATE UNIQUE INDEX firm_offices_live_address ON firm_offices (business_id, address_key)
  WHERE archived_at IS NULL AND address_key IS NOT NULL;

ALTER TABLE firm_office_hours ADD CONSTRAINT firm_office_hours_weekday
  CHECK (weekday BETWEEN 0 AND 6);
ALTER TABLE firm_office_hours ADD CONSTRAINT firm_office_hours_range
  CHECK (opens_at < closes_at);
-- A day's intervals never overlap (touching is fine: 09:00-12:00 and 12:00-17:00).
ALTER TABLE firm_office_hours ADD CONSTRAINT firm_office_hours_no_overlap
  EXCLUDE USING gist (office_id WITH =, weekday WITH =,
    int4range(extract(epoch FROM opens_at)::int, extract(epoch FROM closes_at)::int) WITH &&);

ALTER TABLE firm_office_actions ADD CONSTRAINT firm_office_actions_shape
  CHECK (CASE kind
      WHEN 'DEACTIVATE_LOCATION' THEN office_id IS NOT NULL AND manager_user_id IS NULL
        AND new_manager_user_id IS NULL
      WHEN 'DEACTIVATE_MANAGER' THEN office_id IS NULL AND manager_user_id IS NOT NULL
      ELSE office_id IS NOT NULL AND new_manager_user_id IS NOT NULL
    END
    AND (new_manager_user_id IS NULL OR new_manager_user_id IS DISTINCT FROM manager_user_id));
ALTER TABLE firm_office_actions ADD CONSTRAINT firm_office_actions_state
  CHECK ((status = 'PENDING') = (finished_at IS NULL)
     AND original_effective_at IS NOT NULL
     AND (failure_code IS NULL OR (status = 'FAILED' AND failure_code ~ '^[A-Z][A-Z0-9_]{0,49}$')));
-- No conflicting pending changes: one per location, one manager deactivation per manager.
CREATE UNIQUE INDEX firm_office_actions_one_pending_per_office
  ON firm_office_actions (business_id, office_id) WHERE status = 'PENDING' AND office_id IS NOT NULL;
CREATE UNIQUE INDEX firm_office_actions_one_pending_per_manager
  ON firm_office_actions (business_id, manager_user_id)
  WHERE status = 'PENDING' AND kind = 'DEACTIVATE_MANAGER';

-- New actions start PENDING with the database's time; while PENDING only the time, the new
-- manager and the status change; DONE only once due; a finished action never changes (so it
-- never runs twice).
CREATE FUNCTION firm_office_actions_rules() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'PENDING' THEN
      RAISE EXCEPTION 'firm office actions: a new action is PENDING' USING ERRCODE = 'check_violation';
    END IF;
    NEW.created_at := now();
    NEW.original_effective_at := NEW.effective_at;
    NEW.finished_at := NULL;
    RETURN NEW;
  END IF;
  IF OLD.status <> 'PENDING' THEN
    RAISE EXCEPTION 'firm office actions: a finished action never changes'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.id <> OLD.id OR NEW.business_id <> OLD.business_id OR NEW.kind <> OLD.kind
     OR NEW.office_id IS DISTINCT FROM OLD.office_id
     OR NEW.manager_user_id IS DISTINCT FROM OLD.manager_user_id
     OR NEW.created_by_user_id <> OLD.created_by_user_id OR NEW.created_at <> OLD.created_at
     OR NEW.original_effective_at IS DISTINCT FROM OLD.original_effective_at THEN
    RAISE EXCEPTION 'firm office actions: only the time, the new manager and the status change'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status = 'PENDING' THEN
    NEW.finished_at := NULL;
    RETURN NEW;
  END IF;
  IF NEW.effective_at <> OLD.effective_at
     OR NEW.new_manager_user_id IS DISTINCT FROM OLD.new_manager_user_id THEN
    RAISE EXCEPTION 'firm office actions: an action finishes as it was scheduled'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status = 'DONE' AND OLD.effective_at > now() THEN
    RAISE EXCEPTION 'firm office actions: an action runs only once it is due'
      USING ERRCODE = 'check_violation';
  END IF;
  NEW.finished_at := now();
  RETURN NEW;
END
$$;
CREATE TRIGGER firm_office_actions_rules BEFORE INSERT OR UPDATE ON firm_office_actions
  FOR EACH ROW EXECUTE FUNCTION firm_office_actions_rules();

-- ---------- Appointment types: meeting methods ----------

UPDATE appointment_types SET meeting_methods = ARRAY[location_kind];

-- Inserted without methods: the type's location kind. Otherwise the first method is the location
-- kind; changing only the location kind moves it to the front of the methods.
CREATE FUNCTION appointment_types_meeting_methods() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.meeting_methods IS NULL OR cardinality(NEW.meeting_methods) = 0 THEN
      NEW.meeting_methods := ARRAY[NEW.location_kind];
    ELSE
      NEW.location_kind := NEW.meeting_methods[1];
    END IF;
  ELSIF NEW.meeting_methods IS DISTINCT FROM OLD.meeting_methods THEN
    IF cardinality(NEW.meeting_methods) > 0 THEN
      NEW.location_kind := NEW.meeting_methods[1];
    END IF;
  ELSIF NEW.location_kind IS DISTINCT FROM OLD.location_kind THEN
    NEW.meeting_methods := ARRAY[NEW.location_kind] || array_remove(OLD.meeting_methods, NEW.location_kind);
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER appointment_types_meeting_methods BEFORE INSERT OR UPDATE ON appointment_types
  FOR EACH ROW EXECUTE FUNCTION appointment_types_meeting_methods();
ALTER TABLE appointment_types ADD CONSTRAINT appointment_types_meeting_methods
  CHECK (meeting_methods IS NOT NULL AND array_ndims(meeting_methods) = 1
     AND cardinality(meeting_methods) BETWEEN 1 AND 3 AND app_array_distinct(meeting_methods)
     AND meeting_methods[1] = location_kind);

-- ---------- Custom roles (Users & Roles) ----------

ALTER TABLE custom_roles ADD CONSTRAINT custom_roles_values
  CHECK (char_length(btrim(name)) >= 1 AND char_length(name) <= 60 AND app_no_hidden_characters(name)
     AND (description IS NULL
       OR (char_length(btrim(description)) >= 1 AND char_length(description) <= 300))
     AND based_on <> 'OWNER');
CREATE UNIQUE INDEX custom_roles_live_name ON custom_roles (business_id, lower(btrim(name)))
  WHERE archived_at IS NULL;

CREATE FUNCTION custom_roles_rules() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id <> OLD.id OR NEW.business_id <> OLD.business_id OR NEW.based_on <> OLD.based_on
     OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'custom roles: the id, firm and starting role never change'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER custom_roles_rules BEFORE UPDATE ON custom_roles
  FOR EACH ROW EXECUTE FUNCTION custom_roles_rules();

CREATE FUNCTION custom_role_permissions_rules() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.business_id <> OLD.business_id OR NEW.custom_role_id <> OLD.custom_role_id
     OR NEW.module <> OLD.module OR NEW.capability <> OLD.capability THEN
    RAISE EXCEPTION 'custom role permissions: only granted changes' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER custom_role_permissions_rules BEFORE UPDATE ON custom_role_permissions
  FOR EACH ROW EXECUTE FUNCTION custom_role_permissions_rules();

-- A member with a custom role has the role it started from, so every role check stays right;
-- an archived custom role cannot be given (members who already have it keep it).
CREATE FUNCTION memberships_custom_role() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  r record;
BEGIN
  IF NEW.custom_role_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT based_on, archived_at INTO r FROM custom_roles
    WHERE business_id = NEW.business_id AND id = NEW.custom_role_id;
  IF NOT FOUND THEN
    RETURN NEW; -- the foreign key refuses an unknown role
  END IF;
  IF NEW.role <> r.based_on THEN
    RAISE EXCEPTION 'memberships: a member with a custom role has the role it is based on'
      USING ERRCODE = 'check_violation';
  END IF;
  IF r.archived_at IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.custom_role_id IS DISTINCT FROM OLD.custom_role_id) THEN
    RAISE EXCEPTION 'memberships: an archived custom role cannot be given'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER memberships_custom_role BEFORE INSERT OR UPDATE OF custom_role_id, role ON memberships
  FOR EACH ROW EXECUTE FUNCTION memberships_custom_role();

-- ---------- Secure document links and their codes ----------

ALTER TABLE document_links ADD CONSTRAINT document_links_values
  CHECK (token_hash ~ '^[0-9a-f]{64}$'
     AND (recipient_email IS NULL OR (char_length(recipient_email) BETWEEN 3 AND 254
       AND recipient_email = lower(recipient_email) AND recipient_email = btrim(recipient_email)
       AND position('@' IN recipient_email) > 1))
     AND (recipient_phone IS NULL OR recipient_phone ~ '^\+[1-9][0-9]{6,14}$')
     AND CASE kind
       WHEN 'CLIENT' THEN client_id IS NOT NULL AND recipient_user_id IS NULL
       ELSE recipient_user_id IS NOT NULL AND client_id IS NULL
     END
     AND CASE sent_via WHEN 'EMAIL' THEN recipient_email IS NOT NULL ELSE recipient_phone IS NOT NULL END
     -- The code goes over the other channel: a missing address never skips it.
     AND (NOT code_required OR (recipient_email IS NOT NULL AND recipient_phone IS NOT NULL))
     AND expires_at > created_at
     AND expires_at <= created_at
       + CASE kind WHEN 'CLIENT' THEN interval '24 hours' ELSE interval '48 hours' END
     AND failed_attempts BETWEEN 0 AND 4
     AND (verified_at IS NULL OR verified_at >= created_at)
     AND (revoked_at IS NULL OR revoked_at >= created_at));

-- The database's clock: created now, the expiry trimmed to its cap. Afterwards only the
-- counters, the lockout, the first verification and revoking change; wrong codes count up one at
-- a time, and go back to 0 only as a lockout of at most 15 minutes starts.
CREATE FUNCTION document_links_rules() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.created_at := now();
    NEW.expires_at := LEAST(NEW.expires_at, NEW.created_at
      + CASE NEW.kind WHEN 'CLIENT' THEN interval '24 hours' ELSE interval '48 hours' END);
    NEW.failed_attempts := 0;
    NEW.locked_until := NULL;
    NEW.verified_at := NULL;
    NEW.revoked_at := NULL;
    RETURN NEW;
  END IF;
  IF NEW.id <> OLD.id OR NEW.business_id <> OLD.business_id OR NEW.document_id <> OLD.document_id
     OR NEW.kind <> OLD.kind OR NEW.client_id IS DISTINCT FROM OLD.client_id
     OR NEW.recipient_user_id IS DISTINCT FROM OLD.recipient_user_id
     OR NEW.recipient_email IS DISTINCT FROM OLD.recipient_email
     OR NEW.recipient_phone IS DISTINCT FROM OLD.recipient_phone
     OR NEW.sent_via <> OLD.sent_via OR NEW.code_required <> OLD.code_required
     OR NEW.token_hash <> OLD.token_hash OR NEW.expires_at <> OLD.expires_at
     OR NEW.created_by_user_id <> OLD.created_by_user_id OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'document links: a link never changes who, what or how long'
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at THEN
    RAISE EXCEPTION 'document links: a revoked link stays revoked' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.verified_at IS NOT NULL AND NEW.verified_at IS DISTINCT FROM OLD.verified_at THEN
    RAISE EXCEPTION 'document links: the first verification never changes'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.locked_until IS DISTINCT FROM OLD.locked_until THEN
    IF NEW.locked_until IS NULL OR NEW.failed_attempts <> 0 THEN
      RAISE EXCEPTION 'document links: a lockout starts with the wrong codes back at 0'
        USING ERRCODE = 'check_violation';
    END IF;
    NEW.locked_until := LEAST(NEW.locked_until, now() + interval '15 minutes');
  ELSIF NEW.failed_attempts NOT IN (OLD.failed_attempts, OLD.failed_attempts + 1) THEN
    RAISE EXCEPTION 'document links: wrong codes count up one at a time'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER document_links_rules BEFORE INSERT OR UPDATE ON document_links
  FOR EACH ROW EXECUTE FUNCTION document_links_rules();

ALTER TABLE document_link_codes ADD CONSTRAINT document_link_codes_values
  CHECK (code_hash ~ '^[0-9a-f]{64}$'
     AND expires_at > created_at AND expires_at <= created_at + interval '10 minutes'
     AND (consumed_at IS NULL OR (consumed_at >= created_at AND consumed_at <= expires_at)));

-- A code is created now (database clock) for a live link that asks for one, over the other
-- channel, and lasts at most 10 minutes. It is used once, before it expires, and only while it
-- is the link's newest code (a new code invalidates the last).
CREATE FUNCTION document_link_codes_rules() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  l record;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT code_required, sent_via, expires_at, revoked_at INTO l FROM document_links
      WHERE business_id = NEW.business_id AND id = NEW.link_id;
    IF FOUND AND (NOT l.code_required OR l.revoked_at IS NOT NULL OR l.expires_at <= now()
        OR NEW.channel = l.sent_via) THEN
      RAISE EXCEPTION 'document link codes: only a live link that asks for a code gets one, over the other channel'
        USING ERRCODE = 'check_violation';
    END IF;
    NEW.created_at := now();
    NEW.expires_at := LEAST(NEW.expires_at, NEW.created_at + interval '10 minutes');
    NEW.consumed_at := NULL;
    RETURN NEW;
  END IF;
  IF NEW.id <> OLD.id OR NEW.business_id <> OLD.business_id OR NEW.link_id <> OLD.link_id
     OR NEW.channel <> OLD.channel OR NEW.code_hash <> OLD.code_hash
     OR NEW.expires_at <> OLD.expires_at OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'document link codes: only consumed_at changes' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.consumed_at IS NOT DISTINCT FROM OLD.consumed_at THEN
    RETURN NEW;
  END IF;
  IF OLD.consumed_at IS NOT NULL OR NEW.consumed_at IS NULL THEN
    RAISE EXCEPTION 'document link codes: a code is used once' USING ERRCODE = 'check_violation';
  END IF;
  IF now() > OLD.expires_at THEN
    RAISE EXCEPTION 'document link codes: the code has expired' USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM document_link_codes c WHERE c.business_id = OLD.business_id
      AND c.link_id = OLD.link_id AND (c.created_at, c.id) > (OLD.created_at, OLD.id)) THEN
    RAISE EXCEPTION 'document link codes: only the newest code can be used'
      USING ERRCODE = 'check_violation';
  END IF;
  NEW.consumed_at := now();
  RETURN NEW;
END
$$;
CREATE TRIGGER document_link_codes_rules BEFORE INSERT OR UPDATE ON document_link_codes
  FOR EACH ROW EXECUTE FUNCTION document_link_codes_rules();

-- ---------- 100 MB per file on the document paths (was 10 MB) ----------
-- documents, document settings, Begin Online uploads, intake settings (MB), agreement files,
-- staff documents and Firm Sign (a 100 MB document can be sent for signature). The integer
-- columns hold 104857600. Message-template attachments and the platform support and
-- communications files stay at 10 MB.
ALTER TABLE documents DROP CONSTRAINT documents_size_10_mb;
ALTER TABLE documents ADD CONSTRAINT documents_size_100_mb
  CHECK (((size_bytes >= 1) AND (size_bytes <= 104857600)));
ALTER TABLE document_settings DROP CONSTRAINT document_settings_ranges;
ALTER TABLE document_settings ADD CONSTRAINT document_settings_ranges
  CHECK ((((request_reminder_days_before IS NULL) OR ((request_reminder_days_before >= 1) AND (request_reminder_days_before <= 30))) AND ((request_expiry_days IS NULL) OR ((request_expiry_days >= 1) AND (request_expiry_days <= 365))) AND ((document_expiry_reminder_days IS NULL) OR ((document_expiry_reminder_days >= 1) AND (document_expiry_reminder_days <= 365))) AND ((share_expiry_days IS NULL) OR ((share_expiry_days >= 1) AND (share_expiry_days <= 365))) AND ((upload_max_bytes IS NULL) OR ((upload_max_bytes >= 1) AND (upload_max_bytes <= 104857600)))));
ALTER TABLE esign_attachments DROP CONSTRAINT esign_attachments_values;
ALTER TABLE esign_attachments ADD CONSTRAINT esign_attachments_values
  CHECK ((esign_key_ok(s3_key, business_id, request_id, 'attachments/'::text) AND esign_hex64(sha256) AND esign_text_ok(file_name, 255) AND (content_type = ANY (ARRAY['application/pdf'::text, 'image/jpeg'::text, 'image/png'::text])) AND ((size_bytes >= 1) AND (size_bytes <= 104857600)) AND ((scan_status = 'PENDING'::"ScanStatus") = (scanned_at IS NULL))));
ALTER TABLE esign_documents DROP CONSTRAINT esign_documents_values;
ALTER TABLE esign_documents ADD CONSTRAINT esign_documents_values
  CHECK (((("position" >= 0) AND ("position" <= 99)) AND esign_text_ok(file_name, 255) AND (content_type = ANY (ARRAY['application/pdf'::text, 'image/jpeg'::text, 'image/png'::text])) AND ((size_bytes >= 1) AND (size_bytes <= 104857600)) AND ((page_count >= 1) AND (page_count <= 100)) AND (jsonb_typeof(page_sizes) = 'array'::text) AND (jsonb_array_length(page_sizes) = page_count) AND esign_key_ok(s3_key, business_id, request_id, ''::text) AND esign_hex64(sha256) AND ((scan_status = 'PENDING'::"ScanStatus") = (scanned_at IS NULL))));
ALTER TABLE esign_pending_uploads DROP CONSTRAINT esign_pending_uploads_values;
ALTER TABLE esign_pending_uploads ADD CONSTRAINT esign_pending_uploads_values
  CHECK ((esign_hex64(token_hash) AND esign_hex64(sha256) AND esign_text_ok(file_name, 255) AND (content_type = ANY (ARRAY['application/pdf'::text, 'image/jpeg'::text, 'image/png'::text])) AND ((size_bytes >= 1) AND (size_bytes <= 104857600)) AND
CASE kind
    WHEN 'DOCUMENT'::"EsignUploadKind" THEN ((user_id IS NOT NULL) AND (recipient_id IS NULL) AND (field_id IS NULL) AND esign_key_ok(s3_key, business_id, request_id, ''::text))
    ELSE ((user_id IS NULL) AND (recipient_id IS NOT NULL) AND (field_id IS NOT NULL) AND esign_key_ok(s3_key, business_id, request_id, 'attachments/'::text))
END));
ALTER TABLE esign_template_versions DROP CONSTRAINT esign_template_versions_values;
ALTER TABLE esign_template_versions ADD CONSTRAINT esign_template_versions_values
  CHECK (((version >= 1) AND esign_key_ok(s3_key, business_id, template_id, 'template-'::text) AND esign_hex64(sha256) AND ((size_bytes >= 1) AND (size_bytes <= 104857600)) AND (jsonb_typeof(page_sizes) = 'array'::text) AND ((jsonb_array_length(page_sizes) >= 1) AND (jsonb_array_length(page_sizes) <= 100)) AND (jsonb_typeof(roles) = 'array'::text) AND (jsonb_array_length(roles) <= 20) AND (jsonb_typeof(fields) = 'array'::text) AND (jsonb_array_length(fields) <= 500) AND ((expiry_days >= 1) AND (expiry_days <= 365)) AND ((reminder_first_after_days >= 1) AND (reminder_first_after_days <= 60)) AND ((reminder_every_days >= 1) AND (reminder_every_days <= 60)) AND ((reminder_max >= 0) AND (reminder_max <= 10)) AND ((expiry_warning_days >= 0) AND (expiry_warning_days <= 30)) AND esign_text_ok(email_subject, 200) AND esign_text_ok(email_message, 1000) AND esign_text_ok(note, 500)));
ALTER TABLE firm_agreement_files DROP CONSTRAINT firm_agreement_files_size_10_mb;
ALTER TABLE firm_agreement_files ADD CONSTRAINT firm_agreement_files_size_100_mb
  CHECK (((size_bytes >= 1) AND (size_bytes <= 104857600)));
ALTER TABLE intake_settings DROP CONSTRAINT intake_settings_ranges;
ALTER TABLE intake_settings ADD CONSTRAINT intake_settings_ranges
  CHECK ((((default_expiry_days >= 1) AND (default_expiry_days <= 365)) AND ((first_reminder_days >= 1) AND (first_reminder_days <= 30)) AND (final_reminder_days > first_reminder_days) AND (final_reminder_days <= 60) AND ((expiry_alert_hours >= 1) AND (expiry_alert_hours <= 168)) AND ((max_file_size_mb >= 1) AND (max_file_size_mb <= 100))));
ALTER TABLE lead_uploads DROP CONSTRAINT lead_uploads_size_10_mb;
ALTER TABLE lead_uploads ADD CONSTRAINT lead_uploads_size_100_mb
  CHECK (((size_bytes >= 1) AND (size_bytes <= 104857600)));
ALTER TABLE staff_documents DROP CONSTRAINT staff_documents_rules;
ALTER TABLE staff_documents ADD CONSTRAINT staff_documents_rules
  CHECK ((staff_line_ok(file_name, 200) AND (file_name !~ '[/\\]'::text) AND (content_type = ANY (ARRAY['application/pdf'::text, 'image/jpeg'::text, 'image/png'::text, 'application/msword'::text, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'::text])) AND ((size_bytes >= 1) AND (size_bytes <= 104857600)) AND esign_hex64(sha256) AND starts_with(s3_key, (((('tenant/'::text || (business_id)::text) || '/staff/'::text) || (membership_id)::text) || '/'::text)) AND ((scan_status = 'PENDING'::"ScanStatus") = (scanned_at IS NULL))));
