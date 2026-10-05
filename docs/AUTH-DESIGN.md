# Firmivra authentication design (decided)

Owner: Rasel (architecture). Builder: Tumit (API, Sprint 1 and 2). Consumers: Fahad and Nahid (sign-in screens).
Status: decided Oct 4, 2026. Updated Oct 5 to match the R2 auth contract (`docs/api/auth.yaml`, `packages/types/src/auth`), and with one session per site (`GET /api/v1/admin/me`).

## Summary

- **Identity provider:** AWS Cognito, us-east-1. No third-party auth service.
- **Who is who:** Cognito answers only "who is this person". Which firm they belong to and what role they have live in **our database** (`Membership`, `ClientAccount`, `PlatformAdmin`), never in Cognito groups or token claims.
- **Our own screens:** no Cognito Hosted UI. Sign-in, MFA, forgot and reset password are Next.js screens that match Octavia's mockups, calling **our API**, which talks to Cognito.
- **Tokens in cookies:** the browser never sees or stores raw tokens in JavaScript. The API sets them as `HttpOnly`, `Secure`, host-only cookies: `SameSite=Lax`, and `SameSite=Strict` for the refresh cookie.

## User pools

Three separate Cognito user pools, created by Rasel with CDK (Step 7). A login from one pool can never be used in another app.

| Pool | Who | Used by | MFA |
| --- | --- | --- | --- |
| `firmivra-<env>-staff` | Firm owners, admins, staff | app.firmivra.com | Required (authenticator app, TOTP) |
| `firmivra-<env>-clients` | Clients of a firm | portal.firmivra.com/{firm} | Optional (TOTP; SMS later when SNS is approved) |
| `firmivra-<env>-admins` | Firmivra Super Admin | admin.firmivra.com | Required (TOTP) |

Each pool has one **confidential app client** (with a client secret) used only by the API. The web app has no Cognito client of its own.

Password policy: at least 12 characters, upper, lower, number. Account lockout and compromised-credential checks on.

## Usernames

- **Cognito username is a UUID** we generate. Email is a normal attribute, not a unique sign-in alias.
- **Staff:** one Cognito user per person. One person can be a member of more than one firm through several `Membership` rows. After sign-in, if they belong to more than one firm, the app asks which firm to open.
- **Clients:** one Cognito user **per firm**. The same email signing up at two firms gets two separate accounts, because each firm's client data must stay separate. The API finds the right Cognito user from `ClientAccount (businessId, email)`.

## Sign-in flow (all pools)

1. Screen posts email and password to our API, for example `POST /api/v1/portal/{slug}/auth/sign-in` or `POST /api/v1/auth/sign-in` (staff) or `POST /api/v1/admin/auth/sign-in`.
2. API looks up the Cognito username (for clients, by firm and email), then calls Cognito `AdminInitiateAuth` (`ADMIN_USER_PASSWORD_AUTH`) with the client secret.
3. The API returns a `SignInResult` whose `status` is the next step:
   - `MFA_REQUIRED`, with an opaque `session`: the screen shows the code input; the code and the `session` go to `.../auth/mfa`.
   - `MFA_SETUP_REQUIRED`, with a `session` (first sign-in, or after activation): `.../auth/mfa/setup` returns the QR code, then the first code goes to `.../auth/mfa`.
   - `SIGNED_IN`, with the user data of `GET /api/v1/me` (firm site) or `GET /api/v1/admin/me` (Super Admin site). `.../auth/mfa` also answers with `SIGNED_IN` once the code is right.
4. On `SIGNED_IN` the API sets three cookies. Each site has its own names, so the admin and app sites never share a session:

   | Cookie | Firm site | Super Admin site | Path | Lifetime | SameSite |
   | --- | --- | --- | --- | --- | --- |
   | access | `fv_access` | `fv_admin_access` | `/` | 15 min | Lax |
   | id | `fv_id` | `fv_admin_id` | `/` | 15 min | Lax |
   | refresh | `fv_refresh` | `fv_admin_refresh` | `/api/v1/auth` (firm), `/api/v1/admin/auth` (Super Admin) | 7 days (firm), 1 day (Super Admin) | Strict |

   The refresh path covers both `refresh` and `sign-out`, so sign-out can revoke the refresh token. Refresh tokens last as long as each Cognito pool allows, and the refresh cookie lives exactly as long as its token: staff 7 days, Super Admins 1 day, clients 30 days (shorter where an account can see more). The client portal's cookies are set in the client auth contract (R3, `docs/api/client-auth.yaml`).
