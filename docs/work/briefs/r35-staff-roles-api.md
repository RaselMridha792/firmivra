# R35 staff roles: brief for the API session

Written by the R35 database and rules session (Oct 14). The database tables, the eight roles, the permission grid and the guards are done (branch `rasel/R35-staff-roles-7`); there are no staff-management endpoints or screens yet. This is what the screens need. Octavia's designs and guides: `docs/mockups/firm-workspace/staff-management/source/` and `docs/mockups/firm-workspace/settings/source/`.

## What exists now

- Roles (`packages/types/src/team/roles.ts`): `FIRM_ROLES` (Owner, Admin, Manager, Staff, Bookkeeper, Tax Preparer, Client Support, Read Only), `ROLES_MANAGED_BY` (who may invite or change which role).
- Permission grid (`packages/types/src/team/permissions.ts`): `DEFAULT_ROLE_PERMISSIONS`, `roleCan`, `capabilityOfMethod`; the firm's own changes are `role_permissions` and `member_permissions` (the API applies them over the defaults; nothing reads them yet). `@Access(module, capability?)` in `apps/api/src/auth/decorators.ts` opens a route to the five newer roles. Read `apps/api/README.md` ("Adding a module").
- Tables (`packages/db/prisma/schema.prisma`, sections "Staff management", "Staff details, access and security", "Staff documents and sessions", "Permission matrix overrides"): `departments`, `teams`, `team_members`, `member_departments`, `staff_profiles`, `staff_security_settings`, `staff_compensation`, `staff_drafts`, `staff_documents`, `staff_sessions`, `role_permissions`, `member_permissions`; membership status `LOCKED`.

## Database walls the API must respect

- **Pay (`staff_compensation`)**: the database shows and changes a row only to the session's acting Owner or Admin. Open the firm scope with `actorUserId` (`forBusiness(businessId, { actorUserId })`). A session with no actor sees nothing and writes nothing.
- **Staff documents (`staff_documents`)**: the same wall. Only the acting Owner or Admin reads, inserts, updates (type, archive time) or archives a row; open the scope with `actorUserId`. Exception, for the document scanner only (a job with no actor): it may read rows that are still `PENDING` (or that it scanned in the last five minutes) and may change only `scan_status` and `scanned_at`, once, from `PENDING`. It cannot insert, delete, or change any other column. The scanner must use `updateMany` (not `update`, which reads the row back); `updateMany` returns a count, 0 when the row is already scanned. Nothing is deleted: replacing a file adds a row and archives the old one.
- **Last active owner**: demoting, deactivating or locking the last active owner fails with `LAST_ACTIVE_OWNER` (SQLSTATE `FV001`).
- **Pay type and frequency lists are provisional.** The designs show closed dropdowns, so the database enums are my guess: `StaffPayType` Salary, Hourly, Commission, Per project, Other; `StaffPayFrequency` Weekly, Biweekly, Semimonthly, Monthly, Annually. The API session confirms them with Rasel and Octavia before the screens use them (a change is a new migration).

## Endpoints

The brief for the API session that follows. Paths are under `/api/v1`. "Grid" means the route is also opened to the five newer roles by `@Access(...)` where their default grid allows it (done in the rules PR); Owner and Admin are always listed first. Every change writes `AuditService.log` (actor, target, changed group; never a password, token, MFA secret or pay value). Staff routes that touch pay (`staff_compensation`) must open the firm scope with `actorUserId`: the database shows pay only to the acting Owner or Admin.

**Already there, and what it covers**

| Existing | Covers | Gap |
| --- | --- | --- |
| `GET /business/team` (Owner, Admin) | members, role, status, open invite (name, email, sent, expires), `isYou` | no job title, departments, last login, MFA state, search or paging |
| `PATCH /business/team/:id` (Owner) | role change | now accepts all 8 roles (done in the rules PR); no permission-escalation check beyond `ROLES_MANAGED_BY` |
| `POST /business/team/:id/deactivate`, `POST /business/team/:id/resend-invite` (Owner, Admin) | deactivate (last active owner is protected by the database), resend | no revoke, reactivate, lock, sign-out |
| `POST /auth/invites` (Owner, Admin) | invite with name, email, role | takes only name, email, role: no department, title, profile, security; no "send welcome email" switch |
| `POST /auth/forgot-password`, `reset-password`, `sign-out` | a person's own reset and sign-out | no admin-triggered reset, MFA reset or "sign out all" |
| `GET /business/audit-log` (Owner, Admin) | firm audit rows, filter by actor | filter by target member; `auth.signed_in` / `auth.sign_in_failed` rows are the login history |

**1. Staff Management: directory and Create/Edit Staff** (`STAFF_MANAGEMENT`; Owner, Admin; Manager may view)

