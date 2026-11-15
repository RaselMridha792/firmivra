# Tax Planning: Review 2 QA map

This file maps every row of Octavia's Tax Planning Review 2 (C01 to C27 and the approved additions) to the PR that built it and the test that covers it. A row that needed no code instead gets the exact steps on dev that show it, and a part still open is a **GAP** with what is missing. Her checklist and review (Nov 2026) are kept privately, outside the repo; rows are named by their IDs and headings only.

**Where the tests are**
- API e2e: `apps/api/test/e2e/tax-planning.e2e.test.ts` (below: TP e2e), `project-deadlines.e2e.test.ts`, `notify-jobs.e2e.test.ts`, `scheduling.e2e.test.ts`, `tasks-work.e2e.test.ts`
- Isolation: `apps/api/test/isolation/cases/tax-planning.ts`, `project-deadlines.ts`
- db: `packages/db/test/tax-planning-review2.test.ts`, `tax-plan-workflow.test.ts`, `tax-planning-opportunities.test.ts`, `project-deadlines.test.ts`
- Mock specs: `apps/web/e2e/mock/r56-tax-planning.spec.ts` (below: mock TP), `r1-tp-workflow.spec.ts` (mock WF), `r56-project-deadlines.spec.ts`

**The PRs**: #1376 (C01 to C04, C16, C18, C22), #1397 (C05 to C09, C24 to C26), #1409 (C10, C13, C17 View, C19 to C21, C23), #1416 (schema S1 to S6), #1427 (C08, C11, C27), #1433 (C12, C15, C17 Edit), #1468 and #1474 (the approved workflow and Duplicate Plan), #1482, #1489 and #1493 (Project Deadlines).

## Corrections C01 to C27

| Row | Status | PR | Test or steps |
| --- | --- | --- | --- |
| C01: KPI cards open their lists | Done | #1376 | TP e2e "opens the overview's KPI lists, finds a plan by its name…"; mock TP "Review 2 (C01, C02, C04, C16)…" |
| C02: planning consultation | Done | #1376, #1433 | The same e2e (the planning service); the same mock checks Schedule opens New Appointment on the planning service with the way back |
| C03: Clients row menu | Done | #1376, #1474 | mock TP "Review 2 (C03, C22)…" (Schedule, Send Resource); mock WF "…Duplicate Plan makes an editable Draft copy" (the menu). View, Edit, Assign Staff, Close and Archive are on the menu with no test of their own. |
| C04: a deadline row opens its details | Done | #1376 | TP e2e "shows tax deadlines and planning milestones in a range" (affected clients); mock TP C01/C02/C04/C16 (details and affected-client links) |
| C05: required fields | Done | #1397 | mock TP "Plan: create it, enter figures, override an estimate, finalize it" (Next names what is missing; the required marks). Checked on the screen: a draft still saves. |
| C06: source, as-of date and Add Item | Done | #1397 | TP e2e "keeps the plan's figures, each with its year, kind and source…"; mock TP "Plan: create it…" (source, Add Item) |
| C07: Cancel and unsaved changes | Done | #1397 | mock TP "Plan: create it…" (Cancel asks first; Keep Editing). Steps 3 to 5 save each change as it is made, so their Cancel needs no prompt. |
| C08: Finalize, named blockers, one status everywhere | Done | #1397, #1427, #1474 | TP e2e "moves the plan along only in ways that fit, and finalizes and sends it…" (each blocker says where to fix it); TP e2e "finalizes to Finalized, revises and reopens…"; mock TP (readiness). The status comes from the plan in every view; no test compares the Clients list with the plan. |
| C09: send status | Done | #1397, #1474 | TP e2e "moves the plan along…" (a refused send says why; Awaiting Client Review); TP e2e and mock WF "…from work to internal review…" |
| C10: opportunity reasoning and Edit | Done | #1409 | TP e2e "takes the reasoning on create, and edits an open opportunity with its history and audit"; isolation case PATCH opportunities. The screens have no mock test. |
| C11: reopen an opportunity | Done | #1416, #1427 | TP e2e "reopens a closed opportunity to Under Review, with its history"; db `tax-planning-opportunities` (a closed one reopens only to Under Review) |
| C12: client discussions from the plan | Done | #1416, #1433, #1474 | `scheduling.e2e` "links the appointment to one of the client's open plans, never another's" and "moves a Draft plan to Scheduled…"; TP e2e "lists the tasks and client discussions linked to the plan, only its own"; db Review 2 (S3) |
| C13: strategy inputs, documents and checklist | Done | #1409, this PR | mock `r1-tp-gaps` "C13 and C23: a strategy keeps its inputs, documents and checklist, and View Details shows them"; the API side, TP e2e "manages the library with Manage Strategies…" |
| C14: plan documents | Evidence | (earlier) | Dev: a saved plan > Implementation > Documents > Attach Document lists the client's documents. TP e2e "links only the plan client's documents". |
| C15: implementation tasks | Done | #1416, #1433 | `tasks-work.e2e` "links the task to one of the client's open plans, never another's"; TP e2e "lists the tasks and client discussions…" (owner, due date) |
| C16: calendar and list views | Done | #1376 | mock TP "Review 2 (C01, C02, C04, C16)…" (the month grid; the view in the address) |
| C17: resources View and Edit | Done | #1409, #1416, #1433 | TP e2e "edits a built-in resource in the firm's own words…" (Staff refused, another firm unchanged); TP e2e "lists the approved resources…"; db Review 2 (S6) |
| C18: Reports context and filters | Done | #1376, this PR | Central Reports has the Tax Planning service area: the `tax_plans` data source (the firm's plans with their projected savings, as the plan shows them; Staff only their clients'), two quick reports (Projected Savings by Plan, Planning Plans by Status), and the library's Category filter offers Tax Planning and Tax Returns. The Tax Planning Reports tab opens the report and the filtered library, each with Back to Tax Planning. `reports.e2e` "Tax Planning in central Reports…" (rows, Staff reach, the filter, another firm); mock `r1-tp-gaps` "C18: …"; `r56-reports` (the quick reports) |
| C19: save a calculation to a plan | Done | #1409, this PR | Save to Plan attaches the scenario to one of the client's open plans, or makes a new plan for it (New plan…). mock `r1-tp-gaps` "C19: Save to Plan can start a new plan for the client"; TP e2e "saves scenarios, to a plan as snapshots…" |
| C20: find saved scenarios | Done | #1409, this PR (test) | The calculator's Recent Scenarios reopens a saved scenario (`?scenario=`), and the plan's Goals & Strategies step lists its own. There is no per-client Tax Planning page, so the list sits there. mock `r1-tp-gaps` "C20: a saved scenario is listed and reopens with what it kept" |
| C21: calculator method, limits and Add as Strategy | Done | #1409 | TP e2e "works out the saving from the tables, and says why when it cannot" (limits, overlap, unsupported year) |
| C22: plan-name search and filters | Done | #1376 | TP e2e (C01, C02, C22) for the plan-name search; mock TP "Review 2 (C03, C22)…" (entity and year in the address) |
| C23: strategy View Details | Done | #1409, this PR (test) | mock `r1-tp-gaps` "C13 and C23…" (View Details shows the documents and the checklist) |
| C24: entity presets | Done | #1397 | mock TP "Plan: create it…" (the Individual preset; custom entry stays) |
| C25: saved versions open read-only | Done | #1397, this PR | A kept version opens read-only with its own send and approval history: when it was finalized, sent for the client's review or delivered, by whom, and the client's approval of exactly that version. mock TP "Plan: create it…"; mock `r1-tp-gaps` "C25: a version shows its own send history and the client approval of exactly that version" |
| C26: stale calculations | Done | #1397, this PR (test) | The result is marked out of date once an input changes, and Save Scenario waits for Calculate. mock `r1-tp-gaps` "C26: …" |
| C27: reopen, revise and Finalized | Done | #1416, #1427, #1474 | TP e2e "finalizes to Finalized, revises and reopens with a reason, and keeps the history"; db Review 2 (Finalized; a closed plan changes only its status); the workflow e2e (approval of one exact version) |

