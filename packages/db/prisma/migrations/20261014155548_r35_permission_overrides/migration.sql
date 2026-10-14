-- r35_permission_overrides (R35, Rasel Oct 14): what a firm changed in the permission grid of
-- Settings > Users & Roles: per role (role_permissions) and per member (member_permissions). The
-- defaults are code; "Reset to Default" deletes the rows. Both are firm tables: business_id,
-- same-firm foreign keys, RLS enabled and forced with the business policy. The Owner's
-- permissions cannot be overridden.


-- CreateEnum
CREATE TYPE "PermissionModule" AS ENUM ('DASHBOARD', 'CLIENTS', 'LEADS', 'APPOINTMENTS', 'INTAKE_FORMS', 'DOCUMENTS', 'CLIENT_PORTAL', 'TASKS', 'TAX_RETURNS', 'BOOKKEEPING', 'PAYROLL', 'TAX_PLANNING', 'BUSINESS_ADVISORY', 'INVOICES_PAYMENTS', 'MESSAGES', 'COMMUNICATIONS', 'AUTOMATIONS', 'COMPLIANCE', 'REPORTS', 'TEMPLATES', 'SERVICES_PRICING', 'STAFF_MANAGEMENT', 'INTEGRATIONS', 'SETTINGS');

-- CreateEnum
CREATE TYPE "PermissionCapability" AS ENUM ('VIEW', 'CREATE', 'EDIT', 'DELETE', 'APPROVE', 'MANAGE', 'EXPORT');

-- CreateTable
CREATE TABLE "role_permissions" (
    "business_id" UUID NOT NULL,
    "role" "MembershipRole" NOT NULL,
    "module" "PermissionModule" NOT NULL,
    "capability" "PermissionCapability" NOT NULL,
    "granted" BOOLEAN NOT NULL,
    "updated_by_membership_id" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("business_id","role","module","capability")
);

-- CreateTable
CREATE TABLE "member_permissions" (
    "business_id" UUID NOT NULL,
    "membership_id" UUID NOT NULL,
    "module" "PermissionModule" NOT NULL,
    "capability" "PermissionCapability" NOT NULL,
    "granted" BOOLEAN NOT NULL,
    "updated_by_membership_id" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "member_permissions_pkey" PRIMARY KEY ("business_id","membership_id","module","capability")
);

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_business_id_updated_by_membership_id_fkey" FOREIGN KEY ("business_id", "updated_by_membership_id") REFERENCES "memberships"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_permissions" ADD CONSTRAINT "member_permissions_business_id_membership_id_fkey" FOREIGN KEY ("business_id", "membership_id") REFERENCES "memberships"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_permissions" ADD CONSTRAINT "member_permissions_business_id_updated_by_membership_id_fkey" FOREIGN KEY ("business_id", "updated_by_membership_id") REFERENCES "memberships"("business_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------- Grants ----------
GRANT SELECT, INSERT, UPDATE, DELETE ON role_permissions, member_permissions TO firmivra_app;

-- ---------- Enable and force RLS; the business policy ----------
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['role_permissions', 'member_permissions'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I ON %I USING (business_id = app_current_business_id())'
                   ' WITH CHECK (business_id = app_current_business_id())', t || '_business', t);
  END LOOP;
END
$$;

-- ---------- Shape ----------
-- The Owner's permissions are fixed: no override for the role, and none for a member who is an
-- Owner. (A member made an Owner later keeps old rows, which the API ignores for Owners.)
ALTER TABLE role_permissions ADD CONSTRAINT role_permissions_not_owner CHECK (role <> 'OWNER');

CREATE FUNCTION member_permissions_rules() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM memberships m WHERE m.id = NEW.membership_id AND m.role = 'OWNER') THEN
    RAISE EXCEPTION 'member_permissions: an Owner''s permissions cannot be changed'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER member_permissions_rules BEFORE INSERT ON member_permissions
  FOR EACH ROW EXECUTE FUNCTION member_permissions_rules();
