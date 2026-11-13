-- R1 (Rasel's approval in R1's window, Nov 10; the lead's queue). firm_application_response_codes:
-- the one-time code the applicant types after opening an information request's link (sent to the
-- application's contact email). Only the code's hex HMAC-SHA256 with the server key is kept, never
-- the code. It works for 10 minutes, and only the newest code of a request counts. Platform data:
-- the applicant's link writes in platform scope, admins read. Never deleted. No backfill.
-- Safe on dev: a new, empty table; nothing else changes.

-- CreateTable
CREATE TABLE "firm_application_response_codes" (
    "id" UUID NOT NULL,
    "request_id" UUID NOT NULL,
    "code_hash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "consumed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "firm_application_response_codes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "firm_application_response_codes_request_id_created_at_idx" ON "firm_application_response_codes"("request_id", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "firm_application_response_codes" ADD CONSTRAINT "firm_application_response_codes_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "firm_application_info_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------- Access ----------
-- Never deleted: a used or expired code stays as a record. The applicant's link (platform scope)
-- writes; admins read (to see that a code was sent and used, never the code).
GRANT SELECT, INSERT, UPDATE ON firm_application_response_codes TO firmivra_app;
ALTER TABLE firm_application_response_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE firm_application_response_codes FORCE ROW LEVEL SECURITY;
CREATE POLICY firm_application_response_codes_platform ON firm_application_response_codes
  USING (app_scope() = 'platform') WITH CHECK (app_scope() = 'platform');
CREATE POLICY firm_application_response_codes_admin_read ON firm_application_response_codes
  FOR SELECT USING (app_is_admin());

-- ---------- Data rules Prisma cannot express ----------
ALTER TABLE firm_application_response_codes ADD CONSTRAINT firm_application_response_codes_shape
  CHECK (code_hash ~ '^[0-9a-f]{64}$'
     AND attempts >= 0
     AND expires_at > created_at AND expires_at <= created_at + interval '10 minutes'
     AND (consumed_at IS NULL OR consumed_at >= created_at));

-- The database clock decides. On insert created_at is now() (the API reads it for its resend gap),
-- the request must still be open and its link unexpired, and expires_at must be within 10 minutes
-- (up to 1 minute over, a slightly fast API clock, is trimmed to exactly 10). After insert only
-- attempts (+1 at a time) and consumed_at (once) change. A code is consumed only before it expires,
-- only while its request is still open and unexpired, and only if it is the newest code of that
-- request; consumed_at is then the database's now(). A used code never changes again.
CREATE FUNCTION firm_application_response_codes_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.attempts <> 0 OR NEW.consumed_at IS NOT NULL THEN
      RAISE EXCEPTION 'firm application response codes: a new code has no attempts and is not used'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM firm_application_info_requests r
                   WHERE r.id = NEW.request_id AND r.status = 'OPEN' AND r.expires_at > now()) THEN
      RAISE EXCEPTION 'firm application response codes: a code is sent only for an open request whose link has not expired'
        USING ERRCODE = 'check_violation';
    END IF;
    NEW.created_at := now();
    IF NEW.expires_at <= now() OR NEW.expires_at > now() + interval '11 minutes' THEN
      RAISE EXCEPTION 'firm application response codes: expires_at must be within 10 minutes'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.expires_at > now() + interval '10 minutes' THEN
      NEW.expires_at := now() + interval '10 minutes';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.consumed_at IS NOT NULL THEN
    RAISE EXCEPTION 'firm application response codes: a used code cannot change'
      USING ERRCODE = 'check_violation';
  END IF;
  IF (NEW.id, NEW.request_id, NEW.code_hash, NEW.expires_at, NEW.created_at)
     IS DISTINCT FROM (OLD.id, OLD.request_id, OLD.code_hash, OLD.expires_at, OLD.created_at) THEN
    RAISE EXCEPTION 'firm application response codes: only attempts and consumed_at can change'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.attempts NOT IN (OLD.attempts, OLD.attempts + 1) THEN
    RAISE EXCEPTION 'firm application response codes: attempts only go up by one'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.consumed_at IS NOT NULL THEN
    IF now() >= OLD.expires_at THEN
      RAISE EXCEPTION 'firm application response codes: an expired code cannot be used'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM firm_application_info_requests r
                   WHERE r.id = OLD.request_id AND r.status = 'OPEN' AND r.expires_at > now()) THEN
      RAISE EXCEPTION 'firm application response codes: the request is no longer open'
        USING ERRCODE = 'check_violation';
    END IF;
    IF EXISTS (SELECT 1 FROM firm_application_response_codes c
               WHERE c.request_id = OLD.request_id AND c.id <> OLD.id
                 AND (c.created_at, c.id) > (OLD.created_at, OLD.id)) THEN
      RAISE EXCEPTION 'firm application response codes: only the newest code can be used'
        USING ERRCODE = 'check_violation';
    END IF;
    NEW.consumed_at := now();
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER firm_application_response_codes_rules
  BEFORE INSERT OR UPDATE ON firm_application_response_codes
  FOR EACH ROW EXECUTE FUNCTION firm_application_response_codes_rules();
