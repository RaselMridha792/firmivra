# Client Portal module: QA map

Each item in the four firm-workspace mockups (`docs/mockups/firm-workspace/client-portal-tab/source/`) is mapped here to the PR that built it and the test that covers it. The module also follows Octavia's *Client Portal Developer Instructions*.

The module is the firm's internal view of one client's portal at a time. It is not the client's portal.

It is built from the canonical records (Clients, Documents, Intake Forms, Messages, Appointments, Tax Returns, Invoices, Tasks).

- **Who can open it:** every route is under `@Access('CLIENT_PORTAL')`.
- **Staff** see only the clients assigned to them.
- **Access changes** are for the Owner and Admins only.

**Tests**

- **API e2e** (`apps/api/test/e2e/`):
  - `client-portal-lock`
  - `client-portal-management`
  - `client-portal-access`
  - `intake-workspace` (the `clientId` filter)
- **Tenant isolation:** `apps/api/test/isolation/cases/client-portal.ts` covers every route that takes a client id.
- **Mock specs** (`apps/web/e2e/mock/`):
  - `r60-client-portal`
  - `r60-client-portal-manage`
  - `r60-client-portal-documents`
  - `r60-client-portal-forms`
  - `r60-client-portal-preview`
  - `r29-firm-sidebar`
  - `r60-tax-returns-shared` (TX-F04's Client Portal link)
  - `r60-portal-layout` (the module's own width)

**PRs**

| PR | What it built |
| --- | --- |
| #1370 | Lock check at sign-in and in the guard; activity copy |
| #1375 | API part 1: header, recent, summary, pending actions, activity, logins |
| #1400 | API part 2: visibility and its enforcement, deactivate and reactivate, reset access, MFA reset, KPIs |
| #1405 | Web 1 and Web 2: the `/client-portal` page and the client page |
| #1410 | Web 4: Documents |
| #1414 | Web 5: Intake Forms, the record tabs, Communications |
| #1418 | Web 6: the preview and TX-F04 |
| #1480 | Layout by the module's own width |

## Frame 1: client-portal.jpg (`/client-portal`)

| Item | PR | Test |
| --- | --- | --- |
| Sidebar "Client Portal" opens the module; the placeholder is removed | #1405 | `r29-firm-sidebar` |
| Page title and subtitle | #1405 | `r29-firm-sidebar` (the title) |
| Switch Client: active client; search by name, email, phone, company or Client ID | #1405 (search: #1382) | `r60-client-portal` |
| Recent Clients: one-click switching, newest first | #1375, #1405 | `client-portal-management`, `r60-client-portal` |
| Clients list: search, All Statuses, All Services, rows with type and status, pagination | #1405 | `r60-client-portal` |
| The active client is kept in the address, and the last client is reopened | #1405 | `r60-client-portal` (reload) |
| Safe switch: the previous client's data is cleared before the next one loads | #1405 | `r60-client-portal` |
| Client header: name, status, type, Client Since, Client ID | #1375, #1405 | `client-portal-management`, `r60-client-portal` |
| Open Client Portal: a read-only staff preview, audited, never a client session | #1418 | `client-portal-access`, `r60-client-portal-preview` |
| Send Message (client prefilled) and View Profile | #1405 | `r60-client-portal` |
| More menu: Portal Management, Access & Security, View Activity History | #1405 | `r60-client-portal-manage` |
| Tabs: Overview, Documents, Messages, Appointments, Tax Returns, Invoices & Payments, Intake Forms | #1405, #1410, #1414 | `r60-client-portal`, `r60-client-portal-forms` |
| Portal Summary: six cards with a Last 7 / 30 / 90 Days range; each card opens its tab | #1375, #1405 | `client-portal-management`, `r60-client-portal` |
| Recent Activity table and View All Activity | #1370, #1375, #1405, #1599 | `client-portal-management`, `r60-client-portal`, `r60-client-portal-livefix` "CP-F2-04, F2-15, F1-14…" (a staff preview reads "Portal preview opened by <member> (staff)" on the Activity tab) |
| Unsaved edits: leaving the client (Switch Client, Back, breadcrumbs, tabs) with an unsaved edit asks first (instructions 13, 27) | #1551, #1599 | `r56-client-portal-documents` "instructions 19 and 13: Rename in place; leaving with the name unsaved asks first", `r60-client-portal-livefix` "CP-F1-15…" (an unsaved Client Note) |

## Frame 2: individual-client-portal-management-access-and-visibility.jpg (`/client-portal/{id}`)

| Item | PR | Test |
| --- | --- | --- |
| Breadcrumbs: Client Portal > Clients > client > tab | #1405 | `r60-client-portal-manage` |
| Back to All Clients and Switch Client, on every page | #1405 | `r60-client-portal-manage` |
| Header: name, portal status, Client ID, email, phone, type | #1375, #1405 | `client-portal-management`, `r60-client-portal-manage` |
| Status strip: Portal Status, Last Login, Portal Since, Last Activity, MFA, Access Method (Edit) | #1375, #1405, #1599 | `client-portal-management`, `r60-client-portal-manage`, `client-portal-management` "CP-F2-04: a staff preview is listed as the member's, and never the client's Last Activity"; `r60-client-portal-livefix` (Last Activity is the client's own) |
| Tabs: Overview, Access & Security, Portal Content, Documents, Forms & Requests, Communications, Activity | #1405, #1410, #1414 | `r60-client-portal-manage` |
| Pending Client Actions: documents, intake incomplete or submitted, signature, invoice, appointment, task; each opens its record; overdue flagged | #1375, #1405 | `client-portal-management`, `r60-client-portal-manage` |
| Portal Content & Visibility: 8 areas per client, on top of the firm's switches; enforced in the portal API and menu; audited | #1400, #1405 | `client-portal-access`, `r60-client-portal-manage` |
| Quick Actions: Send and Resend Portal Invitation | #1405, #1595 | `portal-invitations` (the API); `r60-client-portal-frame2` "Frame 2: the invitation's status and date, and Send then Resend Portal Invitation". #1595 makes the mock's client page read the invitation sent, as the API's does. |
| Quick Actions: Reset Client Access | #1400, #1405 | `client-portal-access` |
| Quick Actions: Lock and Unlock Portal Access (refused at sign-in, on refresh and on every portal request) | #1370, #1405 | `client-portal-lock`, `r60-client-portal-manage` |
| Quick Actions: Deactivate and Reactivate Portal | #1400, #1405 | `client-portal-access` |
| Quick Actions: View Login History | #1375, #1405 | `client-portal-management`, `r60-client-portal-manage` |
| Portal Link for This Client, with Copy Link | #1405 | `r60-client-portal-manage` |
| Client Notes (Internal Only): the canonical staff notes, as the lead decided | #1405 | `r60-client-portal-manage` |
| Recent Portal Activity with IP address (Owner and Admin only) | #1370, #1375, #1405, #1599 | `client-portal-management`, `r60-client-portal-manage`, `r60-client-portal-livefix` (the preview row, by the member, with the IP) |
| Access & Security: invitation status and date, MFA Management (Reset MFA), Login History and Security Events | #1375, #1400, #1405 | `client-portal-management`, `client-portal-access`, `r60-client-portal-manage` |
| Activity tab: type, actor and date filters; load more | #1375, #1405 | `client-portal-management`, `r60-client-portal-manage` |
| Activity: each row opens its record; a row with no record stays text (instructions 24) | #1546 | `r56-client-portal-gaps` "instructions 24: an activity row opens its record; one with no record stays text" |
| Pending Client Actions: Send Reminder on an overdue item, through the item's own reminder route (instructions 17) | #1546 | e2e `client-portal-management` "names Send Reminder's target on an overdue request, form or signature, and none on time"; mock `r56-client-portal-gaps` "instructions 17: an overdue pending action has Send Reminder; the others do not" |
| Communications tab: the client's threads, unread counts, New Message | #1414 | `r60-client-portal-forms` |

## Frame 3: documents-tab.jpg (Documents)

| Item | PR | Test |
| --- | --- | --- |
| Client Documents header with Upload Document and Request Document (client prefilled) | #1410 | `r60-client-portal-documents` |
| KPIs: Total Documents, Client Uploaded, Firm Shared, Pending Review, Requested | #1400, #1410 | `client-portal-access`, `r60-client-portal-documents` |
| Search, type or category, status and date filters, with Clear | #1410 | `r60-client-portal-documents` |
| Tabs: All Documents, Client Uploaded, Firm Shared, Pending Review, Requested | #1410 | `r60-client-portal-documents` |
| Table columns: Name, Type, Category, Source, Uploaded By, Date, Status | #1410 | `r60-client-portal-documents` |
| Row menu: View, Download, Mark Reviewed, Request Replacement, Share to or Remove from Portal, Archive, Move to Trash | #1410 | `r60-client-portal-documents` |
| CP-PT-03: a file the firm moved to Trash, archived or replaced leaves the client's portal (list, view, download, message and invoice attachments, service reports, the tax return PDF, intake uploads, the signed copy) and the firm's portal counts, by one rule (`LIVE_DOCUMENT`); restored, it comes back | #1605 | `documents-portal` "CP-PT-03: a file the firm trashed or archived leaves the client's portal and its counts, and comes back when restored"; unit `tax-returns` "…the PDF only when CLEAN, shared and live" |
| Row menu: Link to Record, Reclassify and Rename (instructions 19) | #1551 | `r56-client-portal-documents` (both tests) |
| Pagination with 10, 25 or 50 per page | #1410 | `r60-client-portal-documents` |
| Document Requests panel, with Request New Document | #1410 | `r60-client-portal-documents` |
| Recent Document Activity | #1370, #1410 | `r60-client-portal-documents` |
| **Storage Usage: left out.** No storage quota is recorded or enforced anywhere, and the instructions say to show it only when one is. | — | — |

## intake-form-client-portal.jpg (Intake Forms / Forms & Requests)

| Item | PR | Test |
| --- | --- | --- |
| Intake Forms header: Request Form (Send Intake Form with the client chosen), Send Reminder, More Actions | #1414 | `r60-client-portal-forms` |
| KPIs: Total, Completed, Submitted Needs Review, In Progress, Not Started, Archived | #1400, #1414 | `client-portal-access`, `r60-client-portal-forms` |
| Search, status and date filters, with Clear | #1414 | `r60-client-portal-forms` |
| Filters by form type and service: Form Type and Service choices are the client's own forms in the chosen status (P1-17) | this PR (R56) | e2e `intake-workspace` "lists with tabs, search, filters and pages" (formId and serviceId on the archived tab); mock `r56-client-portal-forms-filters` |
| Table: Form Name, Form Type, Date Requested, Due Date, Date Submitted, Status, Assigned To | #1414 | `r60-client-portal-forms`, `intake-workspace` |
| Every state kept: a submitted form never disappears ("Submitted - Needs Review") | #1414 | `r60-client-portal-forms` |
| Archived forms listed: Status "Archived" lists them; they stay out of All Statuses, as counted (P1-17). A form sent from Request Form shows on return | this PR (R56) | e2e `intake-workspace` "lists with tabs, search, filters and pages" (tab=archived); mock `r56-client-portal-forms-filters` |
| Row actions: View Submission, Review, Request Correction, Mark Reviewed, Send Reminder, Send Message, View Form History, Archive | #1414 | `r60-client-portal-forms` |
| Row action: Download PDF, the same export as the form's Export PDF (`GET /intakes/:id/pdf`), in its own tab; a failure says why and the list stays (P1-18) | this PR (R56) | mock `r56-client-portal-forms-filters` "P1-18: Download PDF on a form row…"; the route: e2e `intake-workspace-actions` "exports the answers as a PDF behind a short link" |
| Pending Client Actions, Quick Actions, Form Templates (Manage Templates) | #1414 | `r60-client-portal-forms` |
| Form Settings (Client Permissions): the client's Intake Forms switch plus each form's Archive. No per-form portal flag (a Review 2 default). | #1400, #1414 | `client-portal-access`, `r60-client-portal-forms` |

## Related

| Item | PR | Test |
| --- | --- | --- |
| TX-F04: a tax return's Client Portal action opens the firm-side Client Portal for its client, with Back to the return on every tab | #1418 | `r60-client-portal-preview`, `r60-tax-returns-shared` |
| Frame 1's record tabs: Messages, Appointments, Tax Returns, Invoices & Payments | #1414 | `r60-client-portal-forms` |
| Tax Returns tab: the assigned staff column (preparer, reviewer, or Unassigned) (instructions 4) | #1546 | e2e `tax-returns` "names each return's assigned staff"; mock `r56-client-portal-gaps` "instructions 4: the Tax Returns tab shows each return's assigned staff" |
| Layout: nothing overlaps with the side menu open; no sideways scroll at 1440 or 390 | #1480 | `r60-portal-layout`, `r29-firm-sidebar` |

## Tests added (cross-check of Nov 15, done in #1595)

Every row of the Nov 15 list now has a check:

- Frame 1: `r60-client-portal-frame1`: Switch Client's search; the Clients list's search, no-match message, status filter and page summary; Send Message and View Profile; the More menu; View All Activity; the last client reopened from the menu.
- Frame 2: `r60-client-portal-frame2`: Client Notes, Copy Link, the Portal Content tab, the breadcrumb's Clients link; the invitation's status and date; Send, then Resend Portal Invitation.
- Pending Client Actions: `r60-client-portal-pending`: the signature item (Form 8879).
- Frame 3: `r60-client-portal-frame3`: the columns, search with Clear, the row menu, 10, 25 or 50 per page, and Request Document with the client chosen.
- Intake Forms: `r60-client-portal-intake`: the counts are the client's own forms (none, then the one sent; #1595 fixes the mock, which showed 8 forms beside an empty list); the actions of a form waiting on the client, with Send Reminder; More Actions; the Quick Actions; Manage Templates.
- The record tabs and Communications: `r60-client-portal-records`: each lists the client's records, and Messages shows read and unread.

One row is left to Octavia's retest on dev: a "Submitted - Needs Review" row in the table. In mock mode a form can't be submitted from the firm's side, and the mock seeds no submitted form for the module's clients; the label itself is the forms tab's status text for a submitted form.

## Review One: the client's portal and Settings > Client Portal

Octavia's Review One for what a client sees in their portal and for Settings > Client Portal (the Client Portal settings guide of Oct 20 and the portal items in the Oct 21 to 28 reviews). This is separate from the firm-side module above. The full check (64 rows: what was already done, and what is open) is kept privately, outside the repo. Rows are named by their IDs only; her text is not copied here. The decisions are the lead's, Nov 18. The cross-tab portal rows (A7, A9, SP-1, T16, B10, B28, B32, BA-CP, BK-CP2 to CP4) are R55's.

| Row | Code status | PR | Test |
| --- | --- | --- | --- |
| CP-1 Panels and View Client Portal | Done | #1619 | mock `r1-portal-review1` "CP-1: five panels, each by its address, and View Client Portal opens a client's preview" |
| CP-1g Button text, device preview | **GAP**: needs the db PR | | |
| CP-3b Go to Communications | Done | #1619 | mock `r1-portal-review1` CP-1 (the link opens the announcement composer) |
| CP-3c, CP-3d, CP-3h, CP-3i Announcements switch, channel policy, preview, dashboard switch | **GAP**: needs the db PR | | |
| CP-4f Contact switches reached by API | Done (messages); appointments stay the card's button only, by the lead's decision | #1619 | e2e `portal-contact` "CP-4f: with Allow Secure Messages off, a client cannot start a conversation by API either" |
| CP-5a to CP-5e, CP-5h Tabs: all six, rename, reorder, custom tabs, targeting, preview | **GAP**: needs the db PR | | |
| CP-6.6 Phone layout | Done (test) | #1619 | mock `r1-portal-review1` "CP-6.6: Settings > Client Portal fits a phone, every panel" |
| CP-7.1 Cancel and leaving with unsaved changes | Done | #1619 | mock `r1-portal-review1` "CP-7.1: General has Cancel, and leaving with unsaved changes asks first" |
| CP-7.6, CP-7.7 Rollout and sign-off evidence | Her retest and Rasel's release steps | | |
| CP-9.3 Personal portal hides the Business tab | Done | #1619 | e2e `portal-tabs` "CP-9.3: a Personal portal lists no business-only tab; a Business portal does"; mock `r1-portal-review1` CP-9.3 |
| SM10 Portal header clock | Done | #1619 | e2e `portal-info` (the firm's zone); mock `r1-portal-review1` "SM10: the portal header shows the date, time and the firm's time zone" |
| SU-D3b A quiet decline | Done (test) | #1619 | e2e `client-sign-ups` "SU-D3b: with notify unticked, a decline closes the login and emails nobody" |
