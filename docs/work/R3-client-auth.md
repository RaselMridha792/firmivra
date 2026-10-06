# R3: Client accounts (Oct 8-9)

**Goal:** A client signs up on a firm's portal, verifies email and phone, the firm approves, and the client signs in or resets a password.

**Owned paths (change only these):**
- `apps/api/src/client-auth/**`
- `packages/types/src/client-auth/**`
- `docs/api/client-auth.yaml`

**Read first (nothing else):** CLAUDE.md, docs/work/README.md, this file, and:
- docs/AUTH-DESIGN.md (clients pool)
- docs/work/R2-staff-auth.md (reuse its session code)

## Steps

- [x] 1. Contract first: `packages/types/src/client-auth` (schemas and client functions) plus mock fixtures on Oct 7, with docs/api/client-auth.yaml, so Nahid builds N02 and N03 against it; the firm's pending sign-ups contract by Oct 8 (Fahad F06)
- [x] 2. Sign-up on portal/{slug} through our API (no Cognito self sign-up): account status pending
- [x] 3. Verify email and phone codes (SMS goes to the API log locally and in dev until SNS is registered)
- [ ] 4. Firm side: list pending sign-ups, approve, decline (owner and admin only), notify the client
- [x] 5. Client sign-in, optional MFA, session cookies scoped to the portal
- [x] 6. Forgot and reset password per firm; the response never reveals whether an account exists
- [x] 7. Per-firm Terms and Privacy accepted at sign-up and stored with version and time
- [ ] 8. e2e tests, including a client of firm A trying firm B's portal

## Done when

Nahid's sign-up and sign-in screens work end to end on dev; Fahad's pending sign-ups queue approves a client.

## Rules

- Contract first for every module (Rasel, Oct 6): the module's first PR is its zod schemas and client functions in `packages/types`, registered on `api` in `apps/web/src/lib/api.ts`, plus typed mock fixtures in `apps/web/src/mocks/<module>.ts`. The developers build the screen against it the same day.
- Never edit screens: in apps/web change only `src/mocks/<module>.ts` and your lines in `src/lib/api.ts`.

## Needs from others

