# R55: Settings > Users & Roles (Octavia's review, Oct 20)

Guide: `docs/specs/settings-review-2026-10-20/users-and-roles--firmivra-users-and-roles-developer-guide-1.md` (PR #965). Screens: `apps/web/src/app/firm/(workspace)/settings/users/`. Contract: `packages/types/src/settings/users.ts` (`api.users`), `packages/types/src/staff/roles.ts` (`api.roles`). One small PR per item.

## Items

- [x] 1. **Counters and table do not load** (P1). Cause: no API served `/business/users`, `/users/summary` or `/users/export`; only the contract existed. Built in `apps/api/src/staff/users.{controller,service}.ts` on the Staff directory's query. On the screen: Retry on failed counters and table, the guide's empty-state wording, and counters that filter the table.
- [x] 2. **Invite User** returned "We could not find that" (P1): `POST /business/users/invite` was never built. Per the guide the person is created in Staff Management first, so the dialog invites an existing staff record (searchable; name and work email from the record), saves a role change through Edit Staff, and sends the activation email through Resend Invitation, which fails loudly when the email does. The contract's name-and-email `users/invite` stays unbuilt on purpose (it would create a second record).
- [x] 3. **Reset Password and Deactivate selectors were empty** (P1): they listed only the table's current page ("No users on this page"). Each picker now loads its own searchable list from `GET /business/users` (every user, any table filter): Reset lists Active and Locked accounts, Deactivate everyone not already Inactive, never yourself. The confirmation names the person with their email; the table and counters reload after the action.
- [x] 4. **Admin permission edits were rejected** (P1): the grid save used `ROLES_MANAGED_BY` (who may *give* a role), which leaves Admin out for an Admin, so an Admin saving the Admin grid got 403 CANNOT_GRANT. Owner and Admin now change every role's grid but the Owner's; an Admin cannot take Staff Management (View, Edit, Delete) away from the Admin role (409 ADMIN_LOCKOUT), the Owner can. Enforcement: the Admin role's routes are decided by `@Roles`, so its grid was never applied; the guard now refuses an Admin a cell the firm explicitly took away from the Admin role (the Admin default is every cell, so nothing changes for a firm that never edited it). A member's own grant still wins.
- [ ] 5. **Custom role** (P1): template, then a Set Permissions dialog, then save. Needs a `custom_roles` table (R0).
- [ ] 6. P3: individual overrides (Inherit, Allow, Deny), change role, revoke invitation, unlock, reactivate, bulk actions, last-administrator protection.
  - [x] Read-only audit log: already read-only (one GET for Owner and Admin; the app's database role has only SELECT and INSERT on `audit_logs`, proven in e2e). Added the authorized export (`GET /business/audit-log/export`, the filters shown, at most 10,000 rows, logged as `audit_log.exported`; contract #994), the Export button, and the quick views Staff access (`staff.`) and Roles & permissions (`role.`). Users & Roles actions write: `membership.invited` / resent, `invite.revoked`, `membership.role_changed`, `role.permissions_saved` / reset, `staff.permissions_saved` / `staff.permissions_overridden`, `staff.password_reset_sent`, `staff.locked` / `unlocked`, `staff.deactivated` / `reactivated`, `users.exported`.
  - [x] Unlock and Reactivate (row menu): a review of who it is, company, saved role and own overrides, then the Staff routes (`staff.unlocked`; reactivate re-invites someone who never joined). Unlock is offered for Locked rows only; the API never unlocks an inactive account.
  - [x] Change Role (row menu): who and current role, the new role's permissions in this firm, the person's own overrides (kept); saved through Edit Staff's route (`membership.role_changed` with from and to). Shown only for people whose role you may change (`ROLES_MANAGED_BY`).

## Decisions

1. Total Users counts accepted accounts (Active, Locked, Inactive); Pending Invitations counts invited ones apart (guide section 1). Roles is the firm's eight roles until custom roles exist.
2. Search matches name, email, job title and role name ("manag" finds the Managers).
3. Export holds every matching row (all pages) with basic fields only (name, email, role, company, status, MFA, last login, invited) and writes `users.exported` with the count and the filter names.
4. Owner and Admin only (`@Roles(FIRM_MANAGERS)`), as the contract says.

## Needs from others

- **R42 (contract owner):** drop `InviteUserRequest` / `api.users.invite` (name and email) from `packages/types/src/settings/users.ts`, or keep it for a later "add and invite in one step"; the screen no longer calls it.

- **R0 (schema):** the guide's ninth role, **Business Consultant** (`MembershipRole` has eight), and a `custom_roles` table (name, description, template, permissions) for item 5.
