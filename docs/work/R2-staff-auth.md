# R2: Staff and Super Admin auth (Oct 6-8)

**Goal:** Firm staff and Super Admin sign in through our own screens with MFA; every API call knows the user, firm and role.

**Owned paths (change only these):**
- `apps/api/src/auth/**`
- `apps/web/src/lib/auth.ts`
- `packages/types/src/auth/**`
- `docs/api/auth.yaml`

**Read first (nothing else):** CLAUDE.md, docs/work/README.md, this file, and:
- docs/AUTH-DESIGN.md
- apps/api/src/auth (guards) and apps/api/src/audit/audit.service.ts (AuditService)

## Steps

- [x] 1. FIRST, by Oct 6 evening: publish the auth contract (docs/api/auth.yaml + types) so Fahad builds screens against it; keep AUTH_MODE=local working for developers
- [ ] 2. Sign-in with AdminInitiateAuth for the staff and admins pools; MFA challenge (TOTP) and first-time MFA setup
- [ ] 3. Session: HttpOnly secure cookies, refresh, sign-out everywhere; tokens never in the browser
- [ ] 4. GET /me: user, firm memberships, role from our DB
- [ ] 5. Guards: @Roles(owner, admin, staff), firm scope from the host/route, platform scope for Super Admin; 404 when no firm link, 403 when wrong role
- [ ] 6. Staff invites: create invite, email link (log until R6), /activate sets password + MFA
- [ ] 7. Rate limit sign-in and MFA attempts; audit every sign-in, failure and invite with AuditService.log
- [ ] 8. e2e tests: sign-in, MFA, wrong firm, wrong role, expired invite

## Done when

A staff user and a Super Admin can sign in with MFA on dev; Fahad's F02 screens work against it.

## Needs from others

- R0 (in progress): `team_invites` table holding the token hash; the user row and an `INVITED` membership are created when the invite is sent. Step 6 builds on that shape.
- Lead: AUTH-DESIGN.md changes for the status union, cookie names and paths, and staff/admin forgot and reset password: done in PR #8.

## Progress log

(newest last: date, step, what changed, commit)

- 2026-10-05, step 1: auth contract in docs/api/auth.yaml and packages/types/src/auth (zod schemas, `createStaffAuthClient`, `createAdminAuthClient`); `staffAuth` and `adminAuth` in apps/web/src/lib/auth.ts, local `/dev/token` unchanged. Tests live in packages/types/test/auth (mapped owned path). Password rules match the Cognito pools in infra/src/stacks/auth-stack.ts (re-checked on main after #7); the zod schema adds Cognito's own limits (no space at either end, at most 256 characters). Commit: "feat: auth contract for staff and Super Admin sign-in".
