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

### Oct 25 (sixth session, end): start here

The sixth R60 stopped here (Rasel needed the laptop). The next R60 reads `CLAUDE.md`,
`docs/work/README.md`, `docs/work/R60-settings.md` (the R60 rules) and this file, then
`git fetch origin`.

**Merged this session:** #1147 (group 1, squash `49eb6497`), after `origin/main` was merged in over
R55's periods.

**Open (two, the limit):**
- **#1150** (group 3, Q1 to Q7, Q10), `rasel/R60-dashboard-quick`, head `f43c97c`, mergeable.
  `main` was merged in after #1147: Clients and Leads keep both prop sets (`?new=1` and the
  drill-down). Its sheet still says Completed Returns (shot before #1147 merged; noted in the body).
- **#1153** (group 4, D1 and D3), `rasel/R60-client-form`, head `2191e06`. D1's checks are the
  contract's `NewClientForm`; the API keeps `CreateClientRequest` for the calendar's quick add.

**Built and pushed, no PR yet:**
1. (c) Staff phone verification, `rasel/R60-staff-phone`, head `a654e22` (from `main`, on R1's
   `staff_phone_codes`). The PR body is this session's scratchpad `pr-phone.md`: replace `(SHEET)`
   with the blob link of `apps/web/e2e/screenshots/r60-staff-phone/r60-staff-phone.jpg` pinned to
   `a654e22` (`?raw=true`). When a slot frees: merge `origin/main`, check, `gh pr create`.
2. Clients PR 1 (part), `rasel/R60-clients-e1`, head: this commit (from `main` at `49eb6497`).
   Done:
   - E1: the Pending Documents and Balances Due cards filter the list. The contract has
     `ListClientsQuery.owes` (DOCUMENTS, BALANCE), with the summary's own SQL, so the counts match.
   - E7: the list's place lives in its address (`lib/clients-place.ts`, `history.replaceState`).
     Back restores it, the profile's Clients link returns to the last list with its scroll, and a
     plain `/clients` starts fresh.
   - E6: Edit Details asks Save Changes, Discard Changes or Keep Editing on Cancel, Escape or the
     close button. `packages/ui` `Modal` now prevents the browser's own close on Escape and leaves
     it to `onClose`; existing modals behave the same.
   - E3: an advisory enrollment (workstream ACCEPTED, IN_PROGRESS, AWAITING_CLIENT or ON_HOLD, not
     archived) counts as the client's service in the row tags, the service filter and the tab
     counts.

   Tests: clients e2e 11 of 11 plus 19 of 19, `r60-clients.spec.ts` (E1, E6, E7) green, and a test
   fix in `clients-work.e2e.test.ts` (an unscoped owner query). No sheet yet.

**Next, in this order:**
1. When #1150 or #1153 merges: open (c) staff phone (above).
2. Clients PR 1, the rest:
   - E4: the profile tabs Services, Intake Forms, Tasks, Notes and Activity, with a More overflow.
     Enrolled services (status, link) and the Activity Log go on Overview.
   - E5: required fields and format checks in Edit Details, as D1. The responsible party waits for
     column request 14.
   - E2: waits for Rasel (below).
   - Then the sheet (the clients list with data, empty and unreachable), and merge `origin/main`
     (#1150 and #1153 touch `clients-screen.tsx`, `clients/page.tsx` and `clients-dialogs.tsx`).
     Open the PR.
3. Clients PR 2: E8 to E10, Added Last 30 Days, More Filters and the Archived Clients shortcut.

**Waiting on Rasel:**
- **E2, Last Activity:** `clients.last_activity_at` (R37) is meant to be set by the API on each
  event, but only e-sign completion sets it. So the column and its From/To filter miss almost all
  activity. The day boundaries are right: the firm's time zone, both ends included. Which events
  count? Proposed: a message in the client's thread, a document uploaded or requested, an invoice
  sent or a payment received, an appointment booked or held, an intake submitted, a signature
  completed, and a note or task change. Either each module sets the column in its own write, or the
  list computes the latest of them in SQL.
- **Column request 14** (E5's responsible party): below, under the column requests.
- **Staff texts:** verified staff can choose SMS, but no staff notice has a text copy yet, so
  nothing is texted to them until one is added.
- These fail on `main` without R60's changes: `arfan-create-broadcast` ("makes the draft...") and
  `r23-client-record` (4 cases).

**Local state:** `firmivra_r60` has the fake number +17705550123 on `owner@lvp.test`, verified by
the sheet. Clear `phone_verified_at` (or change the number) to shoot it again. This session's
scratchpad is
`C:/Users/RASEL/AppData/Local/Temp/claude/f--firmivra-R60/f91ebf82-40e0-4f47-be72-f45b4f80350f/scratchpad/`:
`shots-kpi.cjs`, `shots-quick.cjs`, `shots-form.cjs`, `shots-phone.cjs`, `compose.cjs`,
`spec-*.json`, `pr-*.md`, `sub.py` and `region.py`. Worktrees: `F:/firmivra-R60` (Clients
branch), `F:/firmivra-R60-web` (#1150's branch).

### Oct 25 (fifth session, later): start here

The fifth R60 stops here; its context is full. The next R60 reads `CLAUDE.md`,
`docs/work/README.md`, `docs/work/R60-settings.md` (the R60 rules) and this file, then
`git fetch origin`.

**Rasel's message (Oct 25, evening).** Octavia's review of Oct 25 is
`docs/specs/review-2026-10-25/CHANGE-LIST.md`, with her guides `dashboard--developer-feedback.md`
and `clients--developer-feedback.md`. R60 takes:
- **A. Dashboard,** in four groups, one PR each:
  1. KPI cards and destinations (K2 to K7).
  2. Tasks, appointments and notifications (T4, T5, A2 to A4, N2, N3).
  3. Quick actions and + New (Q1 to Q7, Q10).
  4. The client form and Report a Problem (D1, D3).
- **B. Clients (section E),** in two PRs:
  1. E1 to E7.
  2. E8 to E10, plus the Added Last 30 Days filter, More Filters and the Archived Clients shortcut.
  Export, the extra bulk actions and linked Business and Personal profiles are later, or for a fresh session.

Two PRs open at most. Keep her PASS items working, never seed her example data, and do not touch
`packages/db`, `infra` or `.github`: write a request here and tell Rasel. Item (c), the staff phone
verification, waits for R1's `staff_phone_codes` PR (Rasel's tap is given; R1 builds it after the
prod release).

**Open (two, the limit):**
- **#1147 (group 1, K2 to K7)** (`rasel/R60-dashboard-kpis`).
- **#1148 (group 2, T4, T5, A2 to A4, N2, N3)** (`rasel/R60-dashboard-lists`).

**Built and pushed, no PR yet:** group 3 (Q1 to Q7, Q10), `rasel/R60-dashboard-quick` (head
`ed98259`, from `main`). When a slot frees: merge `origin/main`. If #1148 merged first, the header
popover in `firm-controls.tsx` conflicts: keep this branch's `Popover`, which already has #1148's
`onOpen`, and keep #1148's `FirmBell`. The R60 file's progress log conflicts too: keep both entries,
`main`'s first. Then run the checks and `gh pr create` with this session's `pr-quick.md` (its
sheet link is pinned to `ed98259`).

**Next, in this order:**
1. **Group 4:** D1 (the shared client form: name, email, phone and the right address required for
   Individual and Business, Business Name for Business, no misleading "optional", home or business
   address wording) and D3 (Report a Problem's text exactly: "Describe what went wrong. Your firm
   name and affected page will be included in the report."; attachments the user's choice). The
   form is `clients/_components/clients-dialogs.tsx` (`AddClientDialog`); Report a Problem is in
   `components/app-shell/firm-controls.tsx` (the Help panel). Check `packages/types` client
   schemas for the required fields: E5 (Clients PR 1) needs the same rules plus a responsible party
   for a Business; if that needs a column, write the request here first.
2. **Clients PR 1, E1 to E7:**
   - Pending Docs and Balance Due cards filter the list.
   - Last Activity: inclusive boundaries in the firm's time zone.
   - Stacy's service linkage: reconcile; do not rename services.
   - Profile tabs Services, Intake Forms, Tasks, Notes and Activity, with enrolled services and the
     Activity Log at the bottom of Overview.
   - Required fields with the responsible party.
   - Save / Discard / Keep Editing on Cancel.
   - Return to Clients restores filters, search, sort, page and scroll.
3. **Clients PR 2:** E8 to E10, Added Last 30 Days, More Filters and the Archived Clients shortcut.

**Group 1's decisions (in #1147's body):**
- New Leads = stage New Lead created this month.
- Returns In Progress = `TAX_RETURN_IN_PROGRESS_STATUSES`.
- Accepted Returns = accepted this month according to the status history.
- Outstanding = every OPEN invoice.
- Back to Dashboard is `?back=dashboard` (`lib/from-dashboard.ts`, `components/back-to-dashboard.tsx`).

**Local state and tools:**
- `firmivra_r60` holds one fake license and two fake upcoming appointments for LVP (for the sheets).
- This session's scratchpad:
  `C:/Users/RASEL/AppData/Local/Temp/claude/f--firmivra-R60/40a63a02-fb97-48a6-861e-a53c02853169/scratchpad/`.
  It holds `shots-kpi.cjs`, `shots-lists.cjs`, `shots-quick.cjs`, `compose.cjs` (now takes .webp),
  `spec-*.json`, `pr-*.md` and `sub.py`.
- Pass non-ASCII text to Python as a file, not through a heredoc on stdin (it arrives mangled).
- A server page cannot call a function from a `'use client'` file: keep such helpers in `lib/`.

### Oct 25 (fifth session, end): start here

The fifth R60 stops here. The next R60 reads `CLAUDE.md`, `docs/work/README.md`,
`docs/work/R60-settings.md` (the R60 rules) and this file, then `git fetch origin`.

**Open (two, the limit):**
- **#1116 (I12, data retention):** `origin/main` was merged in after #1115 merged. Main's CI fix had
  taken `intake.submitted-notice` out of `ALWAYS_SENT`, and the merge brought the line back, so it
  was dropped again. API unit 1724 of 1724; types, API and web typecheck 0. Head `c02c020`, CI green.
  It waits for the review thread to merge it.
- **#1128 (a) SM11 Work Start Date** (`rasel/R60-staff-work-start`, CI green). **For Rasel:** the
  design's "Start Date" (Create Staff step 1 card 4, Edit Staff card 4) now saves the Work Start
  Date. Hire Date stays in step 4, and Edit Staff gains a Hire Date field. Changing that back is
  one line per screen.

**Built and pushed, no PR yet (open each when a slot frees):**
1. (b) SM8 company schedules, `rasel/R60-staff-schedules` (head `0bf54a1`, from `main`): merge
   `origin/main`, check, then `gh pr create` with the body in this session's scratchpad
   (`pr-schedules.md`).
2. (d) the licensing card, `rasel/R60-firm-licenses` (head `72bc02a`, from `main`): the same, with
   `pr-licenses.md`.

The bodies' sheet links are pinned to those heads. If a merge changes a sheet, shoot it again and
re-pin.

**Blocked:** (c) the staff phone verification needs a place to keep a code and count wrong tries.
`users.phone_verified_at` alone is not enough, and `verification_codes` is keyed to a client
account. This is column request item 13 below, for Rasel's word.

**Local state:** `firmivra_r60` holds one fake license for LVP, written as the platform for (d)'s
sheet. This session's scratchpad:
`C:/Users/RASEL/AppData/Local/Temp/claude/f--firmivra-R60/40a63a02-fb97-48a6-861e-a53c02853169/scratchpad/`.
It holds `shots-work.cjs`, `shots-sched.cjs`, `shots-lic.cjs`, `compose.cjs`, `spec-*.json`,
`pr-*.md` and `sub.py`, an exact-match replacer that keeps LF line endings. On Windows, Python's
plain `open(..., 'w')` writes CRLF, so pass `newline=''`.

### Oct 25 (fourth session, end): start here

R60's context was full; the next R60 starts from this section. Read `CLAUDE.md`,
`docs/work/README.md`, `docs/work/R60-settings.md` (the R60 rules) and this file.

**Merged:** #1088 (Offices & Job Titles), #1093 (New Accounts & Security), #1094 (I8), #1101
(Request Change keeps the EIN's last four), #1106 (I9). **Open (two, the limit):** #1115 (I7,
Notify additional emails, from `main`) and #1116 (I12, data retention, stacked on #1115). After
#1115 merges, merge `origin/main` into `rasel/R60-intake-retention` before #1116 merges.

**Later on Oct 25:**
- #1115's CI fix: the client-submit notice (`intake.submitted-notice`) left `ALWAYS_SENT` and keeps the INTAKE category. It is sent with no `recipient`, so no preference applies anyway, and `notify.test.ts` keeps its rule that always-sent templates are ACCOUNT. `main` merged in; new head `a2479a0`.
- API unit tests: 1724 of 1724. Intakes e2e: 27 of 27. Types, API and web typecheck: 0 errors.
- Column request item 12 (each existing firm's contact email in Notify additional emails) waits for Rasel's own tap before anyone touches `packages/db`. It stays written in this file (on #1115's branch); he will ask.
- Items (a) to (d) below are not started.

**Rasel's answers (Oct 25):**
1. Column items 7 to 11 are on `main` (R1's #1095): build them now, in this order, one PR each,
   at most two open: (a) SM11 Work Start Date, (b) SM8 company schedules, (c) the staff phone
   verification, (d) the firm's licensing card (read-only for the firm; only a Super Admin or the
   platform writes licenses).
2. The firm's contact email hears of a submit by default (done in #1115; existing rows: column
   request item 12, a data change for R1).
3. Firm setup's invite and the sign-in code: R55 adds the one line (under Needs). Do not touch.
4. The Send page's schedule stays read-only; per-send times are a schema request (below), Rasel
   decides later.
5. The reminder and alert sender (I8, I9) and the Locations page: recorded under Needs, not built.

**Next, (a) to (d), from fresh `main` (names from R1's #1095; see "From R1" under Needs):**

| # | Columns | Where it goes |
| --- | --- | --- |
| a | `staff_profiles.work_start_date` (`StaffProfile.workStartDate`, a date) | Contract `StaffDetailsInput` and `StaffProfileDetails` (`packages/types/src/staff/schemas.ts`); `profileData` in `apps/api/src/staff/staff-write.service.ts` and the profile in `staff-read.service.ts`; Create Staff step 4 (`team/new/details/_components/details-step.tsx`) and Edit Staff (`team/[id]/_components/edit-staff-screen.tsx`), apart from Hire Date and Access Start Date; the staff mock; `staff-write.e2e.test.ts` |
| b | `staff_work_schedules` (`StaffWorkSchedule`, like `staff_job_titles`) | Follow #1088 (job titles): API add, rename, archive, restore; `StaffFormOptions.workSchedules` = the presets, then the firm's saved schedules (today they come from `staff_profiles.work_schedule`, `staff-read.service.ts`); a "Work Schedules" card on Offices & Job Titles; check R1's migration for a backfill |
| c | `users.phone_verified_at` (`User.phoneVerifiedAt`; the database clears it when `phone` changes) | A code by SMS through R6's sender (`SMS_MODE=log` locally), then `smsOffered` for verified staff in `apps/api/src/notifications/notifications.service.ts` (today staff get email only, #1065); `Notifier.phoneChanged` still clears the SMS choices |
| d | `firm_licenses` (`FirmLicense`, `FirmLicenseStatus`) | The Professional Licensing card (`settings/profile/_components/locked-details.tsx`) lists the firm's rows instead of "Not on file"; the Request Change "Current" values from them (`profile-changes.service.ts`); read-only for the firm, no firm write route |

**How this session worked (keep doing it):**
- Rebuild after every branch switch: `pnpm --filter @firmivra/db generate` and `build`, `@firmivra/types` build (and `@firmivra/ui`), then typecheck; also `pnpm --filter @firmivra/types typecheck` (its tests are typechecked in CI).
- Main squash-merges, so a branch stacked on a merged PR conflicts on that PR's own lines: check `git log <base>..origin/main -- <file>` and, when only the squash touched the file and it equals the branch's copy, keep the branch's side. The progress log at the end of this file conflicts on every merge: keep both entries, `main`'s first.
- Screenshots: this session's scratchpad `C:/Users/RASEL/AppData/Local/Temp/claude/f--firmivra-R60/aa63cad8-4ccf-4508-ba07-6873392c6ec3/scratchpad/` (`shots-*.cjs`, `compose.cjs`, `spec-*.json`, the PR bodies `pr-*.md`). Run the dev servers in the background, stop them by port (3600, 4600), delete `apps/web/.next`. The first mock run after `.next` is deleted can time out once on a cold page: rerun with `--last-failed`.

### Oct 24 (fourth session): Rasel's go on column items 1 to 6, start here

Rasel (Oct 24, evening): build I7, I8, I9 and I12 and SM3's two routes (saved job titles, new
account security defaults) now that items 1 to 6 are on `main` (#1074). One PR per item or route,
at most two open, each with its contract, API, screen, e2e and isolation tests. Nothing that needs
items 7 to 11 (R1's next migration PR) until they are on `main`. #1079 (Staff SM8 to SM13) and the
review thread: its branch is touched only to answer review. Ownership transfer and Sign Out All
Sessions stay unbuilt. #1073 and #1076 merged.

| # | Branch (from `main`) | What | State |
| --- | --- | --- | --- |
| 1 | `rasel/R60-sm3-job-titles` | SM3 Offices & Job Titles: `api.staff` job titles (list, add, rename, archive, restore; 409 `JOB_TITLE_EXISTS`), the editor at `/team/settings/offices-titles`; Create and Edit Staff offer the saved titles and Location Management's active locations | #1088 (merged Oct 24) |
| 2 | `rasel/R60-sm3-security-defaults` | SM3 New Accounts & Security: the firm's defaults for new accounts (`staff_security_defaults`), a policy page that says existing accounts keep their own and confirms the save; Create Staff (and import) start from them | #1093 |
| 3 | `rasel/R60-intake-reminders` | I8: first and final reminders in minutes (5 minutes to 30 days, "after sending"); the old day columns kept valid; the Send page's schedule shows the firm's timing (a send keeps only on or off) | PR (Oct 24) |
| 4 | stacked on 3 | I9: the expiration alert in minutes (30 minutes; 1, 2, 3, 5, 6, 10, 12, 24, 42, 72 hours) and No alert | Next |
| 5 | stacked on 4 (the same settings) | I7: Notify additional emails (up to 10) and a no-content "form submitted" email to them | Next |
| 6 | stacked on 5 | I12: Data retention period in years (1 to 100, or not set); saving deletes nothing | Next |

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
| 1 | `rasel/R60-profile-request-change` | #1063 (merged Oct 24): `api.profileChanges` (contract, API, e2e), the two locked cards and the dialog, the EIN locked on the server once Active. Notes below ("Request Change") |
| 2 | `rasel/R60-notifications-email` (stacked on #1063) | #1065 (merged Oct 24): staff email always on (`emailLocked`, 400 `EMAIL_ALWAYS_ON`, the sender sends anyway, older Off rows read as on); staff SMS only with a verified mobile number, which no staff login records, so email only for now. Notes below ("Notifications") |
| 3 | `rasel/R60-billing` | #1073 (merged Oct 24): `api.firmBilling` (overview, invoices, invoice, PDF, requests), the Billing page on her design with the plan, usage, details and invoice dialogs; plan and contact changes as support requests. Notes below ("Billing") |
| 4 | `rasel/R60-payments` | #1076 (merged Oct 24): the Payments page on her design (web only); Stripe keeps every existing state; Manage Connection, Manage Bank Account and Check Eligibility open the firm's own Stripe Dashboard. Notes below ("Payments") |
| 5 | `rasel/R60-staff-sm8-13` (from `main`) | PR opened Oct 24 in the slot #1073 freed: SM9 cards and `/team/directory`, SM13 department Manage Members (`GET`/`PUT /business/departments/{id}/members`), SM11 custom roles in Create Staff and the Create Custom Role shortcut with Back, SM8 custom schedules and the workload unit, SM10 the header clock. Notes below ("Staff") |

**Rasel's decisions (Oct 24, afternoon):** Billing stays request-based for now, no self-serve
Stripe (question 4). The Super Admin action that applies an approved legal name, EIN or licensing
change is R56's (question 3; under Needs). Column requests 7 to 11 are approved; R1 builds them one
migration PR at a time ("Column request for R1"). Still waiting for his word, not built: ownership
transfer and Sign Out All Sessions (questions 1 and 2). Tests that take "today" in UTC against the
firm's day take the firm's New York date (the automations test, on the Payments branch).

#1063, #1065 and #1073 merged on Oct 24. Open: #1076 (Payments) and the Staff PR. Next for R60:
build on column items 1 to 6 (landed in #1074; "Column request for R1"). The third session's
scratchpad keeps the shot helpers:
`C:/Users/RASEL/AppData/Local/Temp/claude/f--firmivra-R60/fd07679c-e53b-4b16-8968-b670b5107292/scratchpad/`: `shots-profile.cjs`, `shots-notifications.cjs`, `shots-billing.cjs`, `shots-payments.cjs`,
`shots-staff.cjs`, `compose.cjs`, `spec-*.json`.

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

- **From R1 (Oct 24): column requests 7 to 11 are built** (merged as #1095 on Oct 24), one PR on R1's branch `rasel/R1-r60-columns-2`. Its PR opened on Oct 24 after the idempotency PR (#1084) merged, one migration PR at a time; not merged yet. Build on these names once it merges:
  - **7, `firm_licenses`:**
    - Columns: `regulatory_body` (1 to 120), `license_type` (1 to 80), `license_number` (1 to 60), each trimmed, something visible and no control characters; `expires_on`; `status` (`FirmLicenseStatus`: ACTIVE, EXPIRED, SUSPENDED or REVOKED, default ACTIVE); `verified_by_user_id` with `verified_at`.
    - Who may write: the firm reads only its own rows. Only the admin scope (a Super Admin, `forAdmin`) or the platform scope inserts or updates, so the firm-side API can only read, and a firm can never verify its own license.
    - The verifier is a `platform_admins` row, and both verify fields come together.
    - No DELETE: a license ends by its status.
  - **8:** a data-only migration. Every firm member's `notification_preferences.email` that was off is now on; clients' rows are untouched.
  - **9, `users.phone_verified_at`:**
    - The database clears it whenever `phone` changes, unless the same update sets it too, so "verify and save the new number" works in one update.
    - It is never set without a phone.
    - Your `Notifier.phoneChanged` can still clear the SMS choices in the same transaction.
  - **10, `staff_profiles.work_start_date`:** a nullable date, apart from `hire_date` and `access_starts_on`.
  - **11, `staff_work_schedules`:** like `staff_job_titles`. Name trimmed, 1 to 80 characters, unique ignoring case while not archived; archived, never deleted (no DELETE grant); `created_by_user_id` must be a member of the firm. It was filled once from each firm's distinct `staff_profiles.work_schedule` (first spelling wins, case ignored), and a staff record keeps its own text.
  - **Five migrations, one per busy table,** so none holds one table while it waits for another. Tests: `packages/db/test/r60-columns-2.test.ts`.
- **R1 (columns, items 1 to 11):** all approved by Rasel on Oct 24 (1 to 6 in the morning, 7 to 11
  in the afternoon); the exact request and what R60 builds on each are "Column request for R1"
  below. Items 1 to 6 landed in #1074 (Oct 24); R60 builds on them next. Items 7 to 11 are R1's
  `rasel/R1-r60-columns-2` (five migrations, third in R1's queue). Nothing is built on an item
  until it lands.
- **R56 (applying an approved Request Change; Rasel, Oct 24):** a Super Admin action on the firm's
  detail that changes its legal name, EIN and (once item 7 lands) its licenses after activation.
  Today the team resolves a Request Change ticket and nothing changes. What R60's side gives it:
  the ticket (`apps/api/src/settings/firm-tickets.ts`, category and subject from
  `api.profileChanges`) holds the current and proposed values and the reason; the firm's card
  shows the ticket's status and Firmivra's latest sent reply, so resolving the ticket after
  applying is all the firm side needs. R60 proposes: admin scope, audited in both logs (platform
  and the firm's), linked from the ticket; a new EIN written as activation writes it (encrypted
  with the firm's KMS key, `ein_enc` and `ein_last4`) and checked for duplicates as an
  application's is (`ein_hash`). Rasel (Oct 24): the request keeps only the proposed EIN's last
  four digits ("Ending in 6789"), so Apply leaves the EIN empty for the admin to type
  (`rasel/R60-profile-ein-last4`).
- **R1 (I10):** done in #1025 (2, 5, 10, 50 or 100 MB, enforced in uploads). R60 verifies only.
- **R56 (I3):** done in #1020 (`PublicLink`, `PublicLinkBlock`); R60 builds I3's link next.
- **Secure link page (I2):** a form for a lead or a new contact needs the secure link page
  (`LEAD_LINK_UNAVAILABLE` today). Owner to be named by Rasel.
- **Intake reminders and expiry alerts (Rasel, Oct 25: record, do not build now; owner to be
  named):** no job sends the first and final reminders (I8, `first_reminder_minutes`,
  `final_reminder_minutes`, minutes after sending) or the expiration alert (I9,
  `expiry_alert_minutes` before `expires_at`, null for none), and there is no reminder or alert
  email template. Each send keeps `intakes.reminders_enabled`. Her stop rules: none after the form
  is submitted, completed or expired; an expiration change reschedules. The test reminder (#1033)
  uses the firm's message email (`lead.message-email`) until the template exists.
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
     licensing details after activation. R56 builds it (Rasel, Oct 24; the R56 item above). Until
     then the team resolves the ticket and nothing changes.
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
  1. *Self-serve plan changes:* request-based for now (Rasel, Oct 24: no self-serve Stripe). The
     firm's scope reads its subscription but writes none of the platform's billing rows (R0's
     policies), and there is no provider quote or payment for Firmivra's own subscription. So
     Upgrade and Downgrade go through her catalog and Review (with the blockers and an estimate at
     today's usage) and send a request to the Super Admin team, who apply it in Subscriptions.
  2. *Payment methods:* no card or account is stored for Firmivra's subscription (no Stripe
     customer for platform billing). The card shows the latest recorded payment and no
     Add, Update, Set as Default or Remove buttons, rather than dead ones (the same decision).
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
- **Staff Management SM3 (Oct 24, fourth session):** Offices & Job Titles is built on the saved
  titles (#1074) and Location Management's locations (`rasel/R60-sm3-job-titles`); New Accounts &
  Security comes next on the security defaults (#1074). The Reports shortcut still needs a Staff
  and Team report in Reports (its owner to name), so that card stays as it is.
- **The Locations screen (Rasel, Oct 25: record, do not build now; owner to be named):** R1 built Location Management's API
  (`/business/locations`), but the web has no Settings > Locations page (`/settings/locations`, which
  Billing's dialog already links to, answers 404). Offices & Job Titles lists the firm's active
  locations and says they come from Location Management, without a link until the page exists.
- **New Accounts & Security (built, `rasel/R60-sm3-security-defaults`): what it cannot do yet.**
  1. *Firm setup's Team step* invites through `POST /auth/invites`
     (`apps/api/src/auth/invites.controller.ts`, outside R60's paths), which creates an account
     with no security row; the row is made later with the columns' own defaults, not the firm's.
     Create Staff and Bulk Upload Staff start from the firm's defaults. **R55 (Rasel, Oct 25)**
     adds the one-line call when the invite creates the member: `newAccountSecurity(tx,
     businessId)` (`apps/api/src/staff/staff-security-defaults.service.ts`) as the start of its
     `staff_security_settings` row. R60 does not touch the sign-in code.
  2. *Enforcement:* sign-in does not enforce any staff security setting yet (Settings checks,
     check 6), so the defaults, like each account's own settings, are stored and shown only.
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
- **I7, the firm's own address on submit (Rasel, Oct 25: yes, by default):** a new settings row
  and Reset Defaults start Notify additional emails with the firm's contact email
  (`business_settings.contact_email`); the firm removes it to stop it. Firms whose settings row
  already exists need column request item 12 (a data change) to get it.
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
3. ~~Applying a Request Change~~ Answered Oct 24: R56 builds the Super Admin action (Needs).
4. ~~Billing: requests or self-serve?~~ Answered Oct 24: requests for now, no self-serve Stripe.

## Column request for R1 (approved by Rasel, Oct 24)

For the fresh R1. Items 1 to 6 approved on Oct 24 (morning), 7 to 11 on Oct 24 (afternoon). R1
builds them one migration PR at a time: 1 to 6 in #1074 (merged), 7 to 11 in one PR of five
migrations. Every new firm table gets `business_id` with the firm's
row-level security like the other firm tables. R60 builds the API and screens on each after it
merges. Old columns stay until R60's API reads the new ones, then a later migration drops them.

**Where each stands (Oct 24), and what R60 builds on each:**

| Item | State | R60 builds after it lands |
| --- | --- | --- |
| 1 to 4 (intake settings) | Landed in #1074 | Octavia's I7, I8, I9 and I12: the four settings on the API and the Notifications & Reminders panel |
| 5 and 6 (SM3) | Landed in #1074 | Saved job titles and new-account security defaults, API and screens; SM3's two routes |
| 7 (`firm_licenses`) | R1's `rasel/R1-r60-columns-2` | The Licensing card's rows and the request's "Current"; R56's apply action writes the rows. The one R60 needs first from that PR |
| 8 (staff email on, data only) | Same PR | Nothing (the API reads them as on today) |
| 10 and 11 (SM11, SM8) | Same PR | Work Start Date in Create and Edit Staff; company schedules, add and archive |
| 9 (`users.phone_verified_at`) | Same PR | The staff code-by-text verification (R6's sender, SNS in AWS), then SMS for verified staff |

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

7. **Company Profile, professional licensing (added Oct 24, approved Oct 24).** Table
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
9. **Notifications, a verified staff mobile number (added Oct 24, approved Oct 24).**
   `users.phone_verified_at timestamptz NULL`, cleared whenever `users.phone` changes (the
   same transaction that clears the SMS choices, `Notifier.phoneChanged`). With it R60 builds
   the staff verification (a code by text through R6's sender) and offers SMS to verified staff.

10. **Staff SM11, Work Start Date (added Oct 24, approved Oct 24).**
    `staff_profiles.work_start_date date NULL`, distinct from `hire_date` and the access start
    date. Create Staff step 4 and Edit Staff show it.
11. **Staff SM8, company work schedules (added Oct 24, approved Oct 24).** Table
    `staff_work_schedules`: `id` (uuid7), `business_id`, `name text NOT NULL` (1 to 80),
    `archived_at timestamptz NULL`, `created_by_user_id`, `created_at`, `updated_at`; unique
    `(business_id, lower(name)) WHERE archived_at IS NULL`; filled once from the distinct
    `staff_profiles.work_schedule`. A staff record keeps its own text.

12. **I7, the firm's contact email in existing intake settings (Rasel's tap, Oct 24 20:20 UTC; a
    data change only; R1's `rasel/R1-intake-contact-email`, #1121).** Since #1115 a firm's new intake
    settings start with its own contact email (`business_settings.contact_email`) first in
    `notify_additional_emails`. One data migration, `r1_intake_contact_email`, does the same once
    for the rows that exist:
    - **Per firm**, each in its own scope (RLS is forced).
    - **Where it adds:** the address, trimmed and lower-case, goes first in that firm's own list,
      only where the list does not hold it yet (ignoring case).
    - **Where it skips:** a firm with no valid contact email (the API's email check), with no
      intake settings, or with 10 emails already keeps what it has.
    - **Nothing else changes** (`updated_at` included). A second run changes nothing, and it logs
      no address.
13. **Staff phone verification codes (Oct 25, for Rasel's word; blocks item (c)).** Item 9 gave
    `users.phone_verified_at`, but no table holds a code sent to a staff member, so the API can
    neither check a code nor count wrong tries (`verification_codes` is keyed to a client account).
    Proposed: table `staff_phone_codes`, like `verification_codes`: `id` (uuid7), `business_id`,
    `user_id` (a member of the firm), `target` (the E.164 number the code went to), `code_hash` (an
    HMAC, never the code), `attempts int NOT NULL DEFAULT 0`, `expires_at` (at most 15 minutes after
    `created_at`), `consumed_at NULL`, `created_at` (the database's clock); the firm's row-level
    security; SELECT, INSERT and UPDATE only (attempts +1 at a time, `consumed_at` once, on the
    newest unexpired code for that user); no DELETE; index `(user_id, created_at DESC)`. With it
    R60 builds: Send Code (one per minute, a daily cap per firm as the client codes), Verify (5
    tries, then a new code), and on success `phone_verified_at` set in the same update as the number;
    then SMS for verified staff. Alternative for Rasel: let `verification_codes` take a staff
    `user_id` as well as a client account.

**Schema request, for Rasel to decide later (Oct 25, not a PR):** per-send reminder times. The
Send page shows the firm's times ("View Schedule", read-only) because a send keeps only
`intakes.reminders_enabled`. Times of its own would need `intakes.first_reminder_minutes`,
`final_reminder_minutes` and `expiry_alert_minutes` (nullable: null takes the firm's), with
the same ranges as `intake_settings`; the Send page's Edit Schedule would then save them.

Offices need no column: they are R1's Locations API (`firm_offices`).

## Checks that fail on clean `main` too (not R60's changes)

- `apps/web/e2e/mock/r19-payments-settings.spec.ts` "other roles" and "answers from the API": on
  Windows they cannot start their extra mock servers (`spawn pnpm ENOENT`: `spawn` without a
  shell). Local only; CI (Linux) runs them. Its two in-page tests pass locally.

- `apps/api/test/e2e/automations.e2e.test.ts:708` (R55's automations): the same window. It makes a rule
  that expired "yesterday" in UTC, while the service compares with the firm's day (New York), so
  from 00:00 to 04:00 UTC the rule is not yet expired and two more cases after it fail. Seen on
  #1065's run at 01:20 UTC. **Fixed on `rasel/R60-payments` (Oct 24, Rasel's word):** its `day()`
  takes the firm's New York date, which the job's expiry, task due dates and the runs filter use.
- `apps/api/test/e2e/leads-pipeline.e2e.test.ts:311` (R55): the date filter test took "today" in
  UTC while the API filters days in the firm's time zone (America/New_York). Fixed on `main` (it
  takes the New York date now).

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
- Oct 24 (fourth session, Rasel's "Fresh R60 v2"): `rasel/R60-payments` was 16 commits ahead of
  origin (the Billing merge and `main`); pushed first. #1073 (Billing): its CI failed once on
  `workspaces.e2e.test.ts` (q5, a 100 ms race, not Billing's) and passed on a rerun; merged. On
  Payments: the automations test's `day()` takes the firm's New York date (Rasel's word; 17 of 17
  locally) and the notes take Rasel's decisions (Billing by request, R56 applies a Request
  Change, column items 7 to 11 approved with R60's order). #1076 (Payments) opened; CI green.
  Staff (`rasel/R60-staff-sm8-13`) merged `main` (with #1073 and R1's #1074): API and web `tsc` 0
  errors, departments and staff e2e 20 of 20, Staff mock specs 54 of 54; its PR opened in the
  slot #1073 freed.
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
- Oct 24 (fourth session): Rasel's go on column items 1 to 6 (#1074). SM3 Offices & Job Titles
  (`rasel/R60-sm3-job-titles`): the saved job titles API (Owner and Admin; 409 `JOB_TITLE_EXISTS`
  and `JOB_TITLE_ARCHIVED`; audit rows hold no name), the editor page, Staff Settings' card opening
  it, and Create and Edit Staff offering the saved titles and the active locations. Job titles e2e
  8 of 8, staff e2e 8 of 8, contract unit 20 of 20, `r60-staff-job-titles` and the Staff specs 10 of
  10, API and web `tsc` 0 errors; the isolation sweep's only local failures are the known
  file-scanner ones. Sheet shot on the real API. No Locations page exists (Needs).
- Oct 24 (fourth session): I8 (`rasel/R60-intake-reminders`, from `main`; PR once #1088 merged): the first and final reminders in minutes (`firstReminderAfterMinutes`,
  `finalReminderAfterMinutes`; her 5, 10, 15 and 30 minutes, 1, 2, 3, 6 and 12 hours and 1 to 30
  days, "after sending"), the old day columns kept valid on every save (rounded up, the final
  after the first), the test reminder's wording in minutes, and the Send page's schedule showing
  the firm's times (a send keeps only on or off; "View Schedule" instead of fields the API never
  kept). Intake workspace e2e 17 of 17, unit 11 and 10, the Intake Forms mock specs 38 of 38;
  sheet shot on the real API.
- Oct 24 (fourth session): SM3 New Accounts & Security (`rasel/R60-sm3-security-defaults`, from
  `main`): `api.staff.securityDefaults` and `saveSecurityDefaults` (Owner and Admin; version and
  409 `SAVE_CONFLICT`; the lists with their access choice; the audit row names the changed
  settings), the page at `/team/settings/security` (who it affects, a confirm before saving), Staff
  Settings' card showing them, Create Staff step 3 and every new account (Bulk Upload too)
  starting from them, step 3's choices winning. Defaults e2e 6 of 6, staff write and security e2e
  34 of 34, contract unit 20 of 20, the Staff mock specs 55 of 55, API and web `tsc` 0 errors.
  Sheet shot on the real API. Firm setup's invite (`/auth/invites`) is outside R60's paths (Needs).
- Oct 24 (fourth session): Rasel's fix before the next feature (`rasel/R60-profile-ein-last4`,
  from `main`): Request Change keeps only the proposed EIN's last four digits in the ticket
  ("Proposed: Ending in 4321"); the full number is in no ticket, audit row, log or answer (the
  e2e checks the stored ticket, the POST and GET answers and Super Admin's detail). The dialog says
  so under New EIN. Profile-changes e2e 6 of 6, `r60-profile-request-change` 2 of 2.
- Oct 24 (fourth session): I9 (`rasel/R60-intake-expiry-alert`, stacked on I8, which merged as #1094): the
  expiration alert in minutes (`expirationAlertMinutes`; 30 minutes and 1, 2, 3, 5, 6, 10, 12, 24,
  42 and 72 hours) and No alert (null, now taken), the old hour column following (rounded up,
  kept under No alert), the Send page's schedule saying it. Intake workspace e2e 17 of 17, types
  unit 12 of 12, the Intake Forms mock specs 39 of 39; sheet shot on the real API.
- Oct 24 (fourth session): I7 (`rasel/R60-intake-additional-emails`, stacked on I9, local): Notify
  additional emails (`additionalEmails`: up to 10, lower case, each once; the editor under
  Notifications & Reminders), and on each client submit a no-content notice to them (the new
  `intake.submitted-notice` template: the form's title and the Intake Forms link, no name or
  answer; `intake-workspace/submitted-notice.ts`, called after the Notifier in the portal submit).
  Intake workspace and intakes e2e 45 of 45, notify templates unit 75 of 75, the Intake Forms mock
  specs 40 of 40; sheet shot on the real API with the email as rendered.
- Oct 24 (fourth session): I12 (`rasel/R60-intake-retention`, stacked on I7, local): Data
  retention period in Security & Compliance (`dataRetentionYears`: 1 to 100 whole years, or not
  set), saved and shown only; the e2e checks that saving one deletes no intake, submission or
  document. Intake workspace e2e 19 of 19, types unit 13 of 13, the Intake Forms mock specs 41 of
  41 (one cold-start failure passed on rerun); sheet shot on the real API.
- Oct 25 (fourth session): Rasel's answers. I7: the firm's contact email starts Notify additional
  emails for a new settings row and on Reset Defaults (existing rows: column request item 12);
  intake workspace e2e 19 of 19, `r60-intake-settings` 14 of 14. Needs: R55's one line in the
  firm setup invite; the reminder and alert sender and the Locations page recorded, not built;
  per-send reminder times written as a schema request.
- Oct 25 (fifth session): #1116 merged `main` after #1115 (head `c02c020`, CI green). (a) SM11
  Work Start Date as #1128 (CI green). (b) SM8 company schedules and (d) the licensing card built,
  tested and pushed (`rasel/R60-staff-schedules`, `rasel/R60-firm-licenses`), waiting for a PR
  slot. (c) blocked on column request item 13 (staff phone codes). The duplicate item 12 (the
  unapproved draft) is removed; item 12 is R1's #1121.
- Oct 25 (fifth session): #1116 (I12) merged `origin/main` after #1115: the stale
  `intake.submitted-notice` line in `ALWAYS_SENT` (main's CI fix had removed it) dropped again;
  API unit 1724 of 1724, typecheck 0; head `c02c020`, CI green. (a) SM11 Work Start Date
  (`rasel/R60-staff-work-start`): `workStartDate` in `StaffDetailsInput` and
  `StaffProfileDetails`, saved and read by the staff API; step 4 shows it under Hire Date; the
  design's "Start Date" (step 1 card 4 and Edit Staff card 4) now saves it, and Edit Staff gains
  Hire Date so it stays editable; the Success page's Start Date reads it first. staff-write e2e
  23 of 23, types 22 of 22, staff mock specs 18 of 18; sheet shot on the real API.
- Oct 25 (fifth session): (d) the firm's licenses (`rasel/R60-firm-licenses`, from `main`, local
  until a PR slot frees): `GET /business/settings/profile/licenses` (Owner and Admin, also while
  Pending Setup; no firm route writes one) and `api.profileChanges.licenses()`; the Professional
  Licensing card lists five locked rows per license (one block per license), "Not on file" when
  none, a quiet note when unreachable; Request Change's "Current" (dialog and ticket) shows each
  license's value, oldest first, joined with "; ". Profile changes e2e 8 of 8, contract 5 of 5,
  `r60-profile-request-change` 2 of 2; sheet shot on the real API (one fake license written as
  the platform in the local database).
- Oct 25 (fifth session): (b) SM8 company work schedules (`rasel/R60-staff-schedules`, from
  `main`, local until a PR slot frees): `api.staff` work schedules (list, add, rename, archive,
  restore; 409 `WORK_SCHEDULE_EXISTS` and `WORK_SCHEDULE_ARCHIVED`) on R1's
  `staff_work_schedules`, as #1088's job titles; `StaffFormOptions.workSchedules` = the presets,
  then the saved live ones (a saved one named like a preset is offered once); a Work Schedules card
  on Offices & Job Titles (the Job Titles card made generic); step 4's note says a custom schedule
  stays on its record. Staff e2e 24 of 24 (schedules 8, job titles 8, staff 8), isolation: only
  the four known local failures, mock specs 11 of 11; sheet shot on the real API. (c) is blocked:
  no table holds a staff code (column request item 13, for Rasel); (d) next.
- Oct 25 (fifth session): Dashboard group 2 (`rasel/R60-dashboard-lists`): T4 (a task's title
  opens `/tasks/{id}`; the client is a separate link, shown as a link only with Clients view), T5
  (the checkbox asks "Mark this task complete?"; Cancel changes nothing; an error says the task is
  unchanged), A2 (a row opens `/calendar/{id}`), A3 (the row menu: View Details, Edit,
  Reschedule, Send Reminder, Mark Complete, Cancel with the calendar's own confirmation, Open
  Client; by the role's grid; the video icon links only an https meeting link), A4 (the next two
  weeks in a scrolling, keyboard-reachable list; `RowMenu` gains `fixed` so a scrolling list does
  not clip it), N2 (opening the bell marks the notifications it shows as read), N3 (an appointment
  notification opens `/calendar/{id}`). Contract unit 49 of 49, mock specs 3 new plus the
  dashboard's and the notifications' 21; sheet shot on the real API (two fake appointments added
  to the local database).
- Oct 25 (fifth session): Octavia's review of Oct 25 (`docs/specs/review-2026-10-25/`), Dashboard
  group 1, K2 to K7 (`rasel/R60-dashboard-kpis`): each KPI card opens its list filtered to what it
  counts, with Back to Dashboard (`?back=dashboard`, `components/back-to-dashboard.tsx`). New Leads
  = stage New Lead created this month (Leads' scope); Returns In Progress = the five in-progress
  workflow statuses (`TAX_RETURN_IN_PROGRESS_STATUSES`, `workflowGroup=IN_PROGRESS` on the list);
  Completed Returns renamed Accepted Returns = Accepted this month by the status history
  (`acceptedFrom`/`acceptedTo` on the list); Outstanding Invoices = every OPEN invoice (an
  Outstanding option and its total on the list); Appointments Today and View Calendar open Today.
  The pipeline's Leads leaves archived leads out (as Leads does). Dashboard e2e 9 of 9, returns
  workspace e2e 7 of 7, mock specs 28 of 28; sheet shot on the real API. (c) still waits for R1's
  `staff_phone_codes`.
- Oct 25 (sixth session): `origin/main` merged into #1147 after R55's periods (#1146) and #1148.
  The cards keep R55's period selector and comparisons and count by group 1's rules over the global
  period: New Leads = New Lead created in the period; Returns In Progress = the in-progress
  workflow statuses at the period's end (now: their status; earlier: the status history); Accepted
  Returns = accepted in the period (history). New Leads and Accepted Returns open their lists with
  the period's dates. The pipeline keeps R55's counts. Dashboard and returns workspace e2e 18 of 18,
  dashboard unit 12 of 12, dashboard mock specs 29 of 29 (two only pass serially: load).
