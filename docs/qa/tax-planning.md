# Tax Planning: Review 2 QA map

This file maps every row of Octavia's Tax Planning Review 2 (C01 to C27, the approved additions, the Collapse All observation and the open release gates) to the PR that built it and the test that covers it. A row that needed no code instead gets the exact steps on dev that show it. A part still open says so in its Status: **Not built yet** (with who builds it), **After Nov 17** (deferred by decision), **Built; test gap** (the code is there, a check is missing) or **Open** (a release gate for her retest). Her checklist and review (Nov 2026) are kept privately, outside the repo; rows are named by their IDs and headings only.

**Where the tests are**
- API e2e: `apps/api/test/e2e/tax-planning.e2e.test.ts` (below: TP e2e), `project-deadlines.e2e.test.ts`, `notify-jobs.e2e.test.ts`, `scheduling.e2e.test.ts`, `tasks-work.e2e.test.ts`, `reports.e2e.test.ts`
- Isolation: `apps/api/test/isolation/cases/tax-planning.ts`, `project-deadlines.ts`
- db: `packages/db/test/tax-planning-review2.test.ts`, `tax-plan-workflow.test.ts`, `tax-planning-opportunities.test.ts`, `project-deadlines.test.ts`
- Mock specs: `apps/web/e2e/mock/r56-tax-planning.spec.ts` (below: mock TP), `r1-tp-workflow.spec.ts` (mock WF), `r1-tp-gaps.spec.ts` (mock `r1-tp-gaps`), `r56-project-deadlines.spec.ts`, `r56-reports.spec.ts`

**The PRs**: #738 (C14, earlier), #1376 (C01 to C04, C16, C18, C22), #1397 (C05 to C09, C24 to C26), #1409 (C10, C13, C17 View, C19 to C21, C23), #1416 (schema S1 to S6), #1427 (C08, C11, C27), #1433 (C12, C15, C17 Edit), #1468 and #1474 (the approved workflow and Duplicate Plan), #1482, #1489 and #1493 (Project Deadlines), #1506 (C18 in central Reports, C19 into a new plan, C25 a version's own history; the tests for C13, C20, C23 and C26).

## Corrections C01 to C27

