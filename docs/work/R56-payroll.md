# R56: Payroll module

The Payroll screens on the R39 contract (`api.payroll`, `createPayrollClient`, merged in #716) with a mock written here. Designs: `docs/mockups/firm-workspace/payroll/source/` (`payroll.jpg`, `payroll-with-dropdown.jpg`, `client-payroll-workspace.jpg`, `payroll-run-review-and-approval.jpg`) and the developer guide docx. Branch `rasel/R56-payroll` from `origin/main`, web port 3560. Conventions: `docs/work/R56-tasks.md` (handoff section).

Queue (Scrum thread, 2026-10-18): Payroll, Bookkeeping (contract in #718; start Templates if it has not merged), Templates, Automations, Communications. Integrations, Reports, Tax Planning and Business Advisory go to a new developer.

## Owned paths

`apps/web/src/app/firm/(workspace)/payroll/**` (new routes), `apps/web/src/mocks/payroll*.ts` (new mock, two files), the `payroll` entry in `apps/web/src/lib/api.ts` (mock switch), the sidebar link in `(workspace)/layout.tsx` and `lib/firm-modules.ts` (Payroll leaves the "module not built" list), `apps/web/e2e/mock/r56-payroll.spec.ts`, `r56-screenshots/p-*`.

## Routes

| Route                | What                                                                                                                                                                                                                                         |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/payroll`           | Overview: five cards with a period selector, Status, Volume, By Provider and Connected Providers, seven views, filters, the client table with the Actions menu and bulk bar, Upcoming Payroll Runs, Payroll Settings, Add Payroll Client |
| `/payroll/clients/[id]` (`?tab=runs`, `reports`, `filings`…) | One payroll client in ten tabs: Overview, Employees, Payroll Runs, Tax Filings, Reports (with Year-End), Documents, Tasks, Notes, Communications, Settings                                                        |
| `/payroll/runs/[id]` | Run Payroll: five steps shown on one page: period details, employees and hours, summary, exceptions, notes, next steps (save draft, mark ready, approve, submit to provider, complete, reopen)                                           |

## Run it

| State           | Command                                                                                                                                                                  |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| With data       | `NEXT_PUBLIC_API_MOCK=payroll,clients,documents,taskWork,team,staff,me,notifications NEXT_PUBLIC_API_MOCK_ROLE=OWNER WEB_PORT=3560 pnpm --filter @firmivra/web dev` |
| Empty           | the same plus `NEXT_PUBLIC_API_MOCK_EMPTY=payroll`                                                                                                                       |
| API unreachable | `NEXT_PUBLIC_API_MOCK=me,notifications,team,staff`                                                                                                                       |

## Steps

- [x] 1. Mock `payroll` (every call of the contract)
- [x] 2. Overview, Actions menu, dialogs
- [x] 3. Client workspace and its tabs
- [x] 4. Run Payroll
- [x] 5. Mock spec (10 tests), three states, 375 px, PR

## Needs from others

- **Provider actions** (Open Payroll Provider, Pull / Refresh Report, Download Report, Import Hours, Manage Time Off, Approve & Submit in one step): the contract has no deep link, report pull, time import or provider write-back, so these are not built (the docx says to hide what the provider cannot do). Approval and submission are two steps; Submit to Provider records the provider's confirmation text.
- **Business Name column and masked EIN** are not in the contract; the table shows the client name, the header shows industry, employees, frequency and client since.
- **Connect Payroll Provider** picks the client and the provider and saves it; real OAuth sign-in belongs to Integrations.
- **Request Payroll Documents, Create Task, Send Message and Schedule Appointment** open the shared module (`/modules/document-requests`, `/tasks/new`, `/messages`, `/calendar/new`) without client context; those pages do not take a client yet.
- **Helpful Resources**: no source for the firm's payroll guides; the card shows its frame with a quiet text.
- **Payroll Volume** shows the months that have confirmed runs (the mock has about six months); the design shows twelve.
- **Mock ids**: the payroll mock's clients have their own ids; Documents and Tasks for them are empty or unavailable in mock mode (quiet text). Team members come from the team mock.

## Progress log

- 2026-10-18: Payroll built on the #716 contract with a new mock; 10-test spec passes; screenshots committed.
