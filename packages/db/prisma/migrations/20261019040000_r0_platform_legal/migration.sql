-- r0_platform_legal (R0, Oct 19, Super Admin schema stage D4): Firmivra's own legal documents
-- for the firms on the platform (Terms of Service, Privacy Policy, Data Processing Agreement,
-- Acceptable Use), versioned per kind with one published version in force, and the acceptance
-- records that prove who agreed to which version and when. Not a firm's text for its clients
-- (that is firm_legal_documents). Platform data: the Super Admin team writes it, every scope reads
-- the published text, a firm reads its own acceptances. An acceptance outlives a deleted firm or
-- application (the link is cleared; named linked_business_id so the firm delete keeps the row).
-- Queued in docs/work/R0-schema.md ("Schema gaps from the Super Admin API sessions").

-- CreateEnum
CREATE TYPE "PlatformLegalDocumentKind" AS ENUM ('TERMS_OF_SERVICE', 'PRIVACY_POLICY', 'DATA_PROCESSING_AGREEMENT', 'ACCEPTABLE_USE');

-- CreateEnum
CREATE TYPE "PlatformLegalDocumentStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'RETIRED');

-- CreateTable
CREATE TABLE "platform_legal_documents" (
    "id" UUID NOT NULL,
    "kind" "PlatformLegalDocumentKind" NOT NULL,
    "version" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "summary_of_changes" TEXT,
    "status" "PlatformLegalDocumentStatus" NOT NULL DEFAULT 'DRAFT',
    "effective_at" TIMESTAMPTZ(3),
    "requires_reacceptance" BOOLEAN NOT NULL DEFAULT false,
    "published_at" TIMESTAMPTZ(3),
    "published_by_user_id" UUID,
    "retired_at" TIMESTAMPTZ(3),
    "created_by_user_id" UUID,
    "updated_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "platform_legal_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_legal_acceptances" (
    "id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "linked_business_id" UUID,
    "user_id" UUID,
    "firm_application_id" UUID,
    "accepted_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip_address" INET,
    "user_agent" TEXT,

    CONSTRAINT "platform_legal_acceptances_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "platform_legal_documents_status_idx" ON "platform_legal_documents"("status");

-- CreateIndex
CREATE UNIQUE INDEX "platform_legal_documents_kind_version_key" ON "platform_legal_documents"("kind", "version");

-- CreateIndex
CREATE INDEX "platform_legal_acceptances_document_id_idx" ON "platform_legal_acceptances"("document_id");

-- CreateIndex
CREATE INDEX "platform_legal_acceptances_linked_business_id_idx" ON "platform_legal_acceptances"("linked_business_id");

-- CreateIndex
CREATE INDEX "platform_legal_acceptances_user_id_idx" ON "platform_legal_acceptances"("user_id");

-- CreateIndex
CREATE INDEX "platform_legal_acceptances_firm_application_id_idx" ON "platform_legal_acceptances"("firm_application_id");

-- AddForeignKey
ALTER TABLE "platform_legal_acceptances" ADD CONSTRAINT "platform_legal_acceptances_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "platform_legal_documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_legal_acceptances" ADD CONSTRAINT "platform_legal_acceptances_linked_business_id_fkey" FOREIGN KEY ("linked_business_id") REFERENCES "businesses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_legal_acceptances" ADD CONSTRAINT "platform_legal_acceptances_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_legal_acceptances" ADD CONSTRAINT "platform_legal_acceptances_firm_application_id_fkey" FOREIGN KEY ("firm_application_id") REFERENCES "firm_applications"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------- Values ----------
ALTER TABLE platform_legal_documents ADD CONSTRAINT platform_legal_documents_values
  CHECK (version >= 1 AND platform_text_ok(title, 200) AND platform_text_ok(body, 200000)
         AND (summary_of_changes IS NULL OR platform_text_ok(summary_of_changes, 2000))
         AND (status = 'DRAFT') = (published_at IS NULL)
         AND (status = 'RETIRED') = (retired_at IS NOT NULL)
         AND (status = 'DRAFT' OR effective_at IS NOT NULL));

ALTER TABLE platform_legal_acceptances ADD CONSTRAINT platform_legal_acceptances_values
  CHECK (user_agent IS NULL OR char_length(user_agent) <= 500);

-- One version in force per kind.
CREATE UNIQUE INDEX platform_legal_documents_one_published ON platform_legal_documents (kind)
  WHERE status = 'PUBLISHED';

-- ---------- Rules ----------
-- Documents: numbered 1, 2, 3 per kind; a draft is edited and deleted freely; publishing stamps
-- the time and who (effective now unless a date was set) and retires the kind's previous
-- published version; a published version's text never changes and only retires; retired is
-- final. The database stamps who and when.
CREATE FUNCTION platform_legal_documents_rules() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public, pg_temp
  AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'DRAFT' THEN
      RAISE EXCEPTION 'platform legal documents: only a draft is deleted; a published version retires'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'DRAFT' OR NEW.published_at IS NOT NULL OR NEW.retired_at IS NOT NULL THEN
      RAISE EXCEPTION 'platform legal documents: a new version starts as a draft'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.version <> coalesce((SELECT max(d.version) FROM platform_legal_documents d
                                WHERE d.kind = NEW.kind), 0) + 1 THEN
      RAISE EXCEPTION 'platform legal documents: the next % version is %', NEW.kind,
        coalesce((SELECT max(d.version) FROM platform_legal_documents d WHERE d.kind = NEW.kind), 0) + 1
        USING ERRCODE = 'check_violation';
    END IF;
    NEW.created_at := now();
    NEW.created_by_user_id := app_current_admin_id();
  ELSE
    IF (NEW.id, NEW.kind, NEW.version, NEW.created_at, NEW.created_by_user_id)
       IS DISTINCT FROM (OLD.id, OLD.kind, OLD.version, OLD.created_at, OLD.created_by_user_id) THEN
      RAISE EXCEPTION 'platform legal documents: kind, version and creation never change'
        USING ERRCODE = 'check_violation';
    END IF;
    IF OLD.status = 'RETIRED' THEN
      RAISE EXCEPTION 'platform legal documents: a retired version never changes'
        USING ERRCODE = 'check_violation';
    END IF;
    IF OLD.status = 'PUBLISHED' THEN
      IF NEW.status <> 'RETIRED'
         OR (NEW.title, NEW.body, NEW.summary_of_changes, NEW.effective_at, NEW.requires_reacceptance,
             NEW.published_at, NEW.published_by_user_id)
            IS DISTINCT FROM (OLD.title, OLD.body, OLD.summary_of_changes, OLD.effective_at,
             OLD.requires_reacceptance, OLD.published_at, OLD.published_by_user_id) THEN
        RAISE EXCEPTION 'platform legal documents: a published version never changes; publish a new one'
          USING ERRCODE = 'check_violation';
      END IF;
      NEW.retired_at := now();
    ELSIF NEW.status = 'RETIRED' THEN
      RAISE EXCEPTION 'platform legal documents: a draft is deleted, not retired'
        USING ERRCODE = 'check_violation';
    ELSIF NEW.status = 'PUBLISHED' THEN
      UPDATE platform_legal_documents SET status = 'RETIRED'
      WHERE kind = NEW.kind AND status = 'PUBLISHED' AND id <> NEW.id;
      NEW.published_at := now();
      NEW.published_by_user_id := app_current_admin_id();
      NEW.effective_at := coalesce(NEW.effective_at, now());
    ELSIF NEW.published_at IS NOT NULL OR NEW.retired_at IS NOT NULL THEN
      RAISE EXCEPTION 'platform legal documents: the database stamps publishing and retiring'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  NEW.updated_at := now();
  NEW.updated_by_user_id := app_current_admin_id();
  RETURN NEW;
END
$$;
CREATE TRIGGER platform_legal_documents_rules BEFORE INSERT OR UPDATE OR DELETE ON platform_legal_documents
  FOR EACH ROW EXECUTE FUNCTION platform_legal_documents_rules();

-- Acceptances: of a published version, naming the person or the applicant; the database stamps
-- the time. Insert-only (no update or delete grant).
CREATE FUNCTION platform_legal_acceptances_rules() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public, pg_temp
  AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM platform_legal_documents d
                 WHERE d.id = NEW.document_id AND d.status = 'PUBLISHED') THEN
    RAISE EXCEPTION 'platform legal acceptances: only the published version is accepted'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.user_id IS NULL AND NEW.firm_application_id IS NULL THEN
    RAISE EXCEPTION 'platform legal acceptances: name the person or the firm application'
      USING ERRCODE = 'check_violation';
  END IF;
  NEW.accepted_at := now();
  RETURN NEW;
