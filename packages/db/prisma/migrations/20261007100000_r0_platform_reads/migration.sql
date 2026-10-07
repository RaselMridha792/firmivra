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

-- CreateTable
CREATE TABLE "platform_user_signups" (
    "day" DATE NOT NULL,
    "pool" "IdentityPool" NOT NULL,
    "users" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "platform_user_signups_pkey" PRIMARY KEY ("day","pool")
);

-- CreateIndex
CREATE INDEX "client_tax_status_history_business_id_client_id_tax_year_se_idx" ON "client_tax_status_history"("business_id", "client_id", "tax_year", "seq");

-- CreateIndex
CREATE INDEX "firm_applications_ein_hash_idx" ON "firm_applications"("ein_hash");


-- ==================== Firm applications: the EIN, never in full (R4) ====================
-- The API keeps only the last 4 digits and a keyed hash (HMAC-SHA256 with a server-side secret)
-- for the duplicate check. The full EIN is stored nowhere: not in a column, not in `data`.
ALTER TABLE firm_applications ADD CONSTRAINT firm_applications_ein
  CHECK ((ein_last4 IS NULL) = (ein_hash IS NULL)
         AND (ein_last4 IS NULL OR ein_last4 ~ '^[0-9]{4}$')
         AND (ein_hash IS NULL OR octet_length(ein_hash) = 32));
ALTER TABLE firm_applications ADD CONSTRAINT firm_applications_no_ein_in_data
  CHECK (NOT jsonb_path_exists(data, '$.**.ein'));

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
-- Firms that are ACTIVE already get their creation time (the beta firm was created ACTIVE). The
-- backfill sets a scope: under forced RLS an owner role that doesn't bypass it (RDS) sees no rows.
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
    NEW.activated_at := now();
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER businesses_activated_at
  BEFORE INSERT OR UPDATE ON businesses
  FOR EACH ROW EXECUTE FUNCTION businesses_activated_at();

-- ==================== Owner invites: Super Admin reads them (R4: ownerInvite, OWNER_INVITED) ====================
-- The owner activation links the platform sent (no inviting member), for any firm. Whole rows,
-- including the token's SHA-256, which can't be turned back into the link; the API returns only
-- status and times. Never staff or client invites, and admin scope never writes invites.
CREATE POLICY invites_admin_owner_invites ON invites FOR SELECT
  USING (app_is_admin() AND invited_by_user_id IS NULL
         AND EXISTS (SELECT 1 FROM memberships m
                     WHERE m.business_id = invites.business_id AND m.id = invites.membership_id
                       AND m.role = 'OWNER'));

-- ==================== Dashboard: staff and client logins per day (R4) ====================
-- Super Admin can't read the users of firms, so the database counts them: one row per UTC day
-- and pool, kept by a trigger on users. Backfilled first, then locked.
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

GRANT SELECT, INSERT, UPDATE ON platform_user_signups TO firmivra_app;
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
  AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.pool = OLD.pool
     AND (NEW.created_at AT TIME ZONE 'UTC')::date = (OLD.created_at AT TIME ZONE 'UTC')::date THEN
    RETURN NULL;
  END IF;
  IF TG_OP IN ('UPDATE', 'DELETE') AND OLD.pool IN ('STAFF', 'CLIENT') THEN
    UPDATE platform_user_signups SET users = users - 1
     WHERE day = (OLD.created_at AT TIME ZONE 'UTC')::date AND pool = OLD.pool;
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') AND NEW.pool IN ('STAFF', 'CLIENT') THEN
    INSERT INTO platform_user_signups (day, pool, users)
    VALUES ((NEW.created_at AT TIME ZONE 'UTC')::date, NEW.pool, 1)
    ON CONFLICT (day, pool) DO UPDATE SET users = platform_user_signups.users + 1;
  END IF;
  RETURN NULL;
END
$$;
CREATE TRIGGER users_count_signups
  AFTER INSERT OR DELETE OR UPDATE OF pool, created_at ON users
  FOR EACH ROW EXECUTE FUNCTION users_count_signups();

-- ==================== Setup Step 2: business details (T02) ====================
-- The details the firm gave in its application, now its own to edit: entity type and services as
-- codes from the application's lists (packages/types firm-applications; the API checks the codes,
-- so a list change needs no migration), team size as a number. The DBA is `businesses.name`.
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
ALTER TABLE business_settings ADD CONSTRAINT business_settings_services
  CHECK (services IS NOT NULL AND cardinality(services) <= 20 AND codes_ok(services));
-- Up to 2,000 characters, not blank; line breaks and tabs, no other control characters.
ALTER TABLE business_settings ADD CONSTRAINT business_settings_description
  CHECK (btrim(description) <> '' AND char_length(description) <= 2000
         AND description !~ '[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]');

-- ==================== Tax-year history: the order rows were written in (R10) ====================
-- `seq` orders a year's history: changed_at is now the time of the change, but two transactions
-- can still commit in the other order. The history trigger inserts rows as the app role.
GRANT USAGE ON SEQUENCE client_tax_status_history_seq_seq TO firmivra_app;
