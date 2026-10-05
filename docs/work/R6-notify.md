# R6: Email and SMS sender (Oct 12)

**Goal:** One NotifyService sends email and SMS everywhere, with templates, working locally and on dev.

**Owned paths (change only these):**
- `apps/api/src/notify/**`

**Read first (nothing else):** CLAUDE.md, docs/work/README.md, this file, and:
- infra email stack (SES identity dev.firmivra.com)
- Local Mailpit settings

## Steps

- [ ] 1. Publish the NotifyService interface by Oct 9 (Tumit T06 and other streams call it)
- [ ] 2. Email via SES on dev, Mailpit locally; SMS via SNS on dev only after registration, otherwise written to the API log
- [ ] 3. Templates: invite, approval, decline, request info, sign-up approved, password reset, document requested, appointment booked/changed/reminder, invoice sent, payment received
- [ ] 4. Firm branding in client emails (name, logo, colours); no secrets or SSNs in messages
- [ ] 5. Respect notification preferences (from Tumit's API)
- [ ] 6. Replace the log-only calls in R2, R3, R4

## Done when

Every flow above sends a real email to a verified address on dev.

## Needs from others

(none yet)

## Progress log

(newest last: date, step, what changed, commit)
