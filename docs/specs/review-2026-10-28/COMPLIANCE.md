# Octavia's review of Compliance and Deadlines (28 Oct): change list

Source: `Compliance and Deadlines Developer Feedback` (browser review of 28 Oct 2026, Owner account, DEV). Report codes are kept in every item: C-F01 to C-F06 (defects), C-G01 to C-G03 (gaps), C-U01 (user addition), C-R01 to C-R08 (suggestions and confirmations), C-001 to C-022 (test groups), P01 to P42 (pending work), CD-001 to CD-172 (original guide items), and section numbers 1 to 17.

## Summary

1. Report colors: RED 8 (C-F01 to C-F06, C-G01, C-U01; Sections 12 and 15 roll up as RED). YELLOW: 3 findings (C-G02, C-G03, C-014), plus C-021, 8 suggestions or confirmations (C-R01 to C-R08), and 42 pending groups (P01 to P42) covering 139 CD items. Confirmed GREEN: see section I.
2. This list: 17 build/fix items (CD-F01 to CD-F17) and 17 decision/fixture items (CD-Y01 to CD-Y17).
3. Highest priorities: CD-F01 duplicate linked tasks (C-F01), CD-F02 effective-date filters vs the Upcoming list (C-F04), CD-F10 recurring edit fails to save (C-F05), CD-F03 at-risk View Client and Back (C-F06), CD-F14 applicability criteria shown (C-G02), CD-F06 attachment workflow (C-G01).
4. Also high: CD-F05 and CD-F09 lose filters and tab on Cancel, Back and refresh (C-F02, C-F03); CD-F15 audit and log navigation (C-G03).
5. Database change: none confirmed. Possible, to check first: CD-F01 (unique key on the deadline to task link or an idempotency key), CD-F06 (upload linkage to the deadline), CD-Y04 (source URL, effective year, last-verified, payment date on deadlines if not already stored). Each is a "Schema or infra request" issue for Rasel, not a change from this list.
6. Roles and permissions: no role or permission change is requested. Touching them: CD-F06 (permission errors on upload), CD-F16 (permitted detail access in logs), CD-Y13 (server-side allow/deny matrix and cross-business checks; only Owner was tested).
7. Every fix: unit test, e2e per endpoint touched, tenant-isolation test for new tenant data, audit entry for actions on client data, synthetic data only, no reminder, email, SMS or portal delivery from any test.
8. Nothing here certifies statutory accuracy. Guide tax examples stay reference material (CD-Y07).
9. Where the report asks Octavia for something, a default is written in the item and marked "Default". Defaults are reversible and shown at review, not asked.
10. Retest evidence per item should record owner, build, date and result (report "Next decision").

## Defaults taken for her (reversible, not asked)

- D1. All six suggestions C-R01 to C-R06 are adopted as written, in the smallest form that satisfies each (CD-F04, F08, F13, F12, F07, F16). The report calls them proposals, not guide failures; P42 priority is set by this list's order.
- D2. Manual task creation stays recorded in the global Audit Log (C-G03); the module Logs gains links to it rather than duplicating events.
- D3. Linked tasks do not silently rewrite deadline dates, and deadlines do not auto-complete tasks (P27, P28); any propagation is a documented, default-off setting.
- D4. Tests never send anything: reminders, portal visibility and delivery stay off; a test delivery sink (Mailpit and SMS log) is the only recipient.
- D5. Fixtures are new synthetic clients, calendars and tasks in the dev firm and a second test business; the existing three client profiles and the existing IRS calendar are never edited.
- D6. Unknown or uncertain dates always show Needs Verification and never a guessed date (confirmed by C-005, C-016; keep).

## Where things live (one line per screen)