| Method and path | What | Roles |
| --- | --- | --- |
| `GET /business/staff` | directory: search (name, email, job title), department, status, role; name, job title, departments, role, status, last login; paged | Owner, Admin, grid view |
| `GET /business/staff/summary` | total, active, inactive, departments, joined this month | Owner, Admin, grid view |
| `GET /business/staff/:id` | one member: identity, role, status, job title, departments, profile, security summary (2FA on, password changed, restrictions, auto logout, last login), notes | Owner, Admin, grid view |
| `POST /business/staff` | Submit & Send Invitation: create the member and send the secure invite in one idempotent call (retry never duplicates; "created, invite failed" is a result with Resend) | Owner, Admin |
| `PATCH /business/staff/:id` | account information, role, departments, job title, profile (`staff_profiles`), access level, status | Owner, Admin |
| `PUT /business/staff/:id/security` | sign-in rules (`staff_security_settings`); never weakens the platform's mandatory 2FA | Owner, Admin |
| `GET/PUT /business/staff/:id/compensation` | pay (`staff_compensation`) | Owner, Admin |
| `GET/PUT /business/staff/:id/notes` | internal note, 500 characters, stamped with who and when | Owner, Admin |
| `GET/POST /business/staff-drafts`, `GET/PUT/DELETE /business/staff-drafts/:id` | Save as Draft (`staff_drafts`): no account, no invite | Owner, Admin |
| `POST /business/staff/:id/documents/uploads`, `.../uploads/confirm`, `GET .../documents`, `GET .../documents/:docId/download`, `PATCH .../documents/:docId` (reclassify), `POST .../documents/:docId/archive` | `staff_documents` (see the wall above): PDF, JPEG, PNG, DOC, DOCX, 10 MB; private `tenant/<business>/staff/<member>/` prefix; signed short-lived links; scan before download | Owner, Admin |
| `POST /business/staff/:id/invite/resend`, `POST /business/staff/:id/invite/revoke` | fresh invite (exists as `resend-invite`); revoke an open invite | Owner, Admin |
| `POST /business/staff/:id/reactivate` | reactivate a deactivated member | Owner, Admin |
| `POST /business/staff/import/preview`, `POST /business/staff/import` | Bulk Upload: template, column map, validate (duplicates, role, department), preview counts and row errors, import, optional invitations, error file | Owner, Admin |

**2. Teams & Departments** (`STAFF_MANAGEMENT`; tables `departments`, `teams`, `team_members`, `member_departments`)

| Method and path | What | Roles |
| --- | --- | --- |
| `GET /business/departments`, `GET /business/departments/summary` | list with head, team count, staff count, status; KPIs (departments, teams, staff, active staff); search and status filter | Owner, Admin, grid view |
| `POST /business/departments`, `PATCH /business/departments/:id` | add, edit; change head; set INACTIVE, ARCHIVED or reactivate (warn and offer to move people first) | Owner, Admin |
| `GET /business/departments/:id` | details with its teams | Owner, Admin, grid view |
| `GET /business/teams`, `POST /business/teams`, `PATCH /business/teams/:id` | list, add in a department, edit, change lead, move department, deactivate or archive | Owner, Admin (list: grid view) |
| `PUT /business/teams/:id/members` | manage members (primary, backup, member) | Owner, Admin |
| `GET /business/org-chart` | reporting hierarchy from `staff_profiles.supervisor_membership_id` and department heads | Owner, Admin, grid view |

**3. Staff account access and security** (`STAFF_MANAGEMENT`; Owner and Admin; the target must be a role the actor manages)

| Method and path | What |
| --- | --- |
| `GET /business/staff/:id/security` | overview: status, access level, role, last login, 2FA, password last changed, restrictions, auto logout |
| `GET /business/staff/:id/sessions`, `POST /business/staff/:id/sessions/:sessionId/revoke`, `POST /business/staff/:id/sessions/revoke-all` | Active Sessions (`staff_sessions`); revoke also revokes the Cognito refresh token (`GlobalSignOut`) |
| `GET /business/staff/:id/login-history` | `auth.signed_in` and `auth.sign_in_failed` audit rows for the member: time, IP, device, success or failed. The design also shows a city: nothing resolves IP to a place yet, so show the IP and device, or add a lookup later |
| `GET /business/staff/:id/permissions` | effective permissions: role default, firm role override, member override |
| `GET /business/staff/:id/activity` | audit rows about or by the member |
| `POST /business/staff/:id/reset-password`, `POST /business/staff/:id/reset-mfa` | high risk: reason, confirmation, audit; secure link, never a password; MFA re-enrolment |
| `POST /business/staff/:id/lock`, `POST /business/staff/:id/unlock` | status LOCKED (and back); locking the last active owner is refused by the database; sessions revoked |
| `POST /business/staff/:id/deactivate` | exists as `/business/team/:id/deactivate`; also revoke sessions |

The API must enforce on every request: `auto_logout_minutes`, `max_concurrent_sessions` (+ `sign_out_other_sessions`), `access_location` (IPs or countries), `access_starts_on` and `disable_on` (a daily job deactivates), `end_date`. Set `last_login_at` and `password_changed_at` at sign-in and reset.

**4. Settings > Users & Roles** (`SETTINGS`; Owner and Admin)

| Method and path | What |
| --- | --- |
| `GET /business/users` | the table: name, email, role, status, MFA (Enabled, Disabled, Pending), last login; search, role, status; paged. Same data as the staff directory plus MFA; the "Company" filter only matters for platform admins (a firm has one company) |
| `GET /business/users/summary` | KPIs: total users, active users and % active, pending invitations, roles |
| `GET /business/users/export` | CSV of the permitted admin fields; audited |
| `GET /business/roles`, `GET /business/roles/:role/permissions` | the 8 roles; the grid for a role: defaults overlaid with `role_permissions` |
| `PUT /business/roles/:role/permissions` | Save Changes: write `role_permissions` rows that differ from the default; refuse Owner, an Edit with no View, anything the actor cannot grant (`ROLES_MANAGED_BY`), and warn on escalation |
| `DELETE /business/roles/:role/permissions` | Reset to Default |
| `PUT /business/staff/:id/permissions`, `POST /business/staff/:id/permissions/copy-from/:otherId` | per-member overrides (`member_permissions`); Copy Permissions |
| `GET /business/permission-modules` | the 24 modules, 7 capabilities and one-line explanations for the Permission Details panel |
| `POST /business/users/invite` | Invite User: same as staff create with fewer fields (exists as `POST /auth/invites`) |

Not in this list because they are other areas: Reports filtered for staff, Staff Settings defaults (company-wide staff defaults: new table when specified), Settings pages other than Users & Roles.
