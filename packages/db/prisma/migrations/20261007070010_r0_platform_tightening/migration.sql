-- Platform scope tightening agreed with R2 (Oct 6). forPlatform() stays for identity work, which
-- never deletes users or firms and never manages Super Admins.
-- (a) No DELETE on users or businesses for the app: a firm is closed (status CLOSED), not deleted.
DROP POLICY users_delete ON users;
DROP POLICY businesses_delete ON businesses;
REVOKE DELETE ON users, businesses FROM firmivra_app;

-- (b) platform_admins is read-only for the app: Super Admins are added by ops or the seed (owner).
REVOKE INSERT, UPDATE, DELETE ON platform_admins FROM firmivra_app;

-- Still open: (c) support grant requests only in admin scope (R8) and (d) firm_applications in
-- platform scope only for the public submit and approval provisioning (R4).