| Screen | Route | Files |
| --- | --- | --- |
| Overview, All Deadlines, By Client, By Type, Tax Calendar | `/compliance` | `apps/web/src/app/firm/(workspace)/compliance/_components/compliance-screen.tsx`, `compliance-views.tsx`, `deadline-table.tsx` |
| Add / Edit Deadline | `/compliance/new`, `/compliance/[id]/edit` | `deadline-form.tsx`, `deadline-dialogs.tsx` |
| Deadline detail | `/compliance/[id]` | `deadline-detail-screen.tsx` |
| Recurring workspace (six tabs: setup, manage, import, library, applicability, logs) | `/compliance/recurring/new?tab=...` | `recurring-setup.tsx`, `recurring-list.tsx`, `calendar-import.tsx`, `calendar-library.tsx`, `rules-tab.tsx`, `logs-tab.tsx` |
| Settings | in the module | `compliance-settings.tsx` |
| API | `/api/v1/compliance` | `apps/api/src/compliance/compliance.controller.ts` (task create: `POST :id/tasks`, `POST :id/tasks/link`), plus the deadlines, recurrences, rules, calendars, settings services |
| Mockups | | `docs/mockups/firm-workspace/compliance/source` |

## A. Overview and All Deadlines (`/compliance`)

### CD-F01. Duplicate linked tasks (RED, High)
- Source: C-F01, C-007, P29, Section 12, CD-123, CD-148.
- Observed: Create Task on one deadline succeeded twice and made two distinct linked task IDs; the action stayed enabled after the first. Tasks `01a1809e...` and `01a1809f...` are kept as evidence.
- Build/fix: make task generation idempotent per deadline and task template at the API boundary (`POST :id/tasks`): a repeat returns the existing task, not a new one. Disable the action while the request runs, and after creation show View Task (row menu in `deadline-table.tsx` and the detail screen). Hold under double-click, refresh, retry and concurrent requests. Different intended templates stay allowed. Write the audit entry once.
- Retest: one task and one stable link only; repeat create returns the existing task.
- Schema? No, to check (a unique key on the existing deadline to task link may be the cleanest guard; Rasel decides).

### CD-F02. Date filters, effective dates and the Upcoming list disagree (RED, High)
- Source: C-F04, C-008 narrow, P06, P04 (fix part), CD-007, CD-012, CD-141.
- Observed: original due 12 Nov, extended 12 Dec, status Completed: the record showed in the Upcoming table under Next 30 Days; Next 7 hid it and Next 30 brought it back. Cause unproven; do not assume the backend filters by original date.
- Build/fix: document and apply one date basis per view (original, adjusted, extended, and which one a range filter uses), and one status rule per view. Default: ranges and the Upcoming list use the effective due date (extended when set) and exclude Completed and Not Applicable; label the basis on screen so list and KPI scope are clear. Same rule for KPIs, list, By Client, By Type and Tax Calendar.
- Retest: original-date versus extended-date boundaries, Completed exclusion, Next 7 / Next 30 / All Dates and combined filters, fixed clock, firm timezone.
- Schema? No, to check.

### CD-F03. At-risk View Client opens the generic overview; Back loses filters (RED, Medium)
- Source: C-F06, C-019, P08, CD-015, Section 13.
- Observed: one overdue QA deadline showed risk reason "1 overdue", but View Client opened the generic client overview; browser Back reset All Dates to Next 30 Days.
- Build/fix: View Client opens the affected client's compliance view with the risk filter and reason visible. Use the shared origin-link Back (SH1 pattern from the Oct 26 list) so the originating tab, date range and filters return on both browser and in-app Back. No client data edited.
- Retest: one-overdue fixture, correct client, risk context shown, return keeps All Dates.
- Schema? No.

### CD-F04. Search and custom date range (YELLOW suggestion, adopted by default)
- Source: C-R01, P42.
- Observed: Overview and All Deadlines have preset ranges and native selects only; no deadline-name search and no custom range. By Client already has search.
- Build/fix: add deadline, form or agency search and From/To dates on Overview and All Deadlines; make long client and assignee lists searchable; keep queries on Back (CD-F03). Default: tax-year, source, jurisdiction, priority, recurring and unassigned filters are added only where the field already exists on the deadline; any not stored are listed, not invented.
- Retest: combined filters and no-result states.
- Schema? No, to check.

## B. Add / Edit Deadline (`/compliance/new`, `/compliance/[id]/edit`)

