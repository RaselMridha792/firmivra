# Octavia's review of Oct 24 to 25, 2026: Dashboard and Business Advisory (change list)

Source: Octavia's two Drive folders of Oct 25: **Dashboard** (guide) and **business dev & Advisory** (guide plus four screenshots). Her guides are in this folder as text converted from her .docx (tables flattened, one row per line group):

- `dashboard--developer-feedback.md` (Dashboard, "First review checkpoint", Oct 24)
- `business-advisory--developer-feedback.md` (Business Advisory and Development, updated Oct 24, sections 1 to 27)
- Screenshots: `screenshots/business-advisory-1.png` to `-4.png` (Client Advisory Detail workspace and related screens, Oct 23 and 24).

Both modules are already built on main (`apps/api/src/dashboard`, `apps/api/src/advisory`, `apps/web/src/app/firm/(workspace)/page.tsx` and `.../business-advisory`). This is a fix and addition round, not a new build.

How to read it (same rules as `docs/specs/review-2026-10-23/CHANGE-LIST.md`):

- **P1**: a defect she hit (error, wrong route, data not saving). Do first. **P2**: a changed rule or missing control. **P3**: a new or bigger flow.
- "Check" means the session first looks at main and dev: her guides were written against an older dev build.
- Items she calls **PASS** or **Working** are provisional: do not break or rework them. **PENDING** and **V1 to V11 / T01 to T12** are tests for the session (Pass, Fail or Blocked with evidence in the PR), not defects. **CLARIFIED** items were withdrawn: do not implement them (her guides list them; they are repeated here only where a wrong guess is likely).
- Design completeness rule applies: complete screens, honest empty states, no fake numbers, no placeholder or debug text. Example names, dates and dollar amounts in her guides are fictional test data: never seed them.
- Anything that changes `packages/db` needs Rasel's own tap; anything that changes auth guards or role checks needs his word as well. Say so in the PR and in the reply instead of doing it.

Priority now (Rasel, Oct 25): Octavia's focus is the **firm workspace and the client portal**. All of this must be done before Oct 28.

## A. Dashboard (guide: `dashboard--developer-feedback.md`)

Her IDs (K, C, T, A, N, Q, D, U) are kept. Rule from her guide: every card, row and shortcut opens the exact record, filter or creation workflow its label promises; use the canonical source-module workflows and the same permission and audit checks. Never hard-code example figures.

