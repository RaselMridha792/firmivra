# R11: Intake, Begin Online, leads and messages API (Oct 9-12)

**Goal:** A visitor submits a Begin Online form, the firm reviews the lead and converts it to a client; clients fill intake forms in the portal; the firm and the client exchange messages, and each keeps private notes. Former developer tickets I06, I07 and I09 (Arfan), moved here on Oct 6.

**Handover:** When contract B merges, R11 passes to R15 (Rasel's Oct 18 plan): its file, types, mocks and API.

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
- Oct 8, #127 review (cloud Scrum thread; Rasel's decision 3 of Oct 8: intake agreements are per firm and versioned): `IntakeFormDefinition` no longer has `agreement`, and `IntakeAgreement` is gone; Annual Tax drops its own Service Agreement section and `agreeToTerms` box. The agreement, its acknowledgments and the signature come from the firm's agreements (R14's `api.publicAgreements(slug)`); contract B's submit bodies take R14's `IntakeSignatureInput`. A definitions test checks that no form carries an agreement of its own.
- Oct 8, #127 full review (cloud Scrum thread), two more: married filers must give the spouse's first and last name, SSN and date of birth (required inside the married-only section; the spouse's ID and card uploads wait for Octavia). `intakeUploadCounts` takes the database's scan status and counts an allow-list only (`COUNTED_UPLOAD_STATUSES`: CLEAN and PENDING), so an INFECTED or FAILED file never answers a required slot. For contract B: responses that carry answers refuse a full SSN or EIN (`intakeNumbersMasked`), and the review's nits (a required checkbox and `minItems` inside group rows, `hiddenSlotUploads` for shown upload fields only, a total field cap and bounded labels).
- Oct 9, step 1, contract B (branch `rasel/R11-contract-b`, rebuilt on main's A): `api.myIntakes(slug)` and `api.beginOnline(slug)` with their schemas, mocks and registration lines. No draft, form or intake carries agreement text (the review step reads R14's `api.publicAgreements(slug)`). Both submits share `SubmitIntakeRequest`; its `signature: IntakeSignatureInput` waits for R14's contract on main (a comment marks the place; neither main nor #155 has it yet, #155 has only `SignatureCaptureInput`). New codes NO_INTAKE_AGREEMENT, AGREEMENT_OUTDATED (`details`: `IntakeAgreementOutdatedDetails`, loose until R14), ACKNOWLEDGMENT_REQUIRED, SIGNATURE_MISMATCH, PDF_REQUIRED and Begin Online's TERMS_OUTDATED, each with a mock trigger word. `MyIntake` and `BeginDraft` refuse a full SSN or EIN (`refuseFullNumbers`); the mocks count files by the database scan status (`INTAKE_UPLOAD_STATUS`); R0's r0_intake_engine rules are in the comments. #127's nits in A: a required checkbox and `minItems` in group rows, `hiddenSlotUploads` keeps only shown upload fields, `INTAKE_LIMITS.maxFields` 200 and bounded strings (labels 300, help and texts 500, option labels 200; the six forms' longest are 246, 285 and 66, and Bookkeeping has 102 fields).
- Oct 9, contract B handed to R15 (Rasel, Oct 9): R15 takes this branch (`rasel/R11-contract-b`, from ad82dd6). Still to do, for R15:
  - Add `signature: IntakeSignatureInput` (R14's agreements contract) to both submit bodies once it is on main (the placeholder line marks the spot); then swap the mocks' trigger words for real signature checks, and use R14's types for `IntakeAgreementOutdatedDetails` and `MyIntake.signature`.
  - Add 503 `ENCRYPTION_UNAVAILABLE` to the Begin Online and portal intake error codes and mocks (R15's #198 returns it when the firm key can't be used).
  - The review of c0e0cd1 (two lenses) found 9 items. ad82dd6 changed code for most of them, but nobody has re-checked it, so verify each:
    1. SHOULD `intake/schemas.ts` `refuseFullNumbers` checked only the places the definition types as ssn/ein: a full number under an unknown key, a group value that isn't an array of rows, or a row key that isn't one of the group's fields got through. Fix: refuse those three shapes; tests for each.
    2. SHOULD mocks: file limits were checked only when the upload ticket was issued, so parallel uploads could pass a slot's `maxFiles` and the 50-file limit (then MyIntake, BeginDraft and IntakeUploadList fail to parse). Fix: check again at confirm (409 TOO_MANY_FILES), and say so in both confirmUpload docs for the API.
    3. SHOULD `begin-online` mock `forms()` returned services in IntakeFormKey order instead of the page order (`BEGIN_ONLINE_SERVICES`).
    4. SHOULD (process) two contract Bs existed (`rasel/R15-contract-b` and this branch); R15's API branches must build on the one that merges.
    5. NIT both mocks threw away the cleaned answers of a submit check, so hidden questions' answers stayed stored after submit. Store the cleaned answers; say in `SubmitIntakeRequest` that the locked version holds only shown fields' answers.
    6. NIT bounds without a failing test: maxOptions (100), 30 bullets or examples, and the lengths of placeholder, subtitle, badge, selectAll and grid labels.
    7. NIT the start prefill joined first and last name into `fullName` (up to 201 characters against the field's 200): leave it out when too long.
    8. NIT `TERMS_OUTDATED` had no input: say the accepted Terms and Privacy travel with R14's signature (`intake_signatures.terms_document_id` and `privacy_document_id`), Begin Online only.
    9. NIT `IntakeCondition.equals` took any string, and `oneOf` and `includesAny` had no length limit.
  - Not this branch's: `ApiRequestError` drops `error.details` (`packages/types/src/client.ts`), so screens can't read `VALIDATION_FAILED` issues or `AGREEMENT_OUTDATED`'s agreements.
