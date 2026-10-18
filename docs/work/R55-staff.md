# R55: Staff Management directory API

Contract: `packages/types/src/staff/` (R42). Module: `apps/api/src/staff/`.

## Steps

- [x] 1. The directory (read): list, summary, form options, one member's details, the import template.
- [x] 2. Invite and change a member: create (with the idempotency key and a draft), update, lock, unlock, deactivate, reactivate, resend and revoke an invite. (The import moves to step 5.)
- [x] 3. Security: access settings, sessions, login history, activity, reset password and MFA.
- [x] 4. Per-member permissions (`member_permissions`), notes, compensation.
- [ ] 5. Documents (the three-step upload), drafts (done in step 2) and the import.

## Progress

- 2026-10-18: step 1. `GET /business/staff` (search, status, role and department filters, pages of 10, 25, 50 or 100), `/staff/summary`, `/staff/options`, `/staff/import/template` (CSV), `/staff/:id`.
- 2026-10-19: steps 2 and 4 (PR A, `rasel/R55-staff-write`). `POST /business/staff`, `PATCH /:id`, `/:id/lock|unlock|deactivate|reactivate`, `/:id/invite/resend|revoke`, `GET|PUT /:id/permissions`, `POST /:id/permissions/copy-from/:fromId`, `GET|PUT /:id/notes`, `GET|PUT /:id/compensation`, `/business/staff-drafts` (list, get, create, save, delete). Two additive changes in `apps/api/src/auth` (Rasel's yes through the Scrum thread): InvitesService `delivery` (send, skip, try) and the roles guard applying `member_permissions`. PR #830.
- 2026-10-19: step 3 (PR B, `rasel/R55-staff-security`, stacked on #830). `GET|PUT /:id/security`, `GET /:id/sessions`, `POST /:id/sessions/:sessionId/revoke`, `POST /:id/sessions/revoke-all`, `GET /:id/login-history`, `GET /:id/activity`, `POST /:id/reset-password`, `POST /:id/reset-mfa`. One additive change in `apps/api/src/auth`: `IdentityProvider.resetMfa`.

## Notes

1. Owner and Admin read. Staff reads only when the firm's grid gives the role Staff Management view (the route's role list lets Staff in, so the service checks the grid); the five newer roles go through the grid at the guard. A Manager therefore gets 403 by default (Staff Management is a sensitive module).
2. `options.roles` is what the caller may give (`ROLES_MANAGED_BY`): an Admin gives the roles below Admin, an Owner also Admin.
3. A member's invite is the latest open invite (not accepted, not revoked). `lastLogin` is the time in `staff_security_settings`; device and place wait for the login history.
4. `firstName` and `lastName` are the user's one `name` split at the first space.
5. Static routes (`summary`, `options`, `import/template`) are declared before `:id`.
6. No schema change.
7. Create Staff runs in one transaction that holds the idempotency key's lock from the replay check to the audit row (`staff.created`, which keeps the key and the invitation's outcome). Everything is checked before the invite: departments and teams (404, 409 GROUP_INACTIVE), supervisor, employee id, the grid. The invite commits in InvitesService's own transaction: if a later write fails, the member stays INVITED and a retry answers 409 DUPLICATE_EMAIL.
8. `sendWelcomeEmail: false` makes the invite without sending (NOT_SENT; Resend makes a new link). A failed send is FAILED and keeps the member.
9. A member's name, email and phone live on the shared login (`users`), which firm scope cannot change: Edit Staff refuses a different name or email (400), and `phone` is accepted and not stored (see Needs).
10. Lock, deactivate and reactivate sign out the member's `staff_sessions` here, not Cognito's GlobalSignOut: a staff login is shared with other firms. The tenant guard refuses a member who is not ACTIVE at once (404).
11. Reactivate: a member who had joined is ACTIVE again; one who never joined gets a new invite to their login's own email (INVITED). Revoke Invitation leaves the member DEACTIVATED.
12. A member's own permissions: Create Staff's step 2 and PUT keep the cells that differ from the role's (Owner never). The roles guard reads them on every `@Access` route (cached 10 s per member): a refusal takes the route away from Admin, Staff and the grid roles; a grant lets a grid role in. Service-level checks that call `PermissionGrantsService.can` with the role (DELETE, MANAGE, EXPORT on some modules) still read the role's grid only.
13. Notes and pay are Owner and Admin only; `GET /:id` now shows notes only to them. An Admin sees the pay of the roles they manage and their own. Audit rows never hold a note, an amount or a draft's content.
14. Security: a location rule with an empty list is 400 (it would lock the member out). Sessions are the open `staff_sessions` rows seen in the last 7 days; "Active now" is the last 5 minutes. Sign out (one or all) marks the rows here; it does not call Cognito, which has no per-firm sign-out and needs the login's username.
15. Reset Password asks the identity service to email the person a reset code (nobody sees a password) and sets `requirePasswordChange`. Reset MFA forgets the login's authenticator and signs it out everywhere: the login is the person's at every firm they work for. Both need a member who can sign in (ACTIVE or LOCKED; 409 NOT_ACTIVE otherwise).
16. Login History reads the firm's `auth.signed_in` and `auth.sign_in_failed` rows for the member, and Activity the firm's rows by or about them (cursor pages). Staff sign-in rows are written to the platform's log today, so Login History is empty until they reach the firm's (see Needs).

## Needs from others

- **Staff import store (R0).** A `staff_import_previews` table (firm, creator, rows as JSON, expiry) for the import's `previewToken`. Until it exists the import routes answer 503 NOT_AVAILABLE.
- **A per-firm name and phone (R0).** `users.name` and `users.phone` belong to the shared login; Create Staff's phone has nowhere to go and Edit Staff cannot correct a name. A `staff_profiles.phone` (and display name) column would hold the firm's own.
- **R6: a staff change notice.** Edit Staff's `notifyMember` is recorded in the audit row; no email goes out until a `staff.changed` template exists.
- **R2: sign-ins the firm can see.** Staff `auth.signed_in` and `auth.sign_in_failed` rows go to the platform's log (no firm at sign-in), and nothing writes `staff_sessions` or `last_login_at`. Login History, Active Sessions and Last Login stay empty until sign-in records them per firm (at the firm the member opens). A failed attempt carries no user, only an email key.
- **R2: sign out at Cognito per session.** Revoking a `staff_sessions` row ends nothing at Cognito until the session check reads the row (or the row keeps what `RevokeToken` needs).
- **MFA state.** Whether a member has a second step is known to Cognito, not to our database. Until the API asks Cognito, an invited member shows PENDING and everyone else DISABLED. The API task role needs `cognito-idp:AdminGetUser` on the staff pool to show the real state.
