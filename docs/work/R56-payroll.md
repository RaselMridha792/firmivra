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
- 2026-10-26: SH2 (Octavia's Oct 25 review, PY-F07, F08; TX-F02 for R60): the shared `ActionMenu` (`packages/ui`) draws its list in a portal (the trigger's dialog when inside one), fixed and clamped to the window (`placeMenu`: below or above, scrolls inside), one arrow on the trigger, arrow keys, Home, End, Escape (focus back) and Tab away; Payroll's Client Actions and More Actions lost their second arrow. On `rasel/R56-shared-row-menu` (from main; PR when a slot frees). Tests: ui 4, mock 4 new (`r56-row-menu`), payroll and bookkeeping specs 24 of 24.
- 2026-10-26: SH1 (PY-F10, the Bookkeeping navigation contract; TX-F03 for R60): exact-origin Back. Links and menu actions out of Payroll and Bookkeeping carry `?from=` (the exact path and query; `OriginLink`, `useOriginNavigate` in `components/origin-link.tsx`); one `OriginBar` in the workspace layout shows Back to {place} on any page opened that way, restores the scroll position, and asks first when a form registered unsaved work (`useUnsavedChanges`, `lib/unsaved.ts`); only a path on this site is followed (`safeOrigin`). The two overviews keep their period, view, filters, search, sort and page in the address (`lib/list-query.ts`, read by the server pages). On `rasel/R56-shared-back` (stacked on the SH2 branch). Tests: unit 7, mock 4 new (`r56-origin-back`), payroll and bookkeeping specs green.
- 2026-10-26: SH3 (PY-F02, F03; the Bookkeeping request and documents contract; TX-F08 to F10 for R60): Request Documents and Upload Document open in place (`components/service-documents.tsx`: `ServiceDocumentsProvider`, `useServiceDocuments`), prefilled with the client, the service's engagement and its period (Bookkeeping's current period; instructions start "For {period}."), showing client, service, recipient and channel before sending, keeping the input on failure and staying on the tab; the row menus open it for their row; Bookkeeping's main page asks which client first; Payroll's main Request Documents still opens All Requests (S08). Mock mode: `mocks/service-engagements.ts` lets the documents mock file for the Payroll and Bookkeeping mock clients. On `rasel/R56-shared-documents` (stacked on SH1). Tests: mock 4 new (`r56-service-documents`), 32 of 32 with SH1, SH2 and the module specs; documents specs 9 of 9.
- 2026-10-26: SH4 (PY-F04, the Bookkeeping Tasks contract; TX-F13 to F15 for R60): Create Task opens Tasks prefilled (`/tasks/new?clientId=&engagementId=&period=`, `newTaskHref`; the details start "For {period}."), with Back to the workspace (asking first when the form has unsaved work), and the saved task's page keeps that Back; the workspaces' task lists are the Tasks module's own `TaskTable` in a compact form (`ServiceTasks`): an inline status (the stages, Completed, Reopen) and the canonical action menu with her labels (Mark as In Progress, Mark Complete, Archive Task) and its dialogs in place; `TaskTable` now uses the shared `ActionMenu`. Mock mode: the clients and engagements mocks answer for the Payroll and Bookkeeping mock clients (`service-engagements.ts`). On `rasel/R56-shared-tasks` (stacked on SH3). Tests: mock 2 new (`r56-service-tasks`); the Tasks, Payroll, Bookkeeping and SH1 to SH3 specs 64 of 64.
- 2026-10-26: SH5 (PY-F05, the Bookkeeping Communications contract; TX-F05 for R60): Send Message and the Communications tabs open Messages at `?clientId=&service=`: that client's conversations (a scoped empty state when there are none) with New Message for them and the service as the subject; Messages has a client filter to use by hand; `NewMessageDialog` is exported (client, name and subject props) for an in-place composer. Bookkeeping's Communications tab opened Communications (marketing) before. Nothing is sent to test the way there. On `rasel/R56-shared-messages` (stacked on SH4). Tests: mock 2 new (`r56-service-messages`); the Messages, Payroll and Bookkeeping specs green.
- 2026-10-26: SH6 (PY-F11; TX-F06 for R60): Schedule Appointment opens the shared form at `/calendar/new?clientId=&engagementId=` on that client (contact, email, phone, type) and the engagement's service with its first appointment type, Back to the workspace, Cancel back to it without creating anything (`cancelHref` from `from`), and the Back asks first once the form was changed. On `rasel/R56-shared-appointment` (stacked on SH5). Tests: mock 2 new (`r56-service-appointment`); the appointment form specs and Payroll and Bookkeeping 34 of 35 under load, the one timing failure passes alone.
- 2026-10-26: SH7 (PY-F01; BK-I01): one rule for connection versus sync (`lib/connection-state.ts`, `describeConnection`): Connected only when authorized and data came at least once; a saved provider or company id alone is Pending setup; a provider chosen but not connected for the firm is Not authorized; errors say what to do from a safe code; the sync is shown apart (Never synced, Synced {time}, Last attempt failed {time} with the last good data kept). Payroll's provider card, Sync Details and Connect message ("Provider saved for this client. It shows as connected after its first successful sync.") and Bookkeeping's software card and connections list use it. No API change: the times are the API's real sync times. On `rasel/R56-shared-connection` (stacked on SH6). Tests: unit 3, mock 3 new (`r56-connection-state`), Payroll and Bookkeeping 20 of 20. I02 and I03 (retry, stale, reconnect, totals) are tests that need a real provider: Blocked until one is authorized.