### CD-F05. Cancel loses context (RED, Medium)
- Source: C-F02, P40.
- Observed: All Deadlines + All Dates + Other, then Add Deadline, then Cancel returned to Overview + Next 30 Days + All Types.
- Build/fix: Cancel and Back return to the originating list, tab, date range, type and other filters, saving nothing. Same origin-link mechanism as CD-F03.
- Retest: from All Deadlines and one other filtered view; filter values, selected tab, no new record.
- Schema? No.

### CD-F06. Attachments: direct upload is unfinished (RED, Medium)
- Source: C-G01, C-021 (YELLOW), P11, P38, CD-022, CD-023, CD-130, CD-142.
- Observed: the form says uploading files here is not connected yet and points to existing client documents under Related Items. Add Document showed "Nothing to add" for the test client (no eligible document).
- Build/fix: the guide does not mandate one upload mechanism. Default: finish the upload action in the form, using the existing documents module and its secure storage, so the file lands as a client document linked to the deadline (no duplicate records); keep linking an existing document. Remove the "not connected" text. Validate allowed types and size; show permission errors; show download and correct client association.
- Retest: allowed and invalid types, size limit, permission error, persistence after refresh, download, no duplicate document (needs fixture CD-Y17).
- Schema? No, to check (link between document and deadline may already exist from Related Items).

### CD-F07. Completed record shows as editable (YELLOW suggestion, adopted by default)
- Source: C-R05, C-009 guard, P42.
- Observed: Edit on a Completed record showed status Upcoming and accepted note edits; Save then correctly rejected with "reopen first".
- Build/fix: show the real Completed state read-only, with a clear Reopen action before editing and the restriction explained before typing. Keep the server guard. No accidental reopen or status rewrite.
- Retest: no status change persists from opening Edit; Reopen path works.
- Schema? No.

### CD-F08. Tax Year and Filing Period limits (YELLOW suggestion, adopted by default)
- Source: C-R02, P42.
- Observed: Tax Year offers 2024 to 2027; Filing Period offers Annual, Q1 to Q4, Monthly, without choosing the month.
- Build/fix: allow earlier and later years, a specific month, a custom period and a fiscal-year boundary, with validation.
- Retest: amended or prior-year work and a non-calendar-year client.
- Schema? No, to check (a month or period field may be needed).

## C. Recurring workspace (`/compliance/recurring/new`)

### CD-F09. Selected tab and URL disagree after refresh (RED, Medium)
- Source: C-F03, P40.
- Observed: opening `?tab=manage`, choosing Logs and reloading returned to Manage Existing Recurring because the URL still held `?tab=manage`.
- Build/fix: write the selected tab to the URL (history entry) and read it from the URL, for all six tabs. Browser Back and Forward keep the visible tab and URL aligned.
- Retest: Manage, Logs, refresh; Logs stays; Back and Forward; each tab.
- Schema? No.

### CD-F10. Recurring edit (Save Changes) fails (RED, High)
- Source: C-F05, C-017, P15, CD-029, CD-033, CD-043, CD-143.
- Observed: changing only Description then Save Changes failed with a generic "details need fixing" error on both the saved template and a non-template definition; no aria-invalid fields; reload proved nothing saved. Pause and Resume do persist.
- Build/fix: find and fix why a valid edit is rejected (`recurring-setup.tsx`, `recurring-list.tsx`, recurrences service). Attach any real validation error to its field (focus, aria-invalid, text) and keep entries. A server error must not be shown as a validation message. Pause, resume, end and archive regress.
- Retest: own test recurrence, edit Description only, save, reload; template and non-template; invalid-field feedback. The initial transient loading text is not a finding.
- Schema? No, to check.

### CD-F11. Custom interval 0 summary is wrong (YELLOW observation)
- Source: C-022.
- Observed: Custom 0 suppressed dates and asked to finish the schedule, but the summary still said "Every 1 months".
- Build/fix: the summary matches the invalid state (no claim of a frequency); zero interval stays blocked with a message.
- Retest: interval 0, empty and valid values.
- Schema? No.

### CD-F12. Unsaved import preview discarded silently (YELLOW suggestion, adopted by default)
- Source: C-R04, P42.
- Observed: switching tabs after filling an import preview dropped the form; returning reset it.
- Build/fix: keep the draft across tab switches, or warn before discarding with an explicit Discard. Apply to Cancel and Back. No duplicate import.
- Retest: return, deliberate discard, navigate away.
- Schema? No.

