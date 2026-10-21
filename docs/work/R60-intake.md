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

## Items

| # | Item | State |
| --- | --- | --- |
| I1 | Template library shows every form | Built, PR (below) |
| I2 | Send to client fails | Reproduced; next |
| I3 | Publish validation, link and embed code | Waits on R56's shared Copy link / embed block for the embed part |
| I4 | Settings Edit links | Reproduced |
| I5 | Submission Rules shortcut | Reproduced |
| I6 | Test Reminder Email | Reproduced |
| I7 to I12 | Settings additions | After the P1 items |
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

- **R1 (I10, 50 and 100 MB per file):** intake uploads must take the multipart path of #1009 for
  files over the single-part limit, with the firm's chosen cap (`intake_settings.max_file_size_mb`,
  up to 100). R60 adds the 50 and 100 MB choices and the enforcement message only once the intake
  upload paths (Begin Online and the portal intake) use #1009's uploader; no second upload path.
- **R56 (I3):** the shared "Copy link / Copy embed code" block and its API shape (one per public
  item: form, appointment type, package). I3's validation part does not wait for it.
- **Secure link page (I2):** a form for a lead or a new contact needs the secure link page
  (`LEAD_LINK_UNAVAILABLE` today). Owner to be named by Rasel.
- **Decisions she left open (do not guess):** Submitted vs Completed, due date vs expiration, staff
  Edit vs Request Revision, import template file types, the auto-create client trigger.
- **Begin Online (seen, not changed):** `newestForm` picks the highest version number of any
  published form of the service, across templates, so a published duplicate with a higher version
  number than the default would serve Begin Online. It should read the service default's live
  version.

## Progress log

- Oct 21: P1 items reproduced on local `main` (above). I1 built.
