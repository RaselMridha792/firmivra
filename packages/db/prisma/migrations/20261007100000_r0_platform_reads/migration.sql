-- DropIndex
DROP INDEX "client_tax_status_history_business_id_client_id_tax_year_ch_idx";

-- AlterTable
ALTER TABLE "business_settings" ADD COLUMN     "description" TEXT,
ADD COLUMN     "ein_enc" BYTEA,
ADD COLUMN     "ein_last4" TEXT,
ADD COLUMN     "entity_type" TEXT,
ADD COLUMN     "services" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "team_size" INTEGER;

-- AlterTable
ALTER TABLE "businesses" ADD COLUMN     "activated_at" TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "client_tax_status_history" ADD COLUMN     "seq" BIGSERIAL NOT NULL,
ALTER COLUMN "changed_at" SET DEFAULT clock_timestamp();

-- AlterTable
ALTER TABLE "firm_applications" ADD COLUMN     "ein_hash" BYTEA,
ADD COLUMN     "ein_last4" TEXT;

-- AlterTable
ALTER TABLE "invites" ADD COLUMN     "sent_by_platform" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "platform_user_signups" (
    "day" DATE NOT NULL,
    "pool" "IdentityPool" NOT NULL,
    "users" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "platform_user_signups_pkey" PRIMARY KEY ("day","pool")
);

-- CreateTable
CREATE TABLE "platform_owner_invites" (
    "invite_id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "membership_id" UUID,
    "sent_at" TIMESTAMPTZ(3) NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "accepted_at" TIMESTAMPTZ(3),
    "revoked_at" TIMESTAMPTZ(3),

    CONSTRAINT "platform_owner_invites_pkey" PRIMARY KEY ("invite_id")
);

-- CreateIndex
CREATE INDEX "platform_owner_invites_business_id_sent_at_idx" ON "platform_owner_invites"("business_id", "sent_at");

-- CreateIndex
CREATE INDEX "client_tax_status_history_business_id_client_id_tax_year_se_idx" ON "client_tax_status_history"("business_id", "client_id", "tax_year", "seq");

-- CreateIndex
CREATE INDEX "firm_applications_ein_hash_idx" ON "firm_applications"("ein_hash");

-- AddForeignKey
ALTER TABLE "platform_owner_invites" ADD CONSTRAINT "platform_owner_invites_invite_id_fkey" FOREIGN KEY ("invite_id") REFERENCES "invites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_owner_invites" ADD CONSTRAINT "platform_owner_invites_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ==================== Firm applications: the EIN, never in full (R4) ====================
-- The API keeps only the last 4 digits and a keyed hash (HMAC-SHA256 with a server-side secret)
-- for the duplicate check, in their columns. Nothing about the EIN is in `data`: no key starting
-- with "ein" (any case: ein, EIN, einLast4, einHash) at any depth, so R4 reads only the columns.
ALTER TABLE firm_applications ADD CONSTRAINT firm_applications_ein
  CHECK ((ein_last4 IS NULL) = (ein_hash IS NULL)
         AND (ein_last4 IS NULL OR ein_last4 ~ '^[0-9]{4}$')
         AND (ein_hash IS NULL OR octet_length(ein_hash) = 32));
ALTER TABLE firm_applications ADD CONSTRAINT firm_applications_no_ein_in_data
  CHECK (NOT jsonb_path_exists(
    data, '$.** ? (@.type() == "object").keyvalue() ? (@.key like_regex "^ein" flag "i")'));

-- Only the application itself (platform scope) sets them; a review never changes them.
CREATE FUNCTION firm_applications_ein_fixed() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF app_scope() IS DISTINCT FROM 'platform'
     AND (NEW.ein_last4 IS DISTINCT FROM OLD.ein_last4 OR NEW.ein_hash IS DISTINCT FROM OLD.ein_hash) THEN
    RAISE EXCEPTION 'firm applications: the EIN changes only with the application, in platform scope'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER firm_applications_ein_fixed
  BEFORE UPDATE ON firm_applications
  FOR EACH ROW EXECUTE FUNCTION firm_applications_ein_fixed();

-- ==================== Firms: when a firm first became ACTIVE (R4: FIRM_ACTIVATED) ====================
-- Firms ACTIVE before this column get their creation time (the real go-live time is not known;
-- the beta firm was created ACTIVE). Firms SUSPENDED or CLOSED before it get none. The backfill
-- sets a scope: under forced RLS an owner role that doesn't bypass it (RDS) sees no rows.
DO $$
BEGIN
  PERFORM set_config('app.scope', 'platform', true);
  UPDATE businesses SET activated_at = created_at WHERE status = 'ACTIVE';
  PERFORM set_config('app.scope', '', true);
