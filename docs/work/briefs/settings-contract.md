# Settings: contract for the API session (R42)

Written by R42 (Oct 15) so Tumit builds the Settings screens on typed mocks while the API is built. Designs: `docs/mockups/firm-workspace/settings/source/` (Settings overview, Company Profile & Branding, Users & Roles; the guide is the `.docx` there).

- Schemas: `packages/types/src/settings/overview.ts`, `settings/branding.ts`, `settings/users.ts`; the existing `settings/schemas.ts` (`FirmSettings`) and `settings/logo.ts` stay as they are. Roles and the permission grid are `staff/roles.ts` (see `staff-management-contract.md`).
- Clients: `createSettingsOverviewClient` (`api.settingsOverview`), `createBrandingClient` (`api.branding`), `createUsersClient` (`api.users`) in `settings/admin-client.ts`; existing `api.settings`; `api.roles` and `api.staff` for the Users & Roles grid and row actions.
- Mocks: `apps/web/src/mocks/settings-admin.ts` (`NEXT_PUBLIC_API_MOCK=settingsOverview,branding,users,settings,roles,staff`; `NEXT_PUBLIC_API_MOCK_EMPTY=settingsOverview,branding,users`). Users & Roles reads the staff mock's members.
- Paths under `/api/v1`. Owner and Admin only (`FIRM_MANAGERS`, grid `SETTINGS`); everything is scoped to the signed-in firm; no business id in a path, query or body. Every change is audited (actor, setting group, old/new where safe; never secrets).

## Settings > Overview

| Method and path | Roles | Request / response | Status | Tables | Design element |
| --- | --- | --- | --- | --- | --- |
| `GET /business/settings/overview` | Owner, Admin | - / `SettingsOverview` | to build | memberships, invites (staff users, this month), audit_logs (recent activity, security alerts) | KPI row: Staff Users (↑ this month), Security Alerts (review required); Recent Administrative Activity (5 rows, View All = audit log) |
| `GET /business/audit-log` | Owner, Admin | `AuditLogQuery` / `AuditLogPage` | exists (R12) | audit_logs | Audit Log menu item, View All, View Audit Log quick action |

Settings Menu (left) and Quick Settings (cards) are links: Company Profile, Branding & White Label (Company Profile & Branding page tabs), Users & Roles, Services & Pricing (its own module), Billing & Subscriptions, Payments & Payouts (`api.paymentsSetup`, exists, R7), Communications, Notifications (`api.notifications` preferences, exists, R6, per member), Integrations (its own module), Client Portal (`api.settings` portal fields, exists), Forms & Documents, Workflow & Automations (Automations module), Security & Access, Data & Backups, Audit Log (exists), System Preferences (Preferences tab below).

## Company Profile & Branding (six tabs)

What already exists in `api.settings` (`GET/PATCH /business/settings`, `POST /business/logo/uploads`, `.../confirm`, `DELETE /business/logo`) and is reused, not repeated:

