# Clients: Review 2 QA map

This file maps every red, partial and yellow row of Octavia's Clients Review 2 (Nov 3, 2026) and its Nov 8 flow check (sections 11 to 23; the report is kept privately, outside the repo). For each row it names the PR that fixed it and the test that covers it, or marks it as a **GAP**.

Rows are named by their IDs and headings only; the report's text is not copied here. Each GAP has a plan and a status. **Test gap** means the change is merged but no test asserts it yet. A row says Done only when the test named beside it proves it. Corrected on Nov 16 after an independent check of every row (#1584).

**Where the tests are**
- API e2e: `apps/api/test/e2e/`
- Mock specs: `apps/web/e2e/mock/`
- Unit tests: `packages/types/test/`, and the web's `apps/web/src/**/*.test.ts`
- Isolation: `apps/api/test/isolation/cases/clients.ts` and `body-ids.ts`
- Intake Forms rows of the Nov 8 check: `docs/qa/intake-forms.md`

## Partial fixes and incomplete workflows (section 2)

| Row | Status | PR | Test |
| --- | --- | --- | --- |
| Return to Clients context | Done: the breadcrumb and Back bring the same list back (filters, card, scroll); a fresh visit starts clean | #1164, #1415 (R55) | mock `r60-clients` "E7: Return to Clients and Back bring the same list back; a new visit starts fresh" |
| Stacy service linkage (Enrolled Services) | Done | #1378 | `client-services.e2e`, `r60-clients-tabs` |
| Profile workspace (Services, Intake Forms, Tasks, Notes, Activity, Overview's Active Services and Recent Activity) | Done | #1378 | `client-services.e2e`, `r60-clients-tabs`, `r23-client-record` |
| Documents (profile Upload, View Request Details) | Done | #1384 | `r60-clients-e8-e10` |
| Message submission and history (recipient and the notice before sending) | Done | #1384 | `r60-clients-e8-e10` |
| Staff assignment (stale profile after assign) | Done: a profile seen before a bulk assign shows the new staff member at once, never the old value first | #1415 (R55); test #1584 | mock `r55-clients-assignment` "a profile seen before a bulk assign shows the new staff member when opened again" |
| Audit visibility (archive and restore details) | Done | #1382 (R1) | `clients.e2e` |
| Audit visibility: the client's Activity with record links | Done: Activity lists the client's recorded events (see N8-05), each with its record link | #1574 (R56) | `clients-work.e2e` "N8-05: Activity lists each recorded event with its link; a firm message off the timeline moves Last Activity but adds no row" |

## Unfixed requirements carried from Review One (section 3)

| Row | Status | PR | Test |
| --- | --- | --- | --- |
| Expanded directory filters (Added Last 30 Days, Archived, More Filters with chips) | Done | #1385 | `clients-work.e2e`, `r60-clients-filters` |
| New KPI and destination | Done | #1382 (R1) | `clients-work.e2e`, `clients.e2e` |
| Client ID search | Done; the Client ID (CL-…) shows on the profile and the list, and the search hint names it | #1382 (R1), #1575 (R1) | `clients.e2e` "finds a client by its Client ID and by a phone typed as shown (Clients Review 2)"; mock `r1-clients-b` "§3 and N8-06: the Client ID shows on the list and the profile; the hint names it and the phone rule" |
| Edit validation (required fields on Add and Edit) | Done | #1380 | `r60-clients-required`, `new-client-form.test` |
| Edit validation: the API part (a blank email, phone or address) | After Nov 17 (decided) | — | The API still takes them: `clients.e2e` "updates only the fields sent; "" clears…" clears a phone |
| Edit validation: ZIP format ("abc" accepted) | Fixed (G3) | #1429: US ZIP or ZIP+4 on Add, Edit and the API | `clients.e2e`, `r60-clients-gaps` (Add) |
| Normalized phone duplicate (API guard) | Done | #1382 (R1) | `clients.e2e` |
| Normalized phone duplicate: the web dialog | Fixed (G2) | #1382 (API) and #1429: Possible duplicate client with Create Anyway and Save Anyway; Edit's test #1584 | `clients.e2e`; mock `r60-clients-gaps` "a phone another client has asks first, then Create Anyway saves it" (Add) and "Edit Details: a phone another client has asks first, then Save Anyway saves it" (Edit) |
| Business responsible party (name, email, phone) | Done | #1380 | `clients.e2e`, `r60-clients-required` |
| Business responsible party: linked personal and business profile | Fixed (G9) | #1446 (`client_links`) and #1454: Linked Profiles on Overview | `clients-work.e2e` (reach, firm B, once per pair, audit), isolation cases, `r60-clients-links` |
| Business responsible party: prefill from the linked profile | Done: a Business's Edit details offers Fill from the linked Responsible party (else Owner) personal profile, which fills only the blank name, email and phone; nothing shows without such a link | #1558 | mock `r55-business-party-fill` "Edit details fills the responsible party from the linked owner, blank fields only", "a Business with no linked person offers no fill" |
| Service management (enroll, pause or end with history, package, staff) | Fixed (G8) | #1444: Enroll, Edit, Service & Billing, End, Mark Completed, Reactivate and History (audit rows); #1446 and #1454: a pause with a reason for every service | `engagements.e2e` (activity, pause and resume), `r60-clients-services` |
| Document and portal actions (profile Upload, Request Details, Portal invitation) | Done | #1384 | `r60-clients-e8-e10` |
| Bulk and contextual actions: tag, status, inactive, export | Done | #1386, #1387 | `clients-work.e2e`, `r60-clients-export`, `r60-clients-bulk` |
| Bulk and contextual actions: message, document request, intake for the selected clients | Fixed (G7); row and profile actions too: Send Intake Form (client chosen) and Schedule Appointment (client prefilled) | #1431: Send Message, Request Document and Send Intake Form in Bulk Actions; #1575 (R1): row menu and profile | `r60-clients-outreach`; mock `r1-clients-b` "§3/§6: Send Intake Form and Schedule Appointment open with the client chosen" |
| Last Activity timestamp | Done | #1362 | `clients-work.e2e` |
| Last Activity logic | Done | #1362 | `clients-work.e2e` |

## Missing from Review One and newly demonstrated (section 4)

| Row | Status | PR | Test |
| --- | --- | --- | --- |
| Last Activity dismissal | Done: Escape and a click outside close it, and focus goes back to its button | #1415 (R55); test #1584 | mock `r55-clients-last-activity` "the Last Activity panel closes on Escape and on a click outside, and focus goes back to its button" |
| Last Activity accessible names | Done: From, To, Clear and Done have names | #1415 (R55); test #1584 | mock `r55-clients-last-activity` "the Last Activity From, To, Clear and Done controls each have a name" (by role and exact name) |
| Dirty Add dismissal | Done: Cancel, Escape and the X ask first on a filled Add New Client; Keep Editing keeps every value | #1415 (R55); test #1584 | mock `r55-clients-add-dialog` "a filled Add New Client asks before Cancel, Escape or the X throws it away" |
| Stale profile after assignment | Done: after a bulk change the profile and the directory agree at once | #1415 (R55); test #1584 | mock `r55-clients-assignment` "after a bulk unassign the profile and the directory both say Unassigned" (and the section 2 test) |
| Archived note writes (API, 409 CLIENT_ARCHIVED) | Done | #1382 (R1) | `notes.e2e` |
| Archived note writes: the notes card still offers Add | **Test gap:** no spec opens an archived client's notes card (see Open: tests) | #1429: an archived client's notes are read only, with the reason | `notes.e2e` (the API's 409) only; nothing on screen |
| Formatted phone search | Done | #1382 (R1) | `clients.e2e` |
| Existing rules newly failed (regression cases) | Done | #1380, #1382 | `clients.e2e`, `clients-work.e2e` |

## Owner decisions and additions (section 5)

| Row | Status | PR | Test |
| --- | --- | --- | --- |
| Duplicate review principle (Create Anyway after the warning) | Fixed (G2) | #1382 (API) and #1429: Possible duplicate client with Create Anyway and Save Anyway | `clients.e2e`, `r60-clients-gaps` |
| Proposed duplicate popup | Fixed (G2); each match also shows its type, email or phone, assigned staff, status and why it matched; a business with a likely matching name pauses the same way (409 POSSIBLE_DUPLICATE) | #1382 (API) and #1429: Possible duplicate client with Create Anyway and Save Anyway; #1575: match details and the company match | `clients.e2e` (DUPLICATE_PHONE fields; "§6: a business with a likely matching name pauses Add and Edit with 409 POSSIBLE_DUPLICATE until confirmed"), `r60-clients-gaps`, mock `r1-clients-b` "§5: each possible duplicate shows its type, email or phone, staff, status and why" and "§6: a business with a likely matching name asks first, then Create Anyway saves it" |
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
| Full Add and Edit coverage a: likely company match | Done (#1575, R1): `clients.e2e` "§6: a business with a likely matching name pauses Add and Edit with 409 POSSIBLE_DUPLICATE until confirmed"; mock `r1-clients-b` "§6: a business with a likely matching name asks first, then Create Anyway saves it" |
| Full Add and Edit coverage b: Edit's Save Anyway | Done (#1584): mock `r60-clients-gaps` "Edit Details: a phone another client has asks first, then Save Anyway saves it" |
| Multi client mutations | `clients-work.e2e` (bulk assign, archive, restore, tag, stage; per-client audit), `r60-clients-bulk`; bulk unassign (#1584): `clients-work.e2e` "unassigns several clients at once (Nobody); Staff may not; the old assignee loses reach" |
| Lifecycle and service history | `clients-work.e2e` (stage changes, audited). Service history: `engagements.e2e` activity, `r60-clients-services` (G8, #1444) |
| Canonical workflow completion (prefilled requests, intake, appointments, tasks) | `r60-clients-e8-e10`, `r60-clients-tabs`, `r60-client-portal-forms` (Request Form with the client chosen); intake and appointment with the client (#1575, R1): mock `r1-clients-b` "§3/§6: Send Intake Form and Schedule Appointment open with the client chosen". Tasks: **GAP**, see N8-36 |
| Summaries and important dates | `client-services.e2e`, `r23-client-record`, `clients-work.e2e`. Overview cards for missing documents, messages, intake and appointments: N8-12, after Nov 17 |
| Delivery and document access | `r60-clients-e8-e10` (recipient and notice), `portal-invitations.e2e` |
| Security and permissions | Tenant isolation suite (`cases/clients.ts`, `body-ids.ts`); role checks in `clients.e2e` and `clients-work.e2e` (Staff 403 on export and bulk stage; Staff limited to their own clients) |
| Audit completeness | `clients.e2e` (archive and restore details), `clients-work.e2e` (bulk, export, stage audited) |
| Reliability and accessibility a (dismissal, focus, names, a failed save) | Done (#1584): mock `r55-clients-last-activity` (three tests: section 4 and N8-10), `r55-clients-add-dialog` "a failed Add keeps every value and says why; trying again saves; closing refocuses Add New Client"; `r60-clients-required` (submit protection) |
| Reliability and accessibility b (keyboard order, screen reader, zoom, touch, disabled modules, Not Enrolled and restricted states) | Her retest on dev with the role logins |
| §7, §20, §21 roll-ups | No work of their own: they close when the rows above close and she retests |
| Acceptance and next module | Report note; nothing to build |

## Test records (section 8)

| Row | Covered by |
| --- | --- |
| Release boundary | Report note; nothing to build |

## Visual consistency review (section 9)

| Row | Status | PR | Test |
| --- | --- | --- | --- |
| V-001 Tab strip scrollbar | Done: one-line strips scroll sideways only, never up and down; focus rings stay in view | #1381, #1415 (R55); test #1584 | mock `r55-clients-tab-strips` "V-001: the Sign-ups and Share Access tab strips show no vertical scrollbar and keep focus rings in view" (1165 and 1440 px; the profile: N8-09) |
| V-002 Documents KPI labels | Done | #1381 (R55); test #1584 | mock `r55-clients-documents-layout` "V-002: each Documents card label fits its card, under its icon, never broken inside a word" |
| V-003 Documents filters | Done: her values (a chosen client, All Document Types, All Statuses, the search hint) and a 27-character client name show whole at 1165 px, and the client filter shows the name on hover | #1381 (R55); test and the long-name fix #1584 | mock `r55-clients-documents-layout` "V-003: the Documents filters show their whole values, with no overlap or clipping" |
| V-004 Documents table readability | Done | #1381 (R55); test #1584 | mock `r55-clients-documents-layout` "V-004: the Documents table keeps each header and value in its cell and scrolls inside its region" |
| V-005 Actions menu clipping | Done | #1381 (R55); test #1584 | mock `r55-clients-documents-layout` "V-005: the Documents row menu opens outside the table with every item in view and working" (Download asks for the file, Archive asks first, Share opens Share Access) |
| V-006 Request KPI baselines | Done | #1381 (R55); test #1584 | mock `r55-clients-documents-layout` "V-006: the Document Requests cards put their counts and labels on shared lines" |
| V-007 Main sidebar collapse | Done | #1396 | `r60-sidebar-collapse` |
| V-008 Full filename disclosure (hover) | Done | #1429: the full file name on hover in Documents; test #1584 | mock `r55-clients-documents-layout` "V-008: a truncated file name shows its full name with the extension on hover" |
| V-009 Approved column alignment | Done: Folders, the table and the right rail take the stat cards' columns (3 at her 1165 px, the rail three across under the table; 5 at 2xl, the rail under the last card), so the edges line up | #1381 (R55), #1574 (R56) | mock `r56-documents-columns` "V-009 at 1165 px: …" and "V-009 at 2xl: …" (edges within 1 px) |
| Visual acceptance limits | Report note; nothing to build | — | — |

## Additional Documents workflow tests (section 10)

| Row | Status | PR | Test |
| --- | --- | --- | --- |
| C2-052 Existing file visibility | Fixed (G1) | #1426: `POST /business/documents/{id}/visibility` and the switch on Document Details | `documents-library.e2e` (visibility, 409s, peer Staff 403, firm B 404), `r60-document-visibility` |
| C2-051 Document action scope | Done: Rename, Move, Request e-sign and Archive work from the table's row menu. **GAP:** an archived file stays in the table: `GET /business/clients/{id}/documents` does not leave archived or trashed files out (`firm-documents.service.ts` list), though the dialog says it leaves the list | #1381 (R55); test #1584 | mock `r55-clients-document-actions` "C2-051: Rename, Move, Request e-sign and Archive each work from the Documents table row menu" |
| C2-049 Empty staff choices | Done: an internal file lists the firm's active members under Team Member | #1382 (R1); test #1584 | mock `r56-share-document` "C2-049: Team Member lists the active staff and shares an internal file with one of them" |
| Approved later client sharing (off by default, explicit opt-in) | Fixed (G1) | #1426: `POST /business/documents/{id}/visibility` and the switch on Document Details | `documents-library.e2e` (visibility, 409s, peer Staff 403, firm B 404), `r60-document-visibility` |
| C2-055 Portal notice when a document is shared | Done: a file made client-visible later tells the client's portal login, as an upload or a Share does | #1574 (R56) | e2e `documents-portal` "C2-055: a firm file made client-visible later tells the PRIMARY login: at once when clean, by its scan result while checked" |
| Remaining sharing acceptance (only the assigned staff or higher can share) | Fixed (G1) | #1426: `POST /business/documents/{id}/visibility` and the switch on Document Details | `documents-library.e2e` (visibility, 409s, peer Staff 403, firm B 404), `r60-document-visibility` |

## Nov 8 flow check (sections 11 to 23)

Her scoped passes need nothing built; they are listed so every row is accounted for.

| Row | Status | PR | Test |
| --- | --- | --- | --- |
| N8-01 Replacement request reopens for the client | Done | #1502 | e2e `documents-packets-portal` "Request Replacement on a submitted item opens the packet for that upload, audited" |
| N8-02 Existing intake assignment: detail and start | Done in Intake Forms | #1407, #1425, #1471, #1479 | `intake-forms.md` INTAKE-ACCESS-01 (mock `r55-portal-assigned-intake`) |
| N8-03 Portal document source filters | Scoped pass; nothing to build | — | — |
| N8-04 Portal message delivery and read state | Scoped pass; nothing to build | — | — |
| N8-05 Client Activity and Last Activity | Done: Activity lists every recorded client event, newest first and paged, each with its record link: the client's portal replies, documents and requests, completed tasks, held appointments, invoices issued and paid, signed e-sign requests, notes and the client's own changes (never a view, list or export), in the firm's time zone. A firm message is listed only when sent with Add to Client Timeline (her opt-in); Last Activity counts every recorded action, every firm message included (the owner's rule), so the two differ only there | #1362, #1429, #1558, #1574 (R56) | `clients-work.e2e` "N8-05: Activity lists each recorded event with its link; a firm message off the timeline moves Last Activity but adds no row"; `messages.e2e` "puts the subject, sender and link on the Activity, never the message; off adds nothing"; mock `r55-client-message-timeline` |
| N8-06 Digits-only phone search | Done: any phone format finds the client, and the hint under the search says "Phone: type numbers only, e.g. 5551234567" | #1382 (R1), #1575 (R1) | `clients.e2e` "finds a client by its Client ID and by a phone typed as shown"; mock `r1-clients-b` "§3 and N8-06: the Client ID shows on the list and the profile; the hint names it and the phone rule" |
| N8-07 Client ID search (UUID and CL- number) | Done | #1382 (R1) | `clients.e2e` "finds a client by its Client ID and by a phone typed as shown" |
| N8-08 Pagination and return | Scoped pass; nothing to build | — | — |
| N8-09 Profile tab scrollbar (V-001) | Done: no vertical scrollbar on Overview, Documents, Messages, Invoices and Signatures; the strip scrolls sideways when its sections are wider than the window | #1381, #1415 (R55); test #1584 | mock `r55-clients-tab-strips` "N8-09: the client profile tab strip shows no vertical scrollbar on each tab, focus rings in view" |
| N8-09 Sign-ups Invite, Resend and Revoke | Done: Sign-ups > Invitations lists every client once with its invitation state (newest first, state filter, search, pages; Staff see their own clients) and Invite, Resend and Revoke per row through the existing invitation APIs | #1555 (R56) | e2e `portal-invitations` "shows each client once with its state, newest invitation first", "filters by state and pages; Staff see only their own clients", "another firm sees none of them; bad input is 400; the view is audited with counts only"; mock `r56-sign-ups-invitations` |
| N8-10 Last Activity dismissal and names | Done | #1415 (R55); test #1584 | mock `r55-clients-last-activity` "N8-10: the Last Activity panel names every control and closes on Escape, a heading click and Done" (its accessibility tree) |
| N8-11 Text preference and SMS | Preference: scoped pass. SMS: retest once SMS is set up on dev; nothing to build in Clients | — | — |
| N8-12 Overview summary cards | After Nov 17 (decided). Active Services (#1378) and Billing (#1434) are on Overview | — | — |
| N8-13 New Clients definition | Done | #1382 (R1) | `clients.e2e` "New Clients counts what its New tab lists; the clients added this month are their own figure", `clients-work.e2e` summary |
| N8-14 Client reply and firm notification | Scoped pass; nothing to build | — | — |
| N8-15 Balances reconcile; profile invoice details | Balances: scoped pass. Invoice details: Done in FC-01 | #1558 | mock `r55-client-invoices-balance` |
| N8-16 Firm PDF content | Scoped pass; the portal byte check is her retest | — | — |
| N8-17 Intake Accept; New to Active | Done: Accept completes a submitted intake and a New client becomes Active; Start Service, payroll processing and a started document review do too; an upload alone never does; Change Status is the manual override | #1556 (R1) | e2e `intakes` "N8-17: Accept completes a submitted intake and its New client becomes Active; submitting alone never does", `engagements` "N8-17: Start Service", `payroll` "N8-17: Processing makes a New client Active…", `documents-library` "N8-17: a document review started activates a New client; an upload alone never does"; mock `r56-intake-detail` "Accept completes a submitted form and says a New client is now Active (N8-17)" |
| N8-17 creation part: a submission or sign-up with purchase intent makes a New client | Her decision: today a non-client's share-link or Begin Online submission makes a Lead (the lead's decision), not a New client | — | — |
| N8-18 Appointment outcomes and notes | After Nov 17 (decided) | — | — |
| N8-19 Completed appointment fixture | Blocked on a fixture; follows N8-18. Nothing to build | — | — |
| N8-20 Existing assignment start (with N8-02) | Done in Intake Forms | #1407, #1425, #1471, #1479 | `intake-forms.md` INTAKE-ACCESS-01 |
| N8-21 Published template and preview | Scoped pass; nothing to build | — | — |
| N8-22 Intake distribution: direct send, link, embed, every portal | Link, embed and portal publication: Done in Intake Forms (#1487, #1497). Direct send with no service: N8-23 (R1) | #1487, #1497 | `intake-forms.md` INTAKE-ACCESS-02 (e2e `intake-share`, `intake-self-service`) |
| N8-23 Intake send without an active service | Done: the form goes on one pending request for the service; the client fills it in the portal; nothing is billed or started and the client stays New | #1556 (R1) | e2e `intake-workspace-actions` "sends a Bookkeeping form to a client with no service, on one pending request: fillable in the portal, nothing billed or started"; mock `tumit-intake-send` "no active service is needed (N8-23); a failed delivery says why" |
| N8-24 Bookkeeping setup found an existing record | Observation; follows N8-23. Nothing separate to build | — | — |
| N8-25 Intake receipt, acceptance and service linking | Done: acceptance is N8-17 and no service is needed (N8-23); a send links the client's active engagement for the form's service, never a completed one or another service's, and makes no request | #1556 (R1); test #1584 | e2e `intake-workspace-actions` "links the sent form to the client's active engagement for the form's service, making no request" |
| N8-26 Search paging and narrowing | Scoped pass; nothing to build | — | — |
| N8-27 Staff and search return | Scoped pass; nothing to build | — | — |
| N8-28 New plus Business Development filter | Scoped pass; nothing to build | — | — |
| N8-29 Document categories | Scoped pass; nothing to build | — | — |
| N8-30 Business dirty Edit | Scoped pass; invalid Save stays under Edit validation (section 3) | — | — |
| N8-31 Share Access recipients | Scoped pass; nothing to build | — | — |
| N8-32 Service labels match the catalog | Scoped pass; nothing to build | — | — |
| N8-33 Draft services in Clients | Done: only active services are Clients tabs and Service choices; draft and inactive services stay in the catalog | #1558 | `clients-work.e2e` "counts the firm's cards and tabs; archived clients are in none of them" (a draft and an inactive service are not in `byService`); mock `r55-clients-draft-services` |
| N8-34 Sign-ups list checks | Scoped pass; the empty-state copy: Done in FC-02 | #1558 | web unit `sign-up-parts.test` |
| N8-35 Signature history and filters | Scoped pass; nothing to build | — | — |
| N8-36 Tasks tab with New Task for the client | Done: the Tasks tab has New Task, opening Create Task on this client with Back to the tab | #1378 (the tab), #1584 | mock `r55-clients-tasks-tab` "N8-36: New Task on the client Tasks tab opens Create Task on this client, with Back"; `r60-clients-tabs` opens the Tasks tab |
| N8-37 Request a Document at the top | Done: Request a Document and the open requests come first | #1547 (R60); test #1584 | mock `r55-clients-profile-documents` "N8-37: Request a document is at the top of the profile Documents tab, before the files" (in the first screenful at 1165 x 747, above and before the list) |
| N8-38 Task details readable | Scoped pass; nothing to build | — | — |
| N8-39 Portal notification filter | Scoped pass; clearing needs a known-unread notice (her retest) | — | — |
| N8-40 Message audit names the client | Scoped pass; nothing to build | — | — |
| FC-01 Profile Invoices: balance due and Open Invoice | Done: the client's Invoices tab shows Total, Balance due and the detailed status (Partially Paid, Overdue, Due Soon, Sent) together, and Open Invoice opens that invoice with Back to the client | #1558 | mock `r55-client-invoices-balance` "the Invoices tab shows total, balance due and status, and Open Invoice opens it" and "the cards show total and balance due at phone width" |
| FC-02 Sign-ups empty state by approval mode | Done: the Waiting tab's empty help names the firm's mode; Manual Review: verified requests wait for review; Automatic Approval: no email or phone match is approved at once, a possible match waits | #1558 | web unit `sign-up-parts.test` "Manual Review: every verified request waits for review", "Automatic Approval: no match is approved at once; a possible match waits" |
| FC-03 Documents staff guidance | Done | #1381 (R55); test #1584 | mock `r55-clients-documents-layout` "FC-03: with no client chosen the Documents note is plain words, with no code talk" (exactly "Select a client to view their documents.") |
| FC-04 Unassigned in Assigned Staff | Done: Unassigned in the staff filter, combinable with New; Staff 403 | #1547 | e2e `clients` "FC-04: Unassigned lists the clients nobody is assigned to, with New too; Staff 403" |
| §23 Messages: wider Subject, collapsible Internal Notes | Done: Hide / Show Internal Notes on the client's Messages (Messages then take the whole width; a note being typed is kept), and the Subject takes the room while the sender stays on one line | #1558 | mock `r55-client-messages-notes-collapse` "Hide Internal Notes widens the Subject and keeps the draft note" (at her 1165 px) |
| §23 V-007 for side menus | Main sidebar: Done (#1396). The Internal Notes rail is the R60 row above | #1396 | `r60-sidebar-collapse` |
| §23 Mobile-friendly Clients | Checked at 375 px: every profile screen (Overview and its tab bar, Activity, Documents, Messages and New Message, Notes, Tasks, Invoices, Signatures, Intake Forms), Add New Client and Edit have no sideways scroll, and their actions are on the screen; they already fit, so nothing changed in the screens. Her own phone and tablet retest is still hers | #1574 (R56) | mock `r56-client-profile-375` (4); also `r23-clients` (cards), `r60-clients-services`, `r60-clients-billing` |
| §23 Platform heading and action-row consistency | After Nov 17 (decided Nov 16, "Clients design consistency": a cross-module design pass) | — | — |
| §23 Business Overview and Edit visual check | Scoped pass; nothing to build | — | — |

## GAP status

G1 to G12 are closed; G9's prefill is #1558 (Nov 15, 2026). The open items are listed by owner below (Nov 16).

| GAP | Status |
| --- | --- |
| G1 C2-052 visibility | Fixed, #1426 |
| G2 Duplicate popup | Fixed, #1429; the matched ids in the audit after Nov 17 |
| G3 ZIP format | Fixed, #1429 |
| G4 Archived notes UI | Fixed, #1429; test gap |
| G5 Full filename on hover | Fixed, #1429; test #1584 (V-008) |
| G6 Last Activity counts every recorded action | Fixed, #1429 |
| G7 Bulk message, request, intake | Fixed, #1431 |
| G8 Service management | Fixed, #1444; the pause for every service in #1446 and #1454 |
| G9 Linked profiles (`client_links`) | Fixed, #1446 (schema) and #1454; the prefill from the linked profile: #1558 |
| G10 ZIP prefix and state | Fixed, #1438; the city and server check after Nov 17 |
| G11 Billing links on the client | Fixed, #1434 and #1444 |
| G12 Card view sort | Fixed, #1432 |

## Open items by owner (Nov 16, 2026)

**Done**
- #1547 (R60): N8-37 Request a Document above the documents list; FC-04 Unassigned in Assigned Staff
- #1555 (R56): N8-09 Sign-ups Invite, Resend and Revoke
- #1556 (R1): N8-17 Accept and New to Active; N8-23 send with no active service
- #1558 (R55): N8-05 Add to Client Timeline; N8-33 draft services; FC-01 / N8-15; FC-02; §23 Internal Notes and Subject; G9 prefill
- #1574 (R56): N8-05 and §2 Activity with record links; C2-055 portal notice; V-009 columns; §23 profile screens at 375 px
- #1575 (R1): §3 Client ID shown; §3/§6 contextual actions; §5 duplicate details; §6 company match; N8-06 phone hint
- #1584 (R55, tests only): §2 and §4 stale profile (C2-034), §4 Last Activity dismissal and names (C2-018, C2-019), N8-10, §4 Dirty Add (C2-029), §6 Edit's Save Anyway, §6 bulk unassign, §6 Reliability a, V-001, N8-09, V-002 to V-006, V-008, C2-051, C2-049, N8-25, N8-37's order, FC-03's words

**Open: product (GAP)**
- C2-051: an archived file stays in the Documents table (the client documents list does not leave archived or trashed files out)

**Open: tests**
- G4: the archived client's read-only notes card (only the API's 409 is tested)

**After Nov 17 (decided)**
- N8-18: appointment outcomes and notes
- N8-12: the Overview summary cards
- Edit validation: the API's required email, phone and address
- Duplicate safeguards: the matched ids in the audit
- ZIP: the city and the server check
- §23: platform heading and action-row consistency (decided Nov 16: a cross-module design pass)

**Her retests or decisions (no code)**
- §6 Reliability and accessibility b: keyboard order, screen reader, zoom, touch, disabled modules and restricted states on dev
- §23 Mobile-friendly Clients b: her phone and tablet retest
- §7, §20, §21 roll-ups: close with the rows above
- N8-17 creation part: a non-client's submission makes a Lead, not a New client; her decision
- N8-11 SMS once set up on dev; N8-16 portal bytes; N8-19 a completed appointment fixture; N8-39 a known-unread notice