5. Errors are generic: "Email or password is incorrect". Never reveal whether an account exists.
6. `POST .../auth/refresh` renews the access and id cookies; `POST .../auth/sign-out` revokes the refresh token and clears all three cookies (`GlobalSignOut` on password reset or deactivation).

## Every API request

1. `AuthGuard` reads the access cookie (or `Authorization: Bearer` for tests), verifies it with `aws-jwt-verify` against the right pool, and gets the Cognito `sub`. Each site has its own session, chosen by the route, never by trying both:
   - `/api/v1/admin/*` (Super Admin site) reads only `fv_admin_access`, `fv_admin_id` and `fv_admin_refresh`, and accepts only Super Admins (admins pool, with a `PlatformAdmin` row).
   - Every other route reads only `fv_access`, `fv_id` and `fv_refresh`, and refuses a Super Admin session, so Super Admin never reaches firm data through firm or portal routes (see "Super Admin access to a firm").
   - The same rule applies to a `Bearer` token in tests: its pool must match the route.
   - Who is signed in: `GET /api/v1/me` on the firm site, `GET /api/v1/admin/me` on the Super Admin site.
2. `TenantGuard` resolves the business from the route or host (`{slug}` or the selected firm), loads the `Membership` or `ClientAccount` for that `sub` and business, and rejects with 404 if none.
3. The request gets a tenant context `{ userId, businessId, role, kind: staff | client | admin }`. Roles come from the database on every request (cache at most 60 seconds), so a removed or deactivated user loses access at once, not at token expiry.
4. `@Roles()` on every controller; default deny.
5. Database access goes through `forBusiness(businessId)`, so row-level security applies.

## Sign-up, invites, password reset

- **Firm owner:** created when Super Admin approves an application; gets an activation email with a one-time link (7 days) to set a password and MFA.
- **Staff:** invited by owner or admin; same activation flow.
- **Clients:** self sign-up on the firm's portal (email and phone verified with 6-digit codes), then status `PENDING_APPROVAL` until the firm approves. A pending client can sign in only to see "waiting for approval".
- **Forgot password:** our API wraps Cognito `ForgotPassword` / `ConfirmForgotPassword` so the flow stays inside the firm's portal. Same response whether or not the account exists. Rate-limited.
- **Emails:** sent by our API through SES with Firmivra or firm branding (Cognito's own emails are turned off).

## Super Admin access to a firm

Super Admin has **no** access to firm data by default. Access needs a `SupportAccessGrant` approved by the firm owner, limited in time and logged in the audit log (Tumit, Sprint 3).

## Local development

Developers have no AWS access. With `AUTH_MODE=local` (only allowed when `NODE_ENV=development`):
- The API signs tokens with a local key instead of Cognito.
- `POST /api/v1/dev/token` returns a session for any seeded user (LVP owner, staff, client, Super Admin).
- The same guards run, so tenant and role checks are tested locally.
- The app refuses to start with `AUTH_MODE=local` in any other environment.

## Who builds what

| Piece | Who | When |
| --- | --- | --- |
| Cognito pools, app clients, SES sender (CDK) | Rasel | Sprint 0, Step 7 |
| AuthGuard, TenantGuard, `@Roles()`, local dev tokens (base) | Rasel | Sprint 0, Step 6.4 |
| Sign-in, MFA, refresh, sign-out, `/me`, activation, firm application approve flow | Tumit | Sprint 1 |
| Staff sign-in, activate and MFA screens | Fahad | Sprint 1 |
| Super Admin sign-in screen | Nahid | Sprint 1 |
| Client sign-up, verify, approval, firm-scoped forgot/reset, team invites | Tumit | Sprint 2 |
| Portal sign-up, sign-in, verify, forgot/reset screens | Nahid | Sprint 2 |
| Support access grants | Tumit | Sprint 3 |
