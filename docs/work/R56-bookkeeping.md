# R56: Bookkeeping module

The Bookkeeping screens on the R38 contract (`api.bookkeeping`, `createBookkeepingClient`, in the #718 branch `rasel/cloud-bookkeeping-api`) with a mock written here. Designs: `docs/mockups/firm-workspace/bookkeeping/source/` (`bookkeeping.jpg`, `bookkeeping-actions-dropdown.jpg`, `client-bookkeeping-workspace.jpg`, `bookkeeping-close-reconciliation-and-report-review.jpg`) and the two developer-guide docx files. Branch `rasel/R56-bookkeeping` from `origin/main` with the #718 branch merged in (the contract is not on main yet: the Scrum note said #717, but #717 is Templates). Web port 3560. Conventions: `docs/work/R56-tasks.md`.

## Owned paths

`apps/web/src/app/firm/(workspace)/bookkeeping/**` (new routes), `apps/web/src/mocks/bookkeeping.ts` (new mock), the `bookkeeping` entry in `apps/web/src/lib/api.ts` (mock switch), the sidebar link in `(workspace)/layout.tsx` and `lib/firm-modules.ts` (Bookkeeping leaves the "module not built" list), `apps/web/e2e/mock/r56-bookkeeping.spec.ts`, `r56-screenshots/bk-*`.

## Routes

| Route                       | What                                                                                                                                                                                                                         |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/bookkeeping`              | Overview: period select, header actions, five KPIs, status donut, monthly income vs expenses, connected software, seven status tabs, filters, the client table with sort, paging and the Actions dropdown                    |
| `/bookkeeping/clients/[id]` | Client workspace: software and Sync Now, current period, KPIs, quick actions, accounts, shared task/document/note counts, trend, year to date, upcoming reports; tabs Reconciliation (periods), Reports and Settings; Documents, Tasks, Notes and Communications open their own modules |
| `/bookkeeping/periods/[id]` | The close: checklist, entered figures, reconciliations (save, ready, approve, reopen), the period's reports, and Start, Ready, Send Back, Approve, Close, Reopen                                                               |
| `/bookkeeping/reports`      | Every bookkeeping report with its review steps (start, send for review, send back, approve, deliver)                                                                                                                          |
| `/bookkeeping/settings`     | Firm cadence, close day, windows, tolerance, status rules, document and close checklists (Owner and Admin)                                                                                                                    |

## Run it

| State           | Command                                                                                                 |
| --------------- | ------------------------------------------------------------------------------------------------------- |
| With data       | `NEXT_PUBLIC_API_MOCK=all NEXT_PUBLIC_API_MOCK_ROLE=OWNER WEB_PORT=3560 pnpm --filter @firmivra/web dev` |
| Empty           | the same plus `NEXT_PUBLIC_API_MOCK_EMPTY=bookkeeping`                                                  |
| API unreachable | `NEXT_PUBLIC_API_MOCK=me`                                                                               |

## Steps

- [x] 1. Mock `bookkeeping` (every call of the contract; eight clients, eight months of periods, reconciliations and reports)
- [x] 2. Overview, filters and the Actions dropdown
- [x] 3. Client workspace and its tabs
- [x] 4. Close, reports and settings
- [x] 5. Mock spec (10 tests), three states, 375 px

## Needs from others

- **Terms pages**: the fourth design (`bookkeeping-close-reconciliation-and-report-review.jpg`) is the client's Terms page (service package, billing, payment schedule). The contract says Terms, transactions, refunds and settlements need tables that do not exist yet, so it is not built.
- **Transactions and Uncategorized Transactions**: Firmivra keeps no ledger. The Transactions tab and the Uncategorized card say so and show the count that was entered for the period.
- **Business Name** column of the list: the contract has one display name.
- **KPI trends**: money cards compare against the period before only when it has figures; with none entered they say "No figures entered yet" instead of a number.
- **Actions dropdown**: Open Accounting Software, Download Report, Change Plan/Service and Remove Bookkeeping Service have no call in the contract and are left out. Request Documents, View Documents, Create Task, Send Message and Schedule Appointment open the shared modules.
- **Add Note and the Notes tab** open the client record (notes live in the shared notes module).
- **Deliver a report** needs a published report of the client's workspace (`api.workspaces`); with none it says to publish one first.
- **Software marks**: the kit has no brand logos, so each provider shows its initials in a coloured disc.
- **Accounts** are added by hand or come from a provider sync; connected accounts cannot be edited here.

## Progress log

- 2026-10-18: Bookkeeping built on the #718 contract with a new mock; 10-test spec passes; screenshots committed.
- 2026-10-26: SH2 (Octavia's Oct 25 review, PY-F07, F08; TX-F02 for R60): the shared `ActionMenu` (`packages/ui`) draws its list in a portal (the trigger's dialog when inside one), fixed and clamped to the window (`placeMenu`: below or above, scrolls inside), one arrow on the trigger, arrow keys, Home, End, Escape (focus back) and Tab away; Payroll's Client Actions and More Actions lost their second arrow. On `rasel/R56-shared-row-menu` (from main; PR when a slot frees). Tests: ui 4, mock 4 new (`r56-row-menu`), payroll and bookkeeping specs 24 of 24.
- 2026-10-26: SH1 (PY-F10, the Bookkeeping navigation contract; TX-F03 for R60): exact-origin Back. Links and menu actions out of Payroll and Bookkeeping carry `?from=` (the exact path and query; `OriginLink`, `useOriginNavigate` in `components/origin-link.tsx`); one `OriginBar` in the workspace layout shows Back to {place} on any page opened that way, restores the scroll position, and asks first when a form registered unsaved work (`useUnsavedChanges`, `lib/unsaved.ts`); only a path on this site is followed (`safeOrigin`). The two overviews keep their period, view, filters, search, sort and page in the address (`lib/list-query.ts`, read by the server pages). On `rasel/R56-shared-back` (stacked on the SH2 branch). Tests: unit 7, mock 4 new (`r56-origin-back`), payroll and bookkeeping specs green.
- 2026-10-26: Zero tolerance (Rasel, after R1's #1177): Settings has no Reconciliation tolerance field; the reconciliation error reads "The difference must be zero."; a difference shows green only at zero; the mock approves only a zero difference (its tolerance stays 0, the contract still carries the fields). On `rasel/R56-zero-tolerance` (from main). Tests: Bookkeeping 11 of 11 (one new).
- 2026-10-26: SH3 (PY-F02, F03; the Bookkeeping request and documents contract; TX-F08 to F10 for R60): Request Documents and Upload Document open in place (`components/service-documents.tsx`: `ServiceDocumentsProvider`, `useServiceDocuments`), prefilled with the client, the service's engagement and its period (Bookkeeping's current period; instructions start "For {period}."), showing client, service, recipient and channel before sending, keeping the input on failure and staying on the tab; the row menus open it for their row; Bookkeeping's main page asks which client first; Payroll's main Request Documents still opens All Requests (S08). Mock mode: `mocks/service-engagements.ts` lets the documents mock file for the Payroll and Bookkeeping mock clients. On `rasel/R56-shared-documents` (stacked on SH1). Tests: mock 4 new (`r56-service-documents`), 32 of 32 with SH1, SH2 and the module specs; documents specs 9 of 9.
