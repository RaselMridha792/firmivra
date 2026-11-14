# Clients: Review 2 QA map

This file maps every red, partial and yellow row of Octavia's Clients Review 2 (Nov 3, 2026; the report is kept privately, outside the repo). For each row it names the PR that fixed it and the test that covers it, or marks it as a **GAP**.

Rows are named by their headings only; the report's text is not copied here. Each GAP has a plan and a status.

**Where the tests are**
- API e2e: `apps/api/test/e2e/`
- Mock specs: `apps/web/e2e/mock/`
- Unit tests: `packages/types/test/`
- Isolation: `apps/api/test/isolation/cases/clients.ts` and `body-ids.ts`

## Partial fixes and incomplete workflows (section 2)

| Row | Status | PR | Test |
| --- | --- | --- | --- |
| Return to Clients context | Done | #1415 (R55) | `r23-clients` |
| Stacy service linkage (Enrolled Services) | Done | #1378 | `client-services.e2e`, `r60-clients-tabs` |
| Profile workspace (Services, Intake Forms, Tasks, Notes, Activity, Overview's Active Services and Recent Activity) | Done | #1378 | `client-services.e2e`, `r60-clients-tabs`, `r23-client-record` |
| Documents (profile Upload, View Request Details) | Done | #1384 | `r60-clients-e8-e10` |
| Message submission and history (recipient and the notice before sending) | Done | #1384 | `r60-clients-e8-e10` |
| Staff assignment (stale profile after assign) | Done | #1415 (R55) | `r23-clients` |
| Audit visibility (archive and restore details) | Done | #1382 (R1) | `clients.e2e` |

## Unfixed requirements carried from Review One (section 3)

| Row | Status | PR | Test |
| --- | --- | --- | --- |
| Expanded directory filters (Added Last 30 Days, Archived, More Filters with chips) | Done | #1385 | `clients-work.e2e`, `r60-clients-filters` |
| New KPI and destination | Done | #1382 (R1) | `clients-work.e2e` |
| Client ID search | Done | #1382 (R1) | `clients.e2e` |
| Edit validation (required fields on Add, Edit and the API) | Done | #1380 | `clients.e2e`, `r60-clients-required`, `new-client-form.test` |
| Edit validation: ZIP format ("abc" accepted) | **GAP G3** | Fix: US ZIP or ZIP+4 on Add, Edit and the API | — |
| Normalized phone duplicate (API guard) | Done | #1382 (R1) | `clients.e2e` |
| Normalized phone duplicate: the web dialog | **GAP G2** | Fix: the Possible duplicate client dialog | — |
| Business responsible party (name, email, phone) | Done | #1380 | `clients.e2e`, `r60-clients-required` |
| Business responsible party: linked personal and business profile | **GAP G9** | `client_links` (Rasel approved; schema goes to the lead first) | — |
| Service management (enroll, pause or end with history, package, staff) | **GAP G8** | Fix: Clients > Services actions, using the existing flows | — |
| Document and portal actions (profile Upload, Request Details, Portal invitation) | Done | #1384 | `r60-clients-e8-e10` |
| Bulk and contextual actions: tag, status, inactive, export | Done | #1386, #1387 | `clients-work.e2e`, `r60-clients-export`, `r60-clients-bulk` |
| Bulk and contextual actions: message, document request, intake for the selected clients | **GAP G7** | Fix: three more Bulk Actions | — |
| Last Activity timestamp | Done | #1362 | `clients-work.e2e` |
| Last Activity logic | Done | #1362 | `clients-work.e2e` |

## Missing from Review One and newly demonstrated (section 4)

| Row | Status | PR | Test |
| --- | --- | --- | --- |
| Last Activity dismissal | Done | #1415 (R55) | `r23-clients` |
| Last Activity accessible names | Done | #1415 (R55) | `r23-clients` |
| Dirty Add dismissal | Done | #1415 (R55) | `r23-clients` |
| Stale profile after assignment | Done | #1415 (R55) | `r23-clients` |
| Archived note writes (API, 409 CLIENT_ARCHIVED) | Done | #1382 (R1) | `notes.e2e` |
| Archived note writes: the notes card still offers Add | **GAP G4** | Fix: hide Add on an archived client, and say why | — |
| Formatted phone search | Done | #1382 (R1) | `clients.e2e` |
| Existing rules newly failed (regression cases) | Done | #1380, #1382 | `clients.e2e`, `clients-work.e2e` |

## Owner decisions and additions (section 5)

| Row | Status | PR | Test |
| --- | --- | --- | --- |
| Duplicate review principle (Create Anyway after the warning) | **GAP G2** | API: #1382 (`allowDuplicatePhone`). Web: G2 | `clients.e2e` (API) |
| Proposed duplicate popup | **GAP G2** | Web: G2 | — |
| Duplicate safeguards (permission, audit with the matched ids, no cross-firm disclosure) | **GAP G2** | API: #1382 (Staff see only their own matches). Web: G2 | `clients.e2e` |
| Last Activity owner clarification (every recorded client action counts) | **GAP G6** | Fix: count the client's own audit rows (edits, assignment, tags, status, archive and restore; not views) | — |
| ZIP validity (the ZIP exists, and city and state match) | **GAP G10** | Fix: a static 3-digit ZIP-prefix-to-state table; mismatch is a soft warning | — |
| ZIP lookup edge cases (unverified kept apart from invalid) | **GAP G10** | Fix: "Can't verify" is a warning, never a block | — |
| Prior owner additions (Added Last 30 Days, More Filters, Archived shortcut, Export, basic fields, Responsible Party) | Done | #1380, #1385, #1386 | as above |
| Prior owner additions: linked Business and Personal profiles | **GAP G9** | `client_links` | — |
| Billing cross reference | **GAP G11** | Client-side links and columns here (open invoices, balance, last payment, Invoices filtered by the client). Real Invoices & Payments changes are listed for the lead. | — |

## Remaining tests and blockers (section 6)

These rows ask for test coverage, not features.

| Row | Covered by |
| --- | --- |
| Counts and filter membership | `clients-work.e2e`: KPIs, Pending Documents, Balances Due, New tab, filters |
| Search and navigation depth (company search, services, sorting, paging) | `clients.e2e`: search by name, email, phone, Client ID and formatted phone. `r60-clients-filters`. **GAP G12**: no sort in the card view (fix: add it) |
| Full Add and Edit coverage | `clients.e2e`, `r60-client-form`, `r60-clients-required`, `new-client-form.test`, `r23-clients` (dirty guard) |
| Multi client mutations | `clients-work.e2e` (bulk assign, archive, restore, tag, stage; per-client audit), `r60-clients-bulk` |
| Lifecycle and service history | `clients-work.e2e` (stage changes, audited). Service history: G8 |
| Canonical workflow completion (prefilled requests, intake, appointments, tasks) | `r60-clients-e8-e10`, `r60-clients-tabs`, `r60-client-portal-forms` (Send Intake Form with the client chosen) |
| Summaries and important dates | `client-services.e2e`, `r23-client-record`, `clients-work.e2e` |
| Delivery and document access | `r60-clients-e8-e10` (recipient and notice), `portal-invitations.e2e` |
| Security and permissions | Tenant isolation suite (`cases/clients.ts`, `body-ids.ts`); role checks in `clients.e2e` and `clients-work.e2e` (Staff 403 on export and bulk stage; Staff limited to their own clients) |
| Audit completeness | `clients.e2e` (archive and restore details), `clients-work.e2e` (bulk, export, stage audited) |
| Reliability and accessibility | `r23-clients` (dismissal, focus, names), `r60-clients-required` (submit protection) |
| Acceptance and next module | Report note; nothing to build |

## Test records (section 8)

| Row | Covered by |
| --- | --- |
| Release boundary | Report note; nothing to build |

## Visual consistency review (section 9)

| Row | Status | PR | Test |
| --- | --- | --- | --- |
| V-001 Tab strip scrollbar | Done | #1381, #1415 (R55) | `r34-documents`, `r23-clients` |
| V-002 Documents KPI labels | Done | #1381 (R55) | `r34-documents` |
| V-003 Documents filters | Done | #1381 (R55) | `r34-documents` |
| V-004 Documents table readability | Done | #1381 (R55) | `r34-documents` |
| V-005 Actions menu clipping | Done | #1381 (R55) | `r34-documents` |
| V-006 Request KPI baselines | Done | #1381 (R55) | `r34-documents` |
| V-007 Main sidebar collapse | Done | #1396 | `r60-sidebar-collapse` |
| V-008 Full filename disclosure (hover) | **GAP G5** | Fix: the full name on hover in Documents | — |
| V-009 Approved column alignment | Done | #1381 (R55) | `r34-documents` |
| Visual acceptance limits | Report note; nothing to build | — | — |

## Additional Documents workflow tests (section 10)

| Row | Status | PR | Test |
| --- | --- | --- | --- |
| C2-052 Existing file visibility | **GAP G1** | Fix: `POST /business/documents/{id}/visibility` and the switch (schema item l is live) | — |
| C2-051 Document action scope | Done | #1381 (R55) | `r34-documents` |
| C2-049 Empty staff choices | Done | #1382 (R1) | No spec: a two-line web fix in `share-screen.tsx` (an internal file uses the member list) |
| Approved later client sharing (off by default, explicit opt-in) | **GAP G1** | as C2-052 | — |
| Remaining sharing acceptance (only the assigned staff or higher can share) | **GAP G1** | as C2-052, with server tests (peer Staff 403, firm B 404) | — |

## GAP status

| GAP | Status |
| --- | --- |
| G1 C2-052 visibility | In progress |
| G2 Duplicate popup | Next |
| G3 ZIP format | Next |
| G4 Archived notes UI | Next |
| G5 Full filename on hover | Next |
| G6 Last Activity counts every recorded action | Next |
| G7 Bulk message, request, intake | Next |
| G8 Service management | After G7 (the lead's scope, Nov 14) |
| G9 Linked profiles (`client_links`) | After G8; schema to the lead first |
| G10 ZIP prefix and state | After G8 |
| G11 Billing links on the client | After G7 |
| G12 Card view sort | After G7 |
