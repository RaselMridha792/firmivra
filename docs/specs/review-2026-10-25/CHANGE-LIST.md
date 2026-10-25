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
