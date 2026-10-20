-- R60 (Super Admin Team screens): Edit Team Member saves a changed name or phone. Both live on the
-- login (users). Admin scope already reads platform admins' logins (users_admin_platform_admins),
-- but no UPDATE policy covered it: users_update allows platform scope and the person themself only,
-- so the CEO's save matched no row.
--
-- The CEO (app_is_admin(), as platform_members_admin_all) may now update the ADMIN login of anyone
-- on the org chart (a platform_members row). Firm staff and clients stay out. The existing triggers
-- still decide what changes: id, cognito_sub and email only in platform scope
-- (users_identity_columns), pool and created_at never (users_pool_fixed, users_created_at_fixed),
-- so in admin scope only name and phone (and updated_at) can change.
CREATE POLICY users_admin_team_update ON users FOR UPDATE
  USING (app_is_admin() AND pool = 'ADMIN'
         AND EXISTS (SELECT 1 FROM platform_members m WHERE m.user_id = users.id))
  WITH CHECK (app_is_admin() AND pool = 'ADMIN'
              AND EXISTS (SELECT 1 FROM platform_members m WHERE m.user_id = users.id));