### CD-F13. Library and recurring filters (YELLOW suggestion, adopted by default)
- Source: C-R03, P42.
- Observed: Calendar Library has Status and Family filters only; Manage Existing Recurring has no search or filter; rule state and status criteria are free text.
- Build/fix: library search by name, form or authority, plus year, jurisdiction and verification-age filters; recurring filters active, paused, ended, template; replace free-text state and status in rules with validated multi-selects.
- Retest: invalid codes, empty results, retained selections.
- Schema? No, to check.

## D. Applicability (rules tab, `rules-tab.tsx`)

### CD-F14. Applicability criteria not exposed (YELLOW, High; build part)
- Source: C-G02, C-004 narrow, C-018 narrow, Sections 6 and 7, CD-055, 058, 059, 060, 062, 063, 066, 145.
- Observed: only entity checkboxes, free-text state codes, five service checkboxes, excluded statuses and a prior-liability threshold. Tax classification or election, fiscal year, jurisdiction, payroll form and sales-tax frequency are not separately exposed; they may be derived from client data. Backend applicability is not established.
- Build/fix: provide the criteria either as configuration or as a shown derivation from client data (separate widgets are not required). Treat LLC as more than one federal tax classification (default single-member, multi-member, S or C election). Validate selections and show why a rule applies. No blanket assignment.
- Retest: with fixtures from CD-Y02.
- Schema? No, to check (depends on what client fields already exist).

## E. Logs and audit (`logs-tab.tsx`, global Audit Log)

### CD-F15. Where manual task creation is logged (YELLOW, Medium)
- Source: C-G03, C-011 narrow, C-013 narrow, P03 (routing part), CD-034, CD-124, CD-133.
- Observed: module Logs showed two Generate Success events, an Override Success and Import/Verify; both manual task-created events appear only in the global Audit Log.
- Build/fix: default D2 applies. Add a link from module Logs to the Audit Log filtered to Compliance, and an "Audit history" link on the deadline detail that opens the global Audit Log filtered to that record. Add affected-record links on each Logs row. This is discoverability, not missing auditing.
- Retest: manual Create Task and applicability Generate with cleared filters: event scope, actor and time, outcome, record link.
- Schema? No.

### CD-F16. Logs filters and detail (YELLOW suggestion, adopted by default)
- Source: C-R06, C-013 narrow, P42.
- Observed: Logs offer Event and Result only; details are generic; no entity or name search, date or actor filters. Edit audit details show changed field names and dateMoved, not before and after values.
- Build/fix: add record name or ID search, date range, actor and text filters; show affected record, before and after values, rule and version, and deep links. Detail access follows the viewer's permissions.
- Retest: return to the same filtered log; permitted and denied detail access.
- Schema? No, to check.

## F. Cross-cutting

### CD-F17. Contextual Help or Info controls (RED, new user requirement)
- Source: C-U01, P41.
- Observed: required addition; coverage was not audited, no claim every icon is absent.
- Build/fix: one consistent Help/Info control, from `packages/ui`, in overview, filters, Add/Edit, recurrence, import, library, applicability, management, logs and settings. Each says purpose, what the area does, inputs and consequences. High-impact actions (override, publish, task generation, reminders) are explained in plain wording. Works with hover, keyboard focus and tap or click; labeled for assistive tech; closes with Esc or Close; no hover-only text; opening it never saves or sends. Wording default: short text drafted by us, shown at review.
- Retest: hover, focus, touch and click, Esc, readable text.
- Schema? No.

## G. Decisions and fixtures (CD-Y, no question goes to Octavia)

