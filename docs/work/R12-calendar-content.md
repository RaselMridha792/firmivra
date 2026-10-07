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

(none yet)

## Progress log

(newest last: date, step, what changed, commit)

- 2026-10-07, step 1 part 2 (contract, prepared on `rasel/R12-contract-workspaces` from fresh main; opens after part 1, #68, merges): tasks, workspaces with reports, and the audit log viewer.
  - `packages/types/src/tasks`: list (by client, engagement, assignee, status; paged), create, update (status, due date, assignee; `null` clears). Staff see their clients' tasks and tasks assigned to them. R10 creates the NAME_CHANGE task.
  - `packages/types/src/workspaces`: the list of Bookkeeping and Tax Planning engagements (open tasks, next due date), the detail (stages, open tasks, reports), reports (create as draft, edit, publish, unpublish, delete only if never published; kinds per workspace in `REPORT_KINDS`; figures as label and amount lines), and the client's published reports in My Services. Status and stage go through R10's `api.engagements`; notes come from R11, documents from R5.
  - `packages/types/src/audit-log`: the firm Owner's log with filters (dates, action or prefix, person, record) and paging; the Super Admin version answers 403 `SUPPORT_GRANT_REQUIRED` until R8.
  - Mocks `apps/web/src/mocks/{tasks,workspaces,audit-log}.ts` (the workspaces reuse R10's Bookkeeping engagement fixture); `api.tasks`, `api.workspaces`, `api.myReports(slug)`, `api.auditLog`.
