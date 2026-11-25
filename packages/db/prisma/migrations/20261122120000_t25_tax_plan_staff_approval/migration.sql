-- Q13: additive, no backfill. Staff approval never changes a historical snapshot.
ALTER TYPE "TaxPlanEventKind" ADD VALUE 'STAFF_APPROVED';

CREATE TABLE tax_plan_staff_approvals (
  id UUID NOT NULL PRIMARY KEY,
  business_id UUID NOT NULL,
  plan_id UUID NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 1),
  approved_by_user_id UUID NOT NULL,
  approved_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT tax_plan_staff_approvals_version_fkey
    FOREIGN KEY (business_id, plan_id, version)
    REFERENCES tax_plan_versions (business_id, plan_id, version)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT tax_plan_staff_approvals_member_fkey
    FOREIGN KEY (business_id, approved_by_user_id)
    REFERENCES memberships (business_id, user_id)
    ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX tax_plan_staff_approvals_business_id_plan_id_version_key
  ON tax_plan_staff_approvals (business_id, plan_id, version);

GRANT SELECT, INSERT ON tax_plan_staff_approvals TO firmivra_app;
ALTER TABLE tax_plan_staff_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE tax_plan_staff_approvals FORCE ROW LEVEL SECURITY;
CREATE POLICY tax_plan_staff_approvals_business ON tax_plan_staff_approvals
  USING (business_id = app_current_business_id())
  WITH CHECK (business_id = app_current_business_id());

CREATE FUNCTION tax_plan_staff_approvals_rules() RETURNS trigger
  LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM tax_plan_versions
    WHERE business_id = NEW.business_id AND plan_id = NEW.plan_id
      AND version = NEW.version AND event = 'FINALIZED'
  ) THEN
    RAISE EXCEPTION 'staff sign-off requires a finalized plan version'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER tax_plan_staff_approvals_rules
  BEFORE INSERT ON tax_plan_staff_approvals
  FOR EACH ROW EXECUTE FUNCTION tax_plan_staff_approvals_rules();
