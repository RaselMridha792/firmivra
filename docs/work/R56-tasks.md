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

## Handoff for a fresh R56 window (Sonnet 5.5, medium)

Start with: `You are workstream R56. Read CLAUDE.md, docs/work/README.md and docs/work/R56-tasks.md only. Continue with the next module in "Remaining modules".` One PR per module, from `git checkout -b rasel/R56-<module> origin/main`; merge `origin/main` before each push (never rebase, never force-push); do not merge; at most 2 open PRs.

**Done (Rasel's firm screens, R56):** #686 Appointments (closed: Tumit's go live), #687 Lead profile tabs (merged), #703 Intake Form submission detail (merged), #710 Services & Pricing categories, packages, package details, package edit, promotions (open, green), #715 Tasks (open, green; branch contains the #709 contract commits until that merges).

**Remaining modules, in this order.** Designs are in `docs/mockups/firm-workspace/<folder>/source/` (images plus the developer-guide docx). Contracts: the R12/R38/R39 ones are in `packages/types/src/` and their briefs in `docs/work/briefs/` (`r38-work-modules-api.md`, `r39-comms-payroll-advisory-api.md`); check `gh pr list` for newer contract PRs (the Tasks one was #709 and had no mock).

| #   | Module                  | Folder           | Images in `source/`                                                                                                                                                       |
| --- | ----------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Compliance & Deadlines  | `compliance`     | `compliance-and-deadlines.jpg`, `add-edit-deadline.jpg`, `recurring-deadline-and-government-calendar-setup.jpg`                                                           |
| 2   | Payroll                 | `payroll`        | `payroll.jpg`, `payroll-with-dropdown.jpg`, `client-payroll-workspace.jpg`, `payroll-run-review-and-approval.jpg`                                                         |
| 3   | Bookkeeping             | `bookkeeping`    | `bookkeeping.jpg`, `bookkeeping-actions-dropdown.jpg`, `client-bookkeeping-workspace.jpg`, `bookkeeping-close-reconciliation-and-report-review.jpg`                       |
| 4   | Templates               | `templates`      | `templates-page.jpg`, `template-category-library.jpg`, `create-edit-template.jpg`                                                                                         |
| 5   | Automations             | `automations`    | `automations.jpg`, `create-automation-rule.jpg`, `automation-logs-and-rule-activity.jpg`                                                                                  |
| 6   | Communications          | `communications` | `communications.jpg`, `new-comunication-menu.jpg`, `create-new-communication-composer.jpg`, `choose-recipients-and-segments.jpg`, `communication-details-and-results.jpg` |
| 7   | Tax Planning & Strategy | `tax-planning`   | `tax-planning.jpg`, `create-edit-planning-plan.jpg`, `planning-opportunity-strategy-review.jpg`                                                                           |
| 8   | Integrations            | `integrations`   | `intigrations.jpg`, `add-integration-marketplace.jpg`, `connect-configure-integration-u2013-microsoft-365.jpg`, `manage-integration-u2013-quickbooks-online.jpg`          |
| 9   | Reports                 | `reports`        | `reports-page.jpg`, `report-detail-view-report.jpg`, `custom-report-builder-1.jpg`                                                                                        |

None of these has routes yet (the sidebar items open `/modules/<slug>`, from `src/lib/firm-modules.ts`). When a module is built, add its routes under `apps/web/src/app/firm/(workspace)/<module>/`, point its sidebar item in `(workspace)/layout.tsx` to the real page (`link('Name', Icon, '/path')` instead of `mod('slug')`) and remove its entry from `FIRM_MODULES`; update links that still use `/modules/<slug>` (grep for it). Bookkeeping and Tax Planning data come from `api.workspaces` (R12 mock `mocks/workspaces.ts`).

**Conventions that worked:**

- Read the docx text (unzip, strip tags) and crop the images at 2x (PIL script) before coding; list every element per part for the PR (docs/design-match.md rule 1); sample colours from flat areas of the image against `packages/ui/src/styles.css` tokens (rule 4).
- Mock first: `apps/web/src/mocks/<module>-*.ts` built inside a function on first use (lint refuses work at import), same schemas and error codes as the contract, dated around today, `empty` option; register in `src/lib/api.ts` as `dev && mocked('<name>') ? createXMock({ role: MOCK_ROLE, empty: mockedEmpty('<name>') }) : createXClient(request)`. After merging a contract branch run `pnpm --filter @firmivra/types build`.
- `page.tsx` is a small server file with its metadata title (keep an existing title if a placeholder has one); screens live in `_components/`; every widget reads its own `useApiQuery` and keeps its frame with a quiet text (no page-wide error panel); API error codes go through `errorMessage(error, { CODE: 'words' })`.
- Kit first (`docs/ui-kit.md`: Table with `server`, BulkBar, KpiCard, Tabs, Timeline, CalendarGrid, DonutChart, Modal, Callout); tokens only; solid Phosphor icons; list inexact icons and every difference in the PR.
- Tests: one mock spec `apps/web/e2e/mock/r56-<module>.spec.ts` (copy `r56-tasks.spec.ts`) run on a reused server: `sed 's/reuseExistingServer: false/reuseExistingServer: true/' playwright.mock.config.ts > playwright.r56.config.ts`, start the dev server on port 3560 with `NEXT_PUBLIC_API_MOCK=all`, then `WEB_PORT=3559 npx playwright test -c playwright.r56.config.ts r56-<module>` (delete the temp config after). Lint and typecheck for the web app only: `pnpm --filter @firmivra/web typecheck` and `lint`.
- States and screenshots: three states (with data, `NEXT_PUBLIC_API_MOCK_EMPTY=<name>`, and `NEXT_PUBLIC_API_MOCK=me,notifications,team,staff` for unreachable, because with no mock at all the layout shows its own account error) at 1440 and 375 px, no sideways scroll; commit PNGs under `apps/web/e2e/mock/r56-screenshots/` (quantize to 128 colours to keep them small) plus a design-left, result-right comparison image; link them with `?raw=true` URLs of the branch.
- PR body: "Before:", "After:", "How", checks, screenshots, element lists, sampled colours, differences, the design-match checklist. No Co-Authored-By and no "Generated with Claude Code" line (Rasel's rule).
- Notes per module in `docs/work/R56-<module>.md` with "Needs from others" (what the contract cannot do: keep a quiet disabled or empty state and list it).

**Traps seen:** `sr-only` spans inside a table's scroll box need a `relative` ancestor or the page scrolls sideways; a mutation's per-call `onSuccess` is dropped if the form remounts when the query refetches (key forms by id, not by version); a `<button>` inside a `<button>` (Toggle in a button) breaks hydration and leaves the page dead; a controlled checkbox needs `.click()` then `toBeChecked()` in Playwright (not `.check()`); Git Bash needs `MSYS_NO_PATHCONV=1` for paths that start with `/`; heredocs with quotes can fail silently, use the Write tool for files; CRLF makes `git status` show a phantom change: `git restore` the file before switching branches; mock team ids differ from `mockMe` (add the task's current assignee as an option).

## Progress log

- 2026-10-17: Tasks built on the #709 contract with a new mock; 9-test spec passes; screenshots committed.
