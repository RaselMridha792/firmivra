-- R37 (Rasel, Oct 14), Tax Returns: client signatures and the return's files. A return's
-- authorization lines (federal e-file, a state's, the client's consent) point at the Firm Sign
-- request that collects the signature, or record a wet signature with its signed copy; a return
-- that has such lines reaches READY_TO_FILE only when every required one is signed.
-- tax_return_documents gives a client's documents their role in the return (draft, signature
-- form, filed return, acknowledgment, voucher, proof of payment, extension). No new signing flow.

-- CreateEnum
CREATE TYPE "TaxAuthorizationKind" AS ENUM ('FEDERAL_EFILE', 'STATE_EFILE', 'CLIENT_CONSENT');

-- CreateEnum
CREATE TYPE "TaxReturnDocumentKind" AS ENUM ('DRAFT_RETURN', 'SIGNATURE_FORM', 'FILED_RETURN', 'ACKNOWLEDGMENT', 'VOUCHER', 'PAYMENT_PROOF', 'EXTENSION');

-- CreateTable
CREATE TABLE "tax_return_authorizations" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "tax_return_id" UUID NOT NULL,
    "kind" "TaxAuthorizationKind" NOT NULL,
    "jurisdiction" TEXT,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "esign_request_id" UUID,
    "signed_on" DATE,
    "document_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "tax_return_authorizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_return_documents" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "tax_return_id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "kind" "TaxReturnDocumentKind" NOT NULL,
    "jurisdiction" TEXT,
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tax_return_documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tax_return_authorizations_business_id_tax_return_id_idx" ON "tax_return_authorizations"("business_id", "tax_return_id");

-- CreateIndex
CREATE INDEX "tax_return_authorizations_business_id_esign_request_id_idx" ON "tax_return_authorizations"("business_id", "esign_request_id");

-- CreateIndex
CREATE INDEX "tax_return_documents_business_id_tax_return_id_kind_created_idx" ON "tax_return_documents"("business_id", "tax_return_id", "kind", "created_at");

-- CreateIndex
CREATE INDEX "tax_return_documents_business_id_document_id_idx" ON "tax_return_documents"("business_id", "document_id");

-- CreateIndex
CREATE UNIQUE INDEX "tax_return_documents_business_id_tax_return_id_document_id_key" ON "tax_return_documents"("business_id", "tax_return_id", "document_id");

-- AddForeignKey
ALTER TABLE "tax_return_authorizations" ADD CONSTRAINT "tax_return_authorizations_business_id_tax_return_id_fkey" FOREIGN KEY ("business_id", "tax_return_id") REFERENCES "tax_returns"("business_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_return_authorizations" ADD CONSTRAINT "tax_return_authorizations_business_id_esign_request_id_fkey" FOREIGN KEY ("business_id", "esign_request_id") REFERENCES "esign_requests"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_return_authorizations" ADD CONSTRAINT "tax_return_authorizations_business_id_document_id_fkey" FOREIGN KEY ("business_id", "document_id") REFERENCES "documents"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_return_documents" ADD CONSTRAINT "tax_return_documents_business_id_tax_return_id_fkey" FOREIGN KEY ("business_id", "tax_return_id") REFERENCES "tax_returns"("business_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_return_documents" ADD CONSTRAINT "tax_return_documents_business_id_document_id_fkey" FOREIGN KEY ("business_id", "document_id") REFERENCES "documents"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_return_documents" ADD CONSTRAINT "tax_return_documents_business_id_created_by_user_id_fkey" FOREIGN KEY ("business_id", "created_by_user_id") REFERENCES "memberships"("business_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------- Grants and RLS ----------
-- Authorization lines are never deleted; a file's role can be removed, except the filed return's
-- and the acknowledgment's (trigger below).
GRANT SELECT, INSERT, UPDATE ON tax_return_authorizations TO firmivra_app;
GRANT SELECT, INSERT, DELETE ON tax_return_documents TO firmivra_app;
ALTER TABLE tax_return_authorizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE tax_return_authorizations FORCE ROW LEVEL SECURITY;
ALTER TABLE tax_return_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE tax_return_documents FORCE ROW LEVEL SECURITY;
CREATE POLICY tax_return_authorizations_business ON tax_return_authorizations
  USING (business_id = app_current_business_id())
  WITH CHECK (business_id = app_current_business_id());
CREATE POLICY tax_return_documents_business ON tax_return_documents
  USING (business_id = app_current_business_id())
  WITH CHECK (business_id = app_current_business_id());

-- ---------- Shape ----------
ALTER TABLE tax_return_authorizations ADD CONSTRAINT tax_return_authorizations_jurisdiction
  CHECK ((kind = 'STATE_EFILE') = (jurisdiction IS NOT NULL)
     AND (jurisdiction IS NULL OR jurisdiction ~ '^[A-Z]{2}$'));
ALTER TABLE tax_return_authorizations ADD CONSTRAINT tax_return_authorizations_signed
  CHECK ((signed_on IS NULL) = (document_id IS NULL));
-- One line per kind (and state) on a return.
CREATE UNIQUE INDEX tax_return_authorizations_line ON tax_return_authorizations
  (business_id, tax_return_id, kind, coalesce(jurisdiction, ''));
ALTER TABLE tax_return_documents ADD CONSTRAINT tax_return_documents_jurisdiction
  CHECK (jurisdiction IS NULL OR jurisdiction ~ '^(US|[A-Z]{2})$');

-- ---------- Rules ----------
-- A line's Firm Sign request and signed copy are the return's own client's; a recorded
-- signature is not in the future; the line stays with its return and kind.
CREATE FUNCTION tax_return_authorizations_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  return_client uuid;
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.id <> OLD.id OR NEW.business_id <> OLD.business_id
     OR NEW.tax_return_id <> OLD.tax_return_id OR NEW.kind <> OLD.kind
     OR NEW.jurisdiction IS DISTINCT FROM OLD.jurisdiction OR NEW.created_at <> OLD.created_at) THEN
    RAISE EXCEPTION 'tax return authorizations: the return and kind of a line cannot change'
      USING ERRCODE = 'check_violation';
  END IF;
  SELECT r.client_id INTO return_client FROM tax_returns r
    WHERE r.business_id = NEW.business_id AND r.id = NEW.tax_return_id;
  IF NEW.esign_request_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM esign_requests e WHERE e.business_id = NEW.business_id
         AND e.id = NEW.esign_request_id AND e.client_id = return_client) THEN
    RAISE EXCEPTION 'tax return authorizations: the Firm Sign request is the return''s client''s'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.document_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM documents d WHERE d.business_id = NEW.business_id
         AND d.id = NEW.document_id AND d.client_id = return_client) THEN
    RAISE EXCEPTION 'tax return authorizations: the signed copy is a document of the return''s client'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.signed_on > current_date + 1 THEN
    RAISE EXCEPTION 'tax return authorizations: signed_on cannot be in the future'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER tax_return_authorizations_rules
  BEFORE INSERT OR UPDATE ON tax_return_authorizations
  FOR EACH ROW EXECUTE FUNCTION tax_return_authorizations_rules();

