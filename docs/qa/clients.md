# Clients: Review 2 QA map

This file maps every red, partial and yellow row of Octavia's Clients Review 2 (Nov 3, 2026) and its Nov 8 flow check (sections 11 to 23; the report is kept privately, outside the repo). For each row it names the PR that fixed it and the test that covers it, or marks it as a **GAP**.

Rows are named by their IDs and headings only; the report's text is not copied here. Each GAP has a plan and a status. **Test gap** means the change is merged but no test asserts it yet.

**Where the tests are**
- API e2e: `apps/api/test/e2e/`
- Mock specs: `apps/web/e2e/mock/`
- Unit tests: `packages/types/test/`, and the web's `apps/web/src/**/*.test.ts`
- Isolation: `apps/api/test/isolation/cases/clients.ts` and `body-ids.ts`
- Intake Forms rows of the Nov 8 check: `docs/qa/intake-forms.md`

## Partial fixes and incomplete workflows (section 2)

| Row | Status | PR | Test |
| --- | --- | --- | --- |
| Return to Clients context | **Test gap:** R60 adds the check after the product items (Nov 15) | #1415 (R55) | None: #1415 only renamed the Last Activity From label in `r23-clients` |
| Stacy service linkage (Enrolled Services) | Done | #1378 | `client-services.e2e`, `r60-clients-tabs` |
| Profile workspace (Services, Intake Forms, Tasks, Notes, Activity, Overview's Active Services and Recent Activity) | Done | #1378 | `client-services.e2e`, `r60-clients-tabs`, `r23-client-record` |
| Documents (profile Upload, View Request Details) | Done | #1384 | `r60-clients-e8-e10` |
| Message submission and history (recipient and the notice before sending) | Done | #1384 | `r60-clients-e8-e10` |
| Staff assignment (stale profile after assign) | **Test gap:** R60 adds the check after the product items (Nov 15) | #1415 (R55) | None: `r23-clients` "Bulk Actions assigns and archives the selected clients" checks the list, not a profile opened before |
| Audit visibility (archive and restore details) | Done | #1382 (R1) | `clients.e2e` |

## Unfixed requirements carried from Review One (section 3)

| Row | Status | PR | Test |
| --- | --- | --- | --- |
| Expanded directory filters (Added Last 30 Days, Archived, More Filters with chips) | Done | #1385 | `clients-work.e2e`, `r60-clients-filters` |
| New KPI and destination | Done | #1382 (R1) | `clients-work.e2e`, `clients.e2e` |
| Client ID search | Done | #1382 (R1) | `clients.e2e` |
| Edit validation (required fields on Add and Edit) | Done | #1380 | `r60-clients-required`, `new-client-form.test` |
| Edit validation: the API part (a blank email, phone or address) | After Nov 17 (decided) | — | The API still takes them: `clients.e2e` "updates only the fields sent; "" clears…" clears a phone |
| Edit validation: ZIP format ("abc" accepted) | Fixed (G3) | #1429: US ZIP or ZIP+4 on Add, Edit and the API | `clients.e2e`, `r60-clients-gaps` (Add) |
| Normalized phone duplicate (API guard) | Done | #1382 (R1) | `clients.e2e` |
| Normalized phone duplicate: the web dialog | Fixed (G2) | #1382 (API) and #1429: Possible duplicate client with Create Anyway and Save Anyway | `clients.e2e`, `r60-clients-gaps` (Add; Edit's Save Anyway is not checked) |
| Business responsible party (name, email, phone) | Done | #1380 | `clients.e2e`, `r60-clients-required` |
| Business responsible party: linked personal and business profile | Fixed (G9) | #1446 (`client_links`) and #1454: Linked Profiles on Overview | `clients-work.e2e` (reach, firm B, once per pair, audit), isolation cases, `r60-clients-links` |
| Business responsible party: prefill from the linked profile | Not built yet (R55) | — | — |
| Service management (enroll, pause or end with history, package, staff) | Fixed (G8) | #1444: Enroll, Edit, Service & Billing, End, Mark Completed, Reactivate and History (audit rows); #1446 and #1454: a pause with a reason for every service | `engagements.e2e` (activity, pause and resume), `r60-clients-services` |
| Document and portal actions (profile Upload, Request Details, Portal invitation) | Done | #1384 | `r60-clients-e8-e10` |
| Bulk and contextual actions: tag, status, inactive, export | Done | #1386, #1387 | `clients-work.e2e`, `r60-clients-export`, `r60-clients-bulk` |
| Bulk and contextual actions: message, document request, intake for the selected clients | Fixed (G7) | #1431: Send Message, Request Document and Send Intake Form in Bulk Actions | `r60-clients-outreach` |
| Last Activity timestamp | Done | #1362 | `clients-work.e2e` |
| Last Activity logic | Done | #1362 | `clients-work.e2e` |

## Missing from Review One and newly demonstrated (section 4)

| Row | Status | PR | Test |
| --- | --- | --- | --- |
| Last Activity dismissal | **Test gap:** R60 adds the check after the product items (Nov 15) | #1415 (R55) | None: no test presses Escape or clicks outside the Last Activity filter |
| Last Activity accessible names | **Test gap:** R60 adds the check after the product items (Nov 15) | #1415 (R55) | `r23-clients` finds the From field by its name; To and Done are not checked |
| Dirty Add dismissal | **Test gap:** R60 adds the check after the product items (Nov 15) | #1415 (R55) | None: no test closes a filled Add New Client |
| Stale profile after assignment | **Test gap:** R60 adds the check after the product items (Nov 15) | #1415 (R55) | None |
| Archived note writes (API, 409 CLIENT_ARCHIVED) | Done | #1382 (R1) | `notes.e2e` |
| Archived note writes: the notes card still offers Add | **Test gap:** R60 adds the check after the product items (Nov 15) | #1429: an archived client's notes are read only, with the reason | `notes.e2e` (the API's 409) only; nothing on screen |
| Formatted phone search | Done | #1382 (R1) | `clients.e2e` |
| Existing rules newly failed (regression cases) | Done | #1380, #1382 | `clients.e2e`, `clients-work.e2e` |

## Owner decisions and additions (section 5)

| Row | Status | PR | Test |
| --- | --- | --- | --- |
| Duplicate review principle (Create Anyway after the warning) | Fixed (G2) | #1382 (API) and #1429: Possible duplicate client with Create Anyway and Save Anyway | `clients.e2e`, `r60-clients-gaps` |
| Proposed duplicate popup | Fixed (G2) | #1382 (API) and #1429: Possible duplicate client with Create Anyway and Save Anyway | `clients.e2e`, `r60-clients-gaps` |
| Duplicate safeguards (permission, no cross-firm disclosure) | Fixed (G2) | #1382 (API) and #1429 | `clients.e2e` "pauses Add and Edit with 409 DUPLICATE_PHONE until confirmed…" (Staff see only their own matches; another firm's never count) |
| Duplicate safeguards: the matched ids in the audit | After Nov 17 (decided) | — | Create Anyway is audited as a field name only |
| Last Activity owner clarification (every recorded client action counts) | Fixed (G6) | #1429: Last Activity counts the client's own audit rows, never a view | `clients-work.e2e` |
| ZIP validity (format, and the ZIP's state) | Fixed (G10) | #1438: a ZIP-prefix-to-state table; a mismatch or an unknown prefix warns, never blocks | `zip-state.test.ts`, `r60-clients-gaps` |
| ZIP validity: the ZIP against the city, checked on the server | After Nov 17 (decided) | — | The server checks the format only |
| ZIP lookup edge cases (unverified kept apart from invalid) | Fixed (G10) | #1438: a ZIP-prefix-to-state table; a mismatch or an unknown prefix warns, never blocks | `zip-state.test.ts`, `r60-clients-gaps` |
| Prior owner additions (Added Last 30 Days, More Filters, Archived shortcut, Export, basic fields, Responsible Party) | Done | #1380, #1385, #1386 | as above |
| Prior owner additions: linked Business and Personal profiles | Fixed (G9) | #1446 (`client_links`) and #1454: Linked Profiles on Overview (the prefill: R60, section 3) | `clients-work.e2e` (reach, firm B, once per pair, audit), isolation cases, `r60-clients-links` |
| Billing cross reference | Carried to the Invoices review | — | Report note: the invoice additions are billing scope; Overview Billing (#1434, #1444) is separate |

## Remaining tests and blockers (section 6)

These rows ask for test coverage, not features.

| Row | Covered by |
| --- | --- |
| Counts and filter membership | `clients-work.e2e`: KPIs, Pending Documents, Balances Due, New tab, filters |
| Search and navigation depth (company search, services, sorting, paging) | `clients.e2e`: search by name, email, phone, Client ID and formatted phone; sort (G12, #1432). `r60-clients-filters`, `r60-clients-sort` |
| Full Add and Edit coverage | `clients.e2e`, `r60-client-form`, `r60-clients-required`, `new-client-form.test`, `r23-clients` (dirty guard) |
| Multi client mutations | `clients-work.e2e` (bulk assign, archive, restore, tag, stage; per-client audit), `r60-clients-bulk` |
| Lifecycle and service history | `clients-work.e2e` (stage changes, audited). Service history: `engagements.e2e` activity, `r60-clients-services` (G8, #1444) |
| Canonical workflow completion (prefilled requests, intake, appointments, tasks) | `r60-clients-e8-e10`, `r60-clients-tabs`, `r60-client-portal-forms` (Request Form with the client chosen) |
| Summaries and important dates | `client-services.e2e`, `r23-client-record`, `clients-work.e2e`. Overview cards for missing documents, messages, intake and appointments: N8-12, after Nov 17 |
| Delivery and document access | `r60-clients-e8-e10` (recipient and notice), `portal-invitations.e2e` |
| Security and permissions | Tenant isolation suite (`cases/clients.ts`, `body-ids.ts`); role checks in `clients.e2e` and `clients-work.e2e` (Staff 403 on export and bulk stage; Staff limited to their own clients) |
| Audit completeness | `clients.e2e` (archive and restore details), `clients-work.e2e` (bulk, export, stage audited) |
| Reliability and accessibility | `r23-clients` (the Last Activity From label only; dismissal and focus are a test gap, #1415), `r60-clients-required` (submit protection) |
| Acceptance and next module | Report note; nothing to build |

## Test records (section 8)

| Row | Covered by |
| --- | --- |
| Release boundary | Report note; nothing to build |

## Visual consistency review (section 9)

| Row | Status | PR | Test |
| --- | --- | --- | --- |
| V-001 Tab strip scrollbar | **Test gap:** R60 adds the check after the product items (Nov 15) | #1381, #1415 (R55) | None: no test measures the profile tab strip |
| V-002 Documents KPI labels | **Test gap:** R60 adds the check after the product items (Nov 15) | #1381 (R55) | `r34-documents` checks the five labels are there, not that they fit |
| V-003 Documents filters | **Test gap:** R60 adds the check after the product items (Nov 15) | #1381 (R55) | `r34-documents` uses the filters, not their widths |
| V-004 Documents table readability | **Test gap:** R60 adds the check after the product items (Nov 15) | #1381 (R55) | `r34-documents` checks the rows' content, not the column widths |
| V-005 Actions menu clipping | Done | #1381 (R55) | `r34-documents` (the row menu opens and offers Download) |
| V-006 Request KPI baselines | **Test gap:** R60 adds the check after the product items (Nov 15) | #1381 (R55) | None: no test opens Document Requests' cards |
| V-007 Main sidebar collapse | Done | #1396 | `r60-sidebar-collapse` |
| V-008 Full filename disclosure (hover) | **Test gap:** R60 adds the check after the product items (Nov 15) | #1429: the full file name on hover in Documents | None: `r60-clients-gaps` has no hover check |
| V-009 Approved column alignment | **Test gap:** R60 adds the check after the product items (Nov 15) | #1381 (R55) | None: no test measures the panels |
| Visual acceptance limits | Report note; nothing to build | — | — |

## Additional Documents workflow tests (section 10)

| Row | Status | PR | Test |
| --- | --- | --- | --- |
| C2-052 Existing file visibility | Fixed (G1) | #1426: `POST /business/documents/{id}/visibility` and the switch on Document Details | `documents-library.e2e` (visibility, 409s, peer Staff 403, firm B 404), `r60-document-visibility` |
| C2-051 Document action scope | **Test gap:** R60 adds the check after the product items (Nov 15) | #1381 (R55) | `r34-documents` doesn't open Rename, Move, Request e-sign or Archive |
| C2-049 Empty staff choices | **Test gap:** R60 adds the check after the product items (Nov 15) | #1382 (R1) | None: a fix in `share-screen.tsx` (an internal file lists the team) |
| Approved later client sharing (off by default, explicit opt-in) | Fixed (G1) | #1426: `POST /business/documents/{id}/visibility` and the switch on Document Details | `documents-library.e2e` (visibility, 409s, peer Staff 403, firm B 404), `r60-document-visibility` |
| Remaining sharing acceptance (only the assigned staff or higher can share) | Fixed (G1) | #1426: `POST /business/documents/{id}/visibility` and the switch on Document Details | `documents-library.e2e` (visibility, 409s, peer Staff 403, firm B 404), `r60-document-visibility` |

## Nov 8 flow check (sections 11 to 23)

Her scoped passes need nothing built; they are listed so every row is accounted for.

| Row | Status | PR | Test |
| --- | --- | --- | --- |
| N8-01 Replacement request reopens for the client | Done | #1502 | e2e `documents-packets-portal` "Request Replacement on a submitted item opens the packet for that upload, audited" |
| N8-02 Existing intake assignment: detail and start | Done in Intake Forms | #1407, #1425, #1471, #1479 | `intake-forms.md` INTAKE-ACCESS-01 (mock `r55-portal-assigned-intake`) |
| N8-03 Portal document source filters | Scoped pass; nothing to build | — | — |
| N8-04 Portal message delivery and read state | Scoped pass; nothing to build | — | — |
| N8-05 Client Activity and Last Activity | Last Activity column: Done (#1362, #1429). Activity tab: Not built yet (R55): the profile composer offers Add to Client Timeline, and Activity shows it | #1362, #1429 | `clients-work.e2e` "counts the client's own recorded changes, never a view…" (the column only) |
| N8-06 Digits-only phone search | Done: any phone format finds the client, so no hint is needed | #1382 (R1) | `clients.e2e` "finds a client by its Client ID and by a phone typed as shown" |
| N8-07 Client ID search (UUID and CL- number) | Done | #1382 (R1) | `clients.e2e` "finds a client by its Client ID and by a phone typed as shown" |
| N8-08 Pagination and return | Scoped pass; nothing to build | — | — |
| N8-09 Profile tab scrollbar (V-001) | Done, test gap | #1381, #1415 (R55) | None (see V-001) |
| N8-09 Sign-ups Invite, Resend and Revoke | Done: Sign-ups > Invitations lists every client once with its invitation state (newest first, state filter, search, pages; Staff see their own clients) and Invite, Resend and Revoke per row through the existing invitation APIs | this PR (R56) | e2e `portal-invitations` "shows each client once with its state, newest invitation first", "filters by state and pages; Staff see only their own clients", "another firm sees none of them; bad input is 400; the view is audited with counts only"; mock `r56-sign-ups-invitations` |
| N8-10 Last Activity dismissal and names | Done, test gap | #1415 (R55) | `r23-clients` (the From label only; see section 4) |
| N8-11 Text preference and SMS | Preference: scoped pass. SMS: retest once SMS is set up on dev; nothing to build in Clients | — | — |
| N8-12 Overview summary cards | After Nov 17 (decided). Active Services (#1378) and Billing (#1434) are on Overview | — | — |
| N8-13 New Clients definition | Done | #1382 (R1) | `clients.e2e` "New Clients counts what its New tab lists; the clients added this month are their own figure", `clients-work.e2e` summary |
| N8-14 Client reply and firm notification | Scoped pass; nothing to build | — | — |
| N8-15 Balances reconcile; profile invoice details | Balances: scoped pass. Invoice details: FC-01 (R55) | — | — |
| N8-16 Firm PDF content | Scoped pass; the portal byte check is her retest | — | — |
| N8-17 Intake Accept; New to Active | Not built yet (R1): Accept on a submitted intake, work-start triggers, and a manual override | — | — |
| N8-18 Appointment outcomes and notes | After Nov 17 (decided) | — | — |
| N8-19 Completed appointment fixture | Blocked on a fixture; follows N8-18. Nothing to build | — | — |
| N8-20 Existing assignment start (with N8-02) | Done in Intake Forms | #1407, #1425, #1471, #1479 | `intake-forms.md` INTAKE-ACCESS-01 |
| N8-21 Published template and preview | Scoped pass; nothing to build | — | — |
| N8-22 Intake distribution: direct send, link, embed, every portal | Link, embed and portal publication: Done in Intake Forms (#1487, #1497). Direct send with no service: N8-23 (R1) | #1487, #1497 | `intake-forms.md` INTAKE-ACCESS-02 (e2e `intake-share`, `intake-self-service`) |
| N8-23 Intake send without an active service | Not built yet (R1): decided allowed, no engagement needed | — | Today the send refuses with 409 NO_ENGAGEMENT |
| N8-24 Bookkeeping setup found an existing record | Observation; follows N8-23. Nothing separate to build | — | — |
| N8-25 Intake receipt, acceptance and service linking | Acceptance: N8-17 (R1). No service needed: N8-23 (R1). A send already links the client's active engagement for the service when there is one | — | — |
| N8-26 Search paging and narrowing | Scoped pass; nothing to build | — | — |
| N8-27 Staff and search return | Scoped pass; nothing to build | — | — |
| N8-28 New plus Business Development filter | Scoped pass; nothing to build | — | — |
| N8-29 Document categories | Scoped pass; nothing to build | — | — |
| N8-30 Business dirty Edit | Scoped pass; invalid Save stays under Edit validation (section 3) | — | — |
| N8-31 Share Access recipients | Scoped pass; nothing to build | — | — |
| N8-32 Service labels match the catalog | Scoped pass; nothing to build | — | — |
| N8-33 Draft services in Clients | Not built yet (R55): Draft services out of the Clients tabs and Service dropdown, with a status filter | — | — |
| N8-34 Sign-ups list checks | Scoped pass; the empty-state copy is FC-02 (R55) | — | — |
| N8-35 Signature history and filters | Scoped pass; nothing to build | — | — |
| N8-36 Tasks tab with New Task for the client | Done, test gap | #1378 | `r60-clients-tabs` opens the Tasks tab; its Create Task link with the client is not checked |
| N8-37 Request a Document at the top | Done: Request a Document and the open requests come first | #1547 | Mock `r60-clients-e8-e10` (the client's Documents) |
| N8-38 Task details readable | Scoped pass; nothing to build | — | — |
| N8-39 Portal notification filter | Scoped pass; clearing needs a known-unread notice (her retest) | — | — |
| N8-40 Message audit names the client | Scoped pass; nothing to build | — | — |
| FC-01 Profile Invoices: balance due and Open Invoice | Not built yet (R55): balance due and a link to each invoice | — | — |
| FC-02 Sign-ups empty state by approval mode | Not built yet (R55) | — | — |
| FC-03 Documents staff guidance | Done, test gap | #1381 (R55) | `r34-documents` checks the no-client note is shown, not its words |
| FC-04 Unassigned in Assigned Staff | Done: Unassigned in the staff filter, combinable with New; Staff 403 | #1547 | e2e `clients` "FC-04: Unassigned lists the clients nobody is assigned to, with New too; Staff 403" |
| §23 Messages: wider Subject, collapsible Internal Notes | Not built yet (R55) | — | — |
| §23 V-007 for side menus | Main sidebar: Done (#1396). The Internal Notes rail is the R60 row above | #1396 | `r60-sidebar-collapse` |
| §23 Mobile-friendly Clients | Her mobile check was not run; nothing new to build. 375 px checks: `r23-clients` (cards), `r60-clients-services`, `r60-clients-billing` | — | — |
| §23 Platform heading and action-row consistency | After Nov 17 (decided): a platform-wide pass | — | — |
| §23 Business Overview and Edit visual check | Scoped pass; nothing to build | — | — |

## GAP status

G1 to G12 are closed except G9's prefill (Nov 15, 2026). The open items are listed by owner below.

| GAP | Status |
| --- | --- |
| G1 C2-052 visibility | Fixed, #1426 |
| G2 Duplicate popup | Fixed, #1429; the matched ids in the audit after Nov 17 |
| G3 ZIP format | Fixed, #1429 |
| G4 Archived notes UI | Fixed, #1429; test gap |
| G5 Full filename on hover | Fixed, #1429; test gap |
| G6 Last Activity counts every recorded action | Fixed, #1429 |
| G7 Bulk message, request, intake | Fixed, #1431 |
| G8 Service management | Fixed, #1444; the pause for every service in #1446 and #1454 |
| G9 Linked profiles (`client_links`) | Fixed, #1446 (schema) and #1454; the prefill from the linked profile is open (R55) |
| G10 ZIP prefix and state | Fixed, #1438; the city and server check after Nov 17 |
| G11 Billing links on the client | Fixed, #1434 and #1444 |
| G12 Card view sort | Fixed, #1432 |

## Open items by owner (Nov 15, 2026)

**R60, product: done in #1547**
- N8-37: Request a Document above the documents list
- FC-04: Unassigned in Assigned Staff, combinable with New

**R55, product (moved from R60, Nov 15)**
- N8-05: Add to Client Timeline in the profile composer; Activity shows it
- N8-33: Draft services out of the Clients tabs and dropdown, with a status filter
- FC-01 / N8-15: the profile Invoices tab shows the balance due and links each invoice
- FC-02: Sign-ups empty-state copy by approval mode
- §23: collapsible Internal Notes and a wider Subject in Messages
- G9: prefill the responsible party from the linked profile

**R60, tests (after the product items)**
- #1415: Return to Clients context, stale profile after assignment, Last Activity dismissal and names, Dirty Add dismissal, V-001
- #1429: G4 archived notes card, V-008 hover
- #1381: V-002, V-003, V-004, V-006, V-009, C2-051, FC-03's words
- #1382: C2-049 staff choices
- #1378: N8-36's Create Task link

**R1**
- N8-23: send an intake with no active service (no engagement needed)
- N8-17: Accept on a submitted intake, work-start triggers from New to Active, and a manual override

**R56**
- N8-09: Sign-ups Invite, Resend and Revoke with the existing invitation APIs (this PR)

**After Nov 17 (decided)**
- N8-18: appointment outcomes and notes
- N8-12: the Overview summary cards
- Edit validation: the API's required email, phone and address
- Duplicate safeguards: the matched ids in the audit
- ZIP: the city and the server check
- §23: platform heading and action-row consistency (a platform-wide pass)

**Her retests (no code)**
- N8-11 SMS once set up on dev; N8-16 portal bytes; N8-19 a completed appointment fixture; N8-39 a known-unread notice
