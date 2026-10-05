-- CreateEnum
CREATE TYPE "LegalDocumentKind" AS ENUM ('TERMS', 'PRIVACY');

-- CreateTable
CREATE TABLE "business_settings" (
    "business_id" UUID NOT NULL,
    "contact_email" TEXT,
    "contact_phone" TEXT,
    "website" TEXT,
    "address_line1" TEXT,
    "address_line2" TEXT,
    "city" TEXT,
    "state" TEXT,
    "postal_code" TEXT,
    "country" TEXT NOT NULL DEFAULT 'US',
    "timezone" TEXT NOT NULL DEFAULT 'America/New_York',
    "logo_key" TEXT,
    "brand_color" TEXT,
    "enabled_modules" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "client_sign_up_enabled" BOOLEAN NOT NULL DEFAULT true,
    "setup_progress" JSONB NOT NULL DEFAULT '{}',
    "setup_completed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "business_settings_pkey" PRIMARY KEY ("business_id")
);

-- CreateTable
CREATE TABLE "firm_legal_documents" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "kind" "LegalDocumentKind" NOT NULL,
    "version" INTEGER NOT NULL,
    "body" TEXT NOT NULL,
    "published_by_user_id" UUID NOT NULL,
    "published_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "firm_legal_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_statuses" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "archived_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "tax_statuses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invites" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "membership_id" UUID,
    "client_account_id" UUID,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "invited_by_user_id" UUID,
    "accepted_at" TIMESTAMPTZ(3),
    "revoked_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invites_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "firm_legal_documents_business_id_kind_version_key" ON "firm_legal_documents"("business_id", "kind", "version");