| ID | Source | Need | Default we choose |
| --- | --- | --- | --- |
| CD-Y01 | C-014, P27, CD-119, CD-122 | Linked task showed due 12 Nov and Pending after the deadline moved to 13 Nov; Related To blank; no visible deadline backlink. Sync policy not exposed; not proven a defect. | Show the deadline in the task's Related To and a task link on the deadline. Date and status sync are off unless a documented setting is on; show the active policy. Tasks-side tests on a synthetic pair. Schema: no, to check (task.deadline_id and deadline.task_id reciprocity). |
| CD-Y02 | C-G02, P02, P20, P21, P34, CD-055 to 068, 067, 068, 134 | Controlled clients for each dimension: default single-member LLC, multi-member LLC, S or C election, fiscal year, 941/944/940, sales frequency, exclusions, missing-data cases. All three current clients lack entity type (Check: 0 matches, 3 Needs Review). | Create new synthetic clients and an isolated rule and calendar; never edit the existing three. Cover positive, negative, unknown, a change after a deadline exists (history kept), and one confirmed deadline showing why it applies and rule and calendar version. |
| CD-Y03 | C-R07, P05, CD-011 | Settings show Due Soon, At Risk, Stale Calendar and Escalate thresholds, no applicability, calendar or holiday defaults. Where are they configured? | Show the real location in this list's PR: either link from Compliance Settings to the canonical setting, or add the missing defaults there. Use a disposable test business; verify save, readback and inheritance. Schema: no, to check. |
| CD-Y04 | C-R08, P14, P24, CD-027, 094 to 099, 146, 149 | Manual Government source shows Statutory due date but no payment date, source URL, effective year or last-verified. | Default: those fields come from the imported or official calendar path, not manual entry; show them read-only on the deadline, and keep original, adjusted, extended and payment dates separate. An extension never moves the payment date. Prove with one verified statutory fixture. Schema: no, to check (add only if the fields do not exist). |
| CD-Y05 | C-016 narrow, P16, CD-030, 044 to 054, 162 | Compare needs a second version of one family, authority and year; only an unrelated IRS calendar exists. Own Draft with an unknown date cannot be verified (correct). | Seed two isolated versions of one family with verified dates, a known-good Published baseline, and a restricted publisher. Test diff, approval, publish, supersede, archive, rollback and retention without touching the existing IRS calendar. |
| CD-Y06 | P19, P35, CD-052, 135 to 137 | Failure and staleness paths not injected. | Test-only fault harness in DEV for a malformed update and a conflicting override (last good version stays, safe retry, audit); controlled clock and last-verified date for the Stale Calendar boundary. Shared thresholds are not changed; use an isolated calendar. |
| CD-Y07 | P22, P23, CD-069 to 076, 078 to 093, 100 to 106, 147, 153 to 161; Sections 7, 8, 10, 16 | Guide rules were read, not validated as current official law; no content approver named. | Treat guide tax examples as reference. Every seed or rule carries source, year and verified date, or shows Needs Verification. Do not accept dates as current law. Firm content approver: we propose the Owner of the dev firm for fixtures only; nothing is claimed as certified. Unknown-state case shows Needs Verification. |
| CD-Y08 | P18, P25, CD-037 to 040, 107, 108 to 116 | Deterministic date fixtures and one record per calendar family (IRS General, IRS Employer, State Income/Franchise/Privilege, Secretary of State, Sales & Use Tax, Payroll/Withholding, Local Business License, Professional/Industry License, Firm Internal). | Fixtures for monthly, quarterly, annual, custom, authority, leap day, month end, N-occurrences, end date and no end; expected holiday results set by us from a stated holiday list. Preview and queue only; no live scheduling. Each family has its own ID and independent filtering. |
| CD-Y09 | P01, P03, P32, CD-002, 004, 006, 034, 117, 124, 131, 133, 144, 150 | Evidence: source-of-truth date ownership, reciprocal IDs, provenance surviving edits, full audit payload (actor, time, entity, reason), prior Not Applicable reason after reopen. | Read-only schema and API trace in the PR. Add a history view that shows the prior reason after reopen. No missing-audit-backend claim. |
| CD-Y10 | P04, P30, CD-007, 128, 141 | KPI, list, calendar and tenant reconciliation; only overdue-based risk was tested. | Known synthetic ledger (status, risk, recurrence), a second test business, and a written risk formula covering overdue, high priority, missing document, approaching date and blocked work, each with reason and boundary. |
| CD-Y11 | P07, P09, P12, P13, P17, P38, CD-014, 016, 019, 024, 025, 035, 036, 125, 142 | Remaining action and form branches: reassign, archive, reminders, documents, every status and priority (including Waiting on Client and Cancelled), time boundaries, multiple reminders, live summary matches saved detail and stays read-only, Save & Create Another, Save as Template, template and government origins. | Run on owned dummy records with a non-notifying assignee and all delivery off. Repeat submit never duplicates. Do not mark Frame 2 passed from a basic save. |
| CD-Y12 | P10, P26, P28, P31, CD-020, 042, 118, 120, 121, 129 | Task templates, assignment, completion rule, reminder and escalation delivery. | Eligible synthetic task template and non-notifying assignee; delivery goes only to the test sink (D4). Deadline never auto-completes a filing; task completion follows an explicit setting (D3). Show routing, suppression, retry, dedupe and job trace. Portal login is outside scope. |
| CD-Y13 | P33, CD-132, 139 | Only Owner tested: no server-side denial or cross-business check. Touches roles and permissions. | API allow/deny e2e tests per role for each compliance action and payload, plus a second test business for cross-business ID checks, independent of hidden UI. Create isolated test roles in the dev firm only. No role or permission change to production behavior. |
| CD-Y14 | P36, CD-138, 151 | Network, timeout, conflict and error matrix. | Controlled offline, 409, 5xx and timeout responses on an owned unsaved form: form state kept, actionable error, idempotent retry; separate from the confirmed CD-F10 failure. |
| CD-Y15 | P37, CD-140 | Guide has no approved frame images. | Compare with `docs/mockups/firm-workspace/compliance/source` and the written specs; record intended deviations; no pixel-match claim beyond that reference. |
| CD-Y16 | P39, CD-152 | No responsive or keyboard accessibility audit. | Default matrix: latest Chrome, Edge and Safari at 1280 px and 390 px wide. Check primary-action visibility, overflow, focus order and visibility, labels, dialogs, error announcements and keyboard actions. |
| CD-Y17 | C-021, P11, CD-022, 023, 130 | Fixture for attachments: a harmless synthetic client document, a second owned deadline, test payment or proof metadata. | Add them to the dev seed (synthetic only) so CD-F06 can be retested; no real or confidential document. |

