-- r0_intake_engine (Rasel's Oct 18 plan, step 3, approved Oct 8), for the intake engine and
-- Begin Online (R11), documents (R5) and appointments: 1. intake uploads in documents; 2. the
-- firm's request for changes; 3. saved steps; 4. a lead's tax year; 5. one Begin Online service
-- per kind; 6. a draft's own expiry and the 90-day cap; 7. client files only into ACTIVE
-- engagements; 8. a lead converts only into an ACTIVE engagement; 9. meeting links;
-- 10. cancel cutoffs.

-- AlterTable
ALTER TABLE "appointment_types" ADD COLUMN     "cancel_cutoff_hours" INTEGER NOT NULL DEFAULT 24;

-- AlterTable
ALTER TABLE "documents" ADD COLUMN     "intake_id" UUID,
ADD COLUMN     "intake_slot" TEXT;

-- AlterTable
ALTER TABLE "intake_submissions" ADD COLUMN     "saved_steps" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "intakes" ADD COLUMN     "correction_note" TEXT,
ADD COLUMN     "correction_requested_at" TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "leads" ADD COLUMN     "draft_expires_at" TIMESTAMPTZ(3),
ADD COLUMN     "tax_year" INTEGER;

-- AlterTable
ALTER TABLE "memberships" ADD COLUMN     "meeting_url" TEXT;

-- AlterTable
ALTER TABLE "services" ADD COLUMN     "begin_online" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "documents_business_id_intake_id_idx" ON "documents"("business_id", "intake_id");

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_business_id_intake_id_fkey" FOREIGN KEY ("business_id", "intake_id") REFERENCES "intakes"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------- Existing rows (local and dev), before the checks ----------
-- A DRAFT lead runs 30 days from now, never past its 90 days (an older one is already expired);
-- no resume link outlives the 90 days; an intake already in NEEDS_CORRECTION gets a generic
-- note. Each firm in its own scope (forced RLS).
DO $$
DECLARE
  firm uuid;
  firms uuid[];
BEGIN
  PERFORM set_config('app.scope', 'platform', true);
  SELECT coalesce(array_agg(id), '{}') INTO firms FROM businesses;
  FOREACH firm IN ARRAY firms LOOP
    PERFORM set_config('app.scope', 'business', true);
    PERFORM set_config('app.current_business_id', firm::text, true);
    UPDATE leads
       SET draft_expires_at = least(created_at + interval '2160 hours', now() + interval '720 hours')
     WHERE business_id = firm AND status = 'DRAFT';
    UPDATE leads SET resume_expires_at = created_at + interval '2160 hours'
     WHERE business_id = firm AND resume_expires_at > created_at + interval '2160 hours';
    UPDATE intakes
       SET correction_note = 'Please review your answers and send the form again.',
           correction_requested_at = updated_at
     WHERE business_id = firm AND status = 'NEEDS_CORRECTION';
  END LOOP;
  PERFORM set_config('app.scope', '', true);
  PERFORM set_config('app.current_business_id', '', true);
END
$$;

-- ---------- 1 and 3. Intake slots and saved steps are form keys ----------
-- IntakeKey in packages/types: camelCase from a lower-case letter, at most 64 characters, never
-- constructor or prototype. A list has no NULL and no key twice.
CREATE FUNCTION intake_keys_ok(items text[]) RETURNS boolean
  LANGUAGE sql IMMUTABLE
  AS $$
  SELECT coalesce(bool_and(i ~ '^[a-z][A-Za-z0-9]{0,63}$' AND i NOT IN ('constructor', 'prototype')), true)
         AND count(DISTINCT i) = count(*)
    FROM unnest(items) AS u(i)
$$;

ALTER TABLE documents ADD CONSTRAINT documents_intake_slot
  CHECK ((intake_id IS NULL) = (intake_slot IS NULL)
         AND (intake_slot IS NULL OR intake_keys_ok(ARRAY[intake_slot])));
-- One dimension, at most 10 (a form's most steps); locked on submit with the rest of the version.
ALTER TABLE intake_submissions ADD CONSTRAINT intake_submissions_saved_steps
  CHECK ((cardinality(saved_steps) = 0 OR array_ndims(saved_steps) = 1)
         AND cardinality(saved_steps) <= 10 AND intake_keys_ok(saved_steps));

-- ---------- 2. The firm's request for changes ----------
-- Set exactly while NEEDS_CORRECTION (no reader filters a stale note; the audit log keeps the
-- history): the API clears it with the status change that ends it. Up to 2,000 characters with
-- something visible (not only blanks); tabs and \r\n line breaks, no other control (C0, C1),
-- line separator, filler or invisible characters (emoji joiners and selectors stay).
ALTER TABLE intakes ADD CONSTRAINT intakes_correction
  CHECK ((correction_note IS NULL) = (correction_requested_at IS NULL)
         AND (status = 'NEEDS_CORRECTION') = (correction_note IS NOT NULL)
         AND correction_note ~ '[^[:space:]\xA0\u1680\u2000-\u200F\u202F\u205F\u2800\u3000\uFE00-\uFE0F]'
         AND char_length(correction_note) <= 2000
         AND correction_note !~ '[\x01-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F\xAD\u034F\u061C\u115F\u1160\u17B4\u17B5\u180E\u200B\u2028-\u202E\u2060-\u2064\u2066-\u206F\u3164\uFEFF\uFFA0\uFFF9-\uFFFB\U000E0000-\U000E007F]');

-- The request's time is the database clock: stamped when the note is set or changed, cleared
-- with it, otherwise kept, whatever the caller sends.
CREATE FUNCTION intakes_correction() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  NEW.correction_requested_at := CASE
    WHEN TG_OP = 'UPDATE' AND NEW.correction_note IS NOT DISTINCT FROM OLD.correction_note
      THEN OLD.correction_requested_at
    WHEN NEW.correction_note IS NOT NULL THEN now() END;
  RETURN NEW;
END
$$;

CREATE TRIGGER intakes_correction
  BEFORE INSERT OR UPDATE ON intakes
  FOR EACH ROW EXECUTE FUNCTION intakes_correction();

-- ---------- 4, 6 and 8. Leads ----------
-- Hours, not days (30 and 90), so a daylight saving change in the session's time zone moves
-- nothing. A DRAFT always has its expiry; a lead keeps it as it leaves DRAFT, and for good.
ALTER TABLE leads ADD CONSTRAINT leads_tax_year CHECK (tax_year BETWEEN 2000 AND 2100);
ALTER TABLE leads ADD CONSTRAINT leads_draft_expiry
  CHECK ((status <> 'DRAFT' OR draft_expires_at IS NOT NULL)
         AND draft_expires_at <= created_at + interval '2160 hours'
         AND resume_expires_at <= created_at + interval '2160 hours');

-- Beside leads_rules (r0_intake): created_at is the database clock, so the 90 days count from
-- it; a new draft runs 30 days unless the API says less, and a renewal reaches at most 30 days
-- from now (1 minute of slack); the expiry is frozen once the lead leaves DRAFT, no lead goes
-- back to DRAFT, an expired draft is neither renewed nor sent on nor given a new resume link (it
-- only becomes EXPIRED), and an EXPIRED lead stays EXPIRED;
-- the tax year is set once, while a draft; a lead converts only into an ACTIVE engagement,
-- held until commit so it is still ACTIVE when the carried-over files arrive.
CREATE FUNCTION leads_draft_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.created_at := now();
    IF NEW.status = 'DRAFT' AND NEW.draft_expires_at IS NULL THEN
      NEW.draft_expires_at := now() + interval '720 hours';
    END IF;
  ELSIF NEW.status = 'DRAFT' AND OLD.status <> 'DRAFT' THEN
    RAISE EXCEPTION 'leads: a lead never goes back to being a draft'
      USING ERRCODE = 'check_violation';
  ELSIF OLD.status = 'EXPIRED' AND NEW.status <> 'EXPIRED' THEN
    RAISE EXCEPTION 'leads: an expired lead stays EXPIRED' USING ERRCODE = 'check_violation';
  ELSIF NEW.status <> 'DRAFT' AND NEW.draft_expires_at IS DISTINCT FROM OLD.draft_expires_at THEN
    RAISE EXCEPTION 'leads: only a draft''s expiry can change' USING ERRCODE = 'check_violation';
  ELSIF OLD.status = 'DRAFT' AND OLD.draft_expires_at <= now()
        AND (NEW.status NOT IN ('DRAFT', 'EXPIRED')
             OR NEW.draft_expires_at IS DISTINCT FROM OLD.draft_expires_at) THEN
    RAISE EXCEPTION 'leads: the draft expired; it only becomes EXPIRED'
      USING ERRCODE = 'check_violation';
  ELSIF NEW.tax_year IS DISTINCT FROM OLD.tax_year
        AND (OLD.tax_year IS NOT NULL OR OLD.status <> 'DRAFT') THEN
    RAISE EXCEPTION 'leads: the tax year is set once, while the lead is a draft'
      USING ERRCODE = 'check_violation';
  END IF;

  -- An expired draft, or an EXPIRED lead, takes no new resume link (clearing it stays allowed).
  IF TG_OP = 'UPDATE'
     AND (OLD.status = 'EXPIRED' OR (OLD.status = 'DRAFT' AND OLD.draft_expires_at <= now()))
     AND NEW.resume_token_hash IS NOT NULL
     AND (NEW.resume_token_hash IS DISTINCT FROM OLD.resume_token_hash
          OR NEW.resume_expires_at IS DISTINCT FROM OLD.resume_expires_at) THEN
    RAISE EXCEPTION 'leads: the draft expired; it takes no new resume link'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.draft_expires_at > now() + interval '720 hours 1 minute'
     AND (TG_OP = 'INSERT' OR NEW.draft_expires_at IS DISTINCT FROM OLD.draft_expires_at) THEN
    RAISE EXCEPTION 'leads: a draft runs at most 30 days from its last activity'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.engagement_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.engagement_id IS DISTINCT FROM OLD.engagement_id) THEN
    PERFORM 1 FROM engagements e WHERE e.id = NEW.engagement_id AND e.status = 'ACTIVE' FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'leads: a lead converts only into an ACTIVE engagement'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER leads_draft_rules
  BEFORE INSERT OR UPDATE ON leads
  FOR EACH ROW EXECUTE FUNCTION leads_draft_rules();

-- An expired draft takes no new data: no new upload, and its intake's answers and saved steps
-- only clear (the API clears them and deletes the uploads, then marks the lead EXPIRED). The lead
-- is held FOR SHARE, so its expiry or submit waits for the write, then sees it. Named to run
-- after each table's own rules trigger, so their messages come first.
CREATE FUNCTION lead_uploads_unexpired_draft() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
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

CREATE TRIGGER lead_uploads_unexpired_draft
  BEFORE INSERT ON lead_uploads
  FOR EACH ROW EXECUTE FUNCTION lead_uploads_unexpired_draft();

CREATE FUNCTION intake_submissions_unexpired_draft() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  expired boolean;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.answers::text IS NOT DISTINCT FROM OLD.answers::text
     AND NEW.saved_steps IS NOT DISTINCT FROM OLD.saved_steps THEN
    RETURN NEW;
  END IF;
  SELECT l.status = 'EXPIRED' OR (l.status = 'DRAFT' AND l.draft_expires_at <= now())
    INTO expired
    FROM intakes i JOIN leads l ON l.id = i.lead_id
    WHERE i.id = NEW.intake_id
    FOR SHARE OF l;
  IF coalesce(expired, false)
     AND (TG_OP = 'INSERT' OR NEW.answers <> '{}'::jsonb OR NEW.saved_steps <> '{}'::text[]) THEN
    RAISE EXCEPTION 'intake submissions: the draft expired; its answers only clear'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER intake_submissions_unexpired_draft
  BEFORE INSERT OR UPDATE ON intake_submissions
  FOR EACH ROW EXECUTE FUNCTION intake_submissions_unexpired_draft();

-- ---------- 5. One Begin Online service per kind ----------
-- The six form kinds, never OTHER; an archived service doesn't count (SQL only: Prisma ignores
-- partial indexes).
ALTER TABLE services ADD CONSTRAINT services_begin_online_kind
  CHECK (NOT (begin_online AND kind = 'OTHER'));
