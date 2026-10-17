# R56: firm workspace screens (Appointments, then Lead profile tabs)

Workstream R56 builds firm-workspace screens from Octavia's designs on the typed mocks (no API, no database). Two parts, one PR each. Branch `rasel/R56-frontend-screens`, web port 3560.

## Read first

`CLAUDE.md`, `apps/web/AGENTS.md`, `docs/design-match.md`, `docs/ui-kit.md`, `docs/junior/GUIDE.md` ("Mock first").

## Owned paths

- Part 1: `apps/web/src/app/firm/(workspace)/calendar/**` (not `calendar/page.tsx`), `apps/web/e2e/mock/r56-appointments.spec.ts`, `apps/web/e2e/mock/r56-screenshots/`.
- Part 2: `apps/web/src/app/firm/(workspace)/leads/[id]/**` (not `leads/page.tsx`, not `leads/[id]/convert/`), `apps/web/src/mocks/leads-*.ts` additions only.
- New mock data goes in new files `apps/web/src/mocks/<module>-*.ts` (synthetic data only).

## Run it

| State | Command (web port 3560) |
| --- | --- |
| Appointments, with data | `NEXT_PUBLIC_API_MOCK=scheduling,appointments,team,staff,me,notifications NEXT_PUBLIC_API_MOCK_ROLE=OWNER WEB_PORT=3560 pnpm --filter @firmivra/web dev` |
| Appointments, empty | the same plus `NEXT_PUBLIC_API_MOCK_EMPTY=scheduling` |
| Appointments, API unreachable | `NEXT_PUBLIC_API_MOCK=me,notifications,team,staff` (the shell's own account call needs `me`; with literally no mock the layout shows its account error before any page renders) |
| Lead tabs, with data | `NEXT_PUBLIC_API_MOCK=leadPipeline,leads,me,notifications NEXT_PUBLIC_API_MOCK_ROLE=OWNER` |
| Lead tabs, empty | the same plus `NEXT_PUBLIC_API_MOCK_EMPTY=leadPipeline` |
| Lead tabs, API unreachable | `NEXT_PUBLIC_API_MOCK=me,notifications` |

Add `availability` to the Appointments list to show the weekly hours and blocked time of Edit My Availability (R12's `api.availability` mock; its people are not the scheduling mock's people, so weekly hours show their quiet "no hours on record" text for them).

## Steps

### Part 1: Appointments (`calendar/`)

- [x] 1. `/calendar/list`: overview frame (title, five cards that filter, Calendar / List / Today, search and filters), appointments table, mini calendar, day schedule, Quick Actions, Pro Tip
- [x] 2. `/calendar/today`: the same frame for one day, day navigation
- [x] 3. `/calendar/new`: Schedule Appointment form (every section of the design), Staff Availability panel with conflicts, Appointment Summary
- [x] 4. `/calendar/[id]`: detail with actions, notes, reminders, notices and history
- [x] 5. `/calendar/[id]/edit`: the same form in Edit Existing mode
- [x] 6. `/calendar/types`: Manage Appointment Types and the notice settings
- [x] 7. `/calendar/availability`: Staff Availability and Edit My Availability
- [x] 8. Mock e2e spec `r56-appointments.spec.ts`, three states and 375 px checked, PR opened

### Part 2: Lead profile tabs (`leads/[id]/`)

- [x] 1. `/leads/[id]/communications`
- [x] 2. `/leads/[id]/appointments`
- [x] 3. `/leads/[id]/tasks`
- [x] 4. `/leads/[id]/documents`
- [x] 5. `/leads/[id]/campaigns`
- [x] 6. `/leads/[id]/notes`
- [x] 7. `/leads/[id]/activity`
- [x] 8. Mock e2e spec, three states and 375 px checked, PR opened (branch from `main` after part 1 is open; merge `origin/main` into it later)

## Needs from others

- Related Items (Link to Tax Return, Task, Bookkeeping Client, Invoice, Intake Form, Documents): the contract takes record ids, and no list of those records is on the scheduling contract. The checkboxes show what an appointment is already linked to and cannot link new records until a picker has a source (Tax Returns, Tasks, Invoices, Intake Forms lists for one client).
- Appointment type name, default duration and Active / Inactive are edited through `api.appointmentTypes` (R12), which the three-state command does not mock; Manage Appointment Types shows them read-only and edits the rest through `api.scheduling.setTypeConfig`.
- Required intake form on a type (`requiredIntakeFormId`) needs an intake form list to pick from.
- The Calendar view (`/calendar`) still shows R12's older screen; its overview, KPI row and week grid are another developer's page. The Calendar / List / Today switch links to it.

### Part 2 (lead profile tabs), PR #687

- Open Tasks checkboxes are read-only: `api.leadPipeline` returns tasks but has no call to complete one or to add one (Add Task opens the Tasks module page).
- Campaigns: `options().campaigns` is empty in the mock and campaigns come from Communications (to build); Add to Campaign stays disabled until they exist.
- Documents & Forms: the contract lists file names and scan status only, so there is no open or download action.
- Lead Score is optional in `LeadProfile` and absent in the mock; nothing is drawn for it.
- Call has no calling integration: it opens the phone link and logs a call.
- The Overview page (Contact Information, Lead Details, KPI tiles, Quick Actions) is not in this part.

## Progress log

- 2026-10-17: Part 1 built: shared overview frame (`ap-*` files), List, Today, New, Detail, Edit, Types and Availability pages; mock e2e spec (9 tests) passes; screenshots committed under `apps/web/e2e/mock/r56-screenshots/`.
- 2026-10-17: Part 2 built (PR #687): profile header and tab bar, seven tabs, mock e2e spec (9 tests) passes, screenshots committed. CI shards failed on Docker Hub rate limit and Postgres container setup, not on tests; main merged and re-pushed.
