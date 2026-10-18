# R55: Staff Management directory API

Contract: `packages/types/src/staff/` (R42). Module: `apps/api/src/staff/`.

## Steps

- [x] 1. The directory (read): list, summary, form options, one member's details, the import template.
- [ ] 2. Invite and change a member: create (with the idempotency key and a draft), update, lock, unlock, deactivate, reactivate, resend and revoke an invite, the import itself.
- [ ] 3. Security: access settings, sessions, login history, activity, reset password and MFA.
- [ ] 4. Per-member permissions (`member_permissions`), notes, compensation.
- [ ] 5. Documents (the three-step upload) and drafts.

## Progress

- 2026-10-18: step 1. `GET /business/staff` (search, status, role and department filters, pages of 10, 25, 50 or 100), `/staff/summary`, `/staff/options`, `/staff/import/template` (CSV), `/staff/:id`.

## Notes

1. Owner and Admin read. Staff reads only when the firm's grid gives the role Staff Management view (the route's role list lets Staff in, so the service checks the grid); the five newer roles go through the grid at the guard. A Manager therefore gets 403 by default (Staff Management is a sensitive module).
2. `options.roles` is what the caller may give (`ROLES_MANAGED_BY`): an Admin gives the roles below Admin, an Owner also Admin.
3. A member's invite is the latest open invite (not accepted, not revoked). `lastLogin` is the time in `staff_security_settings`; device and place wait for the login history.
4. `firstName` and `lastName` are the user's one `name` split at the first space.
5. Static routes (`summary`, `options`, `import/template`) are declared before `:id`.
6. No schema change.

## Needs from others

- **MFA state.** Whether a member has a second step is known to Cognito, not to our database. Until the API asks Cognito, an invited member shows PENDING and everyone else DISABLED. The API task role needs `cognito-idp:AdminGetUser` on the staff pool to show the real state.
