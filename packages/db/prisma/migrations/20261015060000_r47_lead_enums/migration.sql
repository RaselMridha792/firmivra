-- R47 (Rasel, Oct 15): one set of lead enums for the database and the Leads contract (R43).
-- LeadSource gets the four sources the Leads design shows (a phone call, a walk-in, an email, an
-- event), placed before OTHER; LeadActivityKind gets DOCUMENT (a file uploaded for the lead) and
-- CAMPAIGN (the lead added to a campaign). Nothing is renamed or removed. The new values are not
-- used by any check, index, policy or row here (a new value cannot be used in the transaction
-- that adds it).

-- AlterEnum
ALTER TYPE "LeadSource" ADD VALUE IF NOT EXISTS 'PHONE_CALL' BEFORE 'OTHER';
ALTER TYPE "LeadSource" ADD VALUE IF NOT EXISTS 'WALK_IN' BEFORE 'OTHER';
ALTER TYPE "LeadSource" ADD VALUE IF NOT EXISTS 'EMAIL' BEFORE 'OTHER';
ALTER TYPE "LeadSource" ADD VALUE IF NOT EXISTS 'EVENT' BEFORE 'OTHER';

-- AlterEnum
ALTER TYPE "LeadActivityKind" ADD VALUE IF NOT EXISTS 'DOCUMENT';
ALTER TYPE "LeadActivityKind" ADD VALUE IF NOT EXISTS 'CAMPAIGN';
