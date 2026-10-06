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
- [ ] 2. Sign-up on portal/{slug} through our API (no Cognito self sign-up): account status pending
- [ ] 3. Verify email and phone codes (SMS goes to the API log locally and in dev until SNS is registered)
- [ ] 4. Firm side: list pending sign-ups, approve, decline (owner and admin only), notify the client
- [ ] 5. Client sign-in, optional MFA, session cookies scoped to the portal
- [ ] 6. Forgot and reset password per firm; the response never reveals whether an account exists
- [ ] 7. Per-firm Terms and Privacy accepted at sign-up and stored with version and time
- [ ] 8. e2e tests, including a client of firm A trying firm B's portal

## Done when

Nahid's sign-up and sign-in screens work end to end on dev; Fahad's pending sign-ups queue approves a client.

## Rules

- Contract first for every module (Rasel, Oct 6): the module's first PR is its zod schemas and client functions in `packages/types`, registered on `api` in `apps/web/src/lib/api.ts`, plus typed mock fixtures in `apps/web/src/mocks/<module>.ts`. The developers build the screen against it the same day.
- Never edit screens: in apps/web change only `src/mocks/<module>.ts` and your lines in `src/lib/api.ts`.

## Needs from others

- R0 (answered Oct 6, PR #27): `legal_acceptances` / `LegalAcceptance` (clientAccountId, legalDocumentId, acceptedAt, ip, userAgent; insert-only; written in business scope in the transaction that creates the client account, one row each for Terms and Privacy) and `business_settings.portalName`, `portalHeader`, `welcomeMessage`. No accent colour column (R0 asked Rasel): `info.branding.accentColor` sends a default until there is one.
- R0 (asked Oct 6, Rasel approved): a `verification_codes` table (client account, channel EMAIL or PHONE, target, code stored only as an HMAC, attempts, expires_at at most 15 minutes, consumed_at; business scope; only attempts and consumed_at change after insert). Codes and attempts live on the server, so replaying an old sign-up cookie can't reset the attempts. Steps 2-3 store codes there.
- R1: serve `apps/web/src/mocks/client-auth.ts` in mock mode (lands Oct 7).
- R10 (note, Rasel Oct 7): until R10's client records exist, step 4's approve creates the minimal client record itself (display name, email, phone, account type) in the approve transaction. That insert sits in one small function so R10 can take it over later.
- Fahad, F06 (note): a pending sign-up has `existingClient` (`{ clientId, displayName }` or null) when the firm already has a client record with the same email (added by staff, or converted from Begin Online). The queue can offer "link to this client": `approve(id, { clientId })` links the login to that record instead of creating a duplicate; without a body, approve creates a new record.
- R3 itself, step 5: when the portal switches to the per-firm cookies, the e2e test that expects 404 on another firm's portal changes: there the visitor is simply signed out (401).

## Progress log

(newest last: date, step, what changed, commit)

- 2026-10-06, step 1 (this session, after R2): contract in `docs/api/client-auth.yaml`, zod schemas and `createPortalAuthClient` / `createClientSignUpsClient` in `packages/types/src/client-auth`, `portalAuth(slug)` in `apps/web/src/lib/auth.ts`, `api.clientSignUps` in `apps/web/src/lib/api.ts`, typed fixtures in `apps/web/src/mocks/client-auth.ts` (approved outside the owned paths). Fields follow the mockups (Full Name, Email, Phone, Password, Account Type, Terms) and PAGE-MAP's pages; the sign-up session is a sealed HttpOnly cookie (path `.../auth/sign-up`), so every page reads `GET .../auth/sign-up`; per-firm portal cookies with access and id on `/api/v1/portal/{slug}/`. Portal info and legal reads are R3's. Branch `rasel/R3-client-auth`.
- 2026-10-06, step 1 merged with main (#28, #29): the clients follow #29's convention, `createPortalAuthClient(request, slug)` and `createClientSignUpsClient(request)` on the shared `createRequest`, with `parseInput` (bad input rejects with ApiRequestError 400 VALIDATION_FAILED before sending); `api.clientSignUps` sits next to `api.taxStatuses`.
- 2026-10-06, plan for steps 2-3 (Rasel: go): public reads (`info`, `legal`), sign-up (Cognito clients-pool login, CLIENT user, PENDING_APPROVAL client account with email and phone unverified, both `legal_acceptances` rows, all in one transaction; an email already verified at this firm only gets an "already have an account" email), sealed sign-up cookie (own HKDF label, 30 min, account and step only), verification with codes in `verification_codes`. Codes are sent through a sender interface and logged only with `AUTH_MODE=local` (no exception to hard rule 4: on dev nothing is logged, so sign-up can't finish there until R6 sends email and SMS); tests capture codes through the interface. Order tomorrow: push this branch's merge with main (#30); open R2 step 6's PR once #34 merges (merge main first); then R3 steps 2-3.
- 2026-10-07, #30 re-review items 3 and 4 (lead): `createPortalAuthMock(firmSlug, options)` and `createClientSignUpsMock({ role })` in `apps/web/src/mocks/client-auth.ts`, typed `PortalAuthClient` and `ClientSignUpsClient`, on the fixtures (now parsed when the module loads), with `parseInput`, the documented error codes as `ApiRequestError`, copies, a sign-up walk (MOCK_CODE `000000`) and pending vs active sign-in; told R1 that `portalAuth` lives in `lib/auth.ts`. `docs/api/client-auth.yaml`: 415 `UNSUPPORTED_MEDIA_TYPE` and 403 `ORIGIN_NOT_ALLOWED` on every POST, and changes come only from the browser.
- 2026-10-07, step 4 contract (Rasel): approve takes an optional `{ clientId }` to link the login to an existing client record of the firm (404 if the firm has none with that id); `ClientSignUp.existingClient` shows a record with the same email. Types, client, YAML and mocks updated (Jane Roe's mock sign-up has an `existingClient`); notes above for R10 and F06.
