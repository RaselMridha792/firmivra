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
- [x] 2. Sign-in with AdminInitiateAuth for the staff and admins pools; MFA challenge (TOTP) and first-time MFA setup
- [x] 3. Session: HttpOnly secure cookies, refresh, sign-out everywhere; tokens never in the browser
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
- R1/R8: a dedicated `AUTH_SESSION_KEY` in Secrets Manager for the sign-in challenge sessions. Until then the key is derived with HKDF from each pool's client secret (label `fv-auth-challenge-v1`), see `apps/api/src/auth/challenge-session.ts`.
- R1: the API trusts exactly two proxy hops (`TRUSTED_PROXY_HOPS` in `apps/api/src/configure-app.ts`: CloudFront, then the ALB) to find the viewer IP for rate limits and the audit log. Tell R2 if anything is added in front of the API (WAF proxy, another load balancer).
- R1: a one-off "link dev users" command in the migrate image, run as an ECS task with the Cognito subs and emails passed as task overrides (nothing committed). Dev has no users until then; after R1 step 6 deploys the app, Rasel creates the Cognito users (commands in the step 2 handoff) and R2 checks sign-in with MFA on dev.
- R1: shorten `refreshTokenValidity` in infra/src/stacks/auth-stack.ts (today 30 days for every pool, from the shared `pool()` helper): staff at most 7 days, Super Admin at most 1 day. Tell R2: `REFRESH_TOKEN_DAYS` in `apps/api/src/auth/site.ts` must change with it (the refresh cookie and its sealed envelope expire with the token).
- R0: a unique index on `users (pool, email)` for the STAFF and ADMIN pools (clients may repeat across firms). Sign-in refuses an email that matches two users of a pool, so duplicates would lock that person out.
- Lead: AUTH-DESIGN.md does not yet say that each site accepts only its own session (`/api/v1/admin/*` reads only `fv_admin_*`, never Super Admin sessions elsewhere) or that the Super Admin site reads `GET /admin/me`.

## Progress log

(newest last: date, step, what changed, commit)

- 2026-10-05, step 1: auth contract in docs/api/auth.yaml and packages/types/src/auth (zod schemas, `createStaffAuthClient`, `createAdminAuthClient`); `staffAuth` and `adminAuth` in apps/web/src/lib/auth.ts, local `/dev/token` unchanged. Tests live in packages/types/test/auth (mapped owned path). Password rules match the Cognito pools in infra/src/stacks/auth-stack.ts (re-checked on main after #7); the zod schema adds Cognito's own limits (no space at either end, at most 256 characters). Commit: "feat: auth contract for staff and Super Admin sign-in".
- 2026-10-05, step 2: `POST {/auth,/admin/auth}/{sign-in,mfa,mfa/setup}` with an `IdentityProvider` (Cognito: AdminGetUser by sub, AdminInitiateAuth with SECRET_HASH, SOFTWARE_TOKEN_MFA, MFA_SETUP via Associate/VerifySoftwareToken; local: password `Firmivra-local-1`, code `000000`). Challenge sessions are JWE, keyed by HKDF. Each site accepts only its own cookie and pools; `GET /admin/me` added. `trust proxy` 2, so rate limits use the viewer IP. Approved changes outside the owned paths: `apps/api/src/config/env.ts` (client secrets), `apps/api/src/me/*` (MeService, AdminMeController), `apps/api/src/dev/dev.controller.ts` (cookie per site), `apps/api/src/configure-app.ts`, `apps/web/src/components/session-panel.tsx` and `apps/web/src/app/admin/page.tsx` (admin /me), plus the existing tests they affect. Tests mapped to `apps/api/test/unit/sign-in.test.ts` and `apps/api/test/e2e/auth.e2e.test.ts`. Not yet tried against real Cognito on dev (needs dev users, see Needs from others). Branch `rasel/R2-step2`.
- 2026-10-05, step 3: `POST {/auth,/admin/auth}/{refresh,sign-out,forgot-password,reset-password}`. The refresh cookie holds a sealed envelope (refresh token, Cognito username, user id; HKDF label `fv-auth-refresh-v1`), because REFRESH_TOKEN_AUTH needs the username for SECRET_HASH; it lives `REFRESH_TOKEN_DAYS` (30, as in infra). Sign-out revokes the refresh token (`RevokeToken`), `everywhere` adds `AdminUserGlobalSignOut`; reset is `ConfirmForgotPassword` then global sign-out; forgot-password always answers ok. The step 2 challenge sealer became a shared `Sealer` (`sealed.ts`). Local: reset code `000000`. Access tokens stay valid up to 15 minutes after sign-out (accepted by Rasel). Branch `rasel/R2-step3` on `rasel/R2-step2`.
