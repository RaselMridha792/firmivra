-- r35_staff_documents_sessions (R35, Rasel Oct 14): HR files kept for a staff member, and a
-- member's signed-in sessions (Active Sessions). Both are firm tables: business_id, same-firm
-- foreign keys, RLS enabled and forced with the business policy. Login history needs no table: it
-- is the audit log's auth.signed_in and auth.sign_in_failed rows.


-- CreateEnum
CREATE TYPE "StaffDocumentType" AS ENUM ('EMPLOYMENT_AGREEMENT', 'CONTRACTOR_AGREEMENT', 'W4', 'DIRECT_DEPOSIT', 'NDA', 'CREDENTIAL_LICENSE', 'TRAINING_ACKNOWLEDGMENT', 'OTHER');

-- CreateTable
CREATE TABLE "staff_documents" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "membership_id" UUID NOT NULL,
    "type" "StaffDocumentType" NOT NULL,
    "file_name" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "s3_key" TEXT NOT NULL,
    "scan_status" "ScanStatus" NOT NULL DEFAULT 'PENDING',
    "scanned_at" TIMESTAMPTZ(3),
    "uploaded_by_membership_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archived_at" TIMESTAMPTZ(3),

    CONSTRAINT "staff_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_sessions" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "membership_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "device" TEXT NOT NULL,
    "ip" TEXT,
    "place" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_active_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMPTZ(3),

    CONSTRAINT "staff_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "staff_documents_s3_key_key" ON "staff_documents"("s3_key");

-- CreateIndex
CREATE INDEX "staff_documents_business_id_membership_id_created_at_idx" ON "staff_documents"("business_id", "membership_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "staff_sessions_token_hash_key" ON "staff_sessions"("token_hash");

-- CreateIndex
CREATE INDEX "staff_sessions_business_id_membership_id_revoked_at_idx" ON "staff_sessions"("business_id", "membership_id", "revoked_at");

-- AddForeignKey
ALTER TABLE "staff_documents" ADD CONSTRAINT "staff_documents_business_id_membership_id_fkey" FOREIGN KEY ("business_id", "membership_id") REFERENCES "memberships"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_documents" ADD CONSTRAINT "staff_documents_business_id_uploaded_by_membership_id_fkey" FOREIGN KEY ("business_id", "uploaded_by_membership_id") REFERENCES "memberships"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_sessions" ADD CONSTRAINT "staff_sessions_business_id_membership_id_fkey" FOREIGN KEY ("business_id", "membership_id") REFERENCES "memberships"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------- Grants: nothing here is deleted (retention); an update changes few columns ----------
GRANT SELECT, INSERT, UPDATE ON staff_documents, staff_sessions TO firmivra_app;

-- ---------- Enable and force RLS; the business policy ----------
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['staff_documents', 'staff_sessions'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I ON %I USING (business_id = app_current_business_id())'
                   ' WITH CHECK (business_id = app_current_business_id())', t || '_business', t);
  END LOOP;
END
$$;

-- ---------- Shape ----------
-- Documents: a plain file name (no folder), the five accepted types, 1 byte to 10 MB, a SHA-256,
-- and a key inside this member's private folder. A scan result comes with its time.
ALTER TABLE staff_documents ADD CONSTRAINT staff_documents_rules
  CHECK (staff_line_ok(file_name, 200) AND file_name !~ '[/\\]'
         AND content_type IN ('application/pdf', 'image/jpeg', 'image/png', 'application/msword',
           'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
         AND size_bytes BETWEEN 1 AND 10485760
         AND esign_hex64(sha256)
         AND starts_with(s3_key, 'tenant/' || business_id::text || '/staff/' || membership_id::text || '/')
         AND (scan_status = 'PENDING') = (scanned_at IS NULL));

-- Sessions: a hashed identifier, short telemetry text, and an IP the database can read.
ALTER TABLE staff_sessions ADD CONSTRAINT staff_sessions_rules
  CHECK (esign_hex64(token_hash) AND staff_line_ok(device, 100) AND staff_line_ok(place, 100)
         AND (ip IS NULL OR (char_length(ip) <= 45 AND staff_ips_ok(ARRAY[ip]))));

-- ---------- Rules on change ----------
-- A document's file, owner and uploader never change. Its type can be corrected (reclassify) and
-- it can be archived, once. The scanner sets the scan result once, from PENDING.
CREATE FUNCTION staff_documents_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  changed text[] := esign_changed(to_jsonb(NEW), to_jsonb(OLD));
BEGIN
  IF NOT changed <@ ARRAY['type', 'archived_at', 'scan_status', 'scanned_at'] THEN
    RAISE EXCEPTION 'staff_documents: only type, archived_at and the scan result can change'
      USING ERRCODE = 'check_violation';
  END IF;
  IF changed && ARRAY['scan_status', 'scanned_at'] AND OLD.scan_status <> 'PENDING' THEN
    RAISE EXCEPTION 'staff_documents: a scan result cannot change' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.archived_at IS NOT NULL AND NEW.archived_at IS DISTINCT FROM OLD.archived_at THEN
    RAISE EXCEPTION 'staff_documents: an archived document stays archived'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER staff_documents_rules BEFORE UPDATE ON staff_documents
  FOR EACH ROW EXECUTE FUNCTION staff_documents_rules();

-- A session's identity never changes; it is seen again (last_active_at) or ended (revoked_at,
-- once). An ended session is not seen again.
CREATE FUNCTION staff_sessions_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  changed text[] := esign_changed(to_jsonb(NEW), to_jsonb(OLD));
BEGIN
  IF NOT changed <@ ARRAY['last_active_at', 'revoked_at', 'ip', 'place', 'device'] THEN
    RAISE EXCEPTION 'staff_sessions: only last_active_at, revoked_at and the device details can change'
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.revoked_at IS NOT NULL AND changed <> '{}' THEN
    RAISE EXCEPTION 'staff_sessions: an ended session does not change' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER staff_sessions_rules BEFORE UPDATE ON staff_sessions
  FOR EACH ROW EXECUTE FUNCTION staff_sessions_rules();
