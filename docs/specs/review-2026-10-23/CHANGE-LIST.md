# Octavia's review of Oct 21 to 22, 2026: Tasks and Staff Management (change list)

Source: Octavia's two Drive folders of Oct 23: **Tasks** (guide plus one screenshot) and **Staff management** (updated guide). Her guides are in this folder as markdown, converted from her .docx:

- `tasks--developer-feedback.md` (Tasks, "First review revised", Oct 21)
- `staff-management--developer-feedback-updated.md` (Staff Management, walkthrough through Oct 22)
- Screenshot: `docs/mockups/firm-workspace/review-2026-10-23/tasks/01.png` (the Tasks page as the Admin test login sees it).

Both modules are already built on main (`apps/api/src/tasks`, `apps/api/src/staff`, `apps/web/src/app/firm/(workspace)/tasks`, `.../team`). This is a fix and addition round, not a new build. More Drives (other areas) may follow; extend this file per area.

How to read it (same rules as `docs/specs/review-2026-10-21/CHANGE-LIST.md`):

- **P1**: a defect she hit (error, wrong route, data not saving). Do first.
- **P2**: a changed rule or missing control. **P3**: a new or bigger flow.
- "Check" means the session that takes the item first looks at main and dev: her guides were written against an older dev build and some items may already be fixed.
- Items she calls **Working** are provisional: do not break them, do not rework them. **Pending** items are tests for the session (Pass, Fail or Blocked with evidence in the PR), not defects.
- Design completeness rule applies: complete screens, empty states, no fake numbers. No placeholder or debug text.
- Anything that changes `packages/db` needs Rasel's own tap; anything that changes auth guards or role checks needs his word as well. Say so in the PR and in the reply instead of doing it.

## A. Tasks (guide: `tasks--developer-feedback.md`)

Her own IDs (C1 to C11, A1 to A5, T1 to T29) are kept. Task publishing is the blocker: a task cannot be saved yet.