- R0 (answered Oct 6, PR #27): `legal_acceptances` / `LegalAcceptance` (clientAccountId, legalDocumentId, acceptedAt, ip, userAgent; insert-only; written in business scope in the transaction that creates the client account, one row each for Terms and Privacy) and `business_settings.portalName`, `portalHeader`, `welcomeMessage`. No accent colour column (R0 asked Rasel): `info.branding.accentColor` sends a default until there is one.
- R0 (answered Oct 6, PR #32, migration `20261006101400_r0_verification_codes`): `verification_codes` / `VerificationCode`, enum `VerificationChannel` (EMAIL, PHONE); fields businessId, clientAccountId, channel, target, codeHash, attempts, expiresAt, consumedAt, createdAt; business scope only. The database sets createdAt (use it for the 45 s resend gap), trims expiresAt to at most 15 minutes, allows only attempts +1 and consumedAt after insert, and refuses consuming an expired code or one that is not the newest. The API locks out at its own attempt limit before consuming and checks target against the account's current email or phone.
- R1: serve `apps/web/src/mocks/client-auth.ts` in mock mode (lands Oct 7).
- R10 (note, Rasel Oct 7): until R10's client records exist, step 4's approve creates the minimal client record itself (display name, email, phone, account type) in the approve transaction. That insert sits in one small function so R10 can take it over later. Linking an existing record follows the rule below; R10's own linking (for example a staff invite) should use the same check.
- Fahad, F06 (note): a pending sign-up has `existingClient` (`{ clientId, displayName }` or null). It is set only for a record approve would accept: the record's email is the sign-up's verified email (both lower-cased) and the record has no primary portal login yet. Offer "link to this client" only then: `approve(id, { clientId: existingClient.clientId })`. Approve refuses any other record with 409 `CLIENT_NOT_LINKABLE` (nothing changes; reload the list), and 404 for a record the firm doesn't have. Without a body, approve creates a new record. The body is strict: any other field is 400.
- R3 itself, step 5 (done): with the per-firm cookies a browser is simply signed out on another firm's portal (401); `guards.e2e.test.ts` now checks that, and keeps 404 for a Bearer token (it reaches the firm check).

## Progress log

(newest last: date, step, what changed, commit)

- 2026-10-06, step 1 (this session, after R2): contract in `docs/api/client-auth.yaml`, zod schemas and `createPortalAuthClient` / `createClientSignUpsClient` in `packages/types/src/client-auth`, `portalAuth(slug)` in `apps/web/src/lib/auth.ts`, `api.clientSignUps` in `apps/web/src/lib/api.ts`, typed fixtures in `apps/web/src/mocks/client-auth.ts` (approved outside the owned paths). Fields follow the mockups (Full Name, Email, Phone, Password, Account Type, Terms) and PAGE-MAP's pages; the sign-up session is a sealed HttpOnly cookie (path `.../auth/sign-up`), so every page reads `GET .../auth/sign-up`; per-firm portal cookies with access and id on `/api/v1/portal/{slug}/`. Portal info and legal reads are R3's. Branch `rasel/R3-client-auth`.
- 2026-10-06, step 1 merged with main (#28, #29): the clients follow #29's convention, `createPortalAuthClient(request, slug)` and `createClientSignUpsClient(request)` on the shared `createRequest`, with `parseInput` (bad input rejects with ApiRequestError 400 VALIDATION_FAILED before sending); `api.clientSignUps` sits next to `api.taxStatuses`.
- 2026-10-06, plan for steps 2-3 (Rasel: go): public reads (`info`, `legal`), sign-up (Cognito clients-pool login, CLIENT user, PENDING_APPROVAL client account with email and phone unverified, both `legal_acceptances` rows, all in one transaction; an email already verified at this firm only gets an "already have an account" email), sealed sign-up cookie (own HKDF label, 30 min, account and step only), verification with codes in `verification_codes`. Codes are sent through a sender interface and logged only with `AUTH_MODE=local` (no exception to hard rule 4: on dev nothing is logged, so sign-up can't finish there until R6 sends email and SMS); tests capture codes through the interface. Order tomorrow: push this branch's merge with main (#30); open R2 step 6's PR once #34 merges (merge main first); then R3 steps 2-3.
- 2026-10-06, step 2 started (local branch `rasel/R3-step2`, on the #30 branch): `GET /portal/{firmSlug}/info` and `/legal/{kind}` in `apps/api/src/client-auth/portal-info.controller.ts` (ACTIVE firms only, else 404; branding from `business_settings` with defaults, accent colour always the default until a column exists; sign-up open only with both documents published; document ids never sent). e2e: `apps/api/test/e2e/portal-info.e2e.test.ts`. Sign-up and verification next, once R0's `verification_codes` table is in.
- 2026-10-07, #30 re-review items 3 and 4 (lead): `createPortalAuthMock(firmSlug, options)` and `createClientSignUpsMock({ role })` in `apps/web/src/mocks/client-auth.ts`, typed `PortalAuthClient` and `ClientSignUpsClient`, on the fixtures (now parsed when the module loads), with `parseInput`, the documented error codes as `ApiRequestError`, copies, a sign-up walk (MOCK_CODE `000000`) and pending vs active sign-in; told R1 that `portalAuth` lives in `lib/auth.ts`. `docs/api/client-auth.yaml`: 415 `UNSUPPORTED_MEDIA_TYPE` and 403 `ORIGIN_NOT_ALLOWED` on every POST, and changes come only from the browser.
- 2026-10-07, steps 2-3 (local branch `rasel/R3-step2`, built on R2 step 6 and R0's #32 until both are on main):
  - `POST/GET /portal/{firmSlug}/auth/sign-up`, `verify-email`, `verify-phone`, `resend`, `change-email`, `change-phone` (`sign-up.controller.ts`, `sign-up.service.ts`).
  - Sign-up creates the clients-pool login (email and phone unverified), the CLIENT user and a PENDING_APPROVAL client account with both `legal_acceptances`.
  - An email already verified at the firm gets only an "already registered" email and the same answer, with a session that goes nowhere; an unverified leftover starts again with the new details.
  - Sealed sign-up cookie (label `fv-portal-signup-v1`, 30 min, path `.../auth/sign-up`) holds only the account and firm.
  - Codes in `verification_codes` (HMAC bound to account and channel, label `fv-client-code-v1`, 10 min, 5 tries, 45 s resend gap from the database's createdAt, a changed target gets its code at once).
  - `ClientCodeSender` logs codes only with `AUTH_MODE=local`.
  - Cognito: `createUser` takes phone and `emailVerified`, new `updateContact` (verified flags, changed email or phone).
  - Audit `client_account.signed_up` and `client_account.verified` in the firm.
  - Tests: `test/e2e/sign-up.e2e.test.ts` (7), `test/unit/client-auth.test.ts`.
- 2026-10-07, step 4 contract (Rasel): approve takes an optional `{ clientId }` to link the login to an existing client record of the firm (404 if the firm has none with that id); `ClientSignUp.existingClient` shows a record with the same email. Types, client, YAML and mocks updated (Jane Roe's mock sign-up has an `existingClient`); notes above for R10 and F06.
- 2026-10-07, #37 fix (lead took #37 off the ready list: linking any record would let one wrong click give a stranger another client's tax records): approve links only a record whose email is the sign-up's verified email (both lower-cased) and that has no primary portal login yet, else 409 `CLIENT_NOT_LINKABLE`; `existingClient` shows only such a record; `ApproveSignUpRequest` is strict. In the zod schemas, client-auth.yaml ("Linking an existing client record"), the F06 note and the mocks (John Doe's record has his email but already a login, so it is refused). Step 4's API enforces the same rule in the approve transaction.
- 2026-10-07, steps 5-6 (local branch `rasel/R3-step2`, on steps 2-3; Rasel: go):
  - `portal/{firmSlug}/auth/sign-in`, `mfa`, `mfa/setup`, `refresh`, `sign-out`, `forgot-password`, `reset-password` (`client-auth/portal-sign-in.controller.ts`): the staff routes (`SignInRoutes`, now exported) with a `SignInPlace` (pool, cookies, authenticator issuer, firm) instead of a site name. Only ACTIVE firms (404 otherwise); sign-out always succeeds and clears that slug's cookies.
  - `GET portal/{firmSlug}/me` (`AUTHENTICATED`, so a pending client reads it): only this firm's account in `clientAccounts`; 401 once the client may no longer sign in.
  - Who may sign in, one rule in `auth/portal-clients.ts`: an ACTIVE client of the firm, or a PENDING_APPROVAL one with email and phone verified. Declined, disabled, invited and unfinished sign-ups get `INVALID_CREDENTIALS` like a wrong password. Refresh checks the same rule.
  - Per-firm cookies `fv_portal_{slug}_*` on `/api/v1/portal/{slug}/`. The challenge and the refresh envelope carry the firm and open only on its portal. `AuthGuard` reads that firm's cookie on portal routes and takes only the clients pool; `crossSiteGuard` takes only the portal's origin on portal routes and counts the portal cookies (sign-up included) as session cookies.
  - Reset failures count per firm and email. Local mode: clients sign in without MFA (the pool's MFA is optional); `POST /dev/token` gives a client their portal's cookie.
  - Docs: apps/api/README.md, auth.yaml, client-auth.yaml. Tests: `test/e2e/portal-sign-in.e2e.test.ts` (11), `test/unit/portal-sign-in.test.ts` (8), the browser case in `guards.e2e.test.ts`; the sign-up e2e visitor now sends the portal's origin.
- 2026-10-07, steps 2-3 PR branch `rasel/R3-signup` (696df21 plus the #41 branch, which holds main with #32): #32 merged, so the PR opens now (Rasel); its diff shows #41's changes until #41 merges, then main is merged in. Step 7 is part of sign-up: `POST auth/sign-up` refuses outdated versions (409 `TERMS_OUTDATED`) and stores one `legal_acceptances` row each for Terms and Privacy (document id, so its version, plus time, IP and user agent) in the transaction that creates the account.
