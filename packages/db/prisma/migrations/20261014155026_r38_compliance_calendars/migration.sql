-- R38 (Rasel, Oct 14), Compliance & Deadlines, part 2: deadline documents and links, and the
-- government Calendar Library (docs/mockups/firm-workspace/compliance/source, Frame 3 and the
-- guide's sections 5, 10 and 11). A firm keeps its own versioned library of official calendars:
-- authority, jurisdiction, effective year, source URL, retrieved and verified times. An import
-- is a DRAFT; a VERIFIED version is published, which supersedes the earlier one (kept for
-- rollback); a published version's entries never change; an entry without a known date says so
-- (NEEDS_VERIFICATION) instead of inventing one. Deadlines point at the entry that made them.

-- CreateEnum
CREATE TYPE "CalendarFamily" AS ENUM ('IRS_GENERAL', 'IRS_EMPLOYER', 'STATE_INCOME_FRANCHISE', 'SECRETARY_OF_STATE', 'SALES_USE_TAX', 'PAYROLL_WITHHOLDING', 'LOCAL_BUSINESS_LICENSE', 'PROFESSIONAL_LICENSE', 'FIRM_INTERNAL');

-- CreateEnum
CREATE TYPE "CalendarStatus" AS ENUM ('DRAFT', 'VERIFIED', 'PUBLISHED', 'SUPERSEDED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "CalendarRuleKind" AS ENUM ('FIXED_DATE', 'FORMULA', 'NEEDS_VERIFICATION');

-- AlterTable
ALTER TABLE "compliance_deadlines" ADD COLUMN     "applicability_reason" TEXT,
ADD COLUMN     "calendar_entry_id" UUID;

-- CreateTable
CREATE TABLE "compliance_deadline_documents" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "deadline_id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "added_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "compliance_deadline_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "compliance_deadline_links" (
    "business_id" UUID NOT NULL,
    "deadline_id" UUID NOT NULL,
    "related_deadline_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "compliance_deadline_links_pkey" PRIMARY KEY ("deadline_id","related_deadline_id")
);

-- CreateTable
CREATE TABLE "compliance_calendars" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "family" "CalendarFamily" NOT NULL,
    "authority" TEXT NOT NULL,
    "jurisdiction" "JurisdictionLevel" NOT NULL,
    "state" TEXT,
    "effective_year" INTEGER NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "name" TEXT NOT NULL,
    "source_url" TEXT NOT NULL,
    "retrieved_at" TIMESTAMPTZ(3),
    "verified_at" TIMESTAMPTZ(3),
    "status" "CalendarStatus" NOT NULL DEFAULT 'DRAFT',
    "published_at" TIMESTAMPTZ(3),
    "published_by_user_id" UUID,
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "compliance_calendars_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "compliance_calendar_entries" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "calendar_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "type" "DeadlineType" NOT NULL,
    "form" TEXT,
    "description" TEXT,
    "rule_kind" "CalendarRuleKind" NOT NULL,
    "due_on" DATE,
    "rule" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "compliance_calendar_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "compliance_deadline_documents_business_id_document_id_idx" ON "compliance_deadline_documents"("business_id", "document_id");

-- CreateIndex
CREATE UNIQUE INDEX "compliance_deadline_documents_business_id_deadline_id_docum_key" ON "compliance_deadline_documents"("business_id", "deadline_id", "document_id");

-- CreateIndex
CREATE INDEX "compliance_deadline_links_business_id_related_deadline_id_idx" ON "compliance_deadline_links"("business_id", "related_deadline_id");

-- CreateIndex
CREATE INDEX "compliance_calendars_business_id_status_idx" ON "compliance_calendars"("business_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "compliance_calendars_business_id_id_key" ON "compliance_calendars"("business_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "compliance_calendars_business_id_family_authority_state_eff_key" ON "compliance_calendars"("business_id", "family", "authority", "state", "effective_year", "version");

-- CreateIndex
CREATE INDEX "compliance_calendar_entries_business_id_calendar_id_idx" ON "compliance_calendar_entries"("business_id", "calendar_id");

-- CreateIndex
CREATE UNIQUE INDEX "compliance_calendar_entries_business_id_id_key" ON "compliance_calendar_entries"("business_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "compliance_calendar_entries_business_id_calendar_id_name_du_key" ON "compliance_calendar_entries"("business_id", "calendar_id", "name", "due_on");

-- AddForeignKey
ALTER TABLE "compliance_deadlines" ADD CONSTRAINT "compliance_deadlines_business_id_calendar_entry_id_fkey" FOREIGN KEY ("business_id", "calendar_entry_id") REFERENCES "compliance_calendar_entries"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compliance_deadline_documents" ADD CONSTRAINT "compliance_deadline_documents_business_id_deadline_id_fkey" FOREIGN KEY ("business_id", "deadline_id") REFERENCES "compliance_deadlines"("business_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compliance_deadline_documents" ADD CONSTRAINT "compliance_deadline_documents_business_id_document_id_fkey" FOREIGN KEY ("business_id", "document_id") REFERENCES "documents"("business_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compliance_deadline_links" ADD CONSTRAINT "compliance_deadline_links_business_id_deadline_id_fkey" FOREIGN KEY ("business_id", "deadline_id") REFERENCES "compliance_deadlines"("business_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compliance_deadline_links" ADD CONSTRAINT "compliance_deadline_links_business_id_related_deadline_id_fkey" FOREIGN KEY ("business_id", "related_deadline_id") REFERENCES "compliance_deadlines"("business_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compliance_calendar_entries" ADD CONSTRAINT "compliance_calendar_entries_business_id_calendar_id_fkey" FOREIGN KEY ("business_id", "calendar_id") REFERENCES "compliance_calendars"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------- Grants, RLS, policy ----------
-- Calendars are superseded or archived, never deleted. Entries change only while their
-- calendar is a DRAFT (and a failed import's draft can be cleaned up).
GRANT SELECT, INSERT, UPDATE ON compliance_calendars TO firmivra_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance_calendar_entries, compliance_deadline_documents,
  compliance_deadline_links TO firmivra_app;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['compliance_calendars', 'compliance_calendar_entries',
    'compliance_deadline_documents', 'compliance_deadline_links'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I ON %I USING (business_id = app_current_business_id())'
                   ' WITH CHECK (business_id = app_current_business_id())', t || '_business', t);
  END LOOP;
END
$$;

-- ---------- Shape ----------
ALTER TABLE compliance_deadline_links ADD CONSTRAINT compliance_deadline_links_shape
  CHECK (deadline_id <> related_deadline_id);
ALTER TABLE compliance_deadlines ADD CONSTRAINT compliance_deadlines_applicability
  CHECK (char_length(applicability_reason) <= 500);

ALTER TABLE compliance_calendars ADD CONSTRAINT compliance_calendars_shape
  CHECK (btrim(name) <> '' AND char_length(name) <= 200
         AND btrim(authority) <> '' AND char_length(authority) <= 120
         AND effective_year BETWEEN 2000 AND 2100 AND version >= 1
         AND source_url ~ '^https://[^ ]+$' AND char_length(source_url) <= 500
         AND (state IS NULL OR state ~ '^[A-Z]{2}$')
         -- Verified or published means it was verified; published has its time.
         AND (status NOT IN ('VERIFIED', 'PUBLISHED', 'SUPERSEDED') OR verified_at IS NOT NULL)
         AND (status NOT IN ('PUBLISHED', 'SUPERSEDED') OR published_at IS NOT NULL));
-- At most one published version per family, authority, state and year.
CREATE UNIQUE INDEX compliance_calendars_one_published
  ON compliance_calendars (business_id, family, authority, coalesce(state, ''), effective_year)
  WHERE status = 'PUBLISHED';

-- A fixed date has its date, a formula its rule, and an unknown date neither.
ALTER TABLE compliance_calendar_entries ADD CONSTRAINT compliance_calendar_entries_shape
  CHECK (btrim(name) <> '' AND char_length(name) <= 200 AND char_length(description) <= 1000
         AND ((rule_kind = 'FIXED_DATE' AND due_on IS NOT NULL AND rule IS NULL)
           OR (rule_kind = 'FORMULA' AND due_on IS NULL AND COALESCE(jsonb_typeof(rule) = 'object', false))
           OR (rule_kind = 'NEEDS_VERIFICATION' AND due_on IS NULL AND rule IS NULL)));

-- One deadline per client, library entry and statutory date, so generating again finds it.
CREATE UNIQUE INDEX compliance_deadlines_one_per_entry
  ON compliance_deadlines (business_id, client_id, calendar_entry_id, coalesce(statutory_due_on, due_on))
  WHERE calendar_entry_id IS NOT NULL;

-- ---------- A published version is fixed ----------
CREATE FUNCTION compliance_calendars_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF OLD.status <> 'DRAFT' AND (NEW.family, NEW.authority, NEW.state, NEW.effective_year,
       NEW.version, NEW.name, NEW.source_url, NEW.jurisdiction)
     IS DISTINCT FROM (OLD.family, OLD.authority, OLD.state, OLD.effective_year, OLD.version,
       OLD.name, OLD.source_url, OLD.jurisdiction) THEN
    RAISE EXCEPTION 'compliance calendars: a version that left DRAFT cannot change, make a new version'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status <> OLD.status AND NOT ((OLD.status, NEW.status) IN (
       ('DRAFT', 'VERIFIED'), ('VERIFIED', 'PUBLISHED'), ('PUBLISHED', 'SUPERSEDED'),
       ('SUPERSEDED', 'PUBLISHED'), ('DRAFT', 'ARCHIVED'), ('VERIFIED', 'ARCHIVED'),
       ('SUPERSEDED', 'ARCHIVED'))) THEN
    RAISE EXCEPTION 'compliance calendars: a % version cannot become %', OLD.status, NEW.status
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER compliance_calendars_rules BEFORE UPDATE ON compliance_calendars
  FOR EACH ROW EXECUTE FUNCTION compliance_calendars_rules();

-- Entries change only while their calendar is a DRAFT.
CREATE FUNCTION compliance_calendar_entries_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  row_ compliance_calendar_entries := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
BEGIN
  IF (SELECT c.status FROM compliance_calendars c
       WHERE c.business_id = row_.business_id AND c.id = row_.calendar_id) <> 'DRAFT' THEN
    RAISE EXCEPTION 'compliance calendars: only a DRAFT version''s entries can change'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN row_;
END
$$;

CREATE TRIGGER compliance_calendar_entries_rules
  BEFORE INSERT OR UPDATE OR DELETE ON compliance_calendar_entries
  FOR EACH ROW EXECUTE FUNCTION compliance_calendar_entries_rules();

-- ---------- Same client: documents and linked deadlines belong to the deadline's client ----------
CREATE FUNCTION compliance_deadline_parts_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF TG_TABLE_NAME = 'compliance_deadline_documents' THEN
    IF NOT EXISTS (SELECT 1 FROM compliance_deadlines d JOIN documents x
                     ON x.business_id = d.business_id AND x.client_id = d.client_id
                    WHERE d.business_id = NEW.business_id AND d.id = NEW.deadline_id
                      AND x.id = NEW.document_id) THEN
      RAISE EXCEPTION 'compliance deadlines: only one of the deadline client''s documents'
        USING ERRCODE = 'check_violation';
    END IF;
  ELSIF (SELECT count(DISTINCT client_id) FROM compliance_deadlines d
          WHERE d.business_id = NEW.business_id
            AND d.id IN (NEW.deadline_id, NEW.related_deadline_id)) <> 1 THEN
    RAISE EXCEPTION 'compliance deadlines: linked deadlines are of the same client'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER compliance_deadline_documents_rules BEFORE INSERT ON compliance_deadline_documents
  FOR EACH ROW EXECUTE FUNCTION compliance_deadline_parts_rules();
CREATE TRIGGER compliance_deadline_links_rules BEFORE INSERT ON compliance_deadline_links
  FOR EACH ROW EXECUTE FUNCTION compliance_deadline_parts_rules();
