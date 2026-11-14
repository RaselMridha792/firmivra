# Tax Returns: Review 2 QA map

This file maps every row of Octavia's Tax Returns Review 2 (Nov 11, 2026) to the PR that built it and the test that covers it, or marks it as a **GAP**. That means the 36 Review One items F01 to F36 and the seven approved additions. Her checklist and checkpoint are kept privately, outside the repo. Rows are named by their IDs and headings only; her text is not copied here, except where a row's own wording decides its status.

Her review status is in the second column: Verified, Partial, Correction or Pending. Verified rows still name her remaining retests. Those are her checks to repeat (roles, narrow screens, populated fixtures), not open code work.

**Where the tests are**
- API e2e: `apps/api/test/e2e/` `tax-return-workspace`, `tax-return-review`, `tax-return-issues`, `tax-statuses`, `scheduling`, `tasks-work`, `documents-packets-portal`
- Isolation: `apps/api/test/isolation/cases/tax-return-workspace.ts`, `tax-return-review.ts`, `tax-statuses.ts`
- db: `packages/db/test/tax-return-filed-year.test.ts`, `tax-review2-fields.test.ts`
- Mock specs: `apps/web/e2e/mock/r60-tax-returns-*.spec.ts`, `r60-tax-r2-features.spec.ts`, `r55-tax-returns.spec.ts`, `r55-tax-return-workspace.spec.ts`, `tax-statuses.spec.ts`

## Review One items F01 to F36

| Row | Her status | Code status | PR | Test |
| --- | --- | --- | --- | --- |
| F01 Client details | Verified | Done | #1175 | Mock `r55-tax-return-workspace` (the cards); long text and mobile are her retest |
| F02 Row menu | Verified | Done | before Review 2 | Mock `r55-tax-returns` "the row menu changes status ..."; narrow screens and full keyboard are her retest |
| F03 Navigation | Partial | Done | #1340, #1466 | #1466: the list keeps tab, filters, search and page in the address; New Message Cancel returns to its origin; Full Review's Create Task and Signatures open on the client and return with Back. Mock `r60-tax-returns-menu`, `-shared` |
| F04 Firm-side Client Portal | Pending (deferred) | Done | #1418 | A return's Client Portal opens the firm-side Client Portal for its client, with Back. Mock `r60-tax-returns-shared` "... Client Portal keep Back to the return" |
| F05 Messaging | Verified | Done; the addition is a **GAP** | #1340 | Mock `r60-tax-returns-shared` "Send Message is written here". The delivery controls are the Messaging addition below |
| F06 Appointments | Partial | Link done; in-place panel is a **GAP** (decision) | #1484 | e2e `scheduling` (linked as the return's engagement; another client's return 404); mock `r60-tax-returns-appointment`. See GAP 2 |
| F07 Row actions | Partial | Done | #1466, #1484 | Her row: "context and appointment association defects are tracked under F03/F06". Both are done. Mock `r60-tax-returns-menu` |
| F08 Upload/Request | Partial | Done | #1340, #1485 | Upload and Request open in place with the client, Tax Returns and the year; Set Up Service for a return with none. Mock `r60-tax-returns-upload`, `-shared` |
| F09 Documents | Partial | Done | #1485 | An upload from the return can link the same record to it in a role. Mock `r60-tax-returns-upload`. Opening the linked PDF, folder/type and search are her retest |
| F10 Upload and request | Correction | Done | #1485 (+ Clients E8) | Client Documents has its own Upload, separate from Request. Bookkeeping, Payroll, Business Advisory and Tax Returns use the shared upload. A request from a return carries Tax Returns and the year (her "only Bookkeeping, no year" was a return without its service). Mock `r60-tax-returns-upload` |
| F11 Intake forms | Partial | Done | #1186, #1466 | Send an Intake Form opens on the client, on the return's engagement. Mock `r60-tax-returns-intake`. Submitted-form, correction and version flows are her retest |
| F12 Link Document | Verified | Done | before Review 2 | e2e `tax-return-review` "links the client's documents; the filed return stays linked"; other roles and surfaces are her retest |
| F13 Task status | Partial | Done | #1422 | Blocked asks why and keeps the reason. e2e `tasks-work` (Blocked without a reason is 400) |
| F14 Task actions | Verified | Done | before Review 2 | Mock `r56-tasks-review`, `r56-service-tasks`; future occurrences and roles are her retest |
| F15 Task flow | Partial | Done | #1466 | Convert to Recurring opens the setup straight away, with Back to the return. Mock `r60-tax-returns-shared` |
| F16 Correct Tax Year | Correction | Done | #1469, #1473 | e2e `tax-return-review` "TX-F16: Correct Tax Year"; db `tax-return-filed-year`; mock `r60-tax-returns-rejection` |
| F17 Metadata authority | Pending (deferred) | No code gap known | #1346, #1348 | Deferred to her Settings/Staff role pass |
| F18 Reviewer permissions | Pending (deferred) | Done | #1346, #1348 | e2e `tax-return-review` "TX-F18: ..."; role testing is her Settings/Staff pass |
| F19 Validation issues | Partial | Done | #1172, #1354, #1466 | Each validation line shows who is responsible and the draft version. Mock `r60-tax-returns-issues` |
| F20 Severity gates | Partial | Done | #1354, #1466 | An open Error, or a validation line back at Error, blocks every transmission, retransmission and paper filing, also after Ready to File. e2e `tax-return-issues` (the post-Ready Error case); mock `r60-tax-returns-issues` |
| F21 Issue resolution | Pending (clarify) | **GAP** (her decision) | | See GAP 3 |
| F22 Rejection | Verified | Done | #1185; In Correction #1488, #1499 | e2e `tax-return-review` "Review 2: Start Correction ..."; mock `r60-tax-returns-rejection`, `r60-tax-r2-features` |
| F23 Rejection history | Verified | Done | #1185 | e2e `tax-return-review` "records transmissions and their answers" |
| F24 Retry history | Partial | Done | #1466, #1469, #1473 | Earlier attempts keep the full rejection; a recorded rejection makes its corrective task with an owner. e2e `tax-return-review` |
| F25 Filing methods | Partial | Done | #1354, #1466 | The Error gate (F20) now covers paper |
| F26 Mailing | Partial | Done | #1198, #1422 | Date mailed starts empty and is required; Record needs the Mail Tracking Number. Mock `r60-tax-returns-mail` |
| F27 Mailing Report | Correction | Done | #1422 | Quick Actions: Mailing Report, with each paper filing's date, tracking and status, and CSV. e2e `tax-return-review` (the report, another firm sees none) |
| F28 Amounts | Verified | Done | #1187 | Mock `r60-tax-returns-amounts` |
| F29 Amount validation | Verified | Done | #1187; rounding #1499 | See Rounding below |
| F30 Record versus submit | Partial | No code gap | | Real transmission and integrations are not part of this release |
| F31 Business identity | Pending | Done | #1176, #1179 | Mock `r60-tax-returns-business`. A populated-entity retest is hers |
| F32 Business snapshots | Partial | Done | #1195 | Mock `r60-tax-returns-identity` |
| F33 Quarterly selector | Verified | Done | before Review 2 | Mock `r55-tax-returns` (the quarterly tab); the quarterly lifecycle is her retest |
| F34 Archived view | Verified | Done | #1178 | Mock `r60-tax-returns-archived` |
| F35 Restore | Partial | Done | #1178 | Mock `r60-tax-returns-archived`; exhaustive data and role checks are her retest |
| F36 Configuration | Pending (clarify) | Mapping done; service tabs is a **GAP** (clarify) | #1488, #1499 | e2e `tax-statuses` "Review 2 (TX-F36)"; mock `r60-tax-r2-features`. See GAP 4 |

