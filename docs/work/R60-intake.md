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

### Oct 24 (third session): Rasel's order, start here

#1054 and #1056 merged. Rasel's order (Oct 24), one PR each, at most two open: (1) Company
Profile Request Change, (2) Notifications settings, (3) Billing, (4) Payments, (5) Staff SM8 to
SM13. His defaults: Request Change goes to Super Admin through the existing support-request flow;
the branding editors stay on Company Profile; pay is not kept in a staff draft. Waiting for his
word, not built: ownership transfer, Sign Out All Sessions (questions 1 and 2 below). Columns go
to "Column request for R1" (I7, I8, I9, I12 and SM3 are approved). No `packages/db`, `infra`,
`.github`, auth guards or AWS work.

| # | Branch | State |
| --- | --- | --- |
| 1 | `rasel/R60-profile-request-change` | #1063 (open): `api.profileChanges` (contract, API, e2e), the two locked cards and the dialog, the EIN locked on the server once Active. Notes below ("Request Change") |
| 2 | `rasel/R60-notifications-email` (stacked on #1063) | #1065 (open): staff email always on (`emailLocked`, 400 `EMAIL_ALWAYS_ON`, the sender sends anyway, older Off rows read as on); staff SMS only with a verified mobile number, which no staff login records, so email only for now. Notes below ("Notifications") |
| 3 | `rasel/R60-billing` (stacked on #1065, local until a PR slot frees) | Built: `api.firmBilling` (overview, invoices, invoice, PDF, requests), the Billing page on her design with the plan, usage, details and invoice dialogs; plan and contact changes as support requests. Notes below ("Billing") |
| 4 | `rasel/R60-payments` (stacked on billing, local) | Built: the Payments page on her design (web only); Stripe keeps every existing state; Manage Connection, Manage Bank Account and Check Eligibility open the firm's own Stripe Dashboard. Notes below ("Payments") |
| 5 | `rasel/R60-staff-sm8-13` (from `main`, independent; local until a slot frees) | Built: SM9 cards and `/team/directory`, SM13 department Manage Members (`GET`/`PUT /business/departments/{id}/members`), SM11 custom roles in Create Staff and the Create Custom Role shortcut with Back, SM8 custom schedules and the workload unit, SM10 the header clock. Notes below ("Staff") |

Open: #1063 and #1065, CI green (Oct 24, 04:10 UTC). Waiting for a slot, in this order: Billing
(stacked on #1065), Payments (stacked on Billing; carries this file), Staff (from `main`). Their PR
bodies are ready in the third session's scratchpad:
`C:/Users/RASEL/AppData/Local/Temp/claude/f--firmivra-R60/fd07679c-e53b-4b16-8968-b670b5107292/scratchpad/`
(`pr-billing.md`, `pr-payments.md`, `pr-staff.md`; replace SHEET with the sheet's blob link
pinned to the branch head). Shot helpers there: `shots-profile.cjs`, `shots-notifications.cjs`,
`shots-billing.cjs`, `shots-payments.cjs`, `shots-staff.cjs`, `compose.cjs`, `spec-*.json`.

### State (Oct 23, second session): open PRs and branches waiting

#1028, #1031, #1033 and #1034 merged on Oct 23; #1038, #1039, #1045 and #1047 merged on Oct 23
(evening). Earlier, in merge order:

| PR | Branch | What |
| --- | --- | --- |
| #1038 | `rasel/R60-intake-link-contract` | I3 link, contract: `beginOnlinePageUrl`, the route's doc, `publicLink(id)`, the mock (contract, not counted) |
| #1039 | `rasel/R60-intake-link-api` | I3 link, API: `GET /business/intake-forms/{id}/public-link`, e2e and the isolation case (stacked on #1038) |
| #1045 | `rasel/R60-intake-link-web` | I3 link, screen: Form Link after Publish, More menu and card menu; a published form's edits stay on it; Publish takes stored grids and State lists (stacked on #1039) |
| #1047 | `rasel/R60-settings-checks` | Docs: the Settings confirm checks (`R60-settings-checks.md`), item 4's questions, this handoff (docs, not counted) |
| #1028 | `rasel/R60-intake-send` | I2: Send says why a send can't reach someone, and where to fix it (merged Oct 23) |
| #1031 | `rasel/R60-intake-publish` | I3 (validation): Publish names each problem and goes to it (merged Oct 23) |
| #1033 | `rasel/R60-intake-settings-p1` | I4 to I6: Edit panels, Submission Rules panel, a real test reminder (merged Oct 23) |

Opened on Oct 24, one at a time: `rasel/R60-intake-settings-p2` as #1054 (merged) and
`rasel/R60-staff-drafts` as #1056. Their notes, kept for the record:

| Branch | What | Before its PR |
| --- | --- | --- |
| `rasel/R60-intake-settings-p2` | I8 (days, "after sending", the final after the first, No reminders saved as off), I9 (1 to 72 hours, 42 not 48), I11 (Always on). API and web | Body ready in the second session's scratchpad (`pr-settings-p2.md`, path below); sheet committed |
| `rasel/R60-staff-drafts` | SM5: Drafts in the directory's status filter (Continue, Delete); a chosen file stays after Back; the saved note says pay and files are not in a draft | Shoot its sheet on the real API (directory Drafts with data, empty, unreachable; 375 px), then write the body |

The second session's scratchpad: `C:/Users/RASEL/AppData/Local/Temp/claude/f--firmivra-R60/ce1f72c0-0ecd-4c6c-8bc9-104d6f2a219d/scratchpad/`
(`shots-link.cjs`, `shots-settings2.cjs`, `compose.cjs`, `spec-*.json`, the PR bodies `pr-*.md`).

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
4. **(Rasel's defaults, Oct 24, under Needs: Request Change through the support-request flow,
   then Notifications, then Billing and Payments.) Settings areas:** Company Profile "Request Change", Notifications, Billing and Payments.
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
| I2 | Send to client fails | Merged (#1028, web only) |
| I3 | Publish validation, link and embed code | Merged: validation (#1031); the main form's link and embed code (#1038, #1039, #1045). The embed code needs R1, R15 and R17 (Needs) |
| I4 | Settings Edit links | Merged (#1033, with I5, I6) |
| I5 | Submission Rules shortcut | Merged (#1033) |
| I6 | Test Reminder Email | Merged (#1033; a real test email; locally in Mailpit) |
| I7 to I12 | Settings additions | I8 (days, wording, order), I9 (hours), I11 and No reminders: `rasel/R60-intake-settings-p2`; I10 verified (R1); I7, I8 minutes and hours, I9 30 minutes and I12 need columns (above) |
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

## I7 to I12 (checked on `main`, Oct 23)

| # | On `main` | This slice (`rasel/R60-intake-settings-p2`) | Needs a column (written item) |
| --- | --- | --- | --- |
| I7 Notify additional emails | Not there; `intake_settings` has no column | Nothing | A list of extra recipient emails (R0), and the notifier to send to them (R6) |
| I8 First and Final reminder | Days only (first 1 to 14, final 3 to 30); "No reminder" saved 3 or 7 days anyway (the API mapped null to the default) | Both lists 1, 2, 3, 5, 7, 10, 14, 21, 30 days, "after sending"; the final only after the first (the database's `final > first`; the API took equal days, then failed at the database); "No reminders" saves `reminders_enabled` off (each new send's default) and reads back as none | Her 5, 10, 15, 30 minutes and 1, 2, 3, 6, 12 hours: `first_reminder_days` and `final_reminder_days` are whole days. A first reminder without a final one has no column either |
| I9 Expiration alert | 12, 24, 48, 72 hours; "No alert" saved 24 | 1, 2, 3, 5, 6, 10, 12, 24, 42, 72 hours before expiry (42, not 48; a saved 48 still shows); no "No alert" (the API refuses null) | 30 minutes (`expiry_alert_hours` is whole hours), and "no alert" (not null) |
| I10 50 and 100 MB | Built by R1 (#1025, #1037): every Begin Online and portal upload checks the firm's size at the ticket (`intake/intake-file-size.ts`); `begin-online.e2e.test.ts` proves 50 MB (49 in, 51 refused), a saved 25 MB, multipart over 16 MB | Verified only | None |
| I11 Encryption | A switch locked on | The read-only "Encrypted file uploads: Always on" | None (encryption itself is the S3 and KMS walls) |
| I12 Data retention period | Not there | Nothing | A years column (R0); the start event, what it covers and what happens at the end are for Rasel and Octavia first. Choosing a period deletes nothing |

None of the reminders or the alert is sent yet: there is no intake reminder job (Needs, below).

## Needs from others

- **R1 (columns for I7, I8, I9, I12 and SM3):** approved by Rasel on Oct 24; the exact request is
  "Column request for R1" below. Nothing is built on them until they land.
- **R1 (I10):** done in #1025 (2, 5, 10, 50 or 100 MB, enforced in uploads). R60 verifies only.
- **R56 (I3):** done in #1020 (`PublicLink`, `PublicLinkBlock`); R60 builds I3's link next.
- **Secure link page (I2):** a form for a lead or a new contact needs the secure link page
  (`LEAD_LINK_UNAVAILABLE` today). Owner to be named by Rasel.
- **Intake reminders (R6 or Rasel to name):** there is no intake reminder job and no intake
  reminder email template. The test reminder (#1033) uses the firm's message email
  (`lead.message-email`), which joins paragraphs; the job and a template of its own come together.
- **Settings areas (handoff item 4): Rasel's defaults (Oct 24, Scrum thread), until he says
  otherwise.** From `docs/specs/settings-review-2026-10-20/CHANGE-LIST.md` P3 and her Company
  Profile guide:
  1. *Request Change* (legal name, EIN, licensing; never edited directly) raises a support
     request to Super Admin through the existing support-request flow (`support_tickets`, which a
     firm may raise: `support_tickets_firm_raise`, source PORTAL), with the current and proposed
     values and the reason; the card shows its status. There are no licensing columns yet.
  2. *Company Profile layout:* the branding editors stay on Company Profile for now.
  3. *Copyable links:* the portal, each main intake form (#1039's link), appointment types (A4)
     and packages (S12) once R56 builds those two.
  4. *Notifications* next: employee email always on, enforced on the server, existing Off settings
     migrated to On; SMS only after a verified mobile number.
  5. *Billing and Payments* after Notifications, by R60.
- **Request Change (built, `rasel/R60-profile-request-change`): what it cannot do yet.**
  1. *Applying an approved request:* Super Admin has no way to change a firm's legal name, EIN or
     licensing details after activation (question 3 below). The team resolves the ticket and
     nothing changes.
  2. *Licensing details:* no columns, so the card's five rows say "Not on file" and a request's
     "Current" says the same (Column request for R1, item 7).
  3. *History and SLA (R0's policies):* a firm-raised ticket gets no Activity entry and no
     response due time, because the firm's scope can neither write `support_ticket_events` nor
     read `support_settings` and `support_holidays`. It shows in the queue, unassigned. A
     SECURITY DEFINER function that stamps both on a firm insert, or the SLA job filling a
     missing due time, would fix it.
  4. *Conversation:* the firm sees only Firmivra's latest sent reply on the card; there is no firm
     Support page to read the thread or answer ("Waiting on You" has no answer path). Owner to be
     named by Rasel.
  5. *Supporting document (guide E4, optional):* not built; the firm side has no support upload
     route (`support_ticket_attachments_firm_add` exists in the database).
- **Notifications (built, `rasel/R60-notifications-email`): what it cannot do yet.**
  1. *Staff SMS is off until a verified mobile number exists* (Rasel's default, Oct 24). Staff
     logins have no verified marker (only `client_accounts.phone_verified_at`), so staff are
     offered email only and the sender sends them no text. Before Oct 24 any staff number turned
     the SMS switches on (q27). Octavia's SMS tests (her checks 02 and 04) wait on item 9 of the
     column request and a verification flow (a code by SMS: R6's sender, SNS in AWS, so R1).
     If Rasel prefers q27 until then, it is two lines (`smsOffered` and `allows`).
  2. *Older Off rows:* the API reads a staff row stored with email off as on and the sender sends
     anyway; item 8 of the column request flips the stored rows so the table says the same.
  3. *SMS opt-out (STOP):* no inbound SMS handler exists (an SNS topic and a route: R1 and R6).
  4. *Delivery records:* `notification_deliveries` already keeps each email and SMS outcome
     (QUEUED, SENT, FAILED, SKIPPED, the provider's id); no screen shows them yet.
  5. *Portal:* the client portal keeps its own preferences (email may be switched off there);
     her guide leaves the portal to its own review.
- **Billing (built, `rasel/R60-billing`): what it cannot do yet.**
  1. *Self-serve plan changes:* the firm's scope reads its subscription but writes none of the
     platform's billing rows (R0's policies), and there is no provider quote or payment for
     Firmivra's own subscription. So Upgrade and Downgrade go through her catalog and Review
     (with the blockers and an estimate at today's usage) and send a request to the Super Admin
     team, who apply it in Subscriptions (question 4).
  2. *Payment methods:* no card or account is stored for Firmivra's subscription (no Stripe
     customer for platform billing). The card shows the latest recorded payment and no
     Add, Update, Set as Default or Remove buttons, rather than dead ones (question 4).
  3. *Storage and "Monthly usage":* the plans measure staff seats and locations only, so those
     two show; her design's storage and monthly rows have no measure behind them.
  4. *Billing address:* the billing profile keeps a contact, not an address; the card shows the
     company address from Company Profile.
- **Payments (built, `rasel/R60-payments`, web only): what it cannot do yet.**
  1. *Square and PayPal:* no Firmivra app or credentials exist for either (an OAuth app each, the
     callback bound to the firm, stored tokens, webhooks). Their cards say so with the button off.
     Rasel to decide whether Firmivra offers them, and R1 to hold the provider accounts.
  2. *Accepted methods:* checkout takes cards only (`stripe-gateway.ts`: bank debits wait until a
     refund can wait for settlement, R7), and no firm setting stores a choice, so the switches
     show what clients can pay with and cannot change; there is no Save. Choosing methods needs a
     setting per firm (cards on, ACH on, default processor) and ACH in checkout: a column item for
     R1 when Rasel wants it.
  3. *Stripe management:* each connected account has the full Stripe Dashboard, so Manage
     Connection, Manage Bank Account and Check Eligibility open dashboard.stripe.com, signed in
     with the firm's Stripe login. Firmivra does not read the bank account or instant payout
     eligibility from Stripe (it would need the Accounts API's external accounts and balance on
     the connected account).
- **Staff SM8 to SM13 (built, `rasel/R60-staff-sm8-13`): what it cannot do yet.**
  1. *SM11 managed job titles* (add, rename, archive): column request item 5 (approved, not landed).
     Titles are already searchable from the firm's saved ones, with free text.
  2. *SM11 Work Start Date:* column request item 10.
  3. *SM8:* the saved schedules are the firm's schedules in use; renaming or retiring one needs a
     table (item 11). The workload cap is "Maximum Active Clients", and client assignment does
     not check it yet: its owner to be named by Rasel.
  4. *SM12 per-file Save:* storage for draft attachments (as SM5).
  5. *SM10:* the clock shows on the firm workspace and Super Admin (`AppShell`); the client portal
     is left out until its own review (one `clock` prop on its header).
- **Staff Management SM3 is blocked (handoff item 5):** each wrong route needs a destination that
  does not exist. Offices & Job Titles needs R1's Locations API and the saved job titles; New
  Accounts & Security needs the staff security defaults (both in "Column request for R1"). The
  Reports shortcut needs a Staff and Team report in Reports (its owner to name). Until then the
  cards stay as they are.
- **SM5 (Rasel's default, Oct 24):** pay is not kept in a staff draft (her own text says "pay is
  not kept"); the note says so. Per-file Save of a draft's attachments needs storage for draft
  files (an API and maybe a table): not built; the chosen files stay only while the tab is open.
- **The embed code cannot work on a firm's website yet (I3, seen Oct 23).** Three blocks, none in
  R60's paths: (1) **R1:** the portal's CloudFront behaviours use the managed `SECURITY_HEADERS`
  policy (`infra/src/stacks/app-stack.ts:185,205`), which sends `X-Frame-Options: SAMEORIGIN`, so a
  browser refuses to draw the page in another site's iframe; the Begin Online pages need a policy
  that allows framing (`frame-ancestors`). (2) **R15 or Rasel (a security decision):** the draft
  cookie is `SameSite=Strict` (`apps/api/src/begin-online/drafts.ts:94`); inside a third-party
  iframe the browser does not send it, so a visitor cannot start or save a draft there.
  `SameSite=None; Partitioned` would be needed, and some browsers block third-party cookies even
  then. (3) **R17:** no portal page reads `?embed=1` (the embed code adds it), so the portal header
  and footer show inside the frame. The link itself works.
- **Begin Online ignores the service's status (R15):** `serviceFor`
  (`apps/api/src/begin-online/begin-online.service.ts`) checks only `beginOnline` and not archived,
  so a service set Inactive or Draft in Services & Pricing still takes Begin Online submissions.
  The public link says INACTIVE then (Rasel's rule); `serviceFor` should also require ACTIVE.
- **Decisions she left open (do not guess):** Submitted vs Completed, due date vs expiration, staff
  Edit vs Request Revision, import template file types, the auto-create client trigger.
- **Begin Online (seen, not changed):** `newestForm` picks the highest version number of any
  published form of the service, across templates, so a published duplicate with a higher version
  number than the default would serve Begin Online. It should read the service default's live
  version.

## Questions for Rasel (waiting for his word)

1. **Ownership transfer** (Settings checks, check 3): where it lives (the firm's Settings or
   Super Admin), who starts it and who accepts it, whether the old Owner becomes an Admin, and
   whether the last Admin gets the protection the last Owner has. Nothing is built.
2. **Sign Out All Sessions ends no real session** (check 6): it marks `staff_sessions` rows that
   sign-in never writes, and never signs anyone out of Cognito. Fix it as Reset MFA does (a Cognito
   global sign-out of the member), and by whom (Users & Roles is R55's page)?
3. **Applying a Request Change** (Company Profile): R60 proposes a Super Admin action on the
   firm's detail ("Edit legal details": legal name, EIN, and licensing once item 7 lands), admin
   scope, audited in both logs, linked from the ticket. Who builds it, and may R60?
4. **Billing: requests or self-serve?** R60 made Upgrade, Downgrade and Edit Billing Details
   requests to the Super Admin team (the Request Change pattern), with the eligibility checks
   and estimates on the firm's side. Self-serve changes and saved payment methods need Stripe
   Billing for Firmivra's own subscriptions (a customer per firm, a price per plan, webhooks) and
   a write path the firm may use: R1's call, and a column or two. Keep requests for now?

## Column request for R1 (approved by Rasel, Oct 24)

For the fresh R1. One migration per item, or one batch, as R1 prefers. Every new firm table gets
`business_id` with the firm's row-level security like the other firm tables. R60 builds the API
and screens on each after it merges. Old columns stay until R60's API reads the new ones, then a
later migration drops them.

1. **I7, Notify additional emails.** `intake_settings.notify_additional_emails text[] NOT NULL
   DEFAULT '{}'`, `CHECK (cardinality(notify_additional_emails) <= 10)`. The API keeps each one a
   valid, lower-case, unique email. The staff "form submitted" email goes to them too, with no
   form content.
2. **I8, reminders in minutes.** `intake_settings.first_reminder_minutes int NOT NULL DEFAULT
   4320` and `final_reminder_minutes int NOT NULL DEFAULT 10080`, filled from
   `first_reminder_days * 1440` and `final_reminder_days * 1440`. In `intake_settings_ranges`:
   `first_reminder_minutes BETWEEN 5 AND 43200` and `final_reminder_minutes >
   first_reminder_minutes AND final_reminder_minutes <= 86400`. The screens will offer 5, 10, 15
   and 30 minutes; 1, 2, 3, 6 and 12 hours; 1, 2, 3, 5, 7, 10, 14, 21 and 30 days.
   `first_reminder_days` and `final_reminder_days` stay until the API reads minutes.
3. **I9, the expiration alert in minutes, and no alert.** `intake_settings.expiry_alert_minutes int
   NULL DEFAULT 1440` (NULL means no alert), filled from `expiry_alert_hours * 60`; `CHECK
   (expiry_alert_minutes IS NULL OR expiry_alert_minutes BETWEEN 30 AND 10080)`. Offered: 30
   minutes; 1, 2, 3, 5, 6, 10, 12, 24, 42 and 72 hours. `expiry_alert_hours` stays until the API
   reads minutes.
4. **I12, data retention period.** `intake_settings.data_retention_years int NULL` (NULL means not
   set), `CHECK (data_retention_years IS NULL OR data_retention_years BETWEEN 1 AND 100)`. Saving
   it deletes nothing; no job reads it until Rasel and Octavia define the start event, what it
   covers and what happens at the end.
5. **SM3, saved job titles.** Table `staff_job_titles`: `id uuid` (uuid7), `business_id`, `name
   text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 80)`, `created_by_user_id uuid NULL`
   (a member of the firm), `archived_at timestamptz NULL`, `created_at`, `updated_at`; unique
   `(business_id, lower(name)) WHERE archived_at IS NULL`. Filled once from the distinct non-empty
   `memberships.job_title` of each firm. Members read; Owner and Admin add, rename and archive
   through the API. A staff record keeps its own `job_title` text.
6. **SM3, staff security defaults for new accounts.** Table `staff_security_defaults`, one row per
   firm (`business_id` primary key), with the columns a new account's `staff_security_settings`
   starts from, with the same types, defaults and checks: `allowed_auth_methods`,
   `access_location`, `allowed_ips`, `allowed_countries`, `restrict_devices`,
   `auto_logout_minutes`, `max_concurrent_sessions`, `sign_out_other_sessions`,
   `allow_trusted_devices`, and the five `notify_*` switches; plus `updated_by_user_id` and
   `updated_at`. Create Staff step 3 starts from it; changing it changes no existing account. Owner
   and Admin read and change it through the API. (Sign-in does not enforce these settings for
   anyone yet: Settings checks, check 6.)

7. **Company Profile, professional licensing (added Oct 24, not yet approved).** Table
   `firm_licenses`: `id uuid` (uuid7), `business_id`, `regulatory_body text NOT NULL` (1 to 120
   characters), `license_type text NOT NULL` (1 to 80), `license_number text NOT NULL` (1 to 60),
   `expires_on date NULL`, `status` (`ACTIVE`, `EXPIRED`, `SUSPENDED`, `REVOKED`; default
   `ACTIVE`), `verified_by_user_id uuid NULL` (a Super Admin), `verified_at timestamptz NULL`,
   `created_at`, `updated_at`. One row per license (a firm may hold several). The firm reads its
   own rows; only the admin or platform scope writes them (Firmivra applies an approved request).

8. **Notifications, staff email on (added Oct 24, a data change only).** One data migration:
   `UPDATE notification_preferences np SET email = true FROM memberships m WHERE
   m.business_id = np.business_id AND m.user_id = np.user_id AND np.email = false`. The API
   already treats these rows as on; this makes the table say so.
9. **Notifications, a verified staff mobile number (added Oct 24, not yet approved).**
   `users.phone_verified_at timestamptz NULL`, cleared whenever `users.phone` changes (the
   same transaction that clears the SMS choices, `Notifier.phoneChanged`). With it R60 builds
   the staff verification (a code by text through R6's sender) and offers SMS to verified staff.

10. **Staff SM11, Work Start Date (added Oct 24, not yet approved).**
    `staff_profiles.work_start_date date NULL`, distinct from `hire_date` and the access start
    date. Create Staff step 4 and Edit Staff show it.
11. **Staff SM8, company work schedules (added Oct 24, not yet approved).** Table
    `staff_work_schedules`: `id` (uuid7), `business_id`, `name text NOT NULL` (1 to 80),
    `archived_at timestamptz NULL`, `created_by_user_id`, `created_at`, `updated_at`; unique
    `(business_id, lower(name)) WHERE archived_at IS NULL`; filled once from the distinct
    `staff_profiles.work_schedule`. A staff record keeps its own text.

Offices need no column: they are R1's Locations API (`firm_offices`).

## Checks that fail on clean `main` too (not R60's changes)

- `apps/web/e2e/mock/r19-payments-settings.spec.ts` "other roles" and "answers from the API": on
  Windows they cannot start their extra mock servers (`spawn pnpm ENOENT`: `spawn` without a
  shell). Local only; CI (Linux) runs them. Its two in-page tests pass locally.

- `apps/api/test/e2e/automations.e2e.test.ts:708` (R55's automations): the same window. It makes a rule
  that expired "yesterday" in UTC, while the service compares with the firm's day (New York), so
  from 00:00 to 04:00 UTC the rule is not yet expired and two more cases after it fail. Seen on
  #1065's run at 01:20 UTC.
- `apps/api/test/e2e/leads-pipeline.e2e.test.ts:311` (R55): the date filter test takes "today" in UTC
  while the API filters days in the firm's time zone (America/New_York), so it fails every night
  from 00:00 to 04:00 UTC (06:00 to 10:00 Dhaka). It failed #1063's first run (Oct 24, 00:53
  UTC). Fix: take today in the firm's zone, as the bookkeeping test was fixed in #991.

- `apps/api/test/isolation/tenant-isolation.test.ts`, locally: 4 of 19 fail on clean `main` as on
  the I1 branch. The two refusal sweeps time out at 30 s; the controls list file and export routes
  (409 `FILE_BLOCKED` from the local scanner, 200 with s3mock links). CI is the judge.
- `apps/web/e2e/mock/r17-intake.spec.ts:8` (the portal's intake cards): expects 6 cards, gets 7
  (Oct 23). It covers the client portal's intake page and its `mocks/intake.ts`; R60's branches
  change neither.
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
- Oct 23 (fresh session): #1028, #1031, #1033 and #1034 merged. I3 link contract: a main form's
  `GET /business/intake-forms/{id}/public-link` answers `PublicLink` with its Begin Online page
  (`beginOnlinePageUrl`), the client's `publicLink(id)` and the mock. The embed blocks found (Needs).
- Oct 23: #1038 (I3 link contract) opened. I3 link API: `IntakeLibraryService.publicLink`, the
  route, and 2 e2e tests (every state; 404 for another form, OTHER, an archived form, a page owned
  by another service, firm B); intake workspace e2e 16 of 16, API `tsc` 0 errors.
- Oct 23: #1039 (I3 link API) opened, stacked on #1038. I3 link screen built: Form Link (a dialog
  with R56's block) after Publish on a main form, in the builder's More menu and on the main
  form's card menu. Two builder fixes it needed: saving a published form now saves its next
  version on the same form (the API's rule) instead of a separate copy, which was never the main
  form; and Publish no longer refuses a saved form's grids, groups and State lists (a #1031 check
  that took them for empty breaks and choice-less dropdowns). LVP's Annual Tax published as v2
  on the real API, Begin Online serving its 72 fields. Web `tsc` 0 errors; mock specs 14 of 14
  (link, builder, templates); builder-draft unit 3 of 3.
- Oct 23: I7 to I12 checked on `main` (table above). Built on `rasel/R60-intake-settings-p2`
  (local, waiting for a PR slot): I8 days and wording, the final after the first, No reminders
  saved as off; I9 hours (42, not 48); I11 Always on. API `tsc` and web `tsc` 0 errors; intake
  workspace e2e 15 of 15; `r60-intake-settings` mock spec 11 of 11; sheet shot on the real API.
- Oct 24: #1038, #1039, #1045 and #1047 merged. Rasel's defaults for item 4 and SM5, the two
  questions (ownership transfer, Sign Out All Sessions) and the approved column request for R1 are
  in this file. `rasel/R60-intake-settings-p2` merged `main` for its PR.
- Oct 24: SM5 (`rasel/R60-staff-drafts`): Drafts in the directory's status filter (Continue,
  Delete; Owner and Admin), a chosen file and its type kept across Back and Next, and the saved
  note naming what a draft does not keep (pay, files). Sheet shot on the real API; it also listed an
  Oct 19 draft nothing had shown. `r60-staff-drafts` 2 of 2 and the `tumit-team*` specs 12 of 12.
- Oct 24 (third session): #1056 merged; `main` merged. Item 1, Company Profile Request Change
  (`rasel/R60-profile-request-change`): `api.profileChanges` (a Portal support ticket in the Super
  Admin queue with the current and proposed values; GET with status and the latest sent reply),
  the locked Company Information and Professional Licensing cards with the Request a Change
  dialog, and `EIN_LOCKED` on `PATCH /business/settings` once Active. Profile-changes e2e 6 of 6,
  contract unit 4 of 4, API and web `tsc` 0 errors, ESLint and Prettier clean; sheet shot on the
  real API. Licensing columns added as item 7 of the column request; question 3 (applying an
  approved change) for Rasel.
- Oct 24 (third session): #1063 opened (item 1). Its first CI run failed only
  `leads-pipeline.e2e.test.ts:311` (R55's date test, 00:00 to 04:00 UTC); noted under "Checks that
  fail". Item 2, Notifications (`rasel/R60-notifications-email`, #1065, stacked on #1063): staff
  email always on (`emailLocked`, 400 `EMAIL_ALWAYS_ON`, `PreferenceSource.allows` sends staff the
  email whatever a stored row says), staff SMS only with a verified mobile number (none recorded,
  so email only); notifications e2e 23 of 23, unit 13 of 13, contract 49 of 49, mock specs 7 of 7.
  Column items 8 and 9 added.
- Oct 24: item 3, Billing (`rasel/R60-billing`, stacked on #1065, local: two PRs open). The firm's
  `api.firmBilling` (overview, invoices, invoice, PDF via pdf-lib, plan and contact requests as
  support tickets through the shared `settings/firm-tickets.ts`, which Request Change now uses
  too), and the page on her design with the plan details, usage, change-plan (catalog, blockers,
  review) and invoice dialogs. Billing e2e 8 of 8, profile-changes 6 of 6, unit 3 of 3, contract
  3 of 3, `tumit-settings-billing` 3 of 3 (rewritten) and `r56-settings-shell`; sheet shot on the
  real API. Question 4 for Rasel.
- Oct 24: item 4, Payments (`rasel/R60-payments`, stacked on billing, local), web only: the page on
  her design (Stripe, Square, PayPal; Accepted Client Payments; Payout Settings; the Invoices &
  Payments link). Stripe keeps every state and test id of `r19-payments-settings`; Square and
  PayPal and the ACH and PayPal methods are off with the reason; the Stripe Dashboard opens for
  the connection, the bank and instant payouts. Web `tsc` 0 errors; `r60-payments-settings` 2 of
  2, r19's in-page tests pass (its server-spawning ones cannot run on Windows); sheet shot on the
  local API with `STRIPE_MODE=fake`.
- Oct 24: item 5, Staff SM8 to SM13 (`rasel/R60-staff-sm8-13`, from `main`): SM9 (the cards
  open the matching list; `/team/directory` for Manage Staff Accounts and Staff Settings), SM13
  (department Manage Members, with no team; 409 `LAST_DEPARTMENT`), SM11 (custom roles in the
  Role selector, Create Custom Role and Back to the same draft), SM8 (the firm's own schedules and
  a custom one; "Maximum Active Clients"), SM10 (the header clock). Departments e2e 12 of 12, staff
  e2e 8 of 8, `r60-staff-sm8-13` 5 of 5 and the Staff specs; sheet shot on the real API. Column
  items 10 and 11 added.
- Oct 24: #1065's CI named the tenant-isolation sweep: `requestId` (Request Change, Billing) is a
  retry key, now in `NOT_RECORDS` (pushed to #1063 and merged up the stack); isolation cases for
  the firm's invoice and its PDF (billing branch) and a department's members (staff branch). The
  sweep passes locally on each; its other local failures are the known file-scanner ones.