CREATE UNIQUE INDEX services_one_begin_online_per_kind ON services (business_id, kind)
  WHERE begin_online AND archived_at IS NULL;

-- ---------- 1 and 7. Documents ----------
-- Beside documents_rules (r0_intake), which keeps checking the file, the scan and the rest:
-- - every client file, uploaded or carried over, goes only into an ACTIVE engagement (stricter
--   than its PENDING or ACTIVE: R5's 409 NO_OPEN_SERVICE), held until commit (as R5 locks it),
--   so a status change waits for the upload;
-- - an intake upload is a client file for an intake of the same engagement that is open (SENT,
--   IN_PROGRESS, NEEDS_CORRECTION) or, carried over, the intake of the upload's lead in the
--   upload's slot;
-- - a file leaves its intake (detached, both cleared; or deleted before its retention ends)
--   only while the intake is open. Each write holds the intake FOR SHARE, which alone does not
--   protect a submit's reads or its detach: a submit must start with
--   SELECT 1 FROM intakes WHERE id = $1 FOR NO KEY UPDATE before it counts or detaches files,
--   then detach the files of hidden slots, then move the status on.
CREATE FUNCTION documents_intake_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  intake_engagement uuid;
  intake_lead uuid;
  intake_open boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.direction = 'CLIENT_TO_FIRM' THEN
      PERFORM 1 FROM engagements e WHERE e.id = NEW.engagement_id AND e.status = 'ACTIVE' FOR SHARE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'documents: a client can upload only to an open engagement (ACTIVE)'
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;
    IF NEW.intake_id IS NOT NULL THEN
      SELECT i.engagement_id, i.lead_id, i.status IN ('SENT', 'IN_PROGRESS', 'NEEDS_CORRECTION')
        INTO intake_engagement, intake_lead, intake_open
        FROM intakes i WHERE i.id = NEW.intake_id FOR SHARE;
      IF NEW.direction <> 'CLIENT_TO_FIRM' OR intake_engagement IS DISTINCT FROM NEW.engagement_id
         OR (NEW.lead_upload_id IS NULL AND NOT intake_open)
         OR (NEW.lead_upload_id IS NOT NULL AND NOT EXISTS (
               SELECT 1 FROM lead_uploads u
               WHERE u.id = NEW.lead_upload_id AND u.lead_id = intake_lead
                 AND u.slot = NEW.intake_slot)) THEN
        RAISE EXCEPTION 'documents: an intake upload is a client file for an open intake of its engagement'
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  IF (CASE TG_OP WHEN 'DELETE'
        THEN OLD.intake_id IS NOT NULL AND NOT coalesce(OLD.retention_until < current_date, false)
        ELSE (NEW.intake_id, NEW.intake_slot) IS DISTINCT FROM (OLD.intake_id, OLD.intake_slot) END) THEN
    PERFORM 1 FROM intakes i
      WHERE i.id = OLD.intake_id AND (TG_OP = 'DELETE' OR NEW.intake_id IS NULL)
        AND i.status IN ('SENT', 'IN_PROGRESS', 'NEEDS_CORRECTION')
      FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'documents: a file only leaves its intake (detached, both cleared, or deleted) while the intake is open'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN CASE TG_OP WHEN 'DELETE' THEN OLD ELSE NEW END;
END
$$;

CREATE TRIGGER documents_intake_rules
  BEFORE INSERT OR UPDATE OR DELETE ON documents
  FOR EACH ROW EXECUTE FUNCTION documents_intake_rules();

-- A client deletes their own upload only while the engagement is ACTIVE, like the uploads (the
-- rest as in r0_documents).
DROP POLICY documents_delete ON documents;
CREATE POLICY documents_delete ON documents FOR DELETE
  USING (business_id = app_current_business_id()
         AND NOT legal_hold
         AND (retention_until < current_date
              OR (direction = 'CLIENT_TO_FIRM'
                  AND EXISTS (SELECT 1 FROM engagements e
                              WHERE e.id = documents.engagement_id AND e.status = 'ACTIVE'))));

-- ---------- 9 and 10. Meeting links and cancel cutoffs ----------
-- https only; no whitespace, control, filler or invisible characters (listed: the locale decides
-- what [:space:] covers); at most 500 characters.
ALTER TABLE memberships ADD CONSTRAINT memberships_meeting_url
  CHECK (char_length(meeting_url) <= 500
         AND meeting_url ~ '^https://[^[:space:]\x01-\x20\x7F-\xA0\xAD\u034F\u061C\u115F\u1160\u1680\u17B4\u17B5\u180B-\u180F\u2000-\u200F\u2028-\u202F\u205F-\u206F\u2800\u3000\u3164\uFE00-\uFE0F\uFEFF\uFFA0\uFFF9-\uFFFB\U000E0000-\U000E0FFF]+$'
         AND meeting_url ~ '^https://[^/]'
         AND meeting_url !~ '^https://[^/?#]*@'
         AND meeting_url !~ '["''<>\\`]');
-- Hours before the start (0 = until the start), at most 30 days.
ALTER TABLE appointment_types ADD CONSTRAINT appointment_types_cancel_cutoff_hours
  CHECK (cancel_cutoff_hours BETWEEN 0 AND 720);
