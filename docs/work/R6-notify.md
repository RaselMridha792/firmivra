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
- [ ] 5. Respect notification preferences (step 7)
- [ ] 6. Replace the log-only calls in R2, R3, R4
- [ ] 7. Plus T06 (Oct 6): notification center (list, unread count, mark read, link to the record) and preferences; reminder jobs for appointments and client notes, as a job inside the API with a Postgres advisory lock unless there's a reason for an AWS scheduler. Contract by Oct 10 (Fahad F07, Nahid N10)

## Done when

Every flow above sends a real email to a verified address on dev.

## Rules

- Contract first for every module (Rasel, Oct 6): the module's first PR is its zod schemas and client functions in `packages/types`, registered on `api` in `apps/web/src/lib/api.ts`, plus typed mock fixtures in `apps/web/src/mocks/<module>.ts`. The developers build the screen against it the same day.
- Never edit screens: in apps/web change only `src/mocks/<module>.ts` and your lines in `src/lib/api.ts`.

## Needs from others

(none yet)

## Progress log

(newest last: date, step, what changed, commit)
