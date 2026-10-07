# R12: Appointments, content, audit viewer, calculators and workspaces API (Oct 10-13)

**Goal:** Firms and clients book appointments without double booking; firms publish resources and external links; owners read their audit log; clients use the calculators; staff work in the Bookkeeping and Tax Planning workspaces. Former developer tickets T07, T08 (Tumit) and I11 (Ibrahim), moved here on Oct 6.

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
- [ ] 4. Audit log viewer: firm owners read their firm's audit log with filters and paging; a Super Admin only through an active support grant
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
- 2026-10-07, Staff calendar access (Rasel's decision on #68's open question; #68 was already merged, so this is a contract follow-up from fresh main, branch `rasel/R12-staff-calendar`):
  - `AppointmentList` items are `CalendarAppointment`: the whole appointment (`restricted: false`) or `BusyAppointment` (`restricted: true`: id, staff member, times, status). The Busy shape has no client fields, so the parser drops any sent by mistake.
  - The rules are in the module comment, the calendar client's doc, `AppointmentsQuery` (the `clientId` 404) and `BookAppointmentRequest` (assigned clients only).
  - Mock: `role: 'STAFF'` is Sam Staff, as in `mocks/clients.ts`; Riley Example's appointment with Mock User is Busy for Sam. Booking checks the client record (404 for an unknown or, for Staff, an unassigned one). The availability mock's "own" hours follow the same signed-in member. `api.appointments` passes `MOCK_ROLE`.
  - The portal mocks are kept per firm (R1's request, as in #75): `api.myAppointments(slug)`, `api.myContent(slug)` and `api.myCalculators(slug)` reuse one mock per lower-cased slug, built on first use.
  - The R12 API (step 2) is built with this rule.