-- A return's file is one of its client's documents; the filed return and the acknowledgment
-- stay linked.
CREATE FUNCTION tax_return_documents_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.kind IN ('FILED_RETURN', 'ACKNOWLEDGMENT') THEN
      RAISE EXCEPTION 'tax return documents: the filed return and the acknowledgment stay linked'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM tax_returns r JOIN documents d ON d.client_id = r.client_id
                 WHERE r.business_id = NEW.business_id AND r.id = NEW.tax_return_id
                   AND d.business_id = NEW.business_id AND d.id = NEW.document_id) THEN
    RAISE EXCEPTION 'tax return documents: the file is a document of the return''s client'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER tax_return_documents_rules
  BEFORE INSERT OR DELETE ON tax_return_documents
  FOR EACH ROW EXECUTE FUNCTION tax_return_documents_rules();

-- Ready to file also needs every required authorization line signed: a recorded signature, or
-- a completed Firm Sign request. Replaces the function of the review migration with that added.
CREATE OR REPLACE FUNCTION tax_returns_2_ready() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF tax_return_step(NEW.workflow_status) >= 4 AND tax_return_step(OLD.workflow_status) < 4 THEN
    IF EXISTS (SELECT 1 FROM tax_return_checklist_items c
               WHERE c.business_id = NEW.business_id AND c.tax_return_id = NEW.id
                 AND c.section = 'VALIDATION')
       AND (NEW.final_validated_at IS NULL OR EXISTS (
              SELECT 1 FROM tax_return_checklist_items c
              WHERE c.business_id = NEW.business_id AND c.tax_return_id = NEW.id
                AND c.section = 'VALIDATION'
                AND (c.result = 'ERROR' OR (c.result = 'WARNING' AND c.acknowledged_at IS NULL)))) THEN
      RAISE EXCEPTION 'tax returns: finish the final validation (no errors, warnings acknowledged) before ready to file'
        USING ERRCODE = 'check_violation';
    END IF;
    IF EXISTS (SELECT 1 FROM tax_return_approvals a
               WHERE a.business_id = NEW.business_id AND a.tax_return_id = NEW.id
                 AND a.status IN ('PENDING', 'RETURNED')) THEN
      RAISE EXCEPTION 'tax returns: every review step must be approved before ready to file'
        USING ERRCODE = 'check_violation';
    END IF;
    IF EXISTS (SELECT 1 FROM tax_return_authorizations z
               WHERE z.business_id = NEW.business_id AND z.tax_return_id = NEW.id AND z.required
                 AND z.signed_on IS NULL
                 AND NOT EXISTS (SELECT 1 FROM esign_requests e WHERE e.business_id = z.business_id
                                   AND e.id = z.esign_request_id AND e.status = 'COMPLETED')) THEN
      RAISE EXCEPTION 'tax returns: every required signature must be in before ready to file'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END
$$;
