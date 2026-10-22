-- r1_office_members (R1, Oct 21, Rasel's choice): who works at a location. Assigned Staff, the
-- per-location staff count and Staff Management's "Assigned Locations"; a member may be at several
-- locations. Rows are added and removed, never changed (the audit log keeps the history).

-- CreateTable
CREATE TABLE "firm_office_members" (
    "business_id" UUID NOT NULL,
    "office_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "firm_office_members_pkey" PRIMARY KEY ("office_id","user_id")
);

-- CreateIndex
CREATE INDEX "firm_office_members_business_id_user_id_idx" ON "firm_office_members"("business_id", "user_id");

-- AddForeignKey
ALTER TABLE "firm_office_members" ADD CONSTRAINT "firm_office_members_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "firm_office_members" ADD CONSTRAINT "firm_office_members_business_id_office_id_fkey" FOREIGN KEY ("business_id", "office_id") REFERENCES "firm_offices"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "firm_office_members" ADD CONSTRAINT "firm_office_members_business_id_user_id_fkey" FOREIGN KEY ("business_id", "user_id") REFERENCES "memberships"("business_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------- Grants and RLS ----------

GRANT SELECT, INSERT, DELETE ON firm_office_members TO firmivra_app;
ALTER TABLE firm_office_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE firm_office_members FORCE ROW LEVEL SECURITY;
CREATE POLICY firm_office_members_business ON firm_office_members
  USING (business_id = app_current_business_id())
  WITH CHECK (business_id = app_current_business_id());

-- ---------- Rules ----------

-- An archived location gets no new staff (its rows stay, as its history does).
CREATE FUNCTION firm_office_members_rules() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM firm_offices o WHERE o.business_id = NEW.business_id
      AND o.id = NEW.office_id AND o.archived_at IS NOT NULL) THEN
    RAISE EXCEPTION 'firm office members: an archived location gets no new staff'
      USING ERRCODE = 'check_violation';
  END IF;
  NEW.created_at := now();
  RETURN NEW;
END
$$;
CREATE TRIGGER firm_office_members_rules BEFORE INSERT ON firm_office_members
  FOR EACH ROW EXECUTE FUNCTION firm_office_members_rules();
