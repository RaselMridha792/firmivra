-- r35_staff_roles (R35, Rasel Oct 14): the firm's eight staff roles and a LOCKED membership
-- status. Existing memberships keep their role and status. Nothing here uses the new values (a
-- value added in a transaction cannot be used before it commits). The new roles get no access
-- until the API's role rules grant it (packages/types team/roles.ts).

-- AlterEnum
ALTER TYPE "MembershipRole" ADD VALUE 'MANAGER' BEFORE 'STAFF';
ALTER TYPE "MembershipRole" ADD VALUE 'BOOKKEEPER';
ALTER TYPE "MembershipRole" ADD VALUE 'TAX_PREPARER';
ALTER TYPE "MembershipRole" ADD VALUE 'CLIENT_SUPPORT';
ALTER TYPE "MembershipRole" ADD VALUE 'READ_ONLY';

-- AlterEnum
-- LOCKED: blocked for now, still a member. Only ACTIVE members get into a firm (TenantGuard), and
-- locking the last active owner fails like any other change that leaves a firm without one
-- (memberships_keep_an_owner).
ALTER TYPE "MembershipStatus" ADD VALUE 'LOCKED' BEFORE 'DEACTIVATED';
