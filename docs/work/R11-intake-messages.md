# R11: Intake, Begin Online, leads and messages API (Oct 9-12)

**Goal:** A visitor submits a Begin Online form, the firm reviews the lead and converts it to a client; clients fill intake forms in the portal; the firm and the client exchange messages, and each keeps private notes. Former developer tickets I06, I07 and I09 (Arfan), moved here on Oct 6.

**Owned paths (change only these):**
- `apps/api/src/intake/**`, `apps/api/src/begin-online/**`, `apps/api/src/leads/**`, `apps/api/src/messages/**` (map them to the real layout once)
- `packages/types/src/intake/**`, `begin-online/**`, `leads/**`, `messages/**`
- `apps/web/src/mocks/intake.ts`, `begin-online.ts`, `leads.ts`, `messages.ts`, and your registration lines in `apps/web/src/lib/api.ts`

**Read first (nothing else):** CLAUDE.md, docs/work/README.md, this file, and:
- the R0 tables for intake form definitions and submissions, leads, message threads, messages and notes
- docs/specs/NOTES-begin-online.md (every field of the six services)
- apps/api/README.md, docs/junior/GUIDE.md

## Steps

- [ ] 1. Contract first, by Oct 9: schemas, client functions and mock fixtures for Begin Online, intake, leads and messages (Arfan N07c and F08, Nahid N06 and N09, Fahad F10)
- [ ] 2. Intake form definitions per firm and service (six Begin Online services plus the portal intake), versioned
- [ ] 3. Begin Online public endpoints on the portal site: start a draft, save a step, email a resume link through R6's NotifyService, logged until R6 merges (token in the URL fragment, only its hash stored, expires), uploads for a draft (with R5's storage), submit; rate limited; no account is created; a submission creates a pending lead and engagement
- [ ] 4. Leads: list, review with the intake answers, convert to client (creates the client and engagement and sends a portal invite through R3), decline with a reason
- [ ] 5. Portal intake form tab: the client fills the same definitions, autosave, lock on submit, Needs Correction
- [ ] 6. Messages: threads per client with a subject, messages, read receipts, unread counts; firm internal notes (firm only); the client's private notes with an optional reminder (never visible to the firm); an email notice without content through R6
- [ ] 7. Audit and e2e, including isolation, plus Begin Online abuse tests (rate limit, size limits)

## Done when

Arfan's Begin Online and leads screens and Nahid's intake and messages tabs work on dev.

## Rules

- Contract first for every module (step 1). Never edit screens: in apps/web change only `src/mocks/<module>.ts` and your lines in `src/lib/api.ts`.

## Needs from others

- R0 (this session holds the lock; next R0 migration): `documents.intake_id` and `documents.intake_slot` (both set or both null; detaching clears both); `intakes.correction_note` and `correction_requested_at` (set together, required while NEEDS_CORRECTION); `intake_submissions.saved_steps` (text[], default empty); `leads.tax_year` (2000-2100, fixed at the draft's start); one Begin Online service per kind per firm (for example `services.begin_online` with a partial unique index on business and kind); a draft's 90-day cap (`resume_expires_at <= created_at + 90 days`), and an expiry for a draft before any resume link is sent (`leads.draft_expires_at`, or relax the expiry and token-hash pairing).
- `packages/types/src/client.ts` (shared): `createRequest` drops `error.details`, so screens rerun `checkIntakeAnswers` to place submit issues. Keep `details` on `ApiRequestError`.
- Rasel: `apps/web` has no unit-test runner, so the mocks check their own fixtures when first used instead of in a test. Adding vitest to `apps/web` changes its package.json and the lockfile: your call.
- Rasel and Octavia, half A's open questions:
  1. A typed full name as the signature, or the mockups' drawn one too?
  2. Do the bookkeeping required documents block submit, or is "provide later" allowed? Today: required, with "I don't have this" plus a reason.
  3. Which duplicate questions go: the Quarterly quarters asked twice, prior-year filing asked twice, "How did you hear" on Business Development steps 1 and 3, Payroll start date and current provider?
  4. Which tax year does Annual Tax ask about (today the current year, as in the mockups), and may late filers pick one?
  5. The intake tab's seven cards: Business Tax opens Annual or Quarterly; "Other Tax Services" has no form. Right?
  6. Should uploads carry a quarter and a document type, as the Quarterly review page shows?
  7. Please confirm or replace the proposed dropdown lists: payroll frequency, system, funding and role; Tax Planning industry, headcount and years; Business Development timeframe; "How did you hear"; the dependent relationships.
  8. Should Business Development and Tax Planning ask for a confirmation email apart from the contact email, as drawn?
  9. Should starting a draft need a CAPTCHA besides the rate limits?
- Octavia's firm agreements (three acknowledgments, signature, version pinned by id and SHA-256): a small follow-up after half A; nothing in half A blocks it.

## Progress log

(newest last: date, step, what changed, commit)
- Oct 8, step 1, half A, first of three contract PRs (Rasel: three; branch `rasel/R11-intake-engine`): the intake form engine in `packages/types/src/intake`. Versioned definitions with steps, sections and fields (text, numbers, currency in cents, dates and months 1900-2100, SSN and EIN, choices, grids up to 50 by 10, groups up to 31 keys a row, upload slots, `showIf` on earlier fields only, the review step last). `checkIntakeAnswers(definition, answers, { mode })`: on save, types, limits and the shared text rule only; on submit, also every shown required field, dropping the answers of hidden fields. Answers are counted before parsing (500 keys at most), `__proto__`, `constructor` and `prototype` are refused, URLs are normalized and refuse a user name or password. SSN and EIN answers come back only as `{last4}`, which must match the stored number at the same key (or group row id). `INTAKE_FORMS` holds Annual Tax for now (`Partial`, so the third PR adds the others without changing callers). Built by an agent, reviewed by a second one; its must-fix and should-fix findings are in. Next: B (the Begin Online and intake clients and the mocks), then C (the other five forms).
