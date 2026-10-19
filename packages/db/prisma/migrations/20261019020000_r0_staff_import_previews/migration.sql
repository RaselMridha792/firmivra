-- r0_staff_import_previews (R0, Oct 19, Rasel's yes in this window): R55's Import Staff keeps the
-- parsed rows of an upload between the preview and the confirm. A firm table like staff_drafts
-- (the firm's own rows, forced RLS); the database gives each preview an hour, after which it is no
-- longer read and is deleted by the firm's next preview or by app_purge_expired_staff_import_previews().

-- CreateTable
CREATE TABLE "staff_import_previews" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "created_by_membership_id" UUID NOT NULL,
    "rows" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3) NOT NULL DEFAULT (now() + '01:00:00'::interval),

    CONSTRAINT "staff_import_previews_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "staff_import_previews_business_id_expires_at_idx" ON "staff_import_previews"("business_id", "expires_at");

-- CreateIndex
CREATE INDEX "staff_import_previews_expires_at_idx" ON "staff_import_previews"("expires_at");

-- AddForeignKey
ALTER TABLE "staff_import_previews" ADD CONSTRAINT "staff_import_previews_business_id_created_by_membership_id_fkey" FOREIGN KEY ("business_id", "created_by_membership_id") REFERENCES "memberships"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------- Values ----------
-- A JSON array of at most 1,000 parsed rows and 1 MB, with no password, token, secret or SSN key
-- at any depth (as staff_drafts). An hour is the database's: see the rules.
ALTER TABLE staff_import_previews ADD CONSTRAINT staff_import_previews_rules
  CHECK (jsonb_typeof("rows") = 'array' AND jsonb_array_length("rows") BETWEEN 1 AND 1000
         AND octet_length("rows"::text) <= 1048576
         AND NOT jsonb_path_exists("rows",
           '$.** ? (@.type() == "object").keyvalue() ? (@.key like_regex "(password|passcode|token|secret|ssn)$" flag "i")'));

-- ---------- Rules ----------
-- The database stamps the times (expiry an hour after creation, whatever the app sends), and
-- each new preview deletes its firm's expired ones. That delete runs as the owner (the app's
-- policies hide expired rows), through the owner's expired-only policies below.
CREATE FUNCTION staff_import_previews_rules() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public, pg_temp
  AS $$
BEGIN
  NEW.created_at := now();
  NEW.expires_at := now() + interval '1 hour';
  RETURN NEW;
END
$$;

CREATE FUNCTION staff_import_previews_cleanup() RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
BEGIN
  DELETE FROM staff_import_previews WHERE business_id = NEW.business_id AND expires_at <= now();
  RETURN NULL;
END
$$;
CREATE TRIGGER staff_import_previews_cleanup AFTER INSERT ON staff_import_previews
  FOR EACH ROW EXECUTE FUNCTION staff_import_previews_cleanup();
CREATE TRIGGER staff_import_previews_rules BEFORE INSERT ON staff_import_previews
  FOR EACH ROW EXECUTE FUNCTION staff_import_previews_rules();

-- Deletes every firm's expired previews (a scheduled job or the import endpoint calls it) and
-- returns how many. Owner-run, so it reaches every firm, but it only ever deletes expired rows
-- and returns no data.
CREATE FUNCTION app_purge_expired_staff_import_previews() RETURNS integer
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
DECLARE
  n integer;
BEGIN
  DELETE FROM staff_import_previews WHERE expires_at <= now();
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END
$$;
REVOKE ALL ON FUNCTION app_purge_expired_staff_import_previews() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_purge_expired_staff_import_previews() TO firmivra_app;

-- ---------- Grants ----------
-- A preview is replaced, never edited: a new upload is a new preview.
GRANT SELECT, INSERT, DELETE ON staff_import_previews TO firmivra_app;

-- ---------- Enable and force RLS; the business policies ----------
-- The firm's own rows, as staff_drafts. Reads see only unexpired previews, so an expired one is
-- unusable before the cleanup runs; the firm deletes (discards) its unexpired ones.
ALTER TABLE staff_import_previews ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_import_previews FORCE ROW LEVEL SECURITY;
CREATE POLICY staff_import_previews_read ON staff_import_previews FOR SELECT
  USING (business_id = app_current_business_id() AND expires_at > now());
CREATE POLICY staff_import_previews_write ON staff_import_previews FOR INSERT
  WITH CHECK (business_id = app_current_business_id());
CREATE POLICY staff_import_previews_delete ON staff_import_previews FOR DELETE
  USING (business_id = app_current_business_id());

-- The cleanup and the purge run as the owner (the role running this migration), which has no
-- BYPASSRLS on RDS while the table forces RLS: it reads and deletes expired rows only. The app
-- role is never the owner, so these never apply to it.
DO $$
BEGIN
  EXECUTE format('CREATE POLICY staff_import_previews_owner_read ON staff_import_previews '
                 'FOR SELECT TO %I USING (expires_at <= now())', current_user);
  EXECUTE format('CREATE POLICY staff_import_previews_owner_purge ON staff_import_previews '
                 'FOR DELETE TO %I USING (expires_at <= now())', current_user);
END
$$;