| Design field | Existing field |
| --- | --- |
| Company Name * | `FirmSettings.name` |
| EIN (Optional) | `ein` (write-only), `einLast4` |
| Website | `website` |
| Tagline / Motto | `sidebarMotto` |
| Short Description (72/250) | `description` (the design's limit is 250; the schema allows 2000: the screen caps at 250) |
| Address, Phone Number, Support Email | `addressLine1`, `addressLine2`, `city`, `state`, `postalCode`, `contactPhone`, `contactEmail` |
| Company Logo (Change Logo, delete) | logo upload and `DELETE /business/logo` |
| Primary Color, Accent Color | `primaryColor`, `accentColor` |
| Time zone (Preferences) | `timezone` |
| Portal welcome text (Client Portal Branding) | `portalName`, `portalHeader`, `welcomeMessage` |

New (one row per firm, **new table** `business_branding`):

| Method and path | Roles | Request / response | Status | Tables | Design element |
| --- | --- | --- | --- | --- | --- |
| `GET /business/branding` | Owner, Admin | - / `BrandingSettings` | to build | business_branding (new), businesses.legal_name | Company Profile: Legal name (restricted), Business Type (`businessCategory`), Primary/Admin Email (`adminEmail`, also the firm master email for appointment notices); Brand Colors: Secondary, Background; Theme Options: Light / Dark / System, Sidebar Style, Sidebar Position, Show Logo Text in Sidebar, Use Rounded Corners; Favicon; Login Page Customization (background image, message up to 200); Email & Communications tab; Client Portal Branding tab (logo, colour overrides); Documents & Legal tab; Preferences tab (locale, currency, date and number format) |
| `PATCH /business/branding` | Owner, Admin (legal name: Owner, or Admin with Company Profile Edit) | `UpdateBrandingRequest` / `BrandingSettings` | to build | business_branding, businesses.legal_name | Actions > Save Changes (409 `SAVE_CONFLICT` on a stale `version`; 400 `LOW_CONTRAST`) |
| `POST /business/branding/assets/uploads`, `POST .../uploads/confirm` | Owner, Admin | `CreateBrandAssetUploadRequest` / `UploadTicket`; `ConfirmBrandAssetUploadRequest` / `BrandingSettings` | to build | business_branding, S3 firm prefix | Change Favicon (64 x 64 PNG/ICO), Login Background Image (1920 x 1080), email logo, portal logo (limits in `BRAND_ASSET_LIMITS`) |
| `DELETE /business/branding/assets/{kind}` | Owner, Admin | - / `BrandingSettings` | to build | business_branding | Favicon delete; remove login background, email or portal logo |
| `POST /business/branding/reset` | Owner, Admin | `ResetBrandingRequest` / `BrandingSettings` | to build | business_branding | Reset to Default Brand Settings (confirm; company profile data stays) |

Live Preview (Dashboard, Client Portal, Login Page, Emails) and Preview Full Platform render in the browser from the unsaved values: no endpoint. The "Make It Yours" and "branding changes will be applied" notes are static.

## Users & Roles

| Method and path | Roles | Request / response | Status | Tables | Design element |
| --- | --- | --- | --- | --- | --- |
| `GET /business/users` | Owner, Admin | `UsersQuery` / `FirmUserList` | to build (`GET /business/team` exists without MFA, last login, paging) | memberships, users, invites, staff_security_settings | User Management table: Name, Email, Role, Company, Status, MFA (Enabled / Disabled / Pending), Last Login ("Invited Sep 25, 2026"), Actions; search, All Roles, All Statuses; "Showing 1-8 of 28 users", pages, 10 per page |
| `GET /business/users/summary` | Owner, Admin | - / `UsersSummary` | to build | memberships, invites | KPIs: Total Users (↑ this month), Active Users (% active), Pending Invitations, Roles (Custom roles) |
| `GET /business/users/export` | Owner, Admin | `UsersQuery` filters / CSV | to build | as list; audit `users.exported` | Export |
| `POST /business/users/invite` | Owner, Admin | `InviteUserRequest` / `InviteUserResponse` | to build (`POST /auth/invites` exists with name, email, role; this adds direct permission overrides and the row answer) | invites, memberships, member_permissions | Invite User (header button, Quick Actions) |
| `GET /business/roles`, `GET/PUT/DELETE /business/roles/{role}/permissions`, `GET /business/permission-modules`, `POST /business/roles/custom` | see Staff contract | `RoleList`, `RolePermissions`, `SaveRolePermissionsRequest`, `PermissionModuleList`, `CreateCustomRoleRequest` | to build | role_permissions; custom_roles (new) | Role Permissions (Role selector, Save Changes, Reset to Default), Module Permissions grid (View, Create, Edit, Approve, Export, Admin = MANAGE), Permission Details, Role Templates, Create Custom Role, Manage Roles |
| row menu | Owner, Admin | `api.staff.*` | see Staff contract | | View Profile, Edit User, Manage Access, Resend / Revoke Invitation, Reset Password, Reset MFA, Sign Out All Sessions, Deactivate / Reactivate, View Activity; Quick Actions Reset User Passwords, Deactivate User |

## Not in the designs, or not for a firm

- **Active Companies, Pending Applications, Company Applications table, Companies, Company Management card**: platform-level (Super Admin console, `api.firmApplications`, R4). A firm never sees other companies. The schema keeps them optional and the firm API leaves them out; the firm screen should hide those cards (or Rasel decides to drop them from the firm design).
- **"All Companies" filter and Company column** on Users & Roles: a firm has one company; the API answers its own name.
- **Pages with a menu item but no design**: Billing & Subscriptions, Communications (sender identities), Forms & Documents, Security & Access (firm MFA and session policy), Data & Backups, Workflow & Automations defaults. No contract until Octavia designs them.
- **Sidebar Style** shows only "Solid"; `GRADIENT` is a guess. **Date and number formats** are not shown in the design (Preferences tab content is not drawn): the lists are a proposal.
- **Business Type "Accounting & Tax Services"** is a category, not the entity type (`entityType`), so it is a new `businessCategory` field.
