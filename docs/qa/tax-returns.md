# Tax Returns: Review 2 QA map

This file maps the rows of Octavia's Tax Returns Review 2 that R60 built to the PR that built them and the test that covers them. Her review (Nov 2026) is kept privately, outside the repo. Rows are named by their IDs only; the report's text is not copied here, except where a row's own wording decides its status.

**Where the tests are**
- API e2e: `apps/api/test/e2e/tax-return-workspace.e2e.test.ts`, `tax-return-review.e2e.test.ts` ("Review 2: Start Correction, Record Extension and amount rounding"), `tax-statuses.e2e.test.ts`
- Isolation: `apps/api/test/isolation/cases/tax-return-workspace.ts`, `tax-return-review.ts`, `tax-statuses.ts`
- db: `packages/db/test/tax-return-filed-year.test.ts`, `tax-review2-fields.test.ts`
- Mock specs: `apps/web/e2e/mock/r60-tax-returns-*.spec.ts`, `r60-tax-r2-features.spec.ts`, `tax-statuses.spec.ts`

## Rows

| Row | Status | PR | Test |
| --- | --- | --- | --- |
| TX-F03 | Done | #1466 | Mock: the return's menu keeps the client and the return in each module |
| TX-F06 | Done | #1484 | e2e: an appointment linked to the return keeps it; mock "Schedule Appointment" opens with `taxReturnId` |
| TX-F07 | Done | #1466, #1484 | Her row: "context and appointment association defects are tracked under F03/F06". Both are done, so F07 is closed with them; `r60-tax-returns-menu.spec.ts` checks Back to the list |
| TX-F08, F10 | Done | #1485 | Mock: Set Up Service on a return with none; an upload linked as one of the return's documents |
| TX-F11, F15, F19, F20 | Done | #1466 | e2e and mock (`r60-tax-returns-issues`, `-rejection`) |
| TX-F16 | Done | #1469, #1473 | e2e "TX-F16: Correct Tax Year"; db `tax-return-filed-year.test.ts` |
| TX-F24 | Done | #1466, #1469, #1473 | e2e: a rejection creates the corrective task |
| Amount comparison and history | Done | #1492 | Mock: the saved figure beside the new one, and each version |
| In Correction / Start Correction | Done | #1488 (db), this PR | db: Rejected never goes straight to review; e2e: a reason is required, the client sees In Progress, then Ready for Review; mock "Start Correction" |
| File Extension | Done | #1488 (db), this PR | e2e: the event only and audited, the new deadline after the due date, refused on a filed return; mock "Record Extension" |
| Amount precision and storage | Done | #1488 (db), this PR | e2e: Round to the dollar stores 1482.50 as 1483 and keeps 1482.50 in the audit; mock: the setting in Settings > Tax statuses |
| TX-F36 (Maps to) | Done | #1488 (db), this PR | e2e: map on create or later, or to none, audited from and to; mock: Maps to per label |

**Amount precision and storage: answered by the design, open to change.** Her question was how precisely amounts are kept. Each firm chooses in Settings > Tax statuses (Owner and Admin): **Exact** keeps the cents (the default), and **Round to the dollar** stores each refund or amount due rounded half up when it is saved. The audit entry of every save keeps the figure exactly as entered beside the stored one, so nothing entered is lost. The choice applies to amounts saved from then on; saved amounts stay as they are. If she wants another rule, such as rounding only on display or for some jurisdictions, the setting can change without losing data.

**File Extension: the event only.** Record Extension stores the day it was filed and the new filing deadline. The original due date stays, and nothing is sent to an agency. A filing extension does not extend payment: the estimate's due date is still the original.