END
$$;
ALTER TABLE businesses ADD CONSTRAINT businesses_active_activated
  CHECK (status <> 'ACTIVE' OR activated_at IS NOT NULL);

-- The database sets it the first time the firm is ACTIVE (insert, setup Finish, or the Super
-- Admin), in any scope, and never changes it, so admin scope can show when a firm went live.
-- Never before the firm's creation time (that time comes from the API's clock).
CREATE FUNCTION businesses_activated_at() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.activated_at IS NOT NULL THEN
      RAISE EXCEPTION 'businesses: activated_at is set by the database'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  ELSIF NEW.activated_at IS DISTINCT FROM OLD.activated_at THEN
    RAISE EXCEPTION 'businesses: activated_at is set by the database'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.status = 'ACTIVE' AND NEW.activated_at IS NULL THEN
    NEW.activated_at := GREATEST(now(), NEW.created_at);
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER businesses_activated_at
  BEFORE INSERT OR UPDATE ON businesses
  FOR EACH ROW EXECUTE FUNCTION businesses_activated_at();

-- ==================== Owner invites from Firmivra (R4: ownerInvite, OWNER_INVITED) ====================
-- An invite the platform sends (the new firm's owner's activation link) is inserted in platform
-- scope with no inviting member; the database marks it `sent_by_platform` and nothing else can.
-- A firm's own invites (business scope) are never marked, whatever their member's role.
CREATE FUNCTION invites_sent_by_platform() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.sent_by_platform := coalesce(app_scope(), '') = 'platform' AND NEW.invited_by_user_id IS NULL;
  ELSIF NEW.sent_by_platform IS DISTINCT FROM OLD.sent_by_platform THEN
    RAISE EXCEPTION 'invites: sent_by_platform is set by the database'
      USING ERRCODE = 'insufficient_privilege';
  ELSIF app_scope() = 'platform'
        AND (NEW.accepted_at IS DISTINCT FROM OLD.accepted_at
             OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
             OR NEW.token_hash IS DISTINCT FROM OLD.token_hash
             OR NEW.membership_id IS DISTINCT FROM OLD.membership_id
             OR NEW.name IS DISTINCT FROM OLD.name OR NEW.email IS DISTINCT FROM OLD.email) THEN
    RAISE EXCEPTION 'invites: platform scope only revokes the links it sent'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER invites_sent_by_platform
  BEFORE INSERT OR UPDATE ON invites
  FOR EACH ROW EXECUTE FUNCTION invites_sent_by_platform();

