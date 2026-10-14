# Staff Management: contract for the API session (R42)

Written by R42 (Oct 15) so Tumit builds the screens on typed mocks while the API is built. Designs: `docs/mockups/firm-workspace/staff-management/source/` (Octavia's guide is the `.docx` there). This adds detail to `docs/work/briefs/r35-staff-roles-api.md` (tables, database walls, owner protection); read that first.

- Schemas: `packages/types/src/staff/schemas.ts` (staff), `staff/departments.ts` (Teams & Departments), `staff/roles.ts` (roles and the permission grid, shared with Settings > Users & Roles).
- Clients: `createStaffClient` (`api.staff`), `createDepartmentsClient` (`api.departments`), `createRolesClient` (`api.roles`) in `staff/client.ts`.
- Mocks: `apps/web/src/mocks/staff-management.ts` (`NEXT_PUBLIC_API_MOCK=staff,departments,roles`; `NEXT_PUBLIC_API_MOCK_EMPTY=staff` for the empty states). One store behind all three.
- Paths are under `/api/v1`. The firm is the signed-in firm (tenant guard); no path, query or body carries a business id. Every change writes `AuditService.log` (never a password, token, MFA secret or pay value). Every route is `@Access('STAFF_MANAGEMENT')`: Owner and Admin change; Manager reads where the grid gives view. The target must be a role in `ROLES_MANAGED_BY[actor]`; nobody changes themselves (409 `CANNOT_CHANGE_SELF`).
- Error codes: `TeamErrorCode` (existing) plus `StaffErrorCode`, `DepartmentErrorCode`.

## Directory (Staff Management page)

| Method and path | Roles | Request / response | Status | Tables | Design element |
| --- | --- | --- | --- | --- | --- |
| `GET /business/staff` | Owner, Admin, grid view | `StaffListQuery` / `StaffListResponse` | to build (`GET /business/team` exists without title, departments, last login, MFA, paging) | memberships, users, invites, member_departments, departments, staff_profiles (access_level), staff_security_settings (last_login_at) | Staff Directory table: Name, Job Title, Department, Role, Status, Last Login, row menu; search, All Departments, All Statuses; "Showing 1-7 of 7", 10 per page |
| `GET /business/staff/summary` | Owner, Admin, grid view | - / `StaffSummary` | to build | memberships, invites, departments | KPI cards: Total Staff (+2 this month), Active Staff (% active), Inactive Staff, Departments |
| `GET /business/staff/options` | Owner, Admin, grid view | - / `StaffFormOptions` | to build | departments, teams, memberships, staff_profiles | Create/Edit dropdowns: Department(s), Job Title, Role (with description), Service Area(s), Work Location / Office, Work Schedule, Supervisor / Manager, Primary / Backup Team, Primary Service Specialty |

The eight cards under the KPIs are links: Create Staff Account (Create Staff), Manage Staff Accounts (directory), Roles & Permissions (`api.roles`), Teams & Departments, Account Access & Security, Activity & Login History (security page tabs), Bulk Upload Staff, Staff Settings (not designed, see below), Reports (Reports module).

## Create / Edit Staff (four steps) and the Success page

| Method and path | Roles | Request / response | Status | Tables | Design element |
| --- | --- | --- | --- | --- | --- |
| `GET /business/staff/{id}` | Owner, Admin, grid view | - / `StaffDetail` | to build | memberships, users, staff_profiles, member_departments, team_members, staff_security_settings, invites | Edit Staff Account (all four sections), right-hand card (photo, status, title, departments, email, phone, office, Member since), Account Preview, Success page summary |
| `POST /business/staff` | Owner, Admin | `CreateStaffRequest` / `CreateStaffResponse` | to build (`POST /auth/invites` takes name, email, role only) | memberships, users (on activation), invites, staff_profiles, member_departments, team_members, staff_security_settings, staff_compensation, member_permissions, staff_drafts (deleted) | Submit & Send Invitation (step 4), Create Account (step 1 variant); Success page: invitation status, Resend Invitation |
| `PATCH /business/staff/{id}` | Owner, Admin | `UpdateStaffRequest` / `StaffDetail` | to build | as above | Edit Staff: Save Changes; "Send notification of changes" (`notifyMember`); 409 `SAVE_CONFLICT` on a stale `version` |
| `GET /business/staff/{id}/compensation`, `PUT ...` | Owner, Admin (database wall) | `StaffCompensationInput` / `StaffCompensation` | to build | staff_compensation (scope opened with `actorUserId`) | Compensation Information: Pay Type, Pay Rate / Salary, Pay Frequency, Commission Arrangement, Internal Payroll ID |
| `GET /business/staff-drafts`, `POST`, `GET /{id}`, `PUT /{id}`, `DELETE /{id}` | Owner, Admin | `SaveStaffDraftRequest` / `StaffDraft`, `StaffDraftList` | to build | staff_drafts | Save as Draft on every step (no account, no invite). Drafts never hold pay. |

Step mapping: step 1 Account Information = `StaffAccountInput`; step 2 Role & Permissions = `account.role` plus `permissions` (`PermissionGrants`, see Roles below; Apply Default = `api.roles.permissions(role)`, Copy = `api.staff.copyPermissions` after create, or read the other member's `permissions` before); step 3 Access & Security = `StaffAccessInput` (+ `sendWelcomeEmail`, `sendWelcomeText`); step 4 Additional Details = `StaffDetailsInput` + `StaffCompensationInput` + documents.

Rules for the API: `idempotencyKey` returns the first result on a retry; an invite that fails after the member is created answers `invitation.status: 'FAILED'` (Resend), never a second member. Duplicate email (member or open invite) is 409 `DUPLICATE_EMAIL`. Edit with no View is 400 `PERMISSION_NEEDS_VIEW`; a grid above the role needs `acknowledgeEscalation` (409 `PERMISSION_ESCALATION`); a role the actor cannot give is 403 `CANNOT_GRANT`. `firstName` and `lastName` are joined into `users.name` (one field today); the response splits it back.

## Staff documents (step 4)

| Method and path | Roles | Request / response | Status | Tables | Design element |
| --- | --- | --- | --- | --- | --- |
| `GET /business/staff/{id}/documents` | Owner, Admin (wall) | - / `StaffDocumentList` | to build | staff_documents | Staff Documents table: Document Type, File Name, Upload Date, Actions |
| `POST /business/staff/{id}/documents/uploads`, `POST .../uploads/confirm` | Owner, Admin | `CreateStaffDocumentUploadRequest` / `UploadTicket`; `ConfirmStaffDocumentUploadRequest` / `StaffDocument` | to build | staff_documents, S3 `tenant/<business>/staff/<member>/` | Drag & drop upload: PDF, JPG, PNG, DOC, DOCX, 10 MB; Replace (`replacesId` archives the old row) |
| `GET .../documents/{docId}/download` | Owner, Admin | - / `StaffDocumentLink` | to build | staff_documents | Actions > View / Download (409 `DOCUMENT_NOT_READY` until scanned CLEAN) |
| `PATCH .../documents/{docId}`, `POST .../documents/{docId}/archive` | Owner, Admin | `UpdateStaffDocumentRequest` / `StaffDocument` | to build | staff_documents | Actions > Reclassify, Archive |

## Staff Account Access & Security page (and Edit Staff's Quick Actions)

| Method and path | Roles | Request / response | Status | Tables | Design element |
| --- | --- | --- | --- | --- | --- |
| `GET /business/staff/{id}/security`, `PUT ...` | Owner, Admin | `StaffAccessInput` / `StaffSecurity` | to build | staff_security_settings, memberships, staff_profiles | Account Status card (status, User Access Level, Role, Last Login + device + place); Security Settings rows (2FA Enabled, Password Last Changed, Account Restrictions, Automatic Logout) with Edit; step 3 sections |
| `GET /business/staff/{id}/sessions` | Owner, Admin | - / `StaffSessionList` | to build | staff_sessions | Active Sessions: Device / Browser, Location, IP Address, Last Active ("Active now"), Actions |
| `POST .../sessions/{sessionId}/revoke`, `POST .../sessions/revoke-all` | Owner, Admin | -, `StaffSecurityActionRequest` / `StaffActionResult` | to build | staff_sessions + Cognito `GlobalSignOut` | row menu > Sign out; Sign Out All Sessions |
| `GET /business/staff/{id}/login-history` | Owner, Admin | `StaffCursorQuery` / `StaffLoginHistory` | to build | audit_logs (`auth.signed_in`, `auth.sign_in_failed`) | Login History: Date & Time, Location, IP Address, Status (Success / Failed), Device |
| `GET /business/staff/{id}/activity` | Owner, Admin | `StaffCursorQuery` / `StaffActivityPage` | to build | audit_logs (actor or target = member) | Recent Activity (Edit Staff), Activity & Audit tab |
| `GET /business/staff/{id}/permissions`, `PUT ...`, `POST .../permissions/copy-from/{otherId}` | Owner, Admin (read: grid view) | `SetStaffPermissionsRequest` / `StaffPermissions` | to build | role_permissions, member_permissions | Access Summary ("Payroll (View, Create, Edit)"), Permissions tab, step 2 grid for an existing member, Copy Permissions from Another Staff Member |
| `GET /business/staff/{id}/notes`, `PUT ...` | Owner, Admin | `SetStaffNoteRequest` / `{ note: StaffNote \| null }` | to build | staff_profiles (notes, notes_updated_at, notes_updated_by) | Notes card ("Last updated ... by ..."), Account Notes (0/500) |
| `POST /business/staff/{id}/reset-password` | Owner, Admin | `StaffSecurityActionRequest` / `StaffActionResult` | to build | Cognito admin reset; staff_security_settings | Reset Password (secure link by email, never a password) |
| `POST /business/staff/{id}/reset-mfa` | Owner, Admin | `StaffSecurityActionRequest` / `StaffActionResult` | to build | Cognito; staff_sessions | Reset MFA (high risk, signs out) |
| `POST /business/staff/{id}/lock`, `POST .../unlock` | Owner, Admin | `LockStaffRequest`, - / `StaffActionResult` | to build | memberships (LOCKED), staff_security_settings (locked_at, locked_reason), staff_sessions | Lock Account (last active owner: 409 `LAST_ACTIVE_OWNER`) |
| `POST /business/staff/{id}/deactivate` | Owner, Admin | `StaffSecurityActionRequest` / `StaffActionResult` | exists as `POST /business/team/{id}/deactivate` (`TeamMember` answer, no reason, no session revoke): build the new path | memberships, invites, staff_sessions | Deactivate Account (Edit Staff footer, Quick Actions, row menu) |
| `POST /business/staff/{id}/reactivate` | Owner, Admin | - / `StaffActionResult` | to build | memberships | row menu > Reactivate |
| `POST /business/staff/{id}/invite/resend`, `POST .../invite/revoke` | Owner, Admin | - / `StaffActionResult` | resend exists as `POST /business/team/{id}/resend-invite`; revoke to build | invites | Resend Invitation (Success page, Quick Actions), Revoke Invitation |

The design's Edit Staff Quick Actions also shows **Delete Account**: the guide says deactivate and preserve history, and the database never deletes members, so the screen should offer Deactivate there (see "not in the designs" below).

## Bulk Upload Staff

| Method and path | Roles | Request / response | Status | Tables | Design element |
| --- | --- | --- | --- | --- | --- |
| `GET /business/staff/import/template` | Owner, Admin | - / CSV file | to build | - | Template download (`api.staff.importTemplateUrl()`) |
| `POST /business/staff/import/preview` | Owner, Admin | `StaffImportPreviewRequest` / `StaffImportPreview` | to build | memberships, invites, departments (read) | Map columns, Validate, Preview counts and row errors (the browser reads the CSV or XLSX and sends rows) |
| `POST /business/staff/import` | Owner, Admin | `StaffImportRequest` / `StaffImportResult` | to build | as Create Staff | Import with the Invitation option, Results with the error file |

## Teams & Departments

| Method and path | Roles | Request / response | Status | Tables | Design element |
| --- | --- | --- | --- | --- | --- |
| `GET /business/departments` | Owner, Admin, grid view | `DepartmentListQuery` / `DepartmentListResponse` | to build | departments, teams, member_departments | Department List: Department Name, Department Head (name, title), Teams, Staff Count, Status, Actions; search, All Statuses, "Showing 1 - 8 of 8" |
| `GET /business/departments/summary` | Owner, Admin, grid view | - / `DepartmentSummary` | to build | departments, teams, memberships | KPIs: Total Departments, Total Teams, Total Staff, Active Staff (% active) |
| `GET /business/departments/{id}` | Owner, Admin, grid view | - / `DepartmentDetail` | to build | departments, teams | Department Details panel (head + Change, Total Teams, Total Staff, Created, Description), Teams in This Department |
| `POST /business/departments`, `PATCH /business/departments/{id}` | Owner, Admin | `CreateDepartmentRequest`, `UpdateDepartmentRequest` / `Department` | to build | departments, member_departments (moveTo) | Add Department; row menu: Edit, Change Head, Deactivate / Reactivate, Archive (409 `GROUP_IN_USE` unless `moveTo`) |
| `GET /business/teams`, `GET /business/teams/{id}` | Owner, Admin, grid view | `StaffTeamListQuery` / `StaffTeamList`; - / `StaffTeamDetail` | to build | teams, team_members | Teams tab, View All Teams, Manage Members |
| `POST /business/teams`, `PATCH /business/teams/{id}` | Owner, Admin | `CreateStaffTeamRequest`, `UpdateStaffTeamRequest` / `StaffTeam` | to build | teams | Add Team; team menu: Edit, Change Lead, Move Department, Deactivate / Archive |
| `PUT /business/teams/{id}/members` | Owner, Admin | `SetStaffTeamMembersRequest` / `StaffTeamDetail` | to build | team_members | Manage Members (primary, backup, member) |
| `GET /business/org-chart` | Owner, Admin, grid view | - / `OrgChart` | to build | memberships, staff_profiles (supervisor), departments (head) | Org Chart tab |

## Roles and the permission grid (shared with Settings > Users & Roles)

| Method and path | Roles | Request / response | Status | Tables | Design element |
| --- | --- | --- | --- | --- | --- |
| `GET /business/roles` | Owner, Admin, grid view | - / `RoleList` | to build | memberships (counts), role_permissions | Select a Role + Role Description (step 2), Role selector and Role Templates (Users & Roles) |
| `GET /business/roles/{role}/permissions` | Owner, Admin, grid view | - / `RolePermissions` | to build | role_permissions (+ code defaults) | Module Permissions grid; Apply Default Permissions for This Role |
| `PUT /business/roles/{role}/permissions` | Owner, Admin | `SaveRolePermissionsRequest` / `RolePermissions` | to build | role_permissions | Save Changes (Users & Roles) |
| `DELETE /business/roles/{role}/permissions` | Owner, Admin | - / `RolePermissions` | to build | role_permissions | Reset to Default |
| `GET /business/permission-modules` | Owner, Admin, grid view | - / `PermissionModuleList` | to build | none (code) | Permission Details / Permission Notes panels |
| `POST /business/roles/custom` | Owner, Admin | `CreateCustomRoleRequest` / `CustomRole` | to build, **needs a new table** (`custom_roles`) and a membership column; answer 501 `NOT_IMPLEMENTED` until then | custom_roles (new) | Create Custom Role, "Custom roles" KPI |

## Not in the designs, or in conflict with the guide

- **Staff Settings** (company staff defaults) has a card but no design and no table: not in this contract.
- **Reports** card routes to the Reports module (not this module).
- **Role catalog**: the guide lists 24 predefined roles (CPA, Enrolled Agent, Payroll Manager...); the database has eight roles (R35). The professional titles are the Job Title; authority is the role. The Users & Roles template "Payroll Specialist" has no role; Rasel to decide (custom roles, or map to Staff).
- **Temporary Password "Set custom password"** (step 3): the guide forbids plaintext passwords and the auth design uses activation links, so the contract has no password field. The screen should show only "Generate automatically" (a secure link).
- **"Require two-factor authentication" checkbox**: staff MFA is always required (staff pool). The contract answers `mfaRequired: true`; the screen shows the box checked and disabled.
- **Delete Account** (Edit Staff Quick Actions): no deletion exists; offer Deactivate.
- **Profile photos** in the directory, Edit and Success pages: no avatar storage. `avatarUrl` is optional and null (initials via `Avatar`).
- **Location of a login** ("Atlanta, GA, USA"): needs an IP-to-place lookup; `place` is null until one exists.
- **Welcome text (SMS)**: no SMS sender for staff yet; `sendWelcomeText` is accepted and ignored.
- **Offices / branches**: no locations table; `options.offices` lists the distinct values typed so far.
- **Department icons and colours** in the list: not stored; the screen picks an icon by name or uses a default.
- **Pay type and frequency lists** are provisional (R35 brief): confirm with Octavia before the screens rely on them.
