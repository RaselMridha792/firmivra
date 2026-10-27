-- r1_client_responsible_party (R1, Oct 26; Rasel's word: "the responsible-party columns"): R60's
-- column request 14 for Octavia's Clients E5 (docs/specs/review-2026-10-25/CHANGE-LIST.md). A
-- Business client's responsible party, the person linked to the business, not replacing it: three
-- columns on client_profiles (R60's alternative to a client_contacts table). Set together or not at
-- all; requiring them for a Business client is the API's rule. No backfill.

-- AlterTable
ALTER TABLE "client_profiles" ADD COLUMN     "responsible_party_email" TEXT,
ADD COLUMN     "responsible_party_name" TEXT,
ADD COLUMN     "responsible_party_phone" TEXT;



-- ---------- Data rules Prisma cannot express ----------
-- All three or none: a trimmed name of 1 to 200, a lower-case email, an E.164 phone.
ALTER TABLE client_profiles ADD CONSTRAINT client_profiles_responsible_party
  CHECK (num_nonnulls(responsible_party_name, responsible_party_email, responsible_party_phone) IN (0, 3)
     AND (responsible_party_name IS NULL
          OR (responsible_party_name = btrim(responsible_party_name)
              AND char_length(responsible_party_name) BETWEEN 1 AND 200))
     AND (responsible_party_email IS NULL
          OR (responsible_party_email = lower(responsible_party_email)
              AND responsible_party_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
              AND char_length(responsible_party_email) <= 254))
     AND (responsible_party_phone IS NULL OR responsible_party_phone ~ '^\+[1-9][0-9]{6,14}$'));
