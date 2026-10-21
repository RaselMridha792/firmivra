# R55: Settings > Users & Roles (Octavia's review, Oct 20)

Guide: `docs/specs/settings-review-2026-10-20/users-and-roles--firmivra-users-and-roles-developer-guide-1.md` (PR #965). Screens: `apps/web/src/app/firm/(workspace)/settings/users/`. Contract: `packages/types/src/settings/users.ts` (`api.users`), `packages/types/src/staff/roles.ts` (`api.roles`). One small PR per item.

## Items

- [x] 1. **Counters and table do not load** (P1). Cause: no API served `/business/users`, `/users/summary` or `/users/export`; only the contract existed. Built in `apps/api/src/staff/users.{controller,service}.ts` on the Staff directory's query. On the screen: Retry on failed counters and table, the guide's empty-state wording, and counters that filter the table.
- [ ] 2. **Invite User** returns "We could not find that" (P1): the same missing API (`POST /business/users/invite`). Per the guide, invite an existing staff record (no second record), deliver the activation email, update the pending count.
- [ ] 3. **Reset Password and Deactivate selectors are empty** (P1): they list only the table's current page. They need every eligible user, searchable.
- [ ] 4. **Admin permission edits rejected** (P1): Owner and Admin may edit every role in their firm.
- [ ] 5. **Custom role** (P1): template, then a Set Permissions dialog, then save. Needs a `custom_roles` table (R0).
- [ ] 6. P3: individual overrides (Inherit, Allow, Deny), change role, revoke invitation, unlock, reactivate, bulk actions, last-administrator protection.

## Decisions

1. Total Users counts accepted accounts (Active, Locked, Inactive); Pending Invitations counts invited ones apart (guide section 1). Roles is the firm's eight roles until custom roles exist.
2. Search matches name, email, job title and role name ("manag" finds the Managers).
3. Export holds every matching row (all pages) with basic fields only (name, email, role, company, status, MFA, last login, invited) and writes `users.exported` with the count and the filter names.
4. Owner and Admin only (`@Roles(FIRM_MANAGERS)`), as the contract says.

## Needs from others

- **R0 (schema):** the guide's ninth role, **Business Consultant** (`MembershipRole` has eight), and a `custom_roles` table (name, description, template, permissions) for item 5.