-- CreateIndex
CREATE UNIQUE INDEX "tax_statuses_business_id_name_key" ON "tax_statuses"("business_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "tax_statuses_business_id_id_key" ON "tax_statuses"("business_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "invites_token_hash_key" ON "invites"("token_hash");

-- CreateIndex
CREATE INDEX "invites_business_id_membership_id_idx" ON "invites"("business_id", "membership_id");

-- CreateIndex
CREATE INDEX "invites_business_id_client_account_id_idx" ON "invites"("business_id", "client_account_id");

-- CreateIndex
CREATE UNIQUE INDEX "client_accounts_business_id_id_key" ON "client_accounts"("business_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "memberships_business_id_id_key" ON "memberships"("business_id", "id");

-- AddForeignKey
ALTER TABLE "business_settings" ADD CONSTRAINT "business_settings_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "firm_legal_documents" ADD CONSTRAINT "firm_legal_documents_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_statuses" ADD CONSTRAINT "tax_statuses_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invites" ADD CONSTRAINT "invites_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invites" ADD CONSTRAINT "invites_business_id_membership_id_fkey" FOREIGN KEY ("business_id", "membership_id") REFERENCES "memberships"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invites" ADD CONSTRAINT "invites_business_id_client_account_id_fkey" FOREIGN KEY ("business_id", "client_account_id") REFERENCES "client_accounts"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ==================== R0 step 2: row-level security and data rules ====================
-- Business settings, firm Terms and Privacy versions, tax statuses, invites.

-- ---------- Invite scope ----------
-- The signed-out "accept invite" step: the API hashes the token from the link and opens the
-- invite scope, which sees only the invite with that hash and nothing else. It reads
-- business_id from that row, then does the rest in business scope.
CREATE OR REPLACE FUNCTION app_current_invite_token_hash() RETURNS text
  LANGUAGE sql STABLE
  AS $$ SELECT CASE WHEN app_scope() = 'invite'
                    THEN NULLIF(current_setting('app.invite_token_hash', true), '') END $$;

-- ---------- Grants ----------
GRANT SELECT, INSERT, UPDATE, DELETE ON business_settings, tax_statuses TO firmivra_app;
-- A published Terms or Privacy version never changes: clients accepted that exact text.
GRANT SELECT, INSERT ON firm_legal_documents TO firmivra_app;
-- Invites stay as a record: accepted or revoked, never deleted.
GRANT SELECT, INSERT, UPDATE ON invites TO firmivra_app;

-- ---------- Enable and force RLS ----------
ALTER TABLE business_settings    ENABLE ROW LEVEL SECURITY;
ALTER TABLE business_settings    FORCE ROW LEVEL SECURITY;
ALTER TABLE firm_legal_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE firm_legal_documents FORCE ROW LEVEL SECURITY;
ALTER TABLE tax_statuses         ENABLE ROW LEVEL SECURITY;
ALTER TABLE tax_statuses         FORCE ROW LEVEL SECURITY;
ALTER TABLE invites              ENABLE ROW LEVEL SECURITY;
ALTER TABLE invites              FORCE ROW LEVEL SECURITY;

-- ---------- Tenant tables: only the current business ----------
CREATE POLICY business_settings_business ON business_settings
  USING (business_id = app_current_business_id())
  WITH CHECK (business_id = app_current_business_id());

CREATE POLICY firm_legal_documents_business ON firm_legal_documents
  USING (business_id = app_current_business_id())
  WITH CHECK (business_id = app_current_business_id());

CREATE POLICY tax_statuses_business ON tax_statuses
  USING (business_id = app_current_business_id())
  WITH CHECK (business_id = app_current_business_id());

CREATE POLICY invites_business ON invites
  USING (business_id = app_current_business_id())
  WITH CHECK (business_id = app_current_business_id());
CREATE POLICY invites_by_token ON invites FOR SELECT
  USING (token_hash = app_current_invite_token_hash());

-- ---------- Data rules Prisma cannot express ----------
ALTER TABLE business_settings ADD CONSTRAINT business_settings_brand_color
  CHECK (brand_color ~ '^#[0-9A-Fa-f]{6}$');
ALTER TABLE business_settings ADD CONSTRAINT business_settings_contact_email_lowercase
  CHECK (contact_email = lower(contact_email));
ALTER TABLE firm_legal_documents ADD CONSTRAINT firm_legal_documents_version_positive
  CHECK (version > 0);
ALTER TABLE tax_statuses ADD CONSTRAINT tax_statuses_name_not_blank
  CHECK (btrim(name) <> '');

-- An invite is for exactly one staff membership or one client account.
ALTER TABLE invites ADD CONSTRAINT invites_one_target
  CHECK (num_nonnulls(membership_id, client_account_id) = 1);
ALTER TABLE invites ADD CONSTRAINT invites_token_hash_sha256
  CHECK (token_hash ~ '^[0-9a-f]{64}$');
-- Links last at most 7 days (docs/AUTH-DESIGN.md). One minute of slack for the API and the
-- database clocks, since expires_at comes from the API and created_at from the database.
ALTER TABLE invites ADD CONSTRAINT invites_expiry_7_days
  CHECK (expires_at > created_at AND expires_at <= created_at + interval '7 days 1 minute');
ALTER TABLE invites ADD CONSTRAINT invites_accepted_or_revoked
  CHECK (accepted_at IS NULL OR revoked_at IS NULL);

-- An invite starts open; afterwards only acceptance or revocation, once, can change it.
CREATE FUNCTION invites_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.accepted_at IS NOT NULL OR NEW.revoked_at IS NOT NULL THEN
      RAISE EXCEPTION 'invites: a new invite cannot be accepted or revoked already'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.id <> OLD.id OR NEW.business_id <> OLD.business_id
     OR NEW.membership_id IS DISTINCT FROM OLD.membership_id
     OR NEW.client_account_id IS DISTINCT FROM OLD.client_account_id
     OR NEW.token_hash <> OLD.token_hash OR NEW.expires_at <> OLD.expires_at
     OR NEW.invited_by_user_id IS DISTINCT FROM OLD.invited_by_user_id
     OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'invites: only acceptance and revocation can change an invite'
      USING ERRCODE = 'check_violation';
  END IF;

  IF (OLD.accepted_at IS NOT NULL AND NEW.accepted_at IS DISTINCT FROM OLD.accepted_at)
     OR (OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at) THEN
    RAISE EXCEPTION 'invites: acceptance and revocation cannot be undone'
      USING ERRCODE = 'check_violation';
  END IF;

  IF OLD.accepted_at IS NULL AND NEW.accepted_at IS NOT NULL
     AND (OLD.revoked_at IS NOT NULL OR OLD.expires_at <= now()) THEN
    RAISE EXCEPTION 'invites: a revoked or expired invite cannot be accepted'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER invites_rules
  BEFORE INSERT OR UPDATE ON invites
  FOR EACH ROW EXECUTE FUNCTION invites_rules();
