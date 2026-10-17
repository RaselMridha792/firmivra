# R56: Tasks module

The Tasks screens on the R55 contract (`api.taskWork`, PR #709; API in #712) with a mock written here. Designs: `docs/mockups/firm-workspace/task/source/` (`task.jpg` overview, `create-edit-task.jpg`, `recurring-task-workflow-setup.jpg`) and the developer guide docx. Branch `rasel/R56-tasks`, web port 3560. This branch contains the contract commits of #709 until that PR merges.

## Owned paths

`apps/web/src/app/firm/(workspace)/tasks/**` (new routes), `apps/web/src/mocks/tasks-work.ts` (new mock), the `taskWork` line in `apps/web/src/lib/api.ts` (mock switch), the sidebar link in `(workspace)/layout.tsx` and `lib/firm-modules.ts` (Tasks leaves the "module not built" list), `apps/web/e2e/mock/r56-tasks.spec.ts`, `r56-screenshots/t-*`.

## Routes

| Route                                    | What                                                                                                                                                                                                                    |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/tasks`                                 | Overview: five cards, seven views (My, All, By Client, By Project, Recurring, Templates, Completed), filters, table with row menu and bulk bar, My Task Summary, Upcoming Deadlines, Templates, Quick Actions, Calendar |
| `/tasks/new`, `/tasks/new?template=<id>` | Create Task (six sections and the right column)                                                                                                                                                                         |
| `/tasks/[id]`                            | One task: actions, checklist (tick items), reminders, dependency, attachments, notes                                                                                                                                    |
| `/tasks/[id]/edit`                       | Edit Task, the same form                                                                                                                                                                                                |
| `/tasks/recurring/new`                   | Set Up Recurring Task with the live "Next 5 Occurrences"                                                                                                                                                                |
| `/tasks/recurring/[id]`                  | One series: settings, next dates, occurrences, pause, resume, stop, skip                                                                                                                                                |

## Run it

| State           | Command                                                                                                                                                                                                           |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| With data       | `NEXT_PUBLIC_API_MOCK=taskWork,clients,engagements,team,staff,me,notifications NEXT_PUBLIC_API_MOCK_ROLE=OWNER WEB_PORT=3560 pnpm --filter @firmivra/web dev` (add `servicesPricing` to fill the Service pickers) |
| Empty           | the same plus `NEXT_PUBLIC_API_MOCK_EMPTY=taskWork`                                                                                                                                                               |
| API unreachable | `NEXT_PUBLIC_API_MOCK=me,notifications,team,staff`                                                                                                                                                                |

## Steps

- [x] 1. Mock `taskWork` (every call of the contract)
- [x] 2. Overview with its widgets
- [x] 3. Create and Edit Task
- [x] 4. Task detail
- [x] 5. Recurring setup and series detail
- [x] 6. Mock spec (9 tests), three states, 375 px, PR

## Needs from others

- **Attachments**: the contract attaches a client's existing document by id (no upload). The form shows the design's drop zone as a quiet frame (Browse Files is not active) and lists attachments of a saved task; picking a client document needs the Documents list for one client.
- **Description formatting**: the design's bold, italic, list and link toolbar is not built; `details` is plain text up to 2000 characters.
- **Task type and client pickers** use `api.clients.list` (first 100) and `api.engagements.listForClient`; a search box instead of a plain list needs a search call that returns more than 100.
- **Task Calendar** shows due dates as marks on the month; clicking a day filters the table to that day. The design's week list and the "View Calendar" page are not built (it opens All Tasks).
- **Row menu "Convert to Recurring"** opens the task, where the dialog asks for the interval; the design has no frame for it.
- **Edit this occurrence only / Edit the series** (`updateSeries` with scope): the series page does not edit settings yet; a series is changed by pausing, stopping or skipping.
- **Automations** button opens the module page `/modules/automations` (not built).
- **Task Templates** has no create or edit page: a template is made by "Save as Template" on a task or the recurring form.
- **Reminders** are in-app only in the form (channels EMAIL and SMS need the firm's settings and the person's consent, not shown yet).
- **Mock team ids**: `api.team` mock members have their own ids (`0199b6a0-...`), the signed-in Mock User in `api.tasks` mocks is `0000...0101`; the form adds the task's current assignee as an option so an edit keeps it.

## Handoff for a fresh R56 window

Read `CLAUDE.md`, `docs/work/README.md` and this file only. Done and open: #686 closed (Appointments, Tumit's go live), #687 and #703 and #710 (Services & Pricing) merged or in review, this PR (Tasks). Next, one PR per module, each matching `docs/mockups/firm-workspace/<module>/source/` exactly: Compliance, Payroll, Bookkeeping, Templates, Automations, Communications, Tax Planning, Integrations, Reports. Method that works: read the docx and the image crops, write a mock first (`src/mocks/<module>-*.ts`, register the module in `src/lib/api.ts`), build `page.tsx` as a small server file with the screen in `_components/`, keep every widget's frame with a quiet text, then a mock spec, then three states at 1440 and 375, element lists and sampled colours in the PR. Traps seen: `sr-only` spans inside a table's scroll box need a `relative` ancestor or the page scrolls sideways; a mutation's per-call `onSuccess` is dropped if the form remounts when the query refetches (key forms by id, not version); `pnpm --filter @firmivra/types build` after merging a contract branch; Git Bash needs `MSYS_NO_PATHCONV=1` for paths that start with `/`.

## Progress log

- 2026-10-17: Tasks built on the #709 contract with a new mock; 9-test spec passes; screenshots committed.