| Row | Status | PR | Test or steps |
| --- | --- | --- | --- |
| C01: KPI cards open their lists | Done | #1376 | TP e2e "opens the overview's KPI lists, finds a plan by its name…"; mock TP "Review 2 (C01, C02, C04, C16)…" |
| C02: planning consultation | Done | #1376, #1433 | The same e2e (the planning service); the same mock checks Schedule opens New Appointment on the planning service with the way back |
| C03: Clients row menu | Done | #1376, #1474 | mock TP "Review 2 (C03, C22)…" (Schedule, Send Resource); mock WF "…Duplicate Plan makes an editable Draft copy" (the menu). View, Edit, Assign Staff, Close and Archive are on the menu with no test of their own. |
| C04: a deadline row opens its details | Done | #1376 | TP e2e "shows tax deadlines and planning milestones in a range" (affected clients); mock TP C01/C02/C04/C16 (details and affected-client links) |
| C05: required fields | Done | #1397 | mock TP "Plan: create it, enter figures, override an estimate, finalize it" (Next names what is missing; the required marks). Checked on the screen: a draft still saves. |
| C06: source, as-of date and Add Item | Built; test gap | #1397 | TP e2e "keeps the plan's figures, each with its year, kind and source…" (the source, and an additional item with its label); mock TP "Plan: create it…" (source, Add Item). The as-of date is sent in the e2e but never read back, and the mock does not fill it. **Test gap:** R60 adds the check after the product items (Nov 15). |
| C07: Cancel and unsaved changes | Built; test gap | #1397 | mock TP "Plan: create it…" (Cancel on Client & Plan Details asks first; Keep Editing). Cancel and Back on Financial Overview after a change, and the Save Draft and Discard choices, have no test. Steps 3 to 5 save each change as it is made, so their Cancel needs no prompt. **Test gap:** R60 adds the check after the product items (Nov 15). |
| C08: Finalize, named blockers, one status everywhere | Built; test gap | #1397, #1427, #1474 | TP e2e "moves the plan along only in ways that fit, and finalizes and sends it…" (each blocker says where to fix it); TP e2e "finalizes to Finalized, revises and reopens…"; mock TP (readiness). The status comes from the plan in every view; no test compares the Clients list with the plan. **Test gap:** R60 adds the check after the product items (Nov 15). |
| C09: send status | Done | #1397, #1474 | TP e2e "moves the plan along…" (a refused send says why; Awaiting Client Review); TP e2e and mock WF "…from work to internal review…" |
| C10: opportunity reasoning and Edit | Built; test gap | #1409 | TP e2e "takes the reasoning on create, and edits an open opportunity with its history and audit" (the edit changes the reasoning, eligibility and documents; Client Data Used and recommended actions are set on create only); isolation case PATCH opportunities. The screens have no mock test. **Test gap:** R60 adds the check after the product items (Nov 15). |
| C11: reopen an opportunity | Built; test gap | #1416, #1427 | TP e2e "reopens a closed opportunity to Under Review, with its history"; db `tax-planning-opportunities` (a closed one reopens only to Under Review). A closed opportunity listed under the Closed filter has no test. **Test gap:** R60 adds the check after the product items (Nov 15). |
| C12: client discussions from the plan | Done | #1416, #1433, #1474 | `scheduling.e2e` "links the appointment to one of the client's open plans, never another's" and "moves a Draft plan to Scheduled…"; TP e2e "lists the tasks and client discussions linked to the plan, only its own"; db Review 2 (S3) |
| C13: strategy inputs, documents and checklist | Done | #1409, #1506 | mock `r1-tp-gaps` "C13 and C23: a strategy keeps its inputs, documents and checklist, and View Details shows them"; the API side, TP e2e "manages the library with Manage Strategies…" |
| C14: plan documents | Evidence | #738 | Dev: a saved plan > Implementation > Documents > Attach Document lists the client's documents. TP e2e "links only the plan client's documents". |
| C15: implementation tasks | Done | #1416, #1433 | `tasks-work.e2e` "links the task to one of the client's open plans, never another's"; TP e2e "lists the tasks and client discussions…" (owner, due date) |
| C16: calendar and list views | Done | #1376 | mock TP "Review 2 (C01, C02, C04, C16)…" (the month grid; the view in the address) |
| C17: resources View and Edit | Not built yet | #1409, #1416, #1433 | **Not built yet (assigned to R1):** a staff-only resource can't become client-facing. Today Edit offers Client-facing on the staff reference too, and the API takes it (`overview.service.ts` `updateResource`). Built and tested: TP e2e "edits a built-in resource in the firm's own words…" (Staff refused, another firm unchanged, made staff-only it is no longer sent); TP e2e "lists the approved resources…"; db Review 2 (S6) |
| C18: Reports context and filters | Done | #1376, #1506 | Central Reports has the Tax Planning service area: the `tax_plans` data source (the firm's plans with their projected savings, as the plan shows them; Staff only their clients'), two quick reports (Projected Savings by Plan, Planning Plans by Status), and the library's Category filter offers Tax Planning and Tax Returns. The Tax Planning Reports tab opens the report and the filtered library, each with Back to Tax Planning. `reports.e2e` "runs the firm's planning plans with their projected savings…" (in "Tax Planning in central Reports"; rows, Staff reach, the filter, another firm); mock `r1-tp-gaps` "C18: …"; `r56-reports` (the quick reports) |
| C19: save a calculation to a plan | Done | #1409, #1506 | Save to Plan attaches the scenario to one of the client's open plans, or makes a new plan for it (New plan…). mock `r1-tp-gaps` "C19: Save to Plan can start a new plan for the client"; TP e2e "saves scenarios, to a plan as snapshots…" |
| C20: find saved scenarios | Built; test gap | #1409, #1506 (test) | The calculator's Recent Scenarios reopens a saved scenario (`?scenario=`), and the plan's Goals & Strategies step lists the client's scenarios. There is no per-client Tax Planning page, so the list sits there. mock `r1-tp-gaps` "C20: a saved scenario is listed and reopens with what it kept" (the calculator list, and the inputs on reopening). The plan's Scenarios list and the note that a reopened result is the kept one have no test. **Test gap:** R60 adds the check after the product items (Nov 15). |
| C21: calculator method, limits and Add as Strategy | Built; test gap | #1409 | TP e2e "works out the saving from the tables, and says why when it cannot" (limits, overlap, unsupported year). Add as Strategy (a named strategy from the result) has no test. **Test gap:** R60 adds the check after the product items (Nov 15). |
| C22: plan-name search and filters | Built; test gap | #1376 | TP e2e (C01, C02, C22) for the plan-name search; mock TP "Review 2 (C03, C22)…" (entity and year in the address). The API's year, staff and entity filters, and the staff filter on the screen, have no test. **Test gap:** R60 adds the check after the product items (Nov 15). |
| C23: strategy View Details | Done | #1409, #1506 (test) | mock `r1-tp-gaps` "C13 and C23…" (View Details shows the documents and the checklist) |
| C24: entity presets | Built; test gap | #1397 | mock TP "Plan: create it…" (the Individual preset); custom entry has no test. **Test gap:** R60 adds the check after the product items (Nov 15). |
| C25: saved versions open read-only | Done | #1397, #1506 | A kept version opens read-only with its own send and approval history: when it was finalized, sent for the client's review or delivered, by whom, and the client's approval of exactly that version. mock TP "Plan: create it…"; mock `r1-tp-gaps` "C25: a version shows its own send history and the client approval of exactly that version" |
| C26: stale calculations | Done | #1397, #1506 (test) | The result is marked out of date once an input changes, and Save Scenario waits for Calculate. mock `r1-tp-gaps` "C26: …" |
| C27: reopen, revise and Finalized | Not built yet | #1416, #1427, #1474 | **Not built yet (assigned to R1, Nov 15):** from Finalized on, an edit needs Revise (a new version), and Implemented needs the approved version unchanged. Today any plan that is not Closed can be edited without Revise and keeps its status (`plan-read.service.ts` `canEdit`; `plans.service.ts` `editable`), and Implemented checks only that the status is Client Approved. Built and tested: TP e2e "finalizes to Finalized, revises and reopens with a reason, and keeps the history"; db Review 2 (Finalized; a closed plan changes only its status); the workflow e2e (approval of one exact version) |

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
| Workflow: information requests | Done (staff side); After Nov 17 (portal side) | #1468, #1474 | TP e2e "asks the client for information by a portal message and answers the request"; db `tax-plan-workflow` (each side's kinds); mock WF. A client's request is recorded by staff (it moves the plan to Needs Review). **After Nov 17 (decided):** the client raising a request from the portal. |
| Workflow: revision work | Done | #1427, #1474 | TP e2e workflow (Needs Review, Start Revision, sent again as a newer version); mock WF |
| Workflow: client approval | Not built yet | #1468, #1474 | **Not built yet (assigned to R1, Nov 15):** from Finalized on, an edit needs Revise (a new version), and Implemented needs the approved version unchanged. Built and tested: TP e2e workflow (the date never after today, the exact version sent); db `tax-plan-workflow` (one approval per version); mock WF |
| Workflow: implementation | Not built yet | #1474 | **Not built yet (assigned to R1, Nov 15):** from Finalized on, an edit needs Revise (a new version), and Implemented needs the approved version unchanged. Built and tested: TP e2e, Implemented is refused (409) until the client's approval is recorded |
| Workflow: delivery | Done | #1468, #1474 | TP e2e and mock WF: Deliver to Client keeps its own version and leaves the status as it is |
| Workflow: closed and finalized | Not built yet | #1416, #1427, #1474 | As C27 |
| Workflow: duplicate | Done | #1474 | As Duplicate Plan |
| Baseline additions retained | Carried forward | (earlier) | No Review 2 change; the earlier Tax Planning rows stand. Not rechecked in this map. |

