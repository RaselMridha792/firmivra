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

(none yet)

## Progress log

(newest last: date, step, what changed, commit)