| # | Change | Prio |
|---|---|---|
| K3 | **New Leads** opens Leads filtered to New and the card's period (it opens all leads today). | P1 |
| K4 | **Returns In Progress** opens Tax Returns filtered to the in-progress statuses (In Preparation, Awaiting Client, Ready Review File) and the period. Document which statuses count. | P1 |
| K5 | Rename **Completed Returns to Accepted Returns**: count and drill down Accepted only (not Transmitted, not Rejected). No invented "Completed" status. Accepted Returns is the default tax outcome card (D5). | P1 |
| K6 | **Outstanding Invoices** opens Invoices & Payments filtered to all unpaid outstanding balances, including not yet overdue. Do NOT make it overdue-only (that suggestion was withdrawn). Count and balance reconcile with the destination. | P1 |
| K7 | **Appointments Today** and View Calendar open Appointments or the calendar filtered to today in the firm's timezone. | P1 |
| K2 | A clear **return to Dashboard** from drill-down pages, keeping period, filters, layout and scroll where practical. | P2 |
| K8 | Restore the **comparison arrows, percentages and labels** on the KPI cards: metric-aware favourable or unfavourable colour plus text, a neutral no-change state, safe "New" or "N/A" when the prior period is zero, equivalent elapsed periods. | P1 |
| C1 | The **period selector** is absent: global selector plus widget controls for Today, This Week, This Month, Last Month, This Quarter, This Year, Last Year, Custom (validated). Firm-local boundaries; month, quarter and year mean to date, "last" means the full period. Document which widgets the global period drives and which have their own. | P1 |
| C2 | **Revenue Overview**: working Month, Quarter, Year and Custom controls; keep the honest empty state. | P1 |
| C5 | **Client Pipeline** stage click does nothing: open the matching pre-filtered Leads, Clients or Workflow view with the stage and the period. Test every configured stage. | P1 |
| T4 | A **task title** opens that exact task; a related-client link is separate and permission-controlled (it opens the client profile today). | P1 |
| T5 | **Confirmation before completing** a task from the checkbox: Cancel leaves it unchanged; Confirm completes once through the canonical task workflow; on failure restore the checkbox and show an actionable error. | P2 |
| A2 | An appointment row opens **that appointment** (not the general page). | P1 |
| A3 | Add the appointment **three-dot menu**: View Details, Edit, Reschedule, Send Reminder, Mark Complete, Cancel (with confirmation), Open Client, filtered by permissions. A meeting icon uses a valid, permitted meeting link. | P2 |
| A4 | **Scrollable Upcoming Appointments** panel for long lists, visible scrollbar, keyboard and touch access. | P2 |
| N2 | Opening the notification list **marks the viewed notifications read** and clears the unread badge; keep the history; the badge stays cleared after refresh. | P2 |
| N3 | A notification about an appointment opens **that appointment**, rechecking access at the destination. | P1 |
| Q1, Q7 | **Add a New Client** (bottom card) and **+ New > Client** open the canonical new-client form directly. | P1 |
| Q2, Q11 | Send a Message and + New > Message open a **fresh composer with client selection**, not an old conversation. Verify before marking passed. | P2 |
| Q3 | **Create a Bulk Email** opens the Send Bulk Email composer directly (not Overview, not the campaigns list), without sending or creating a campaign. | P1 |
| Q4 | **Generate an Invoice** opens a blank canonical invoice creation form. | P1 |
| Q5 | **Upload Documents** opens the secure upload workflow with required client and details selection. | P1 |
| Q6 | The **+ New menu** also offers New Lead, New Task, Bulk Email or Communication, and Upload Documents (only what the user may do). Opening the menu creates nothing. | P2 |
| Q10 | The + New menu closes on Escape, outside click, route change and selection; keyboard navigation and focus return. | P1 |
| D1 | Shared client form: name, email, phone and the right address are required for Individual and Business; Business Name required for Business; no misleading "optional" labels; home or business address wording. | P2 |
| D2 | **Help**: besides the two email actions, an in-app support message, FAQ, and live chat or call options according to the firm's configured availability; show only configured channels, honest availability, nothing sent by opening Help. | P3 |
| D3 | **Report a Problem** text exactly: "Describe what went wrong. Your firm name and affected page will be included in the report." Attachments are the user's choice; never include secrets or unrelated sensitive content automatically. | P2 |
| D4 | **Settings: administrator-controlled service-card templates**: select service, status, metric and label together, a small selected set and optional extra cards. Label, count and drill-down stay aligned. Likely needs a settings table (Rasel's tap). | P3 |
| D5 | Total Clients, New Leads and Outstanding Invoices stay fixed; Accepted Returns is the default tax outcome card. | P2 |

Kept as is (her PASS items, do not break): K1 Total Clients, C6 pipeline counts, T1 to T3 and T6 (messages, tasks due, completed tasks leave Due and show Done), A1 upcoming appointments and View All, N1 reminder in the bell, Q8 + New Invoice, Q9 + New Appointment opens the calendar (accepted), U1 to U5.

Her controlled tests V1 to V11 (reconciliation, comparisons and boundaries, revenue and service breakdown, live updates and cache scope, roles, failure states, audit parity, performance, routing and return context, accessibility, form outcomes) are for the session to run on the PR with fixtures and to report Pass, Fail or Blocked: do not mark any of them passed from an empty widget or a working link. Withdrawn items to leave alone: no missing-clock defect, no overdue-only invoice card, no campaigns-list destination, no "empty chart click failure", no "deleted task", no direct appointment modal.

## B. Business Advisory and Development (guide: `business-advisory--developer-feedback.md`)

Her section numbers (1 to 27) are kept. "Developer handoff remains on hold" in her text is about her own process, not ours: we build and fix now.

### B1. Blocking defects (P1)

| # | Where | Change |
|---|---|---|
| B1 | §23, §24, §27 | **Advisory document upload fails on save** (document type list empty, exact error unknown). Find the cause (validation, configuration, route), fix, with an actionable error. Files Shared by Client stays untestable until this works. |
| B2 | §23, §25 | **Advisory > Documents > Request Document** returns "We couldn't find that item" and does not show the client as recipient. Carry the client and profile context, repair the error, show the client, recipient, item and channel before sending, keep valid input on failure, prevent duplicate requests. (The canonical Client Profile request works: leave it.) |
| B3 | §24, §25, §27 | **Invite Client** opens the profile Edit page. Build a real **Send Portal Invitation** with a secure link: show the recipient, client and access, require confirmation, keep the signup then firm approval flow (Signups), record the outcome. |
| B4 | §10, §19, §22 | **Schedule Meeting / Schedule Advisory Meeting** must carry the client, profile and advisory service into the appointment form (it does not prefill today), and map the advisory appointment type. Back returns to the originating client and tab with the draft kept. |
| B5 | §1 | **Upcoming Advisory Meetings** card opens Appointments with an advisory filter applied, keeping a clear way to the full calendar. |
| B6 | §2 | Entity Type **Other** and Industry **Other** need a "specify" text field that saves. |
| B7 | §5, §13, §15 | Goal form statuses: offer all eight (Not Started, Planning, In Progress, On Track, At Risk, Overdue, Completed, Cancelled) with consistent transitions and overdue derivation. Fix **status and progress mismatch** (back to Planning still shows Completed and read-only progress). |
| B8 | §5 | **Milestones** need owner, status and progress, linked goal or service (original §5), not only name, date and Delete. |
| B9 | §16 | **Version History** lists versions that cannot be opened: add View Snapshot. **Finalized plans are locked**: replace Edit with **Modify Plan**, which creates a linked new draft revision; the finalized version stays unchanged. |
| B10 | §16 | **Approval before finalization**: staff review, then **client approval BEFORE finalization**; a modified revision needs both again. Do not copy the Tax Planning finalize-then-send order. |
| B11 | §11 | **Zoom link toggle** does not work: find the cause (integration not connected?), show an actionable message, never assume it is connected. |
| B12 | §25 | Canonical profile document **year and category selectors are empty**: provide configured choices and a clear empty or configuration state (categories are not Services & Pricing offerings). |

### B2. Required fields, helper text and forms (P2)

| # | Where | Change |
|---|---|---|
| B13 | §3 | Required-field rules: Plan Name, target year, plan type, client; Business Name, Entity Type, Industry, Years in Business, Business Stage; address and contact (not Website); How did you hear about us; Strategy Summary; Focus Area (explicit choice, with an exclusive **None / Not Applicable**). Optional: Website, employee count, hiring plans, key team members, Notes, Funding when not applicable. Consistent markers, inline messages, entries kept on failure. |
| B14 | §4, §6, §7 | Persistent **helper text** below each label and above the input, exact copy from §6 and §7 (Current Customers, Sales Trend, Target Market, Competitors, What Sets Your Business Apart, Amount Needed, Timing, Purpose, Readiness, How the Business Operates, Systems/process challenges, Staffing, Efficiency Opportunities, Strengths, Weaknesses, Opportunities, Threats, Goal Description). Rename Customers to **Current Customers**. Add optional **How the Business Operates** first in Operations, and optional **Opportunities** and **Threats** in SWOT. The recommendation helper texts in §7 are PROPOSED: build them but flag them as proposed in the PR. Apply the same helper placement across the platform for the fields she has approved only. |
| B15 | §2 | **EIN**: a separate status and number field with Not Applicable and To Be Applied For; masked, restricted, audited; status text never saved as an EIN. May need a column (Rasel's tap). |
| B16 | §2 | Let authorized users manage reusable **Industry** choices in Settings (separate from Products & Services). |
| B17 | §1 | **Search Existing Clients** beside the empty plan client selector (links the engagement to the existing client, no duplicate). |
| B18 | §10 | Client search keeps name, email, phone and ID, minus the misleading dropdown arrow. **Add Business Profile** (and **Add Personal Profile**, §22) under an existing client: linked records, prefill, no duplicates, not new login accounts. |
| B19 | §10 | **Create Appointment Type** action beside the selector: opens settings, keeps the whole draft, returns and selects the new type; department managers their own department, admins company-wide. |
| B20 | §11 | **Color**: spelling; inherit read-only from the appointment type; remove the per-appointment dropdown. |
| B21 | §11 | **Manual client SMS consent**: record an opt-in with phone, date, method and agreed wording; a staff toggle alone is not consent. Explain SMS prerequisites when disabled. Related Items: explain the prerequisite. (Check against R55's consent work first.) |
| B22 | §12 | **Recurrence model**: interval of 1 or more, Monday to Sunday weekday buttons, "End after total occurrences" versus additional appointments, End on date, a preview of the actual dates; an initial appointment on one weekday with the series on another. |
| B23 | §12 | **Book Anyway** for Owner and Admin only, with a reason and an audit record. **Return to Appointment** after editing availability keeps the draft (autosave never books) and revalidates. Universal **booking summary** after a booking (client, service, date, time, timezone, staff, location, status). |
| B24 | §13, §14 | **Goal template library**: the 15 approved searchable, editable suggestions in §14; selecting one fills the form and never creates a goal by itself. |
| B25 | §15 | Confirmation popups before Mark Complete and Archive (in-app dialogs, not emails). Archived goals: Active, Archived and All views, searchable, authorized **Restore**; history kept; no hard delete. |
| B26 | §16 | Business Plans: search by plan, client, business; filters year, type, advisor, status. **Archive & History** tab beside Reports with Archived and Versions views; Restore only for archived records, never for version snapshots. |
| B27 | §17 | Financial Analysis: authorized **Edit creates an audited correction version** (prior versions read-only; source, actor, timestamp, reason, old and new values). The extra charts request was withdrawn: do not add charts. |
| B28 | §18 | **Resources**: Open, Edit, Add Resource, search and categories; the send popup adds **Portal** as a channel and **Secure Link or PDF** as formats, with a preview and a client-facing eligibility check. |
| B29 | §18 | Advisory **reports** keep their advisory context and filters when routed to the central Reports (Save, Schedule, Reports links). |
| B30 | §21 | Client Tasks: the title links to the task (permission-controlled), clear Add and Edit Task (details, assignee, due date), Back returns to the client and tab; **Add/Update Progress Note** with status, actor, date and history. In-app confirmation dialogs for status change, cancel, archive, restore and sharing across the platform (name the record, action, recipient and access effect). |
| B31 | §22 | **Cancel Meeting** with reason and confirmation, one appointment record in the central and advisory views; Back to the originating client and Meetings tab with context. |
| B32 | §23 | Notes: an **Internal Only** or **Shared with Client** badge, default internal; sharing previews the client copy and needs confirmation. |
| B33 | §24 | **Files Shared by Client** (inbound files from canonical Documents, separate from files shared by the firm, no duplicate storage) and **document history** (uploader, date, type, version, sharing status, direction). |
| B34 | §25 | Rolling **year options** (current year, six back, three ahead, plus custom); never change stored historical dates. Messages: show channel and recipient before sending; keep history with the recorded outcome. |
| B35 | §26, §27 | **Services & Pricing mapping**: configure the original guide's 14 advisory offerings and the nine **Primary Service Focus** categories (Business Formation, Business Planning, Branding & Website, Funding Readiness, Growth Strategy, Operations, Staffing, Financial Analysis, General Advisory) through Services & Pricing, not hard-coded; keep Additional Services; reuse canonical services (Bookkeeping and Payroll stay separate modules). Add a **Services & Deliverables** tab (In Progress and Completed, service, date, staff, files, links) separate from Plans Delivered. |

### B3. Tests for the session (not defects)

Her T01 to T12 and the PENDING rows: for the PR that touches the area, run the relevant ones with controlled fixtures (uploads and sharing, invitation and client access, service sync, permissions and isolation, calculations and the health-score factors in §20, approval before finalization, snapshots, error and retry) and report Pass, Fail or Blocked with evidence. Do not mark an unexecuted test passed. Withdrawn items to leave alone: shared Industry list, "no existing-client lookup", the Advisory Client Since default, the duplicate-row concern, the new financial charts, an "opaque" health score, "Add Recommendation always fails" (it saved on the latest attempt: keep the negative-path retests).

## C. Routing (Rasel, Oct 25)

- **Dashboard (A):** R60 takes K, T, A, N, Q and D1, D3 first (routes, menus, confirmations); R55 takes K8, C1, C2, C5, D2, D4 and D5 after its open PRs.
- **Business Advisory (B):** R56 takes B1 to B5 first (upload, request, invitation, schedule, meetings card), then B6 to B12; the rest in the order of the table. A fresh session may be needed for B13 onwards.
- **Schema or guard changes** (B15, D4, anything that adds a column): write the request in the session's R file and ask Rasel for the tap; do not touch `packages/db`.

---

# Addendum of Oct 25, 10:07 UTC: Client Sign-ups and Clients

Two more of her folders: **Sign ups** (a new functional spec, v1.0 of 25 Oct, plus an expanded-sidebar concept image) and **Clients** (consolidated first-screen review, 24 to 25 Oct). Text conversions: `client-signups--developer-instructions.md`, `clients--developer-feedback.md`. Image: `screenshots/client-signups-expanded-sidebar.png` (design concept, sample data: match the layout, never seed its names).

Same reading rules as above. Her labels in the Sign-ups spec: APPROVED REQUIREMENT is built; RECOMMENDED SAFEGUARD is built unless an equivalent is cheaper and no weaker; OWNER DECISION PENDING gets the default below (Rasel decided, reversible, shown to Octavia at review: we never ask her for inputs).

## D. Client Sign-ups (spec; screen `apps/web/src/app/firm/(workspace)/sign-ups`, API `apps/api/src/client-auth/client-sign-ups.*`)

Already on main: a queue of verified portal sign-ups with Waiting and Declined views, approve, decline, link to an existing client by email (`CLIENT_CODE...`, `linkable`), audit on list and decisions, owner and admin only. Not on main: everything below.

### D1. Screen to the concept image (P2)

- Sidebar: **Clients** group with Overview, **Sign-ups** (active), Documents, as in the image; Back never goes to Dashboard but to the page the user came from, with tab, search, filters, page and scroll restored (spec §14, tests B01 to B04). Cancel and Close never submit anything.
- Header card **Client self-sign-up approval**: Manual Review / Automatic Approval radios with the two explanation lines, "Manage settings" button, "Authorized admins only".
- Tabs **Waiting for Approval / Approved / Declined** with tenant-wide counts (independent of search; the result area says the filtered total separately). Search name or email, **Date submitted** sort, Filters (date range, potential-match status), Clear. Row: avatar initials, name, email, submitted date, Checks column (**Potential match** amber, **No match found** green: text, never colour only), explicit detail action. Newest first, stable id tie-break, server paging, first page after a filter change. Today's queue is oldest first: change it.
- **Resolve Existing Account** panel (staff only) with the amber "Potential Match, Automatic Approval Paused" box and "View existing client record", the three checkboxes (Call the contact already on file, Verify the client's identity, Record the client's permission), buttons Restore Access / Link Existing Record (disabled until all three are recorded, with the plain reason), Keep Pending, Approve / Decline. Activity list under the table (Application submitted, Email verified, decision events: who, when, result, never tokens or identity evidence).
- **Client view preview** card: only Sign In, Reset Password, Contact Firm; no staff controls, no side effects.
- Footer note and the "still to confirm" strip as in the image only if Octavia's design keeps them in production: leave the strip out (it is a design note, not product copy).
- Loading, empty ("no requests for this status"), no results (with query and Clear), list error with retry, action in progress, unknown outcome, permission lost, version conflict, validation: spec §10 table. Labelled tab list, focus trap in dialogs, accessible names, narrow layout keeps the same labels (cards or scroll region).

### D2. Match detection and the verification gate (P1 for the safety rules)

- A sign-up that matches an existing client of the firm (normalized email, phone, name plus other fields: a name alone never counts as proof) becomes a **potential match**: it stays in Waiting, with a flag separate from the decision state, and auto-approval never applies. Unresolved candidates block approval and re-check at commit (S07). Two sign-ups for the same existing client never create two profiles (S08).
- Review Match: read-only, minimum candidate data, audited access. Restore Access and Link Existing Record need all of: call to a contact already on the canonical record (never the contact from the sign-up), identity verified, permission recorded with scope, actor and time; checked again on the server (F08, F09, S02, S03). Link keeps the existing Client ID, does not overwrite contacts, merges nothing (F10). Restore goes through the existing recovery service, one operation id, no secret in logs.
- Not a Match (record reviewed candidates, actor, time, short reason; fresh check before a new client is created: F12), Keep Pending (note allowed, no change: F11), Approve and Decline after the guards (F13). Approve or decline replays return the existing outcome; stale version, a different decision on a finished request and key reuse with other data return a conflict (S04 to S06). No merge, close or replace anywhere in this flow (S13). Approval creates no subscription, invoice or charge (S16).
- Approved tab shows the canonical Client ID to those who may see it. Delivery failure after approval is shown apart from the approval and retried without a second client (S09).

### D3. Approval mode setting (P2)

- Manage settings opens a confirmation naming the firm, current mode, requested mode and scope; Cancel changes nothing; every change is audited with old and new value and a policy version; stale edits rejected (S11, S12). Permission `firm.signup_policy.manage`. A mode change never approves the existing queue.
- Defaults I chose for her OWNER DECISION PENDING items (change on Rasel's word only):
  - Pending applicant: signs in to nothing, sees a "waiting for the firm" message with Contact Firm (what the portal does today); no entitlement before approval.
  - Automatic eligibility: email and phone verified (or the existing optional-phone rule), no match of any kind, firm in Automatic mode; nothing else. Every automatic decision stores the policy version it used.
  - Decline: the applicant is emailed once with the firm's neutral text (as today); staff may untick "notify" in the decline dialog.
  - Mode change: prospective only.
  - Reversal, reopening, resubmission merge: not built; a declined person can sign up again and is matched like anyone.
  - Retention: keep request and verification metadata as audit rows; no evidence documents, recordings or passwords stored.

### D4. Contracts and permissions (P2)

- Capabilities (map to the existing role model, deny by default, server-side): `signups.read`, `signups.review`, `signups.decide`, `clients.match.read`, `clients.identity.verify`, `clients.access.restore`, `clients.identity.link`, `firm.signup_policy.manage`. Today only the controller's FIRM_MANAGERS roles pass: keep Owner and Admin as the holders; no new role editing in this round (Rasel's word first if a custom role is needed).
- Operations (names are hers, adapt): list with counts, detail, matches, verification, resolution, restore-access, decision, settings GET and PATCH. Every write takes an idempotency key and the expected version and returns request id, state, version, allowed actions, correlation id. Tenant ids from the host and membership only; a foreign firm id or request id is a 404 that leaks nothing (S01). Public sign-up and reset answers never reveal whether an account exists. Rate limits as existing.
- **Needs Rasel's tap (`packages/db`)**: approval-mode setting with version, match-review and verification records, resolution and operation tables, a request version column and a potential-match flag. Write one request in `docs/work/R55-*.md` (or the owner's R file) listing the exact tables and columns; do not touch the schema.
- Tests: her F01 to F14, S01 to S16 and B01 to B04 with synthetic data, Pass / Fail / Blocked with evidence in the PR; plus the usual tenant-isolation and audit tests.

## E. Clients (first screen review; screens `apps/web/src/app/firm/(workspace)/clients`)

Provisional passes to keep: six directory cards present, status and service routing, name, email and phone search, Reset All, assigned-staff filter, profile and Edit Details with save persisting after refresh, row routes (View Profile, Invoices, Signatures), Bulk Actions enablement and the three options, Add Client form with Individual / Business and a blank-save block, document request form, Messages context, invoice draft to Open, tags add and remove, narrow layout, Tab / Enter / Escape on the row menu.

### E1. Defects and gaps (P1/P2)

- **E1. Pending Docs card** does nothing: filter to clients with at least one outstanding document request (count reconciled to canonical requests). **Balance Due card** does nothing: filter to clients with an unpaid invoice balance (counts clients, not dollars; not only overdue; source Invoices and Payments).
- **E2. Last Activity range** (From Oct 22 to today) misses expected activity: check the activity timestamp, inclusive ends, date parsing and the firm time zone; retest with events inside, outside and on both boundaries.
- **E3. Stacy's services**: she is in Annual Tax only, but her advisory enrollment is not reflected; Business Development gives zero. Reconcile the client / service link and the Services & Pricing mapping; directory tags, service filter and profile must agree. Her tab labels (Bookkeeping Copy, Quarterly Copy, LVP Accounting Taxes...) are configured services: check the mapping, do not delete or rename anything.
- **E4. Profile workspace**: only Overview, Documents, Messages, Invoices, Signatures exist. Add Services, Intake Forms, Tasks, Notes and Activity (and a More overflow), with enrolled services (status, link to the service workspace) on Overview, separate from tags; Activity Log at the bottom of Overview (actor, action, time, permitted links). Tax Returns, Bookkeeping, Payroll, Tax Planning, Advisory tabs appear by enrollment, configuration and permission.
- **E5. Required fields**: Individual: type, name, email, phone, address (home); Business: also Business Name, business email, phone, address, and a **responsible party** (full name, email, phone) linked to the business, not replacing it. Format checks; test field by field.
- **E6. Unsaved edits**: Cancel after an edit asks Save Changes / Discard Changes / Keep Editing; each works.
- **E7. Return to Clients** (and Back from any client sub-page) restores filters, search, sort, page and scroll; only Reset or a new navigation clears them.
- **E8. Documents**: add Upload Document (client preselected, canonical Documents flow, permissions) and View Request Details for request rows; View and Download for uploaded files when permitted.
- **E9. Messages composer** shows the client, destination and channel before sending; no send until the channel rules are settled (default: the portal message thread, plus the client's email notice as the existing notifier does).
- **E10. Portal Access** gets Send Invitation Link: prefilled, recipient confirmed, status, permission-controlled resend and revoke, reusing the canonical Client Portal identity; no duplicate login or client.

### E2. Approved additions (P2/P3)

- Separate **Added Last 30 Days** filter (creation date); New stays the New/onboarding status.
- **More Filters**: deadline range, next appointment, primary client type (Individual / Business, separate from entity type), location (state, city, county), balance, missing documents, tags, source, priority, Apply and Clear, removable chips; keep the existing status, services and Records (Current / Archived / both). **Archived Clients** shortcut using the Records filter.
- **Export** visible to the owner and to anyone explicitly granted Export: scope and count preview, audit, minimal sensitive data, server-side check.
- **Bulk Actions** beyond Assign Staff / Archive / Restore: tag, service or status, message, document or intake request, export, inactive; each with permission, consent, preview, confirmation and audit. No Bulk Delete.
- **Linked Business and Personal profiles** under one client relationship: prefill known data, ask only the missing fields, no duplicate client or login.
- Billing additions for the Invoices review (cross reference only, do them when that module is touched): firm logo on invoices, permission-controlled Archive / Cancel / Edit-Correct that keep the sent original and its history, line-item description searchable from Services & Pricing while custom typing stays free, optional service start and end dates, "Save As New Service" only as an explicit authorized choice. Defaults hierarchy (settings, location, template): not decided: do not guess.
- Her pending tests (duplicate prevention, counts, populated fixtures, bulk mutations, export and security, loading and error states, full accessibility): run with controlled fixtures when the PR touches the area; report Pass, Fail or Blocked.

## F. Routing addendum (Rasel, Oct 25)

- **Client Sign-ups (D):** R55 (it already owns Users, Roles and Staff API); starts after its Dashboard items. The schema request in D4 goes in its R file for Rasel's tap first.
- **Clients (E):** R60 takes E1 to E7 after its Dashboard block; E8 to E10 and the E2 additions in a second PR; the Export, Bulk Actions and linked-profile work may need a fresh session.
- Her next module after Clients and Sign-ups is Invoices & Payments (the billing additions above).
