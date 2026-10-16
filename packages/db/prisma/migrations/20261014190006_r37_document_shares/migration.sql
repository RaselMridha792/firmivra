-- R37 (Rasel, Oct 14), Documents: sharing and settings. document_shares holds who may open a
-- document beyond the usual access, with download, upload (new version) and sign permissions and
-- an expiry; a grant is revoked once, never deleted, and a grant to a client is for a document
-- the client may see (not INTERNAL). There is no public link and no external recipient.
-- document_settings is the firm's Documents settings page. The usual access rules (owners,
-- admins, assigned staff, the household for a shared document) are the API's and are not changed.

-- CreateEnum
CREATE TYPE "DocumentShareRecipient" AS ENUM ('CLIENT', 'MEMBER');

-- CreateTable
CREATE TABLE "document_shares" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "recipient_kind" "DocumentShareRecipient" NOT NULL,
    "client_account_id" UUID,
    "member_user_id" UUID,
    "can_download" BOOLEAN NOT NULL DEFAULT true,
    "can_upload" BOOLEAN NOT NULL DEFAULT false,
    "can_sign" BOOLEAN NOT NULL DEFAULT false,
    "expires_at" TIMESTAMPTZ(3),
    "granted_by_user_id" UUID NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),
    "revoked_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "document_shares_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_settings" (
    "business_id" UUID NOT NULL,
    "request_reminder_days_before" INTEGER,
    "request_expiry_days" INTEGER,
    "document_expiry_reminder_days" INTEGER,
    "share_expiry_days" INTEGER,
    "upload_max_bytes" INTEGER,
    "upload_types" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "default_reviewer_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "document_settings_pkey" PRIMARY KEY ("business_id")
);

-- CreateIndex
CREATE INDEX "document_shares_business_id_document_id_idx" ON "document_shares"("business_id", "document_id");

-- CreateIndex
CREATE INDEX "document_shares_business_id_client_account_id_idx" ON "document_shares"("business_id", "client_account_id");

-- CreateIndex
CREATE INDEX "document_shares_business_id_member_user_id_idx" ON "document_shares"("business_id", "member_user_id");

