# R60: Intake Forms, Octavia's review of Oct 20 (section A)

Read first: `CLAUDE.md`, `docs/work/README.md`, `docs/work/R60-settings.md` (the R60 rules), and
`docs/specs/review-2026-10-21/CHANGE-LIST.md` section A with its guide
`docs/specs/review-2026-10-21/intake-forms--developer-instructions-reviewed.md` (items 8 to 24).
Her screenshots: `docs/mockups/firm-workspace/review-2026-10-21/intake-forms/`.

Rasel (Oct 21): P1 items I1 to I6 first, then I7 to I12; reproduce each on dev or main first; one PR
at a time, design-match items ticked. Team invites and the Begin Online fixes continue after the P1
items. I10 (50 and 100 MB) rides on R1's multipart work: coordinate here, no second upload path.

Owned paths: `apps/web/src/app/firm/(workspace)/intake-forms/`, `apps/web/src/mocks/intake-forms.ts`,
`apps/api/src/intake-workspace/`, their tests (`apps/api/test/e2e/intake-workspace.e2e.test.ts`,
`apps/web/e2e/mock/*intake*`), and this file.

## Handoff (Oct 23): start here

R60's context was full; Rasel starts a fresh R60 from this section. Read `CLAUDE.md`,
`docs/work/README.md`, `docs/work/R60-settings.md` (the R60 rules and its own remaining items) and
this file.

### State (Oct 23, second session): open PRs and branches waiting

#1028, #1031, #1033 and #1034 merged on Oct 23. Open, in merge order (each had CI green):

| PR | Branch | What |
| --- | --- | --- |
| #1038 | `rasel/R60-intake-link-contract` | I3 link, contract: `beginOnlinePageUrl`, the route's doc, `publicLink(id)`, the mock (contract, not counted) |
| #1039 | `rasel/R60-intake-link-api` | I3 link, API: `GET /business/intake-forms/{id}/public-link`, e2e and the isolation case (stacked on #1038) |
| #1045 | `rasel/R60-intake-link-web` | I3 link, screen: Form Link after Publish, More menu and card menu; a published form's edits stay on it; Publish takes stored grids and State lists (stacked on #1039) |
| #1047 | `rasel/R60-settings-checks` | Docs: the Settings confirm checks (`R60-settings-checks.md`), item 4's questions, this handoff (docs, not counted) |

Pushed, no PR yet (two non-contract PRs are open). Open each when a slot frees, after merging
`origin/main` into it:

| Branch | What | Before its PR |
| --- | --- | --- |
| `rasel/R60-intake-settings-p2` | I8 (days, "after sending", the final after the first, No reminders saved as off), I9 (1 to 72 hours, 42 not 48), I11 (Always on). API and web | Body ready in the old scratchpad (`pr-settings-p2.md`); sheet committed |
| `rasel/R60-staff-drafts` | SM5: Drafts in the directory's status filter (Continue, Delete); a chosen file stays after Back; the saved note says pay and files are not in a draft | Shoot its sheet on the real API (directory Drafts with data, empty, unreachable; 375 px), then write the body |

Mock specs pass on each: `r60-intake-link` 2, `tumit-intake-builder` and `tumit-intake-templates`;
`r60-intake-settings` 11; `r60-staff-drafts` 2 and the `tumit-team*` specs 12.

### Next, in this order

