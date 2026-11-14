-- AlterTable
ALTER TABLE "tax_return_filing_attempts" ADD COLUMN     "corrective_task_id" UUID;

-- AlterTable
ALTER TABLE "tax_returns" ADD COLUMN     "filed_tax_year" INTEGER;

-- AddForeignKey
ALTER TABLE "tax_return_filing_attempts" ADD CONSTRAINT "tax_return_filing_attempts_business_id_corrective_task_id_fkey" FOREIGN KEY ("business_id", "corrective_task_id") REFERENCES "tasks"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------- Rules (Tax Returns Review 2, the lead's approval of Nov 14) ----------
-- TX-F16: the year a return was first filed under. Stamped by the database the first time the
-- return leaves IN_PROGRESS (as first_filed_at), never set by the app and never changed, so filed
-- evidence keeps its year after a Correct Tax Year. Existing filed returns take their year now.
UPDATE tax_returns SET filed_tax_year = tax_year WHERE first_filed_at IS NOT NULL;

CREATE OR REPLACE FUNCTION tax_returns_filed_year() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.filed_tax_year IS NOT NULL THEN
      RAISE EXCEPTION 'tax returns: filed_tax_year is set by the database'
        USING ERRCODE = 'check_violation';
    END IF;
  ELSIF NEW.filed_tax_year IS DISTINCT FROM OLD.filed_tax_year THEN
    RAISE EXCEPTION 'tax returns: filed_tax_year is set by the database and never changes'
      USING ERRCODE = 'check_violation';
  END IF;
  -- The same moment first_filed_at is stamped (tax_returns_rules), whatever the trigger order.
  IF NEW.filed_tax_year IS NULL AND NEW.status <> 'IN_PROGRESS' THEN
    NEW.filed_tax_year := NEW.tax_year;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER tax_returns_filed_year BEFORE INSERT OR UPDATE ON tax_returns
  FOR EACH ROW EXECUTE FUNCTION tax_returns_filed_year();

-- TX-F24 (above): corrective_task_id links the task made when a rejection is recorded; tasks are
-- archived, never deleted, so the link is RESTRICT (SET NULL would also null business_id here).