**Client approval: manual now, portal later.** Her row allows either a portal approval or a documented manual one. Staff record a documented manual approval now (method `MANUAL`, with the date, the exact version and how it was given). The schema already holds `PORTAL` approvals, so a portal Approve button can come later without a schema change. The manual record covers the approval method; the open part of the row is the C27 item (Implemented only on an approved version that has not changed since).

## Observation and release gates

| Row | Status | PR | Test or steps |
| --- | --- | --- | --- |
| Collapse All observation | Reviewed | none | The opportunity screens have no collapsible sections, so there is no Collapse All to show. Left for her to confirm. |
| First: privacy and documents | Open | (several) | TP e2e "links only the plan client's documents"; a staff-only resource is refused on send (TP e2e "lists the approved resources…"). Waits on the C17 item. Uploads, client previews and staff-only notes are not mapped here. |
| High: roles and isolation | Open | (several) | Isolation cases `tax-planning.ts`, `project-deadlines.ts`; TP e2e "keeps Staff to their assigned clients, and the grid roles to what the grid gives", and the Preparer and other-client refusals across the TP e2e. Report export is not mapped here. |
| High: calculations and screening | Open | #1409 (and earlier) | TP e2e "works out the saving from the tables…" (worked figures, credits, joint filing, limits, unsupported cases); "estimates from the plan's figures, never invents one, and counts overlapping savings once"; "finds opportunities from the plan's figures…" |
| High: snapshots and delivery | Open | #1397, #1474, #1506 | TP e2e "moves the plan along…" (an earlier version unchanged after later sends); mock `r1-tp-gaps` C25. The client's receipt is not mapped here. |
| High: lifecycle | Open | #1427, #1474 | Waits on the C27 item. TP e2e "runs from work to internal review…" and "finalizes to Finalized…" |
| Normal: opportunities | Open | (several) | TP e2e "changes an opportunity only by explicit, audited actions that fit its status" and "reopens a closed opportunity…"; db `tax-planning-opportunities` (one open opportunity per client, strategy and year) |
| Normal: plans and files | Open | (several) | TP e2e "creates a draft plan, lists and reads it, and changes it with an etag" (a stale save is refused); the Duplicate Plan rows. Upload checks are not mapped here. |
| Normal: navigation and resources | Open | #1376, #1409 | mock TP overview, lists and "Review 2 (C01, C02, C04, C16)…"; TP e2e resource view and send |
| Normal: usability and failures | Open | (several) | mock TP "No sideways scroll at 375 px". Focus handling and loading and error states are not mapped here. |

## GAPs

- **C27, and Workflow: closed and finalized, client approval, implementation**: not built yet (assigned to R1, Nov 15). From Finalized on, an edit needs Revise (a new version), and Implemented needs the approved version unchanged.
- **C17**: not built yet (assigned to R1). A staff-only resource can't become client-facing.
- **Workflow: information requests, portal side**: after Nov 17 (decided). The staff side is done.
- **Test gaps** (R60 adds the checks after the product items, Nov 15): C06 the as-of date read back; C07 Cancel and Back on Financial Overview, Save Draft and Discard; C08 the Clients list status against the plan; C10 editing Client Data Used and recommended actions; C11 a closed opportunity under the Closed filter; C20 the plan's Scenarios list and the kept-result note; C21 Add as Strategy; C22 the year, staff and entity filters; C24 custom entry.
- **Release gates**: open for her retest; what exists today is listed above.

Screen parts whose API is tested but which have no mock spec of their own: C10's Edit Details, the C12 and C15 sections of the Implementation step, and C17's View screen.