## Approved additions

| Addition | Status | PR | Test |
| --- | --- | --- | --- |
| File Extension | Done | #1488 (db), #1499 | e2e `tax-return-review`: the event only, audited, the new deadline after the due date, refused on a filed return; mock "Record Extension" |
| Messaging | **GAP** (in progress) | | See GAP 1 |
| Rejected return (In Correction) | Done | #1488 (db), #1499 | db: Rejected never goes straight to review; e2e: a reason is required and the client sees In Progress; mock "Start Correction" |
| Replacement request | Done | #1502 | e2e `documents-packets-portal` "Request Replacement on a submitted item opens the packet ..." |
| Mailing date | Done | #1422 | Mock `r60-tax-returns-mail` |
| Rounding | Done | #1488 (db), #1499 | e2e: Round to the dollar stores 1482.50 as 1483 and keeps 1482.50 in the audit; mock: the setting in Settings > Tax statuses |
| Amount history | Done | #1492 | Mock `r60-tax-returns-amounts` "Review 2: Edit shows the saved amount beside the new one ..." |

## GAPs

1. **Messaging delivery controls** (the approved addition; F05's new requirement). Moved from R56 to R60 on Nov 15. The design and schema are approved:
   - a firm default, an optional saved client preference and a per-send choice;
   - message text in the email only when switched on, with a warning;
   - documents only as sign-in links into the portal.
   - Plan: the db PR, then the feature.
2. **F06 in-place appointment panel.** The lead decided on Nov 7 that Create Appointment opens the shared Schedule form on the client and the return, with Back, as Bookkeeping and Payroll do. A panel would need the Schedule form made embeddable first. Her Review 2 still asks for in-place creation, so this needs her acceptance of the decision, or the embeddable form.
3. **F21 issue resolution.** Her row is a Clarify: what Valid means, who may resolve an issue, whether a reason is required, and when re-review is required. Today an issue's severity can change without a reason. Waiting for her decision; automatic routing is deferred by her.
4. **F36 service tabs.** "Maps to" answers how labels map to workflow statuses. How service types and workflow presets map to the return's stages is still her Clarify.

**Found from her audit note (fixed separately).** A Ready for Review history row repeated the reason of the earlier move back. The cause: a status change without a reason kept the return's last reason, and the history row copies it. The fix clears the reason on a change that has none.

## Notes

**Amount precision and storage: answered by the design, open to change.** Her question was how precisely amounts are kept. Each firm chooses in Settings > Tax statuses (Owner and Admin):
- **Exact** (the default) keeps the cents.
- **Round to the dollar** stores each refund or amount due rounded half up when it is saved. This is her "Round up figures", never down.

The audit entry of every save keeps the figure exactly as entered beside the stored one, so nothing entered is lost. The choice applies to amounts saved from then on; saved amounts stay as they are. If she wants another rule, such as rounding only on display, the setting can change without losing data.

**File Extension: the event only.** Record Extension stores the day the extension was filed and the new filing deadline. The original due date stays, and nothing is sent to an agency. A filing extension does not extend payment: the estimate's due date is still the original.