## Approved additions

| Row | Status | PR | Test or steps |
| --- | --- | --- | --- |
| Project Deadlines | Done | #1482, #1489, #1493 | db `project-deadlines` (private by default, shares, reminders, firm isolation); `project-deadlines.e2e` (a private deadline, a shared deadline, what a deadline may name, a reminder sent once, isolation and audit); `notify-jobs.e2e` "project deadline reminders"; mock `r56-project-deadlines` (the tab beside Reports, Add Deadline, owner-only edit); isolation cases |
| Duplicate Plan | Done | #1474 | TP e2e "duplicates a plan as an editable Draft, the original unchanged"; mock WF "…Duplicate Plan makes an editable Draft copy"; isolation case |
| Context-relevant actions | Done | #1474 | The API works out each plan's actions from its status (`workflow.ts`); TP e2e "runs from work to internal review…" (offered and refused at each step); mock WF |
| Workflow: readiness and consistent status | Done | #1397, #1474 | The readiness checklist (complete, missing, how to fix), next action and owner on every step; Review & Save shows the same status and changes it only by the plan's actions. TP e2e and mock WF. |
| Workflow: plan setup | Done | #1397, #1433, #1474 | `scheduling.e2e` "moves a Draft plan to Scheduled when its discussion is booked"; the first change moves it to In Progress (TP e2e workflow); mock TP C05 (assignee, target date) |
| Workflow: active work | Done | #1474 | TP e2e workflow: In Progress until sent or another move |
| Workflow: internal review | Done | #1468, #1474 | TP e2e and mock WF: a chosen reviewer of the firm, Under Review; another firm's member refused; db `tax-plan-workflow` |
| Workflow: send to client | Done | #1397, #1474 | One Send control with its purpose (review or delivery); a review send is Awaiting Client Review; a delivery before approval is refused (TP e2e, mock WF) |
| Workflow: information requests | Done | #1468, #1474 | TP e2e "asks the client for information by a portal message and answers the request"; db `tax-plan-workflow` (each side's kinds); mock WF. A client's request is recorded by staff (it moves the plan to Needs Review); there is no portal form for it yet. |
| Workflow: revision work | Done | #1427, #1474 | TP e2e workflow (Needs Review, Start Revision, sent again as a newer version); mock WF |
| Workflow: client approval | Done | #1468, #1474 | TP e2e workflow (the date never after today, the exact version sent, one approval per version); db `tax-plan-workflow`; mock WF |
| Workflow: implementation | Done | #1474 | TP e2e: Implemented is refused (409) until the client's approval is recorded |
| Workflow: delivery | Done | #1468, #1474 | TP e2e and mock WF: Deliver to Client keeps its own version and leaves the status as it is |
| Workflow: closed and finalized | Done | #1416, #1427, #1474 | As C27 |
| Workflow: duplicate | Done | #1474 | As Duplicate Plan |

**Client approval: manual now, portal later.** Her row accepts "portal approval or documented manual approval". Staff record a documented manual approval now (method `MANUAL`, with the date, the exact version and how it was given). The schema already holds `PORTAL` approvals, so a portal Approve button can come later without a schema change. The manual record meets the row as written.

## GAPs

None. Every C row and approved addition is built, and each has a test.

Screen parts whose API is tested but which have no mock spec of their own: C10's Edit Details, the C12 and C15 sections of the Implementation step, and C17's View screen.