END
$$;
CREATE TRIGGER platform_legal_acceptances_rules BEFORE INSERT ON platform_legal_acceptances
  FOR EACH ROW EXECUTE FUNCTION platform_legal_acceptances_rules();

-- ---------- Grants ----------
GRANT SELECT, INSERT, UPDATE, DELETE ON platform_legal_documents TO firmivra_app;
GRANT SELECT, INSERT ON platform_legal_acceptances TO firmivra_app;

-- ---------- Row-level security ----------
ALTER TABLE platform_legal_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_legal_documents FORCE ROW LEVEL SECURITY;
ALTER TABLE platform_legal_acceptances ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_legal_acceptances FORCE ROW LEVEL SECURITY;

-- Every scope reads the published text (firm sign-up and activation, the workspace, the portal's
-- footer); the Super Admin team and the platform's jobs read drafts and history too. Only the team
-- writes; which team members may is the API's check (the settings.* keys).
CREATE POLICY platform_legal_documents_read ON platform_legal_documents FOR SELECT
  USING (status = 'PUBLISHED' OR app_scope() = 'platform' OR app_is_admin() OR app_is_platform_member());
CREATE POLICY platform_legal_documents_insert ON platform_legal_documents FOR INSERT
  WITH CHECK (app_is_admin() OR app_is_platform_member());
CREATE POLICY platform_legal_documents_update ON platform_legal_documents FOR UPDATE
  USING (app_is_admin() OR app_is_platform_member())
  WITH CHECK (app_is_admin() OR app_is_platform_member());
CREATE POLICY platform_legal_documents_delete ON platform_legal_documents FOR DELETE
  USING (app_is_admin() OR app_is_platform_member());

-- Acceptances: recorded by the platform's sign-up and activation flows, or by a firm for itself
-- (a member accepting a new version); the team and the platform read all, a firm its own.
CREATE POLICY platform_legal_acceptances_read ON platform_legal_acceptances FOR SELECT
  USING (app_scope() = 'platform' OR app_is_admin() OR app_is_platform_member()
         OR (app_scope() = 'business' AND linked_business_id = app_current_business_id()));
CREATE POLICY platform_legal_acceptances_insert ON platform_legal_acceptances FOR INSERT
  WITH CHECK (app_scope() = 'platform'
              OR (app_scope() = 'business' AND linked_business_id = app_current_business_id()));