## H. Schema needs (each needs Rasel's tap; do not invent a column)

None confirmed. Check first: CD-F01 (unique key or idempotency key on the deadline to task link), CD-F06 (document to deadline link), CD-Y04 (source URL, effective year, last-verified, payment date), CD-F08 and CD-F13 (month or period, filter fields not yet stored). Open a "Schema or infra request" issue only if the check shows a gap.

## I. Confirmed as is (green, narrow; keep)

C-001 Overview structure (seven tabs, six KPI cards, seven filters, four quick actions); C-002 six workspace tabs and empty Preview Import validation; C-003 monthly previews and template save; C-004 empty applicability Save blocked; C-005 internal import preview (Needs verification); C-006 create validation and status persistence; C-008 original and extended dates shown apart; C-009 closed-record save guard; C-010 internal draft calendar persists; C-011 import in Logs; C-012 By Client, By Type and Tax Calendar views; C-013 own-record audit events; C-015 statutory override needs a reason; C-016 verify blocks unknown dates; C-018 recurrence end, suggest rule, Check, Generate, repeat Generate creates none, Dismiss needs a reason; C-020 Bulk Not Applicable reason; C-022 annual and every-2-months previews, authority-defined needs a published calendar. Test records kept in the footprint table of the report (retain; no cleanup claimed).

## J. Routing

| Area | Owner | Notes |
| --- | --- | --- |
| CD-F01, F02, F10, F15 | Rasel's API sessions (compliance services) | Idempotency, date basis, recurring save, audit links. |
| CD-F03, F05, F09, F12 | Frontend (shared origin-link Back, URL tab state) | Same mechanism as the other modules. |
| CD-F17 | Frontend, `packages/ui` (Fahad) | One Help/Info component. |
| CD-Y02, Y05, Y17 | Rasel (seed in `packages/db`) | Synthetic fixtures; schema or seed work goes through Rasel only. |
