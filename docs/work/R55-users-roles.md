# R55: Settings > Users & Roles (Octavia's review, Oct 20)

Guide: `docs/specs/settings-review-2026-10-20/users-and-roles--firmivra-users-and-roles-developer-guide-1.md` (PR #965). Screens: `apps/web/src/app/firm/(workspace)/settings/users/`. Contract: `packages/types/src/settings/users.ts` (`api.users`), `packages/types/src/staff/roles.ts` (`api.roles`). One small PR per item.

## Items

- [x] 1. **Counters and table do not load** (P1). Cause: no API served `/business/users`, `/users/summary` or `/users/export`; only the contract existed. Built in `apps/api/src/staff/users.{controller,service}.ts` on the Staff directory's query. On the screen: Retry on failed counters and table, the guide's empty-state wording, and counters that filter the table.
- [x] 2. **Invite User** returned "We could not find that" (P1): `POST /business/users/invite` was never built. Per the guide the person is created in Staff Management first, so the dialog invites an existing staff record (searchable; name and work email from the record), saves a role change through Edit Staff, and sends the activation email through Resend Invitation, which fails loudly when the email does. The contract's name-and-email `users/invite` stays unbuilt on purpose (it would create a second record).
- [x] 3. **Reset Password and Deactivate selectors were empty** (P1): they listed only the table's current page ("No users on this page"). Each picker now loads its own searchable list from `GET /business/users` (every user, any table filter): Reset lists Active and Locked accounts, Deactivate everyone not already Inactive, never yourself. The confirmation names the person with their email; the table and counters reload after the action.
- [x] 4. **Admin permission edits were rejected** (P1): the grid save used `ROLES_MANAGED_BY` (who may *give* a role), which leaves Admin out for an Admin, so an Admin saving the Admin grid got 403 CANNOT_GRANT. Owner and Admin now change every role's grid but the Owner's; an Admin cannot take Staff Management (View, Edit, Delete) away from the Admin role (409 ADMIN_LOCKOUT), the Owner can. Enforcement: the Admin role's routes are decided by `@Roles`, so its grid was never applied; the guard now refuses an Admin a cell the firm explicitly took away from the Admin role (the Admin default is every cell, so nothing changes for a firm that never edited it). A member's own grant still wins.
- [x] 5. **Custom role** (P1): template, then a Set Permissions dialog, then save. R1's schema #995 added `custom_roles`, `custom_role_permissions` and `memberships.custom_role_id`.
  - [x] Contract (#1005) and API: create with the whole grid in one transaction (`role.custom_created`), read, Edit Permissions and rename (`role.custom_updated`), Archive (`role.custom_archived`, refused while anyone not inactive has it); giving one through Edit Staff (`account.customRoleId`, the role moves with it, `membership.role_changed` with the custom role ids); the guard and the services' own checks read its grid; Users & Roles filters, searches, counts and exports it.
  - [x] Screens: Create Custom Role (Users & Roles' page and Team > Roles' modal) then Set Permissions (every module and capability, the template's grid ticked, Back keeps the form, more than the template asks first); custom roles in Role Permissions (Save Changes is Edit Permissions; Archive Role; Other opens Create Custom Role), the Role filter, the table, Change Role, Invite, Team > Roles and the Roles count.
- [ ] 6. P3: individual overrides (Inherit, Allow, Deny), change role, revoke invitation, unlock, reactivate, bulk actions, last-administrator protection.
  - [x] Unlock and Reactivate (row menu): a review of who it is, company, saved role and own overrides, then the Staff routes (`staff.unlocked`; reactivate re-invites someone who never joined). Unlock is offered for Locked rows only; the API never unlocks an inactive account.
  - [x] Change Role (row menu): who and current role, the new role's permissions in this firm, the person's own overrides (kept); saved through Edit Staff's route (`membership.role_changed` with from and to). Shown only for people whose role you may change (`ROLES_MANAGED_BY`).

## Decisions

1. Total Users counts accepted accounts (Active, Locked, Inactive); Pending Invitations counts invited ones apart (guide section 1). Roles is the firm's eight roles until custom roles exist.
2. Search matches name, email, job title and role name ("manag" finds the Managers).
3. Export holds every matching row (all pages) with basic fields only (name, email, role, company, status, MFA, last login, invited) and writes `users.exported` with the count and the filter names.
4. Owner and Admin only (`@Roles(FIRM_MANAGERS)`), as the contract says.
5. Custom roles: a member with one keeps the role it is based on, so `@Roles` and who manages whom stay as they are. On routes the role's grid decides (Manager, Bookkeeper, Tax Preparer, Client Support, Read Only, Business Consultant), the custom grid decides in its place. On routes the role passes by `@Roles` (Admin, Staff, and the others where listed), a cell the custom grid refuses closes the route only where the role's default gives it, so a role cut from Staff never loses what Staff has by `@Roles` without a default cell. The member's own Allow or Deny still wins. Names are unique among built-in labels and live custom roles, in any case.

## Needs from others

- **R42 (contract owner):** drop `InviteUserRequest` / `api.users.invite` (name and email) from `packages/types/src/settings/users.ts`, or keep it for a later "add and invite in one step"; the screen no longer calls it.

- **R0 (schema):** the guide's ninth role, **Business Consultant** (`MembershipRole` has eight), and a `custom_roles` table (name, description, template, permissions) for item 5.
