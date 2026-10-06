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
- R1: serve `apps/web/src/mocks/client-auth.ts` in mock mode (lands Oct 7).
- R3 itself, step 5: when the portal switches to the per-firm cookies, the e2e test that expects 404 on another firm's portal changes: there the visitor is simply signed out (401).

## Progress log

(newest last: date, step, what changed, commit)

- 2026-10-06, step 1 (this session, after R2): contract in `docs/api/client-auth.yaml`, zod schemas and `createPortalAuthClient` / `createClientSignUpsClient` in `packages/types/src/client-auth`, `portalAuth(slug)` in `apps/web/src/lib/auth.ts`, `api.clientSignUps` in `apps/web/src/lib/api.ts`, typed fixtures in `apps/web/src/mocks/client-auth.ts` (approved outside the owned paths). Fields follow the mockups (Full Name, Email, Phone, Password, Account Type, Terms) and PAGE-MAP's pages; the sign-up session is a sealed HttpOnly cookie (path `.../auth/sign-up`), so every page reads `GET .../auth/sign-up`; per-firm portal cookies with access and id on `/api/v1/portal/{slug}/`. Portal info and legal reads are R3's. Branch `rasel/R3-client-auth`.
- 2026-10-06, step 1 merged with main (#28, #29): the clients follow #29's convention, `createPortalAuthClient(request, slug)` and `createClientSignUpsClient(request)` on the shared `createRequest`, with `parseInput` (bad input rejects with ApiRequestError 400 VALIDATION_FAILED before sending); `api.clientSignUps` sits next to `api.taxStatuses`.