-- Platform scope sends, reads and revokes only those (R4's approve and resend).
CREATE POLICY invites_platform_send ON invites FOR INSERT
  WITH CHECK (app_scope() = 'platform' AND invited_by_user_id IS NULL);
CREATE POLICY invites_platform_read ON invites FOR SELECT
  USING (app_scope() = 'platform' AND sent_by_platform);
CREATE POLICY invites_platform_revoke ON invites FOR UPDATE
  USING (app_scope() = 'platform' AND sent_by_platform)
  WITH CHECK (app_scope() = 'platform' AND sent_by_platform);

-- Super Admin reads a copy without the token: when each link was sent, when it expires, whether
-- it was accepted or revoked. Kept by a trigger running as the table owner; the app only reads.
ALTER TABLE platform_owner_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_owner_invites FORCE ROW LEVEL SECURITY;
GRANT SELECT ON platform_owner_invites TO firmivra_app;
CREATE POLICY platform_owner_invites_read ON platform_owner_invites FOR SELECT
  USING (app_is_admin() OR pg_trigger_depth() > 0);
CREATE POLICY platform_owner_invites_copy ON platform_owner_invites FOR INSERT
  WITH CHECK (pg_trigger_depth() > 0);
CREATE POLICY platform_owner_invites_follow ON platform_owner_invites FOR UPDATE
  USING (pg_trigger_depth() > 0) WITH CHECK (pg_trigger_depth() > 0);

CREATE FUNCTION invites_platform_copy() RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
BEGIN
  IF NOT NEW.sent_by_platform THEN
    RETURN NULL;
  END IF;
  IF TG_OP = 'INSERT' THEN
    INSERT INTO platform_owner_invites
      (invite_id, business_id, membership_id, sent_at, expires_at, accepted_at, revoked_at)
    VALUES
      (NEW.id, NEW.business_id, NEW.membership_id, NEW.created_at, NEW.expires_at, NEW.accepted_at,
       NEW.revoked_at);
  ELSE
    UPDATE platform_owner_invites
       SET expires_at = NEW.expires_at, accepted_at = NEW.accepted_at, revoked_at = NEW.revoked_at
     WHERE invite_id = NEW.id;
  END IF;
  RETURN NULL;
END
$$;
CREATE TRIGGER invites_platform_copy
  AFTER INSERT OR UPDATE OF expires_at, accepted_at, revoked_at ON invites
  FOR EACH ROW EXECUTE FUNCTION invites_platform_copy();

-- ==================== Platform admins: their names in decisions and history (R4) ====================
-- Admin scope already reads the platform_admins list; it may also read those people's user rows
-- (whole rows; the API returns only the name), and keeps reading the name of a Super Admin who
-- decided an application after they leave. ADMIN logins only; firm staff and clients stay out.
CREATE POLICY users_admin_platform_admins ON users FOR SELECT
  USING (app_is_admin() AND pool = 'ADMIN'
         AND (EXISTS (SELECT 1 FROM platform_admins pa WHERE pa.user_id = users.id)
              OR EXISTS (SELECT 1 FROM firm_applications a WHERE a.reviewed_by_user_id = users.id)
              OR EXISTS (SELECT 1 FROM firm_application_status_history h
                         WHERE h.changed_by_user_id = users.id)));

-- ==================== Dashboard: staff and client logins per day (R4) ====================
-- Super Admin can't read the users of firms, so the database counts them: one row per UTC day
-- and pool, kept by a trigger on users running as the table owner (the app only reads).
-- A login's pool (#52) and creation time never change, so the count follows inserts and deletes.
CREATE FUNCTION users_created_at_fixed() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'users: the creation time of a login never changes'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER users_created_at_fixed
  BEFORE UPDATE OF created_at ON users
  FOR EACH ROW EXECUTE FUNCTION users_created_at_fixed();

ALTER TABLE platform_user_signups ADD CONSTRAINT platform_user_signups_pool
  CHECK (pool IN ('STAFF', 'CLIENT'));
ALTER TABLE platform_user_signups ADD CONSTRAINT platform_user_signups_users
  CHECK (users >= 0);
DO $$
BEGIN
  PERFORM set_config('app.scope', 'platform', true);
  INSERT INTO platform_user_signups (day, pool, users)
  SELECT (created_at AT TIME ZONE 'UTC')::date, pool, count(*)
    FROM users WHERE pool IN ('STAFF', 'CLIENT')
   GROUP BY 1, 2;
  PERFORM set_config('app.scope', '', true);
END
$$;

GRANT SELECT ON platform_user_signups TO firmivra_app;
ALTER TABLE platform_user_signups ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_user_signups FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_user_signups_admin_read ON platform_user_signups FOR SELECT
  USING (app_is_admin() OR pg_trigger_depth() > 0);
CREATE POLICY platform_user_signups_trigger_insert ON platform_user_signups FOR INSERT
  WITH CHECK (pg_trigger_depth() > 0);
CREATE POLICY platform_user_signups_trigger_update ON platform_user_signups FOR UPDATE
  USING (pg_trigger_depth() > 0) WITH CHECK (pg_trigger_depth() > 0);

CREATE FUNCTION users_count_signups() RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.pool IN ('STAFF', 'CLIENT') THEN
      UPDATE platform_user_signups SET users = users - 1
       WHERE day = (OLD.created_at AT TIME ZONE 'UTC')::date AND pool = OLD.pool;
    END IF;
  ELSIF NEW.pool IN ('STAFF', 'CLIENT') THEN
    INSERT INTO platform_user_signups (day, pool, users)
    VALUES ((NEW.created_at AT TIME ZONE 'UTC')::date, NEW.pool, 1)
    ON CONFLICT (day, pool) DO UPDATE SET users = platform_user_signups.users + 1;
  END IF;
  RETURN NULL;
END
$$;
CREATE TRIGGER users_count_signups
  AFTER INSERT OR DELETE ON users
  FOR EACH ROW EXECUTE FUNCTION users_count_signups();

-- ==================== Setup Step 2: business details (T02) ====================
-- The details the firm gave in its application, now its own to edit: entity type and services as
-- codes from the application's lists (packages/types firm-applications; the API checks the codes,
-- so a list change needs no migration), team size as a number. The DBA is `businesses.name`.
-- R4's approve copies them in a business-scope transaction for the new firm (never the EIN; the
-- owner enters the full EIN in Step 2).
-- The firm's EIN like a client's: ciphertext with the firm's key and the last 4 digits, together.
ALTER TABLE business_settings ADD CONSTRAINT business_settings_ein
  CHECK ((ein_enc IS NULL) = (ein_last4 IS NULL)
         AND (ein_last4 IS NULL OR ein_last4 ~ '^[0-9]{4}$'));
