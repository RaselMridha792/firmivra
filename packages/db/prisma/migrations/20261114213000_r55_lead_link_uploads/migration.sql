-- R55 item n (approved by the lead under Rasel's delegation, Nov 14): a lead's own files through
-- the secure intake link. lead_uploads.intake_id names the lead's sent intake whose link a file
-- answers. It is set only on the lead's own file (never a staff file), only while that intake is
-- the lead's, open and not past its expiry, with a live link. The API checks that the slot is one
-- of the form's upload fields (as for client intake documents); the database checks the key's
-- shape. The lead may remove a link file while its intake is open. intake_id never changes.
-- Safe on dev: one nullable column, its index and foreign key; no backfill; the new check passes
-- on every existing row (intake_id is null).

-- AlterTable
ALTER TABLE "lead_uploads" ADD COLUMN     "intake_id" UUID;

-- CreateIndex
CREATE INDEX "lead_uploads_business_id_intake_id_idx" ON "lead_uploads"("business_id", "intake_id");

-- AddForeignKey
ALTER TABLE "lead_uploads" ADD CONSTRAINT "lead_uploads_business_id_intake_id_fkey" FOREIGN KEY ("business_id", "intake_id") REFERENCES "intakes"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------- Data rules Prisma cannot express ----------
ALTER TABLE lead_uploads ADD CONSTRAINT lead_uploads_intake_link
  CHECK (intake_id IS NULL OR (uploaded_by_user_id IS NULL AND intake_keys_ok(ARRAY[slot])));

CREATE OR REPLACE FUNCTION lead_uploads_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.scan_status <> 'PENDING' THEN
      RAISE EXCEPTION 'lead uploads: a new upload starts unscanned (PENDING)'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.intake_id IS NOT NULL THEN
      -- The lead's own file through its secure link: the lead's open intake, link live.
      PERFORM 1 FROM intakes i JOIN leads l ON l.id = i.lead_id
        WHERE i.id = NEW.intake_id AND i.lead_id = NEW.lead_id
          AND i.status IN ('SENT', 'IN_PROGRESS', 'NEEDS_CORRECTION')
          AND (i.expires_at IS NULL OR i.expires_at > now())
          AND i.access_token_expires_at > now()
          AND l.archived_at IS NULL AND l.status NOT IN ('DRAFT', 'EXPIRED', 'CONVERTED')
        FOR SHARE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'lead uploads: a file through the secure link needs the lead''s open intake with a live link'
          USING ERRCODE = 'check_violation';
      END IF;
    ELSIF NEW.uploaded_by_user_id IS NULL THEN
      IF NOT EXISTS (SELECT 1 FROM leads l WHERE l.id = NEW.lead_id AND l.status = 'DRAFT') THEN
        RAISE EXCEPTION 'lead uploads: files can be added only while the lead is a draft'
          USING ERRCODE = 'check_violation';
      END IF;
    ELSIF NOT EXISTS (
      SELECT 1 FROM leads l
      WHERE l.id = NEW.lead_id AND l.archived_at IS NULL
        AND l.status NOT IN ('DRAFT', 'EXPIRED', 'CONVERTED')
    ) THEN
      RAISE EXCEPTION 'lead uploads: staff add files to an open lead only'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.id <> OLD.id OR NEW.business_id <> OLD.business_id OR NEW.lead_id <> OLD.lead_id
     OR NEW.s3_key <> OLD.s3_key OR NEW.content_type <> OLD.content_type
     OR NEW.sha256 <> OLD.sha256 OR NEW.size_bytes <> OLD.size_bytes
     OR NEW.uploaded_by_user_id IS DISTINCT FROM OLD.uploaded_by_user_id
     OR NEW.intake_id IS DISTINCT FROM OLD.intake_id
     OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'lead uploads: the file, its S3 key and its lead cannot change'
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.scan_status <> 'PENDING'
     AND (NEW.scan_status <> OLD.scan_status OR NEW.scanned_at IS DISTINCT FROM OLD.scanned_at) THEN
    RAISE EXCEPTION 'lead uploads: a scan result cannot change'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;

-- Only the lead's Begin Online files need its unexpired draft (a link file has its own rule).
CREATE OR REPLACE FUNCTION lead_uploads_unexpired_draft() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF NEW.uploaded_by_user_id IS NOT NULL OR NEW.intake_id IS NOT NULL THEN
    RETURN NEW;
  END IF;
  PERFORM 1 FROM leads l
    WHERE l.id = NEW.lead_id AND l.status = 'DRAFT' AND l.draft_expires_at > now()
    FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'lead uploads: only an unexpired draft takes files'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;

-- The lead removes a link file only while its intake is open (as the portal's removeUpload).
CREATE POLICY lead_uploads_delete_link ON lead_uploads FOR DELETE
  USING (business_id = app_current_business_id() AND intake_id IS NOT NULL
         AND EXISTS (SELECT 1 FROM intakes i
                     WHERE i.id = lead_uploads.intake_id
                       AND i.status IN ('SENT', 'IN_PROGRESS', 'NEEDS_CORRECTION')));
