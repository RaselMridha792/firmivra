# R12: Appointments, content, audit viewer, calculators and workspaces API (Oct 10-13)

**Goal:** Firms and clients book appointments without double booking; firms publish resources and external links; owners and admins read their audit log; clients use the calculators; staff work in the Bookkeeping and Tax Planning workspaces. Former developer tickets T07, T08 (Tumit) and I11 (Ibrahim), moved here on Oct 6.

**Owned paths (change only these):**
- `apps/api/src/appointments/**`, `apps/api/src/content/**`, `apps/api/src/audit-viewer/**`, `apps/api/src/calculators/**`, `apps/api/src/workspaces/**` (map them to the real layout once)
- the matching folders in `packages/types/src/` and `apps/web/src/mocks/`, and your registration lines in `apps/web/src/lib/api.ts`

**Read first (nothing else):** CLAUDE.md, docs/work/README.md, this file, and:
- the R0 tables for appointments, working hours, blocked times, appointment types, content items, calculator definitions and service workspaces
- apps/api/README.md, docs/junior/GUIDE.md

## Steps

- [ ] 1. Contract first, by Oct 10: schemas, client functions and mock fixtures for all five modules (Tumit F09 and N08, Nahid N09 and N10, Fahad F11)
- [ ] 2. Appointments: working hours, blocked time, appointment types, free slots, book (by staff or by the client), reschedule, cancel; R0's constraint stops double booking, so return a clear SLOT_TAKEN error; confirmations and reminders through R6 (`reminder_sent_at`)
- [ ] 3. Content: resources, tips and external links per firm (`content_items`, `icon_key`), the firm's editor and the portal's read; seed LVP's links
- [ ] 4. Audit log viewer: the firm's Owner and Admins read their firm's audit log with filters and paging; a Super Admin only through an active support grant
- [ ] 5. Calculators: the Tax Return Calculator first, with validated inputs and the disclaimer; definitions as data (placeholders until Octavia sends the list)
- [ ] 6. Service workspaces: Bookkeeping and Tax Planning per engagement: status, tasks, documents, notes, reports
- [ ] 7. Audit and e2e, including isolation

## Done when

Tumit's calendar and appointment screens, Nahid's External links, resources and calculator pages, and Fahad's workspaces work on dev.

## Rules

- Contract first for every module (step 1). Never edit screens: in apps/web change only `src/mocks/<module>.ts` and your lines in `src/lib/api.ts`.

## Needs from others

- R0 (asked Oct 7, Rasel approved): `appointment_types.cancel_cutoff_hours` integer, not null, default 24, 0 to 720 (0 = clients may change until the start). Clients reschedule or cancel only until that many hours before the start; staff always can.
- R0 (Rasel: R0 seeds them): LVP's starter external links, `content_items` kind `EXTERNAL_LINK`, published, from FirmVora_External_Links_Directions.docx section 3 (category = section, icon_key = source, sort_order as listed):
  - IRS & Business Taxes (`irs`): IRS Small Business & Self-Employed Tax Center, https://www.irs.gov/businesses/small-businesses-self-employed; IRS Employer Identification Number (EIN), https://www.irs.gov/ein (the doc's URL; the mockup shows /businesses/employer-identification-number); IRS - Pay Business Taxes from Your Bank Account, https://www.irs.gov/payments/pay-business-taxes-from-your-bank-account.
  - Funding & Financial Resources (`sba`): SBA Loans, https://www.sba.gov/loans/; SBA Lender Match, https://www.sba.gov/loans/lender-match/; SBA - Plan Your Business, https://www.sba.gov/counseling/plan-your-business/.
  - Business Planning & Market Research: FDIC Money Smart for Small Business (`fdic`), https://www.fdic.gov/consumer-resource-center/money-smart-small-business; U.S. Census - Census Business Builder (`census`), https://www.census.gov/data/data-tools/cbb.html.
  - Each description is the doc's "Client-Facing Description" (also in `apps/web/src/mocks/content.ts`). The resource pages' text and the calculator figures wait for Octavia.
- R11 (Rasel): workspaces read notes through R11's notes API with an engagement filter (`engagementId`), not their own copy.
- R1 (Rasel): R5's documents list with an engagement filter, for the workspace page.
- R6: appointment confirmations, change and cancellation notices, and reminders (`reminder_sent_at`), as configured (System Wiring section 2 and the notification table).

## Decisions (Rasel, Oct 7)