1. **(In PR: #1038, #1039, #1045.) I3, the rest: link and embed code.** Rasel decided (Oct 22): only each service's main form
   (its default template, `service_default`, of a Begin Online service of the six kinds) gets a
   public link and embed code, pointing to its existing page `{PORTAL_BASE_URL}/{slug}/begin/{path}`
   (paths: annual-tax, quarterly-tax, bookkeeping, payroll, tax-planning, business-development;
   `formOfPath` in `apps/api/src/begin-online/`). No new public page for other templates. Show it with
   R56's `PublicLinkBlock` (#1020: `packages/types/src/public-links/schemas.ts`, `publicEmbedCode`,
   and `apps/web/src/components/public-link.tsx` if R56 added it). Contract first (a
   `GET /business/intake-forms/{id}/public-link` answering `PublicLink`, 404 for a form that is not
   a main form), then API and screen (after Publish in the builder, and on the main form's card).
   `state`: LIVE when published and the service is active and on Begin Online; else DRAFT,
   INACTIVE, ARCHIVED or HIDDEN. Check whether the Begin Online pages honour `?embed=1` (the
   block's iframe adds it); if not, say so in the PR and in Needs (R17's portal layout).
2. **(Built: `rasel/R60-intake-settings-p2`, with an "I7 to I12" table in its copy of this file.) Intake Forms I7 to I12** (CHANGE-LIST section A). Check main first:
   - I7 Notify additional emails (Notifications & Reminders), editable and saved: needs a column?
     (`intake_settings` has none today: a written item to R0/R1, not built).
   - I8 First and Final reminder options in minutes and hours too: the columns are whole days
     (`first_reminder_days`): a schema item; label "after sending".
   - I9 Expiration alert: add 30 minutes, 1, 2, 3, 5, 6, 10 hours; keep 72, 42, 24, 12.
   - I10 50 and 100 MB: built by R1 (#1025); verify only.
   - I11 Encryption: a read-only "Encrypted file uploads: Always on" label instead of the switch.
   - I12 Data retention period (custom years): a column item; selecting it deletes nothing.
   - I13 live tests: record Pass, Fail or Blocked with evidence in a PR.
   Her open decisions stay open (Submitted vs Completed, due date vs expiration, staff Edit vs
   Request Revision, import file types, auto-create client trigger): list them, do not guess.
3. **(In PR: #1047.) Settings Confirm Checks** (`docs/specs/review-2026-10-21/settings--confirm-checks-supplement.md`,
   CHANGE-LIST section E): verification, not features. For each check R60 owns (Overview, ownership
   transfer and branding with R56, Security and Data with R1, Preferences consistency) return Built,
   Partially built or Not built, the page, the test result, the evidence and what remains. The
   tab-to-page mapping (check 10) is one table in that PR.
4. **(Waiting for Rasel: the plan and questions are under Needs.) Settings areas:** Company Profile "Request Change", Notifications, Billing and Payments.
5. **(SM5 built: `rasel/R60-staff-drafts`. SM3 is blocked: see Needs.) Staff Management screens** from Octavia's new review
   (`docs/specs/review-2026-10-23/CHANGE-LIST.md`, section B): SM3 (wrong routes: Offices & Job
   Titles, New Accounts & Security), SM5 (drafts not found; the file lost after Back), SM8 (work
   schedules, maximum workload), SM9 (summary cards and one directory view), SM10 (date, time and
   timezone in the shared header), SM11 (saved job titles; Custom Role shortcut), SM12 (Drafts view
   and status; per-file Save), SM13 (Manage Members on a department).
6. Then R60-settings.md's own items (Begin Online fixes, item 5, with the two failing r22 specs
   below; Data & Backups; the others there).

### How R60 worked (keep doing it)

- Reproduce on local `main` first; write what was found into this file.
- One PR per slice, P1 first; the PR body like #1028 (What and why, the sheet, Design match
  ticked, How to test, Checklist). No attribution lines in commits or PR bodies (CLAUDE.md).
- Screenshot sheets: helpers are in the old session's scratchpad
  (`C:/Users/RASEL/AppData/Local/Temp/claude/f--firmivra-R60/ffc9f91f-04c1-4396-a3d5-c0f47af0b17e/scratchpad/`:
  `shots-intake.cjs`, `shots-send.cjs`, `shots-builder.cjs`, `shots-settings-intake.cjs`,
  `compose.cjs`, `spec-*.json`, and the PR bodies `pr-*.md`). Sheets go under
  `apps/web/e2e/screenshots/r60-*/`, linked by blob URL pinned to the commit with `?raw=true`.
- Local quirks: after merging `main`, run `pnpm install`, build `@firmivra/types` (and
  `@firmivra/ui`), and `pnpm --filter @firmivra/db generate` before typechecking (stale builds give
  false errors). The Docker services can stop: `docker start firmivra-postgres-1 firmivra-s3-1
  firmivra-mailpit-1`. In Git Bash set `MSYS_NO_PATHCONV=1` when passing `/paths` to node scripts.
  The machine is slow: run test suites and dev servers in the background and wait for them.
  Stop dev servers by port (3600, 4600) and delete `apps/web/.next` afterwards.