-- AddForeignKey
ALTER TABLE "document_shares" ADD CONSTRAINT "document_shares_business_id_document_id_fkey" FOREIGN KEY ("business_id", "document_id") REFERENCES "documents"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_shares" ADD CONSTRAINT "document_shares_business_id_client_account_id_fkey" FOREIGN KEY ("business_id", "client_account_id") REFERENCES "client_accounts"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_shares" ADD CONSTRAINT "document_shares_business_id_member_user_id_fkey" FOREIGN KEY ("business_id", "member_user_id") REFERENCES "memberships"("business_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_shares" ADD CONSTRAINT "document_shares_business_id_granted_by_user_id_fkey" FOREIGN KEY ("business_id", "granted_by_user_id") REFERENCES "memberships"("business_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_shares" ADD CONSTRAINT "document_shares_business_id_revoked_by_user_id_fkey" FOREIGN KEY ("business_id", "revoked_by_user_id") REFERENCES "memberships"("business_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_settings" ADD CONSTRAINT "document_settings_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_settings" ADD CONSTRAINT "document_settings_business_id_default_reviewer_user_id_fkey" FOREIGN KEY ("business_id", "default_reviewer_user_id") REFERENCES "memberships"("business_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------- Grants and RLS ----------
GRANT SELECT, INSERT, UPDATE ON document_shares, document_settings TO firmivra_app;
ALTER TABLE document_shares ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_shares FORCE ROW LEVEL SECURITY;
ALTER TABLE document_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_settings FORCE ROW LEVEL SECURITY;
CREATE POLICY document_shares_business ON document_shares
  USING (business_id = app_current_business_id())
  WITH CHECK (business_id = app_current_business_id());
CREATE POLICY document_settings_business ON document_settings
  USING (business_id = app_current_business_id())
  WITH CHECK (business_id = app_current_business_id());

-- ---------- Shape ----------
ALTER TABLE document_shares ADD CONSTRAINT document_shares_recipient
  CHECK ((recipient_kind = 'CLIENT') = (client_account_id IS NOT NULL)
     AND (recipient_kind = 'MEMBER') = (member_user_id IS NOT NULL));
ALTER TABLE document_shares ADD CONSTRAINT document_shares_revoked
  CHECK ((revoked_at IS NULL) = (revoked_by_user_id IS NULL));
-- One live grant per document and person.
CREATE UNIQUE INDEX document_shares_live_client ON document_shares (business_id, document_id, client_account_id)
  WHERE revoked_at IS NULL AND client_account_id IS NOT NULL;
CREATE UNIQUE INDEX document_shares_live_member ON document_shares (business_id, document_id, member_user_id)
  WHERE revoked_at IS NULL AND member_user_id IS NOT NULL;

ALTER TABLE document_settings ADD CONSTRAINT document_settings_ranges
  CHECK ((request_reminder_days_before IS NULL OR request_reminder_days_before BETWEEN 1 AND 30)
     AND (request_expiry_days IS NULL OR request_expiry_days BETWEEN 1 AND 365)
     AND (document_expiry_reminder_days IS NULL OR document_expiry_reminder_days BETWEEN 1 AND 365)
     AND (share_expiry_days IS NULL OR share_expiry_days BETWEEN 1 AND 365)
     AND (upload_max_bytes IS NULL OR upload_max_bytes BETWEEN 1 AND 10485760));
-- The platform's upload types (packages/types UPLOAD_LIMITS); empty means all.
ALTER TABLE document_settings ADD CONSTRAINT document_settings_upload_types
  CHECK (upload_types <@ ARRAY['application/pdf', 'image/jpeg', 'image/png',
           'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
           'application/vnd.openxmlformats-officedocument.wordprocessingml.document']::text[]);

-- ---------- Rules ----------
-- A grant to a client names a login of the document's own client and a document the client may
-- see; a grant to a member names an ACTIVE member. The document, the person and the grantor never
-- change, an expiry is in the future when granted, and a revoked grant never changes again.
CREATE FUNCTION document_shares_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  doc documents%ROWTYPE;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT * INTO doc FROM documents d WHERE d.business_id = NEW.business_id AND d.id = NEW.document_id;
    IF NEW.recipient_kind = 'CLIENT' THEN
      IF doc.direction = 'INTERNAL' OR NOT EXISTS (
           SELECT 1 FROM client_accounts a
           WHERE a.business_id = NEW.business_id AND a.id = NEW.client_account_id
             AND a.client_id = doc.client_id) THEN
        RAISE EXCEPTION 'document shares: a client is given a document of theirs that is not internal'
          USING ERRCODE = 'check_violation';
      END IF;
    ELSIF NOT EXISTS (
        SELECT 1 FROM memberships m
        WHERE m.business_id = NEW.business_id AND m.user_id = NEW.member_user_id AND m.status = 'ACTIVE') THEN
      RAISE EXCEPTION 'document shares: a document is shared with an active member'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.expires_at IS NOT NULL AND NEW.expires_at <= now() THEN
      RAISE EXCEPTION 'document shares: a grant expires in the future'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.revoked_at IS NOT NULL THEN
      RAISE EXCEPTION 'document shares: a grant starts live'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'document shares: a revoked grant cannot change'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.id <> OLD.id OR NEW.business_id <> OLD.business_id OR NEW.document_id <> OLD.document_id
     OR NEW.recipient_kind <> OLD.recipient_kind
     OR NEW.client_account_id IS DISTINCT FROM OLD.client_account_id
     OR NEW.member_user_id IS DISTINCT FROM OLD.member_user_id
     OR NEW.granted_by_user_id <> OLD.granted_by_user_id OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'document shares: the document, the person and the grantor cannot change'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER document_shares_rules
  BEFORE INSERT OR UPDATE ON document_shares
  FOR EACH ROW EXECUTE FUNCTION document_shares_rules();
