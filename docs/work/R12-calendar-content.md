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