- Mock data: the intake mock now answers Send as the API does; its triggers are "noservice" (409
  `NO_ENGAGEMENT`) and "undelivered" (delivery FAILED) in the subject.

## Items

| # | Item | State |
| --- | --- | --- |
| I1 | Template library shows every form | Merged (#1019) |
| I2 | Send to client fails | #1028 open (web only) |
| I3 | Publish validation, link and embed code | Validation: #1031 open. Link and embed code: next (handoff item 1) |
| I4 | Settings Edit links | #1033 open (with I5, I6) |
| I5 | Submission Rules shortcut | #1033 open |
| I6 | Test Reminder Email | #1033 open (a real test email; locally in Mailpit) |
| I7 to I12 | Settings additions | Next (handoff item 2); I10 was built by R1 in #1025 |
| I13 | Live tests | After I1 to I6 |

## What was reproduced (local `main`, Oct 21, LVP's Owner)

- **I1.** The summary said 7 templates and "Personal Tax 2", but the library showed 6 cards: the
  list asked for `templates=true` (each service's default only) while the summary counted every
  template (`templates=all`). A duplicate or a new template for a service that already has a
  default is saved with `service_default = false`, so it was counted and never shown (her item 18,
  "the copy stayed absent after refresh"). A firm has a template only for services where a form was
  once stored (Begin Online's first start, the seed, or the builder), so dev's LVP showed two.
  Also found: Create Template from "All Templates" (or a category with no service) answered 400
  "Choose the service this form is for", shown as "Check the highlighted fields" with nothing
  highlighted.
- **I2.** A new client made for the test has no service: Send answers 409 `NO_ENGAGEMENT`, which
  the screen has no words for, so it shows "Something went wrong. Try again in a moment." (her
  exact words). The screen also maps `FORM_PUBLISHED`, but the API sends `FORM_NOT_PUBLISHED`. A
  new contact answers 503 `LEAD_LINK_UNAVAILABLE` (no secure link page for non-portal recipients).
  Delivery by email goes through the Notifier's `intake.sent` to the client's portal login: a
  client with no login gets nothing (to check in the I2 fix: the result's failed-send state).
- **I4.** Every card is already editable in place; Edit only selects the category and focuses its
  first field, so nothing visibly opens. Security & Compliance's Edit finds no field and keeps
  focus on itself. Branding's Edit is a link to Settings > Branding (works).
- **I5.** The Submission Rules category shows a note and one button, "Go to General Settings".
- **I6.** `POST /business/intake-settings/test-reminder` always answers 503
  `TEST_REMINDER_UNAVAILABLE`. There is no intake reminder job and no intake email template yet
  (the reminder jobs are appointments and client notes).

## I1: the fix

- API (`intake-library.service.ts`): before the library reads, every live service of the six kinds
  that never had a template gets the built-in form as its published version 1, made by Firmivra
  (as Begin Online's first start). The database trigger makes the default template under a
  per-service lock, and a parallel request inserts nothing. A service whose templates were
  archived keeps them archived. No schema change.
- Web: Form Templates and the Intake Forms dashboard list every template the firm keeps
  (`templates=all`), so the cards, the numbers and the categories count the same rows. A draft
  shows "Draft", and Use Template waits for it to be published. Create Template asks for the
  service. A built-in form whose category has no form says so, with a link to Services & Pricing.

## Needs from others

- **R1 (I10):** done in #1025 (2, 5, 10, 50 or 100 MB, enforced in uploads). R60 verifies only.
- **R56 (I3):** done in #1020 (`PublicLink`, `PublicLinkBlock`); R60 builds I3's link next.
- **Secure link page (I2):** a form for a lead or a new contact needs the secure link page
  (`LEAD_LINK_UNAVAILABLE` today). Owner to be named by Rasel.
- **Intake reminders (R6 or Rasel to name):** there is no intake reminder job and no intake
  reminder email template. The test reminder (#1033) uses the firm's message email
  (`lead.message-email`), which joins paragraphs; the job and a template of its own come together.
- **Settings areas (handoff item 4): plan, waiting for Rasel's answers.** From
  `docs/specs/settings-review-2026-10-20/CHANGE-LIST.md` P3 and her Company Profile guide:
  1. *Request Change* (legal name, EIN, licensing; never edited directly). Proposal: the modal
     raises a Super Admin support ticket (the database already lets a firm raise one:
     `support_tickets_firm_raise`, source PORTAL), with the current and proposed values and the
     reason; the card shows its status from the ticket. Needs a "Company details" category (R0
     seed) and a firm route (R60). There are no licensing columns: a written item (R0). Go?
  2. *Company Profile layout:* her guide shows logo, colours, theme and login as summaries with
     "Go to Branding"; today their editors sit on /settings/profile. Moving them changes the
     Branding page (R28 and R56's). Who moves them?
  3. *Copyable links:* the portal, each main intake form (#1039's link), appointment types (A4)
     and packages (S12) once R56 builds those two.
  4. *Notifications:* employee email always on, enforced on the server, with existing Off
     settings migrated to On (an R0 data migration); SMS only after a verified mobile number.
  5. *Billing and Payments:* Upgrade, Downgrade, plan and usage details, payment methods,
     invoices with PDF, the downgrade guard; Payments' Manage Connection, readiness, Square and
     PayPal cards, payout settings. Large and Stripe-bound: which session?
- **Staff Management SM3 is blocked (handoff item 5):** each wrong route needs a destination that
  does not exist. Offices & Job Titles needs R1's Locations API and a saved job-titles table (R0;
  job titles live on each staff record today). New Accounts & Security needs a firm-wide staff
  security policy, which nothing stores (R0). The Reports shortcut needs a Staff and Team report
  in Reports (its owner to name). Until then the cards stay as they are.
- **SM5, two questions for Rasel:** she asks to "clarify or correct" that pay is not kept in a
  staff draft (R55 left it out on purpose: keep it out with the clear note `rasel/R60-staff-drafts`
  adds, or store it encrypted?); per-file Save of a draft's attachments needs storage for draft
  files (API, maybe R0). The chosen files now stay only while the tab is open.
- **Sign Out All Sessions ends no real session** (Settings checks, check 6): it marks
  `staff_sessions` rows that sign-in never writes. Users & Roles is R55's: a Cognito global sign-out,
  as Reset MFA does.
- **Decisions she left open (do not guess):** Submitted vs Completed, due date vs expiration, staff
  Edit vs Request Revision, import template file types, the auto-create client trigger.
- **Begin Online (seen, not changed):** `newestForm` picks the highest version number of any
  published form of the service, across templates, so a published duplicate with a higher version
  number than the default would serve Begin Online. It should read the service default's live
  version.

## Checks that fail on clean `main` too (not R60's changes)

- `apps/api/test/isolation/tenant-isolation.test.ts`, locally: 4 of 19 fail on clean `main` as on
  the I1 branch. The two refusal sweeps time out at 30 s; the controls list file and export routes
  (409 `FILE_BLOCKED` from the local scanner, 200 with s3mock links). CI is the judge.
- `apps/web/e2e/mock/r22-intake-forms.spec.ts:174` ("the success pages"): two "Schedule an
  Appointment" links (the portal header's and the page's). The same cause as the Begin Online
  audit's `r22-begin-online.spec.ts:28`; fixed with the Begin Online work (R60-settings item 5).

## Progress log

- Oct 21: P1 items reproduced on local `main` (above). I1 built.
- Oct 22: I1 merged `main`; web and API typecheck 0 errors; PR opened. I2 built on its branch.
- Oct 22: #1019 (I1) merged. I2, I3 (validation) and I4 to I6 built, with sheets.
- Oct 23: #1028 (I2), #1031 (I3) and #1033 (I4 to I6) opened, each after the one before had CI
  green. Handoff written (above).
- Oct 23: Settings confirm checks (handoff item 3) answered in `docs/work/R60-settings-checks.md`:
  checks 1, 3, 4, 5, 6, 7, 10 (the tab-to-page table) and 11, each with status, page, test result
  and what remains. Most urgent: Sign Out All Sessions ends no real session (check 6).
