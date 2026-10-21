-- R60's Team invitations (Rasel, Oct 21): Add Team Member creates the new person's ADMIN login
-- and its platform_admins row with role TEAM_MEMBER, in platform scope (forPlatform()).
-- r0_platform_tightening (Oct 7) made platform_admins read-only for the app, so that insert
-- failed. This grants INSERT back, for TEAM_MEMBER rows only:
--
-- * INSERT only. UPDATE and DELETE stay revoked, so the app can never turn a TEAM_MEMBER row into
--   a SUPER_ADMIN one, or remove an admin.
-- * A restrictive policy for firmivra_app: the row must be TEAM_MEMBER and the scope platform.
--   platform_admins_access (permissive, FOR ALL) already limits writes to platform scope; the
--   restrictive policy is ANDed with it, so a SUPER_ADMIN row is refused in every scope.
--   app_is_admin() checks role = SUPER_ADMIN, so a new row never grants admin-scope rights.
-- * The policy is for firmivra_app only: the owner (the seed and ops) still adds Super Admins.
--   FORCE ROW LEVEL SECURITY applies policies to the table owner too, and on RDS the owner is not
--   a superuser.
GRANT INSERT ON platform_admins TO firmivra_app;

CREATE POLICY platform_admins_app_insert_team_member ON platform_admins
  AS RESTRICTIVE FOR INSERT TO firmivra_app
  WITH CHECK (role = 'TEAM_MEMBER' AND app_scope() = 'platform');