| # | Change | Prio |
|---|---|---|
| C1 | **Task Type selector opens empty** and saving says "Choose task type". Connect it to the company's task types (`task-types.controller.ts` exists), add a discoverable, permission-controlled setup path, explain an empty configuration. Inactive types follow documented availability. | P1 |
| C2 | **Template must be optional**: a standalone task saves without one. Keep required-field errors inline and keep entries on failure. | P1 |
| C3 | **Add Create Task Template** in the library, keep Save as Template, add a clear **Edit** for the source template (Use is not editing). | P1 |
| C6 | **Upload opens no file chooser.** Restore the picker and drag and drop; validate types and sizes; private storage; actionable errors. | P1 |
| C9 | **Automations button returns "Page not found."** Route to the canonical Automations area with Tasks context. | P1 |
| C4 | Client selector: add name search, company-scoped, no discovery of restricted clients. | P2 |
| C5 | Related To repeats Service; it must pick the permitted related record or engagement, narrowed by client and record type. Service stays a separate optional selector (Services & Pricing). | P2 |
| C7 | Add **All Day** beside due date and time on the main task form, with documented timezone and overdue rules. | P2 |
| C8 | Apply Same Checklist stays disabled in recurrence; each generated occurrence gets its own checklist snapshot. | P2 |
| C10 | Unsaved changes: Save, Discard, Keep Editing for tasks, drafts, templates and Back. | P2 |
| C11 | Duplicate checklist item; keep inline edit and Move Up and Down. | P2 |
| A1 | Related To: searchable real records first; no match allows company text with an explicit Save beside it, labelled custom, never a fake record link. | P3 |
| A2 | Separate **Save Task, Save as Template, Save as Draft**; a tab exactly **Drafts** beside Completed Tasks with search, filters, reopen and edit. Needs a draft state (likely a schema change: Rasel's tap). | P3 |
| A3 | Reminders: keep the options, add **Custom** (number plus minutes, hours or days before due), multiple rules, validation. | P3 |
| A4 | Only company admins or the account owner manage task automations, enforced in the API and the UI. | P3 |
| A5 | Recurring form: Save & Create Another, saved once, no duplicate series on retry. | P3 |

Already working (do not break): Overview navigation, calendar date and bulk entry navigation, filters present, assignee options, checklist add and reorder, reminders add and remove, Save as Template, Use, Duplicate, Archive, Archived view and Restore. The earlier request for an Archived view and Restore is withdrawn.

**T1 to T29** are her test plan. They need an isolated test company with dummy data. The session that owns the module runs them against the real API and records the result per test in its R file. Priorities for the first PRs: T1, T2 (save and drafts), T29 (drafts workflow), T4 to T6 (KPIs, search, calendar), T13 and T14 (isolation and permissions), T15 (automation roles).

## B. Staff Management (guide: `staff-management--developer-feedback-updated.md`)

The document's "Retest plan" lists the order. Do not restart at Add Team.

| # | Change | Prio |
|---|---|---|
| SM1 | **Bulk upload stops at Validate & Preview** ("Something went wrong", also after choosing Do Not Import). Show row and field errors. | P1 |
| SM2 | **Creating a custom role as Admin does not save or appear.** Root cause unknown. | P1 |
| SM3 | **Wrong routes:** Staff Settings > Offices & Job Titles opens Add Staff (needs the list editor, synced with Location Management); New Accounts & Security opens Step 3 of Create Staff (needs a company-wide staff security policy page); the Reports shortcut opens general Reports (add the Staff and Team option inside canonical Reports and select it). | P1 |
| SM4 | **Active Sessions is empty** for the signed-in account and **Staff Login History** misses the recent login. | P1 |
| SM5 | **Drafts:** "Draft saved (pay is not kept)" but the draft cannot be found or reopened; the selected file disappears after Back. No silent loss of HR data. | P1 |
| SM6 | Permission matrix: add a separate **Export** permission for applicable modules, enforced server-side. | P2 |
| SM7 | Bulk upload: Employee ID optional, XLSX as well as CSV, clear required-column and date-format guidance; limits stay (1 MB, 500 rows). | P2 |
| SM8 | Work Schedule: company-defined custom saved schedules; Maximum Workload: say whether clients or tasks and how it limits assignment. | P2 |
| SM9 | Summary cards (Total, Active, Inactive, Departments) open the matching list or Teams & Departments; **Staff Directory** and **Manage Staff Accounts** both open one dedicated directory view with search, filters and actions. | P3 |
| SM10 | Show the **current date and time, top right, on every page**, with the timezone. Platform-wide (shared header). | P3 |
| SM11 | Job titles: searchable saved titles plus custom entry; authorized users add, edit and save reusable company titles. Custom Role shortcut next to the role selector with Back to the same in-progress form. Separate **Work Start Date**. | P3 |
| SM12 | **Drafts view and Draft status** in the directory; reopen with values kept, no invitation or account; per-file **Save** under Remove that stores the private draft attachment and type. | P3 |
| SM13 | Departments: **Manage Members** on each department menu, adding and removing staff without a team; counts and directory filter consistent. | P3 |
| SM14 | **Account authority rules** (Original Owner, Delegated Owner, own password reset, Reset MFA, Resend Invitation, Sign Out All Other Sessions, Lock Account, Deactivate hierarchy) in the guide's section "Approved account authority rules". API and UI. Touches role and guard checks: Rasel's word first. Two policy points are still open in her text (Admin locking scope, direct reports versus whole chain for resending invitations): do not guess, list them as questions. | P3 |

Reported as working (keep): Create Staff form and its four steps, search and Active and Invited filters, Activity & Login History, teams and departments create, edit, move, lead, members, deactivate and reactivate, template download and Map Columns, service areas, security toggles.

## Routing (proposed Oct 23)

| Area | Takes |
|---|---|
| Tasks, API and screens | One session owns it end to end (`docs/work/R55-tasks-api.md`, `docs/work/R56-tasks.md` carry the history). A fresh session is best: R55 and R56 are busy with Leads and Services & Pricing. |
| Staff Management, API and screens | One session owns it (`docs/work/R55-staff.md`, `R55-staff-org.md`, `R60-team.md` carry the history). |
| Schema (draft state, anything in `packages/db`) | R1 writes the migration only after Rasel's own tap, one PR per change. |
| Shared header date and time (SM10) | The session that owns the shared firm layout; one small PR, design-match ticked. |