- Portal booking: only types with `client_bookable`; the client picks a type and a time. The staff member is the client's assigned one if free, otherwise the free member with the fewest appointments that day.
- The client's cutoff for reschedule and cancel is per appointment type (`cancel_cutoff_hours`, above); after it, 409 `CHANGE_WINDOW_CLOSED` (contact the firm).
- History without a new table: each book, reschedule, cancel, complete and no-show writes an audit row with who did it and the old and new times; the appointment detail returns them as its history.
- Owners: notes are R11's; tasks and reports (including the client's read of published reports in My Services) are R12's; R10 step 4 still creates the NAME_CHANGE task row; documents come from R5's list.
- Contract-only PRs don't count toward the 2-PR limit; one at a time from fresh main: appointments, content and calculators first, then workspaces and the audit viewer.
- Staff calendar access (#68's open question). Owner and Admin see and change everything. Staff:
  - see an appointment in full only when they are its staff member or its client is assigned to them (`clients.assigned_user_id`), the clients API's rule (#63);
  - see every other appointment only as Busy (`restricted: true`: time, staff member and status; no client, type, location, engagement, cancel reason or history); its detail is 404;
  - get 404 for a `clientId` filter on a client not assigned to them, so a Busy entry cannot be traced to a client;
  - book only for clients assigned to them, and reschedule, cancel, complete or mark no-show only appointments they see in full (404 otherwise);
  - still get every member's free slots (times and staff names only).
- Audit log viewer (#71 review): Owner and Admin, by the roles matrix (SYSTEM-DESIGN.md:211, PROJECT-DRAFT-v2.md:352); the lead asked Rasel to confirm.
  - A Super Admin's action through a support grant is written to both logs (SYSTEM-DESIGN.md:162). In the firm's log it shows as "Firmivra Support", with no user id and no IP.
  - Reading the log is logged: the first page of each read writes `audit_log.viewed` with the filters, never the rows (R10's "audit every read of client data").
- Report files (#71 review): never an INTERNAL document (firm only, schema.prisma:133-134). Attach and publish answer 409 `INTERNAL_DOCUMENT`. The client downloads only through R5's portal document route, which serves CLEAN files only.
- Not settled by the docs; the contract uses these defaults until Rasel answers (asked through the lead, Oct 7):
  - Who changes reports: whoever sees the workspace drafts, edits, publishes and unpublishes (Owner, Admin, and Staff on their assigned clients). This follows R10's "Staff see and edit only their assigned clients (and those clients' services and returns)"; the matrix's nearest row is "Change status: Staff if allowed".
  - No notice to the client on publish: R6 has no report template. If one is added, it carries no amounts (PROJECT-DRAFT-v2.md:415) and opens the report.
  - SPOUSE and AUTHORIZED logins see a service's published reports wherever My Services shows them the service. The schema has no per-member permissions yet.
  - Closed engagements: reports change only while the engagement is PENDING or ACTIVE. On COMPLETED or CANCELLED, create, edit and publish are 409 `ENGAGEMENT_CLOSED`; unpublish always works. The client sees published reports for as long as My Services shows the service.
  - Tasks follow the calendar rule. Staff see their assigned clients' tasks and the tasks assigned to them, and create tasks only for their assigned clients, like booking. Still open: the lead's stricter rule, that a client's task can go to a Staff member only when that client is assigned to them.
- Not R12 (told the lead):
  - Export: screen 27 is "Audit log and export", but no workstream owns export and no doc specifies it beyond "data export".
  - The client's own login history is only in the roles matrix: no screen, spec or builder.
  - PAGE-MAP has no firm audit-log page (screen 27) and no Super Admin one (screen 12).
- Resources and external links are business-only (System Wiring G): an INDIVIDUAL client gets 403 `BUSINESS_ONLY` for them, checked on the server from the client record's account type; tips are for everyone.

## Progress log

(newest last: date, step, what changed, commit)

- 2026-10-07, step 1 part 1 (contract PR from fresh main, branch `rasel/R12-contract-appointments`): appointments, content and calculators.
  - `packages/types/src/appointments`: types, availability (working hours, blocked time), the calendar (list, detail with history, slots, book, reschedule, cancel, complete, no-show) and the client's own (types, slots, book, reschedule, cancel). Error codes `SLOT_TAKEN`, `SLOT_UNAVAILABLE`, `CHANGE_WINDOW_CLOSED`, `APPOINTMENT_CLOSED`, `TYPE_ARCHIVED`, `BLOCKS_APPOINTMENT`, `DUPLICATE_NAME`.
  - `packages/types/src/content`: the firm's editor (drafts, publish, unpublish, delete) and the portal's published read; page keys for the four resource pages; https-only links; `BUSINESS_ONLY`.
  - `packages/types/src/calculators`: the Tax Return Calculator definition (placeholder figures, `config.placeholder`), the firm's on/off and disclaimer, and `estimateTaxReturn`, a pure function the screen and tests share.
  - Mocks `apps/web/src/mocks/{appointments,content,calculators}.ts` with the API's rules; `api.appointmentTypes`, `api.availability`, `api.appointments`, `api.myAppointments(slug)`, `api.content`, `api.myContent(slug)`, `api.calculators`, `api.myCalculators(slug)`.
  - Routes follow R10: firm `/api/v1/business/...`, portal `/api/v1/portal/{firmSlug}/me/...`. No YAML: the zod files are the contract (as R10).
- 2026-10-07, #68 review fixes (lead): `HttpsUrl` normalizes (`HTTPS://` and spaces) and refuses credentials, IP addresses and localhost; optional text reads `''` as none (reasons, location details, content description, category, body, URL); a RESOURCE category is one of `ResourcePage`; `contentKindProblem` checks an edited item (API and mock); the client cutoff is documented for appointments without a type (24 hours) and non-bookable types (their own); slot queries take `excludeAppointmentId` for a reschedule; content states the Markdown rules (raw HTML and images off, https and mailto links only). Open, for Rasel (asked by the lead): staff reading the whole calendar and booking for any client vs "Staff see only assigned clients".
- 2026-10-07, step 1 part 2 (contract, prepared on `rasel/R12-contract-workspaces` from fresh main; opens after part 1, #68, merges): tasks, workspaces with reports, and the audit log viewer.
  - `packages/types/src/tasks`: list (by client, engagement, assignee, status; paged), create, update (status, due date, assignee; `null` clears). Staff see their clients' tasks and tasks assigned to them. R10 creates the NAME_CHANGE task.
  - `packages/types/src/workspaces`: the list of Bookkeeping and Tax Planning engagements (open tasks, next due date), the detail (stages, open tasks, reports), reports (create as draft, edit, publish, unpublish, delete only if never published; kinds per workspace in `REPORT_KINDS`; figures as label and amount lines), and the client's published reports in My Services. Status and stage go through R10's `api.engagements`; notes come from R11, documents from R5.
  - `packages/types/src/audit-log`: the firm Owner's log with filters (dates, action or prefix, person, record) and paging; the Super Admin version answers 403 `SUPPORT_GRANT_REQUIRED` until R8.
  - Mocks `apps/web/src/mocks/{tasks,workspaces,audit-log}.ts` (the workspaces reuse R10's Bookkeeping engagement fixture); `api.tasks`, `api.workspaces`, `api.myReports(slug)`, `api.auditLog`.
- 2026-10-07, #71 review fixes (lead, head d55c3d1), after merging main (#38's settings lines kept in `api.ts`):
  - Reports never attach an INTERNAL document (409 `INTERNAL_DOCUMENT` on attach and publish); the client downloads through R5's portal route only. Changes need an open engagement (409 `ENGAGEMENT_CLOSED`, unpublish excepted).
  - Audit log: Owner and Admin; Firmivra Support rows carry no user id or IP (`AuditActor` union); both logs and `audit_log.viewed` stated; dates both or neither; no control characters in `entityId`.
  - Optional create text reads `''` as none (task details, report period, summary and notes). Report amounts are whole cents (`amountCents`), and client-visible report text is plain text.
  - Lists are paged: `reports(engagementId, query)` and `myReports(slug).list(engagementId, query)` return `{ items, nextCursor }`; the workspace detail is the engagement and its stages, with tasks and reports from their own lists. The workspaces search refuses control characters.
  - Tasks: Staff create only for their assigned clients; `NAME_CHANGE_PENDING` on reopening a second name change.
  - Mocks: ids are checked as the real client checks them (400); a bad cursor is 400; `ENGAGEMENT_MISMATCH`, `NOT_A_MEMBER`, `DOCUMENT_MISMATCH`, `INTERNAL_DOCUMENT` and `ENGAGEMENT_CLOSED` are raised; the workspaces list filters by assignee and pages; the audit log answers 403 before anything else. A completed 2025 Tax Planning engagement and a Firmivra Support row were added.
- 2026-10-07, Staff calendar access (Rasel's decision on #68's open question; #68 was already merged, so this is a contract follow-up from fresh main, branch `rasel/R12-staff-calendar`):
  - `AppointmentList` items are `CalendarAppointment`: the whole appointment (`restricted: false`) or `BusyAppointment` (`restricted: true`: id, staff member, times, status). The Busy shape has no client fields, so the parser drops any sent by mistake.
  - The rules are in the module comment, the calendar client's doc, `AppointmentsQuery` (the `clientId` 404) and `BookAppointmentRequest` (assigned clients only).
  - Mock: `role: 'STAFF'` is Sam Staff, as in `mocks/clients.ts`; Riley Example's appointment with Mock User is Busy for Sam. Booking checks the client record (404 for an unknown or, for Staff, an unassigned one). The availability mock's "own" hours follow the same signed-in member. `api.appointments` passes `MOCK_ROLE`.
  - The portal mocks are kept per firm (R1's request, as in #75): `api.myAppointments(slug)`, `api.myContent(slug)` and `api.myCalculators(slug)` reuse one mock per lower-cased slug, built on first use.
  - The R12 API (step 2) is built with this rule.
- 2026-10-07, #71 re-review (lead, e0ca894): main merged again (#40 and #77; both sides kept). The workspaces mock checks the body, query and cursor before an unknown id (400 before 404). A PLATFORM audit row must be named "Firmivra Support" and have no IP. A second, closed NAME_CHANGE task makes `NAME_CHANGE_PENDING` reachable in the mock. A never-published draft can be deleted on a closed engagement.
- 2026-10-08, step 6 (branch `rasel/R12-api-workspaces`, from fresh main): the tasks, workspaces and reports API, one module in `apps/api/src/workspaces/` (`WorkspacesModule`, registered in `app.module.ts`).
  - Tasks, `/api/v1/business/tasks`: list (client, engagement, assignee, status; keyset cursor: open tasks by due date with none last, then the rest by last change, newest first), create, update. Owner and Admin reach every task; Staff follow Rasel's q5: only the tasks of clients assigned to them (404 otherwise, also a task assigned to them on another client; a list filter on another client is empty, as in the mock). A client's task goes to a Staff member only when that client is assigned to them: 409 `CLIENT_NOT_ASSIGNED` (the string, until #86 adds it to `TaskErrorCode`); Owner and Admin assignees always fit; `NOT_A_MEMBER` for another firm's person, an open invite, a former member or a client login. `ENGAGEMENT_MISMATCH`; `NAME_CHANGE_PENDING`, also when the unique index `tasks_one_open_name_change` stops a second reopen at the same moment. Row locks only (task FOR UPDATE, client and assignee membership FOR SHARE), no advisory lock.
  - Workspaces, `/api/v1/business/workspaces`: Bookkeeping and Tax Planning engagements (service kind) by kind, status (ACTIVE by default), assignee and search, newest activity first (the engagement's `updatedAt`), paged, with open tasks and the next due date; the detail adds the service's stages. Staff: their assigned clients' only (404).
  - Reports: list (newest first, status, paged), create a draft (`WRONG_REPORT_KIND`), update, publish, unpublish, delete (never published only, `REPORT_WAS_PUBLISHED`). The file is the engagement's (`DOCUMENT_MISMATCH`) and never INTERNAL (`INTERNAL_DOCUMENT`), on attach and again on publish. `ENGAGEMENT_CLOSED` on COMPLETED or CANCELLED (engagement row FOR SHARE), except unpublish and deleting a never-published draft. Whoever sees the workspace changes its reports (q6).
  - Portal, `/api/v1/portal/{firmSlug}/me/services/{engagementId}/reports`: the session's client record (as R10's My Services: any of its logins), published reports only, newest published first, paged; 404 for a service not theirs or a login without a client record; their service without a workspace has none.
  - Input: a NUL, half a surrogate pair (any string, report lines included) and a due date in the year 0000 (the contract's date allows it, Postgres does not) are 400, never 500; so is a forged cursor.
  - Audit: `tasks.listed`, `task.created`, `task.updated`, `workspaces.listed`, `workspace.viewed`, `reports.listed`, `report.created`, `report.updated`, `report.published`, `report.unpublished`, `report.deleted`, `portal.reports_viewed`, with ids, kinds, statuses, counts and field names only.
  - Tests: `apps/api/test/e2e/tasks.e2e.test.ts` (roles, q5, assignees, isolation, 409s, paging, 400s, audit), `apps/api/test/e2e/workspaces.e2e.test.ts` (workspaces, reports, closed engagements, Staff, isolation, races, portal, audit), `apps/api/test/unit/workspaces.test.ts` (cursors, input, completedAt, report data).
