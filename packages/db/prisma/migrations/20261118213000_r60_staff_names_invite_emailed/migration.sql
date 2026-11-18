-- r60_staff_names_invite_emailed (R60, Nov 18; Rasel's approval in R60's window): Staff Management
-- Review 2, SM20 and SM21. Additive only: two nullable columns on staff_profiles, one on invites,
-- a check on the new columns, and a backfill that only fills the new name columns.

-- SM20: a member's first and last name kept apart, so a compound name ("SAL QA" + "Import")
-- survives import, storage and edit. users.name stays; the API keeps it in sync on every write.
ALTER TABLE "staff_profiles" ADD COLUMN "first_name" TEXT,
ADD COLUMN "last_name" TEXT;

-- SM21: when the invitation email actually went out (set on each real send, a resend too); NULL
-- while it never did (Send Welcome Email off, or a failed send). No backfill.
ALTER TABLE "invites" ADD COLUMN "emailed_at" TIMESTAMPTZ(3);

-- ---------- Data rules Prisma cannot express ----------

-- The names as users.name keeps them: not blank, at most 120 characters, no control characters.
ALTER TABLE staff_profiles ADD CONSTRAINT staff_profiles_names
  CHECK ((first_name IS NULL
          OR (btrim(first_name) <> '' AND char_length(first_name) <= 120
              AND first_name !~ '[[:cntrl:]]'))
         AND (last_name IS NULL
              OR (btrim(last_name) <> '' AND char_length(last_name) <= 120
                  AND last_name !~ '[[:cntrl:]]')));

-- Backfill (adds only; users.name is never changed): split on the last space, so "SAL QA Import"
-- is "SAL QA" and "Import"; a single word is the first name alone.
UPDATE staff_profiles sp
SET first_name = CASE
      WHEN btrim(u.name) !~ '\s' THEN btrim(u.name)
      ELSE btrim(regexp_replace(btrim(u.name), '\s+\S+$', ''))
    END,
    last_name = CASE
      WHEN btrim(u.name) !~ '\s' THEN NULL
      ELSE substring(btrim(u.name) FROM '\S+$')
    END
FROM memberships m
JOIN users u ON u.id = m.user_id
WHERE m.business_id = sp.business_id
  AND m.id = sp.membership_id
  AND sp.first_name IS NULL
  AND sp.last_name IS NULL;
