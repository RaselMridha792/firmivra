-- r1_tax_business_identity (R1, Oct 26; Rasel's tap for Octavia's Oct 25 reviews, 4 of 4): TX-F31
-- and TX-F32 of the Tax Returns review (docs/specs/review-2026-10-26/CHANGE-LIST.md). A BUSINESS
-- return keeps a snapshot of the business it is for: name, EIN and address. The database copies it
-- at creation from the client's own profile (by client id, never matched by name), so the profile
-- stays the source for new returns and later profile edits don't rewrite an old return. The EIN
-- follows the existing rules: sealed with the firm's key (sealed_value_ok), last 4 digits beside
-- it, shown masked by the API. Correctable until the return is first filed, then frozen. No
-- backfill: returns from before have no snapshot.

-- AlterTable
ALTER TABLE "tax_returns" ADD COLUMN     "business_address_line1" TEXT,
ADD COLUMN     "business_address_line2" TEXT,
ADD COLUMN     "business_city" TEXT,
ADD COLUMN     "business_ein_enc" BYTEA,
ADD COLUMN     "business_ein_last4" TEXT,
ADD COLUMN     "business_name" TEXT,
ADD COLUMN     "business_postal_code" TEXT,
ADD COLUMN     "business_state" TEXT;



-- ---------- Data rules Prisma cannot express ----------
-- Only a BUSINESS return has a business identity.
ALTER TABLE tax_returns ADD CONSTRAINT tax_returns_business_identity_kind
  CHECK (filing_type = 'BUSINESS'
      OR num_nonnulls(business_name, business_ein_enc, business_ein_last4, business_address_line1,
                      business_address_line2, business_city, business_state,
                      business_postal_code) = 0);
ALTER TABLE tax_returns ADD CONSTRAINT tax_returns_business_ein_sealed
  CHECK (sealed_value_ok(business_ein_enc));
ALTER TABLE tax_returns ADD CONSTRAINT tax_returns_business_ein
  CHECK ((business_ein_enc IS NULL) = (business_ein_last4 IS NULL)
     AND (business_ein_last4 IS NULL OR business_ein_last4 ~ '^[0-9]{4}$'));

-- At creation a BUSINESS return takes the client's profile as it is now (whatever was sent is
-- replaced); the EIN only as a sealed number with its last 4. After the first filing the snapshot
-- never changes. Runs as the caller, so RLS keeps it to the firm's own profile.
CREATE FUNCTION tax_returns_business_identity() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.filing_type = 'BUSINESS' THEN
      SELECT p.business_name,
             CASE WHEN p.ein_last4 IS NOT NULL THEN p.ein_enc END,
             CASE WHEN p.ein_enc IS NOT NULL THEN p.ein_last4 END,
             p.address_line1, p.address_line2, p.city, p.state, p.postal_code
        INTO NEW.business_name, NEW.business_ein_enc, NEW.business_ein_last4,
             NEW.business_address_line1, NEW.business_address_line2, NEW.business_city,
             NEW.business_state, NEW.business_postal_code
        FROM client_profiles p
       WHERE p.business_id = NEW.business_id AND p.client_id = NEW.client_id;
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.first_filed_at IS NOT NULL AND (
       NEW.business_name IS DISTINCT FROM OLD.business_name
    OR NEW.business_ein_enc IS DISTINCT FROM OLD.business_ein_enc
    OR NEW.business_ein_last4 IS DISTINCT FROM OLD.business_ein_last4
    OR NEW.business_address_line1 IS DISTINCT FROM OLD.business_address_line1
    OR NEW.business_address_line2 IS DISTINCT FROM OLD.business_address_line2
    OR NEW.business_city IS DISTINCT FROM OLD.business_city
    OR NEW.business_state IS DISTINCT FROM OLD.business_state
    OR NEW.business_postal_code IS DISTINCT FROM OLD.business_postal_code) THEN
    RAISE EXCEPTION 'tax returns: a filed return keeps its business identity'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER tax_returns_3_business_identity
  BEFORE INSERT OR UPDATE ON tax_returns
  FOR EACH ROW EXECUTE FUNCTION tax_returns_business_identity();
