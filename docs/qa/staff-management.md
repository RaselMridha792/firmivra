# Staff Management: QA map (Review 2)

This file maps each row of Octavia's Staff Management Review 2 that needed work (RED and YELLOW) to the PR that fixed it and the test that covers it. Her PURPLE rows are her own testing and stay with her retest. Product decisions are the lead's of Nov 18 (DECISIONS); the two schema changes (SM20, SM21) are #1621, approved by Rasel.

- API e2e: `apps/api/test/e2e/staff.e2e.test.ts`, `staff-write.e2e.test.ts`, `staff-documents.e2e.test.ts`
- Mock specs: `apps/web/e2e/mock/r60-staff-review2.spec.ts`, and the earlier `r56-reports.spec.ts` (SM3)

| Row | Status | PR | Test |
| --- | --- | --- | --- |
| SM01 Staff and team reporting | Done | PR pending (batch 1) | mock `r60-staff-review2` "SM01: the Reports tile opens the Staff & Team report with its content, and Back returns to Staff Management" |
| SM04 Export permissions | Done | PR pending (batch 1) | staff-write e2e "SM04: Create Staff gives Export like any other column, and the new member keeps it"; mock "SM04…" |
| SM06 Company work schedules | Done | PR pending (batch 1) | staff-write e2e "SM06 and SM25…"; mock "SM06 and SM25: Edit Staff keeps a custom work schedule and both teams" |
| SM09 Bulk file formats | Done | PR pending (batch 1) | staff e2e "SM09: serves the same template as an Excel workbook" |
| SM16 Draft saving and retrieval | Done | PR pending (batch 1) | staff-write e2e "SM16: a draft keeps a changed permission grid and custom security settings as saved"; mock "SM16…" |
| SM18 Unsaved changes warning | Done | PR pending (batch 1) | mock "SM18: Edit Staff asks…" and "SM18: Create Staff asks…" |
| SM25 Direct membership and hierarchy | Done | PR pending (batch 1) | staff-write e2e "SM06 and SM25…" (teams kept, a supervisor loop refused); mock "SM06 and SM25…" |
| SM38 Audit and timestamps | Done | PR pending (batch 1) | staff-documents e2e (the import's audit names its file); mock "SM38: Staff Management times are in the firm's time zone" |
| SM02, SM05, SM08, SM12, SM15, SM17, SM20, SM21, SM33, SM40 | Open | next batch | — |
| SM23, SM24, SM26, SM29, SM31, SM32, SM35, SM36, SM37, SM39, SM41, SM42, SM43 (PURPLE) | Her retest | — | — |
