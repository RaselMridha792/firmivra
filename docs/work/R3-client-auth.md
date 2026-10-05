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

- [ ] 1. Publish docs/api/client-auth.yaml by Oct 7 so Nahid builds N02 and N03 against it
- [ ] 2. Sign-up on portal/{slug} through our API (no Cognito self sign-up): account status pending
- [ ] 3. Verify email and phone codes (SMS goes to the API log locally and in dev until SNS is registered)
- [ ] 4. Firm side: list pending sign-ups, approve, decline (owner and admin only), notify the client
- [ ] 5. Client sign-in, optional MFA, session cookies scoped to the portal
- [ ] 6. Forgot and reset password per firm; the response never reveals whether an account exists
- [ ] 7. Per-firm Terms and Privacy accepted at sign-up and stored with version and time
- [ ] 8. e2e tests, including a client of firm A trying firm B's portal

## Done when

Nahid's sign-up and sign-in screens work end to end on dev; Fahad's pending sign-ups queue approves a client.

## Needs from others

(none yet)

## Progress log

(newest last: date, step, what changed, commit)
