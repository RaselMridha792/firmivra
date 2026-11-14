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
  - `tax-return-review` (the Client Portal link)
- **Tenant isolation:** `apps/api/test/isolation/cases/client-portal.ts` covers every route that takes a client id.
- **Mock specs** (`apps/web/e2e/mock/`):
  - `r60-client-portal`
  - `r60-client-portal-manage`
  - `r60-client-portal-documents`
  - `r60-client-portal-forms`
  - `r60-client-portal-preview`
  - `r29-firm-sidebar`

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

## Frame 1: client-portal.jpg (`/client-portal`)

| Item | PR | Test |
| --- | --- | --- |
| Sidebar "Client Portal" opens the module; the placeholder is removed | #1405 | `r29-firm-sidebar` |
| Page title and subtitle | #1405 | `r60-client-portal` |
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
| Recent Activity table and View All Activity | #1370, #1375, #1405 | `client-portal-management`, `r60-client-portal` |

## Frame 2: individual-client-portal-management-access-and-visibility.jpg (`/client-portal/{id}`)

| Item | PR | Test |
| --- | --- | --- |
| Breadcrumbs: Client Portal > Clients > client > tab | #1405 | `r60-client-portal-manage` |
| Back to All Clients and Switch Client, on every page | #1405 | `r60-client-portal-manage` |
| Header: name, portal status, Client ID, email, phone, type | #1375, #1405 | `r60-client-portal-manage` |
| Status strip: Portal Status, Last Login, Portal Since, Last Activity, MFA, Access Method (Edit) | #1375, #1405 | `client-portal-management`, `r60-client-portal-manage` |
| Tabs: Overview, Access & Security, Portal Content, Documents, Forms & Requests, Communications, Activity | #1405, #1410, #1414 | `r60-client-portal-manage` |
| Pending Client Actions: documents, intake incomplete or submitted, signature, invoice, appointment, task; each opens its record; overdue flagged | #1375, #1405 | `client-portal-management`, `r60-client-portal-manage` |
| Portal Content & Visibility: 8 areas per client, on top of the firm's switches; enforced in the portal API and menu; audited | #1400, #1405 | `client-portal-access`, `r60-client-portal-manage` |
| Quick Actions: Resend Portal Invitation | #1405 (existing invitation API) | `r60-client-portal-manage` |
| Quick Actions: Reset Client Access | #1400, #1405 | `client-portal-access` |
| Quick Actions: Lock and Unlock Portal Access (refused at sign-in, on refresh and on every portal request) | #1370, #1405 | `client-portal-lock`, `r60-client-portal-manage` |
| Quick Actions: Deactivate and Reactivate Portal | #1400, #1405 | `client-portal-access` |
| Quick Actions: View Login History | #1375, #1405 | `client-portal-management`, `r60-client-portal-manage` |
| Portal Link for This Client, with Copy Link | #1405 | `r60-client-portal-manage` |
| Client Notes (Internal Only): the canonical staff notes, as the lead decided | #1405 | `r60-client-portal-manage` |
| Recent Portal Activity with IP address (Owner and Admin only) | #1370, #1375, #1405 | `client-portal-management`, `r60-client-portal-manage` |
| Access & Security: invitation status and date, MFA Management (Reset MFA), Login History and Security Events | #1375, #1400, #1405 | `client-portal-management`, `client-portal-access`, `r60-client-portal-manage` |
| Activity tab: type, actor and date filters; load more | #1375, #1405 | `client-portal-management`, `r60-client-portal-manage` |
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
| Table: Form Name, Form Type, Date Requested, Due Date, Date Submitted, Status, Assigned To | #1414 | `r60-client-portal-forms`, `intake-workspace` |
| Every state kept: a submitted form never disappears ("Submitted - Needs Review") | #1414 | `r60-client-portal-forms` |
| Row actions: View Submission, Review, Request Correction, Mark Reviewed, Send Reminder, Send Message, View Form History, Archive | #1414 | `r60-client-portal-forms` |
| Pending Client Actions, Quick Actions, Form Templates (Manage Templates) | #1414 | `r60-client-portal-forms` |
| Form Settings (Client Permissions): the client's Intake Forms switch plus each form's Archive. No per-form portal flag (a Review 2 default). | #1400, #1414 | `client-portal-access`, `r60-client-portal-forms` |

## Related

| Item | PR | Test |
| --- | --- | --- |
| TX-F04: a tax return's Client Portal action opens the firm-side Client Portal for its client, with Back to the return on every tab | #1418 | `r60-client-portal-preview`, `r60-tax-returns-shared` |
| Frame 1's record tabs: Messages, Appointments, Tax Returns, Invoices & Payments | #1414 | `r60-client-portal-forms` |