ALTER TABLE business_settings ADD CONSTRAINT business_settings_entity_type
  CHECK (entity_type ~ '^[A-Z][A-Z0-9_]*$' AND char_length(entity_type) <= 40);
ALTER TABLE business_settings ADD CONSTRAINT business_settings_team_size
  CHECK (team_size BETWEEN 1 AND 10000);

-- A list of codes: each like `TAX_PREPARATION` (up to 40 characters), none twice.
CREATE FUNCTION codes_ok(items text[]) RETURNS boolean
  LANGUAGE sql IMMUTABLE
  AS $$
  SELECT coalesce(bool_and(i ~ '^[A-Z][A-Z0-9_]*$' AND char_length(i) <= 40), true)
         AND count(DISTINCT i) = count(*)
    FROM unnest(items) AS u(i)
$$;
-- One dimension only: a two-dimensional array of codes would break every read of the row.
ALTER TABLE business_settings ADD CONSTRAINT business_settings_services
  CHECK (services IS NOT NULL AND (cardinality(services) = 0 OR array_ndims(services) = 1)
         AND cardinality(services) <= 20 AND codes_ok(services));
-- Up to 2,000 characters with something in it; line breaks and tabs, no other control characters
-- (C0 or C1).
ALTER TABLE business_settings ADD CONSTRAINT business_settings_description
  CHECK (description ~ '[^[:space:]]' AND char_length(description) <= 2000
         AND description !~ '[\x01-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]');

-- ==================== Encrypted columns hold the helper's ciphertext ====================
-- What the field-encryption helper writes: version 1, mode 1 (local) or 2 (KMS), the wrapped
-- key's length (at least 1), the wrapped key, a 12-byte IV, a 16-byte tag and the ciphertext.
-- Plain digits or any other bytes are refused. (The API stores an empty value as NULL.)
CREATE FUNCTION sealed_value_ok(blob bytea) RETURNS boolean
  LANGUAGE sql IMMUTABLE
  AS $$
  SELECT CASE
    WHEN blob IS NULL THEN true
    WHEN octet_length(blob) < 33 THEN false
    ELSE get_byte(blob, 0) = 1 AND get_byte(blob, 1) IN (1, 2)
         AND get_byte(blob, 2) * 256 + get_byte(blob, 3) >= 1
         AND octet_length(blob) >= 32 + get_byte(blob, 2) * 256 + get_byte(blob, 3)
  END
$$;
ALTER TABLE business_settings ADD CONSTRAINT business_settings_ein_sealed
  CHECK (sealed_value_ok(ein_enc));
ALTER TABLE client_profiles ADD CONSTRAINT client_profiles_ssn_sealed
  CHECK (sealed_value_ok(ssn_enc));
ALTER TABLE client_profiles ADD CONSTRAINT client_profiles_ein_sealed
  CHECK (sealed_value_ok(ein_enc));
ALTER TABLE client_profiles ADD CONSTRAINT client_profiles_dob_sealed
  CHECK (sealed_value_ok(dob_enc));

-- ==================== Tax-year history: the order rows were written in (R10) ====================
-- `seq` orders a year's history: changed_at is now the time of the change, but two transactions
-- can still commit in the other order. Existing rows get theirs in the order they were written.
DO $$
DECLARE
  firm uuid;
  firms uuid[];
  r record;
BEGIN
  PERFORM set_config('app.scope', 'platform', true);
  SELECT coalesce(array_agg(id), '{}') INTO firms FROM businesses;
  FOREACH firm IN ARRAY firms LOOP
    PERFORM set_config('app.scope', 'business', true);
    PERFORM set_config('app.current_business_id', firm::text, true);
    FOR r IN SELECT id FROM client_tax_status_history ORDER BY changed_at, id LOOP
      UPDATE client_tax_status_history
         SET seq = nextval('client_tax_status_history_seq_seq')
       WHERE id = r.id;
    END LOOP;
  END LOOP;
  PERFORM set_config('app.scope', '', true);
  PERFORM set_config('app.current_business_id', '', true);
END
$$;

-- The history is written only by its trigger, running as the table owner: the app can't add a
-- row of its own (with any seq or time) on top of a year's history. The author is still the
-- tax-year row's updated_by_user_id, which the API sets from the signed-in member.
ALTER FUNCTION client_tax_statuses_history() SECURITY DEFINER SET search_path = public, pg_temp;
REVOKE INSERT ON client_tax_status_history FROM firmivra_app;

-- ==================== The owner-run trigger functions are triggers only ====================
-- They run as the table owner, so nobody calls them directly (defense in depth: the app role
-- can't create tables to attach them to anyway).
REVOKE EXECUTE ON FUNCTION invites_platform_copy() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION users_count_signups() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION client_tax_statuses_history() FROM PUBLIC;
