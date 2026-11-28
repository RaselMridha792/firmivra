# Business Advisory: Review Two QA map

This file maps every row of Octavia's Business Advisory Review Two to the PR that built it and the test that covers it, or marks it as a **GAP**. Her review is kept privately, outside the repo. Rows are named by the work list's keys (A-01 to A-15 in her review order, A-NEW for her new requests, A-X for the approved additions, A-G for the acceptance gates) and short headings only.

"Her retest" means her Review Three check of something built, not open code work.

**Where the tests are**
- API e2e: `apps/api/test/e2e/advisory.e2e.test.ts`, `advisory-portal.e2e.test.ts`, `advisory-reports.e2e.test.ts`, `client-profile.e2e.test.ts`, `scheduling.e2e.test.ts`
- Isolation cases: `apps/api/test/isolation/cases/advisory.ts`
- Mock specs: `apps/web/e2e/mock/` `r1-advisory-b1`, `r1-advisory-b2`, `r0-business-advisory`, `r56-advisory-review`, `r55-portal-advisory`, `r55-advisory-resource-preview`

| Row | Code status | PR | Test |
|---|---|---|---|
| A-01 Other reveals Specify | Done (her Verified) | before Review Two | Her pass |
| A-02 Eight goal statuses | Done (her Verified) | before Review Two | Her pass |
| A-03 Milestone owner, status, progress | Done (her Verified) | before Review Two | Her pass |
| A-04 Schedule Advisory Meeting fills client and type | Built, her retest | #1586 | mock `r1-advisory-b1` "A-04" |
| A-05 Zoom link | **H**: her confirmation that she wants generated meetings, and a Zoom app | | |
| A-06 Goal status and progress in step | Done (her Verified) | before Review Two | Her pass |
| A-07 View Snapshot shows the whole plan | Built, her retest | #1586 | mock `r1-advisory-b1` "A-07" |
| A-08 Client approval before finalizing, every revision | Built, her retest | #1635 (B10) | e2e `advisory-portal` (B10); mock `r55-portal-advisory` |
| A-09 Reports keep the client context | Built, her retest | #1586 | mock `r1-advisory-b1` "A-09" |
| A-10 Client Schedule Meeting preselects the type | Built, her retest | #1586 | mock `r1-advisory-b1` "A-10/A-11" |
| A-11 Booking returns to the Meetings tab | Built, her retest | #1586 | mock `r1-advisory-b1` "A-10/A-11" |
| A-12 Documents and the active advisory service | Built, her retest | R56 (456760cd4) | e2e `advisory` (A-12) |
| A-13 Request Document enabled | Built, her retest | R56 (456760cd4) | e2e `advisory` |
| A-14 Portal invitation flow | Her retest | before Review Two | |
| A-15 Document year and category | Done (her Verified) | before Review Two | Her pass |
| A-NEW1 Client entity type as a list with Other/Specify | Done | #1649 | mock `r1-advisory-b1` "A-NEW1" |
| A-NEW2 Module-level View History | Done | batch B | e2e `advisory` "A-NEW2: the module history…"; mock `r1-advisory-b2` "A-NEW2" |
| A-X01 EIN status apart from the number | Built, her retest | #1586 | e2e `client-profile` "A-X01"; mock "A-X01" |
| A-X02 Firm-managed industry list | **GAP**: needs schema (db PR) | | |
| A-X03 Helper text and assessment fields | Her retest | before Review Two | |
| A-X04 Recommendation suggestions while typing | Built, her retest | #1586 | mock "A-X04" |
| A-X05 In-app confirmations | Built, her retest | #1586 | mock "A-X05" |
| A-X06 Add Business or Personal Profile | Done | #1649 | mock `r1-advisory-b1` "A-X06" |
| A-X07 SMS consent and recurrence | Done | batch B | e2e `scheduling` "A-X07: refuses a text reminder…"; mock `r1-advisory-b2` "A-X07" (both) |
| A-X08 Plans Archive & History | Done | #1649 | mock `r1-advisory-b1` "A-X08" |
| A-X09 Financial corrections, audited | Done | #1649 | e2e `advisory` "A-X09: corrects a row…"; mock "A-X09"; isolation (`corrects.snapshotId`) |
| A-X10 Add/Edit Resource | Partial: format and preview done (#1635, B28); the firm's own resources **GAP** (needs schema) | #1635 | e2e `advisory-portal` (B28); mock `r55-advisory-resource-preview` |
| A-X11 Tasks, progress notes, Cancel Meeting | Partial: Edit Action Item and Cancel Meeting done; progress notes **GAP** (schema in #1652, then batch D) | batch B | e2e `advisory` "A-X11: Edit Action Item…"; mock `r1-advisory-b2` "A-X11" (both) |
| A-X12 Note audience, client files and history | Built, her retest | #1586, #1629 (B32) | mock "A-X12"; mock `r55-note-share` |
| A-X13 Recipient and channel before a send | Done | #1649 | e2e `advisory` (send-preview); mock "A-X13"; isolation (`send-preview`) |
| A-X14 Focus categories, Services & Deliverables | Done: the focus categories are the firm's own Services & Pricing categories (Octavia's nine are set up there), General Advisory for a service with none | batch C | e2e `advisory` "A-X14: Services & Deliverables…"; mock `r1-advisory-b2` "A-X14" (both); isolation (`deliverables`) |
| A-G1 Service configuration | Her retest | | After A-12 |
| A-G2 Privacy and permissions | Her retest | | `apps/api/test/isolation/cases/advisory.ts` |
| A-G3 Approval and versions | Her retest | #1635 | After A-08 |
| A-G4 Calculations and sources | Her retest | | |
| A-G5 Persistence and return to origin | Her retest | | |
| A-G6 Delivery and invitation | Her retest | | |
| A-G7 Resilience and usability | Her retest | | |
| A-G8 Audit | Her retest | | |
