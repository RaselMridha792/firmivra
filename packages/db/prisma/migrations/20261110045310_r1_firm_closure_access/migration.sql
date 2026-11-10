-- R1 (Rasel's approval in R1's window, Nov 7; Oct 31 Super Admin review, FIRMS.md section F).
-- SA-FRM-F03: businesses.closed_at, set by the database on closure (existing closed firms take
-- their last change). SA-FRM-F07/F08: firm_data_download_grants (the owner's download-only link:
-- 30 days after closure automatically, up to day 90 when granted) and firm_data_download_log.
-- SA-FRM-F11 to F13: firm_exceptional_access_requests (identity, authority, scope, read-only
-- window, the platform owner's review). SA-FRM-F09: platform_admins.is_platform_owner, at most
-- one. Platform data: platform scope and admins only; a firm sees none of it.
-- Safe on dev: new tables are empty; the ADD COLUMNs are nullable or have a constant default;
-- the backfill touches closed firms only, before the new trigger exists.

-- CreateEnum
CREATE TYPE "FirmDownloadGrantKind" AS ENUM ('AUTOMATIC', 'REQUESTED');

-- CreateEnum
CREATE TYPE "FirmDownloadEvent" AS ENUM ('ISSUED', 'DOWNLOADED', 'EXPIRED', 'REVOKED');

-- CreateEnum
CREATE TYPE "ExceptionalAccessStatus" AS ENUM ('PENDING', 'APPROVED', 'DENIED', 'REVOKED');

-- AlterTable
ALTER TABLE "businesses" ADD COLUMN     "closed_at" TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "platform_admins" ADD COLUMN     "is_platform_owner" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "firm_data_download_grants" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "owner_user_id" UUID NOT NULL,
    "kind" "FirmDownloadGrantKind" NOT NULL,
    "reason" TEXT,
    "granted_by_user_id" UUID,
    "token_hash" TEXT NOT NULL,
    "starts_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),
    "revoked_by_user_id" UUID,
    "revoke_reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "firm_data_download_grants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "firm_data_download_log" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "grant_id" UUID NOT NULL,
    "event" "FirmDownloadEvent" NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actor_user_id" UUID,
    "file_count" INTEGER,
    "bytes" BIGINT,

    CONSTRAINT "firm_data_download_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "firm_exceptional_access_requests" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "requested_by_user_id" UUID NOT NULL,
    "requester_name" TEXT NOT NULL,
    "requester_organization" TEXT NOT NULL,
    "requester_contact" TEXT NOT NULL,
    "legal_authority" TEXT NOT NULL,
    "document_s3_key" TEXT,
    "scope_modules" TEXT[],
    "access_mode" TEXT NOT NULL DEFAULT 'READ_ONLY',
    "status" "ExceptionalAccessStatus" NOT NULL DEFAULT 'PENDING',
    "window_starts_at" TIMESTAMPTZ(3),
    "window_ends_at" TIMESTAMPTZ(3),
    "reviewed_by_user_id" UUID,
    "reviewed_at" TIMESTAMPTZ(3),
    "decision_note" TEXT,
    "revoked_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "firm_exceptional_access_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "firm_data_download_grants_token_hash_key" ON "firm_data_download_grants"("token_hash");

-- CreateIndex
CREATE INDEX "firm_data_download_grants_business_id_expires_at_idx" ON "firm_data_download_grants"("business_id", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "firm_data_download_grants_business_id_id_key" ON "firm_data_download_grants"("business_id", "id");

-- CreateIndex
CREATE INDEX "firm_data_download_log_business_id_grant_id_occurred_at_idx" ON "firm_data_download_log"("business_id", "grant_id", "occurred_at");

-- CreateIndex
CREATE UNIQUE INDEX "firm_exceptional_access_requests_document_s3_key_key" ON "firm_exceptional_access_requests"("document_s3_key");

-- CreateIndex
CREATE INDEX "firm_exceptional_access_requests_business_id_status_idx" ON "firm_exceptional_access_requests"("business_id", "status");

-- AddForeignKey
ALTER TABLE "firm_data_download_grants" ADD CONSTRAINT "firm_data_download_grants_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "firm_data_download_grants" ADD CONSTRAINT "firm_data_download_grants_business_id_owner_user_id_fkey" FOREIGN KEY ("business_id", "owner_user_id") REFERENCES "memberships"("business_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "firm_data_download_grants" ADD CONSTRAINT "firm_data_download_grants_granted_by_user_id_fkey" FOREIGN KEY ("granted_by_user_id") REFERENCES "platform_admins"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "firm_data_download_grants" ADD CONSTRAINT "firm_data_download_grants_revoked_by_user_id_fkey" FOREIGN KEY ("revoked_by_user_id") REFERENCES "platform_admins"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "firm_data_download_log" ADD CONSTRAINT "firm_data_download_log_business_id_grant_id_fkey" FOREIGN KEY ("business_id", "grant_id") REFERENCES "firm_data_download_grants"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "firm_exceptional_access_requests" ADD CONSTRAINT "firm_exceptional_access_requests_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "firm_exceptional_access_requests" ADD CONSTRAINT "firm_exceptional_access_requests_requested_by_user_id_fkey" FOREIGN KEY ("requested_by_user_id") REFERENCES "platform_admins"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "firm_exceptional_access_requests" ADD CONSTRAINT "firm_exceptional_access_requests_reviewed_by_user_id_fkey" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "platform_admins"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------- closed_at (SA-FRM-F03) ----------
-- Firms closed before this migration: their last change is the best record of when.
DO $migration$
BEGIN
  PERFORM set_config('app.scope', 'platform', true);
  UPDATE businesses SET closed_at = updated_at WHERE status = 'CLOSED' AND closed_at IS NULL;
  PERFORM set_config('app.scope', '', true);
END
$migration$;
ALTER TABLE businesses ADD CONSTRAINT businesses_closed_at
  CHECK ((status = 'CLOSED') = (closed_at IS NOT NULL));
-- Set by the database when the firm becomes CLOSED (CLOSED is final), never otherwise.
CREATE FUNCTION businesses_closed_at() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.closed_at := CASE WHEN NEW.status = 'CLOSED' THEN now() END;
  ELSIF NEW.status = 'CLOSED' AND OLD.status <> 'CLOSED' THEN
    NEW.closed_at := now();
  ELSIF NEW.closed_at IS DISTINCT FROM OLD.closed_at THEN
    RAISE EXCEPTION 'businesses: closed_at is set by the database'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER businesses_closed_at
  BEFORE INSERT OR UPDATE ON businesses
  FOR EACH ROW EXECUTE FUNCTION businesses_closed_at();

-- ---------- The platform owner (SA-FRM-F09) ----------
CREATE UNIQUE INDEX platform_admins_one_owner ON platform_admins (is_platform_owner)
  WHERE is_platform_owner;

-- ---------- Access ----------
-- Platform data about a firm: platform scope (the owner's download link) reads and writes;
-- admins read, grant, revoke and request. Firms see none of it. Never deleted.
GRANT SELECT, INSERT, UPDATE ON firm_data_download_grants, firm_exceptional_access_requests
  TO firmivra_app;
GRANT SELECT, INSERT ON firm_data_download_log TO firmivra_app;
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['firm_data_download_grants', 'firm_data_download_log',
    'firm_exceptional_access_requests'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I ON %I USING (app_scope() = ''platform'')'
                   ' WITH CHECK (app_scope() = ''platform'')', t || '_platform', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR SELECT USING (app_is_admin())', t || '_admin_read', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR INSERT WITH CHECK (app_is_admin())',
                   t || '_admin_insert', t);
  END LOOP;
END
$$;
CREATE POLICY firm_data_download_grants_admin_update ON firm_data_download_grants
  FOR UPDATE USING (app_is_admin()) WITH CHECK (app_is_admin());
CREATE POLICY firm_exceptional_access_requests_admin_update ON firm_exceptional_access_requests
  FOR UPDATE USING (app_is_admin()) WITH CHECK (app_is_admin());

-- ---------- Download grants (SA-FRM-F07, F08) ----------
ALTER TABLE firm_data_download_grants ADD CONSTRAINT firm_data_download_grants_shape
  CHECK (token_hash ~ '^[0-9a-f]{64}$'
     AND expires_at > starts_at
     AND (reason IS NULL OR char_length(btrim(reason)) BETWEEN 1 AND 1000)
     AND (kind = 'AUTOMATIC') = (granted_by_user_id IS NULL)
     AND (kind = 'AUTOMATIC' OR reason IS NOT NULL)
     AND (revoked_at IS NULL) = (revoked_by_user_id IS NULL)
     AND (revoked_at IS NULL) = (revoke_reason IS NULL)
     AND (revoke_reason IS NULL OR char_length(btrim(revoke_reason)) BETWEEN 1 AND 1000));
-- Only for a closed firm; the window counts from closure: 30 days for the automatic grant, never
-- past day 90 for any. Fixed once made, except a one-time revoke.
CREATE FUNCTION firm_data_download_grants_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  closed timestamptz;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF (NEW.id, NEW.business_id, NEW.owner_user_id, NEW.kind, NEW.reason, NEW.granted_by_user_id,
        NEW.token_hash, NEW.starts_at, NEW.expires_at, NEW.created_at)
       IS DISTINCT FROM
       (OLD.id, OLD.business_id, OLD.owner_user_id, OLD.kind, OLD.reason, OLD.granted_by_user_id,
        OLD.token_hash, OLD.starts_at, OLD.expires_at, OLD.created_at)
       OR (OLD.revoked_at IS NOT NULL
           AND (NEW.revoked_at, NEW.revoked_by_user_id, NEW.revoke_reason)
               IS DISTINCT FROM (OLD.revoked_at, OLD.revoked_by_user_id, OLD.revoke_reason)) THEN
      RAISE EXCEPTION 'firm data download grants: a grant only gets revoked, once'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  SELECT b.closed_at INTO closed FROM businesses b WHERE b.id = NEW.business_id;
  IF closed IS NULL THEN
    RAISE EXCEPTION 'firm data download grants: only a closed firm gets a download grant'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.expires_at > closed + interval '90 days'
     OR (NEW.kind = 'AUTOMATIC' AND NEW.expires_at <> closed + interval '30 days') THEN
    RAISE EXCEPTION 'firm data download grants: the window ends 30 days after closure (automatic), never past day 90'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER firm_data_download_grants_rules
  BEFORE INSERT OR UPDATE ON firm_data_download_grants
  FOR EACH ROW EXECUTE FUNCTION firm_data_download_grants_rules();

ALTER TABLE firm_data_download_log ADD CONSTRAINT firm_data_download_log_shape
  CHECK ((file_count IS NULL OR file_count >= 0) AND (bytes IS NULL OR bytes >= 0));

-- ---------- Exceptional access (SA-FRM-F11 to F13) ----------
ALTER TABLE firm_exceptional_access_requests ADD CONSTRAINT firm_exceptional_access_requests_shape
  CHECK (char_length(btrim(requester_name)) BETWEEN 1 AND 200
     AND char_length(btrim(requester_organization)) BETWEEN 1 AND 200
     AND char_length(btrim(requester_contact)) BETWEEN 1 AND 320
     AND char_length(btrim(legal_authority)) BETWEEN 1 AND 2000
     AND (document_s3_key IS NULL
          OR (starts_with(document_s3_key, 'tenant/' || business_id || '/exceptional-access/' || id || '/')
              AND document_s3_key ~ '^[A-Za-z0-9/._-]+$' AND document_s3_key !~ '(^|/)\.\.?(/|$)'))
     AND cardinality(scope_modules) BETWEEN 1 AND 20
     AND array_position(scope_modules, NULL) IS NULL
     AND array_to_string(scope_modules, ',') ~ '^([A-Z][A-Z0-9_]{0,59}(,|$))+$'
     AND access_mode = 'READ_ONLY'
     AND (decision_note IS NULL OR char_length(btrim(decision_note)) BETWEEN 1 AND 2000)
     -- Pending has no review; a decision has its reviewer and time; approval has its window.
     AND ((status = 'PENDING') = (reviewed_by_user_id IS NULL))
     AND ((reviewed_by_user_id IS NULL) = (reviewed_at IS NULL))
     AND ((status IN ('APPROVED', 'REVOKED')) = (window_starts_at IS NOT NULL))
     AND ((window_starts_at IS NULL) = (window_ends_at IS NULL))
     AND (window_ends_at IS NULL OR window_ends_at > window_starts_at)
     AND (status <> 'DENIED' OR decision_note IS NOT NULL)
     AND ((status = 'REVOKED') = (revoked_at IS NOT NULL)));
-- The request never changes; PENDING becomes APPROVED or DENIED, APPROVED may be REVOKED; the
-- reviewer is the platform owner.
CREATE FUNCTION firm_exceptional_access_requests_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF (NEW.id, NEW.business_id, NEW.requested_by_user_id, NEW.requester_name,
        NEW.requester_organization, NEW.requester_contact, NEW.legal_authority,
        NEW.document_s3_key, NEW.scope_modules, NEW.access_mode, NEW.created_at)
       IS DISTINCT FROM
       (OLD.id, OLD.business_id, OLD.requested_by_user_id, OLD.requester_name,
        OLD.requester_organization, OLD.requester_contact, OLD.legal_authority,
        OLD.document_s3_key, OLD.scope_modules, OLD.access_mode, OLD.created_at) THEN
      RAISE EXCEPTION 'firm exceptional access requests: the request itself never changes'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.status <> OLD.status
       AND NOT ((OLD.status = 'PENDING' AND NEW.status IN ('APPROVED', 'DENIED'))
                OR (OLD.status = 'APPROVED' AND NEW.status = 'REVOKED')) THEN
      RAISE EXCEPTION 'firm exceptional access requests: a request cannot go from % to %',
        OLD.status, NEW.status USING ERRCODE = 'check_violation';
    END IF;
    IF OLD.status <> 'PENDING'
       AND (NEW.reviewed_by_user_id, NEW.reviewed_at, NEW.window_starts_at, NEW.window_ends_at,
            NEW.decision_note)
           IS DISTINCT FROM
           (OLD.reviewed_by_user_id, OLD.reviewed_at, OLD.window_starts_at, OLD.window_ends_at,
            OLD.decision_note) THEN
      RAISE EXCEPTION 'firm exceptional access requests: a decision never changes'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF NEW.reviewed_by_user_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM platform_admins a
                      WHERE a.user_id = NEW.reviewed_by_user_id AND a.is_platform_owner) THEN
    RAISE EXCEPTION 'firm exceptional access requests: only the platform owner reviews a request'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER firm_exceptional_access_requests_rules
  BEFORE INSERT OR UPDATE ON firm_exceptional_access_requests
  FOR EACH ROW EXECUTE FUNCTION firm_exceptional_access_requests_rules();
