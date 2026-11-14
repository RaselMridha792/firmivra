# Tax Planning: Review 2 QA map

This file maps the rows of Octavia's Tax Planning Review 2 to the PR that built them and the test that covers them, or marks them as a **GAP**. Her checklist and review (Nov 2026) are kept privately, outside the repo. Rows are named by their headings only; the report's text is not copied here.

**Where the tests are**
- API e2e: `apps/api/test/e2e/tax-planning.e2e.test.ts` ("the approved workflow (Review 2)")
- API e2e: `apps/api/test/e2e/scheduling.e2e.test.ts` ("a planning discussion")
- Isolation: `apps/api/test/isolation/cases/tax-planning.ts`
- db: `packages/db/test/tax-plan-workflow.test.ts`
- Mock spec: `apps/web/e2e/mock/r1-tp-workflow.spec.ts`

## Approved additions: the plan workflow

| Row | Status | PR | Test |
| --- | --- | --- | --- |
| Duplicate Plan | Done | #1468, this PR | e2e "duplicates a plan as an editable Draft, the original unchanged"; mock "an implemented plan is delivered; Duplicate Plan makes an editable Draft copy" (the plan's actions and the clients list menu) |
| Context-relevant actions | Done | this PR | The API works out each plan's actions from its status (`workflow.ts`); e2e and mock check what is offered and refused at each step |
| Readiness and consistent status | Done | this PR | The readiness checklist (complete / missing / how to fix), next action and owner on every step of the plan; Review & Save shows the same status and changes it only by the plan's actions |
| Plan setup | Done | #1468, this PR | `scheduling.e2e` "moves a Draft plan to Scheduled when its discussion is booked"; the first change moves it to In Progress (tax-planning e2e) |
| Active work | Done | this PR | e2e: In Progress until sent or another move |
| Internal review | Done | #1468, this PR | e2e and mock: a chosen reviewer of the firm, Under Review; another firm's member is refused |
| Send to client | Done | this PR | One Send control with its purpose (review or delivery); a review send is Awaiting Client Review |
| Information requests | Done | #1468, this PR | e2e "asks the client for information by a portal message and answers the request"; a client's request moves the plan to Needs Review (e2e and mock) |
| Revision work | Done | this PR | Start Revision, finalize and send again: a new version (e2e and mock) |
| Client approval | Done | #1468, this PR | e2e and mock: the date (never after today), the exact version sent, how it was approved; one approval per version |
| Implementation | Done | this PR | e2e: Implemented is refused (409) until the client's approval is recorded |
| Delivery | Done | #1468, this PR | e2e and mock: Deliver to Client keeps its own version and leaves the status as it is |
| Closed and finalized | Done | earlier C27 PRs, this PR | Close and Reopen with the reason in the plan's actions |

**Client approval: manual now, portal later.** Her row accepts "portal approval or documented manual approval". Staff record a documented manual approval now (method `MANUAL`, with the date, the exact version and how it was given). The schema already holds `PORTAL` approvals, so a portal Approve button can come later without a schema change. The manual record meets the row as written.
