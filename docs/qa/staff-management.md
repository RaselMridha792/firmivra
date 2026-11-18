# Staff Management: QA map (Review 2)

This file maps each row of Octavia's Staff Management Review 2 that needed work (RED and YELLOW) to the PR that fixed it and the test that covers it. Her PURPLE rows are her own testing and stay with her retest. Product decisions are the lead's of Nov 18 (DECISIONS); the two schema changes (SM20, SM21) are #1621, approved by Rasel.

- API e2e: `apps/api/test/e2e/staff.e2e.test.ts`, `staff-write.e2e.test.ts`, `staff-documents.e2e.test.ts`
- API e2e (batch 2): `custom-roles.e2e.test.ts`, `departments.e2e.test.ts`, `team.e2e.test.ts`, `my-security.e2e.test.ts`
- Mock specs: `apps/web/e2e/mock/r60-staff-review2.spec.ts`, `r60-staff-review2-b.spec.ts`, and the earlier `r56-reports.spec.ts` (SM3)

| Row | Status | PR | Test |
| --- | --- | --- | --- |
| SM01 Staff and team reporting | Done | #1630 | mock `r60-staff-review2` "SM01: the Reports tile opens the Staff & Team report with its content, and Back returns to Staff Management" |
| SM04 Export permissions | Done | #1630 | staff-write e2e "SM04: Create Staff gives Export like any other column, and the new member keeps it"; mock "SM04…" |
| SM06 Company work schedules | Done | #1630 | staff-write e2e "SM06 and SM25…"; mock "SM06 and SM25: Edit Staff keeps a custom work schedule and both teams" |
| SM09 Bulk file formats | Done | #1630 | staff e2e "SM09: serves the same template as an Excel workbook" |
| SM16 Draft saving and retrieval | Done | #1630 | staff-write e2e "SM16: a draft keeps a changed permission grid and custom security settings as saved"; mock "SM16…" |
| SM18 Unsaved changes warning | Done | #1630 | mock "SM18: Edit Staff asks…" and "SM18: Create Staff asks…" |
| SM25 Direct membership and hierarchy | Done | #1630 | staff-write e2e "SM06 and SM25…" (teams kept, a supervisor loop refused); mock "SM06 and SM25…" |
| SM38 Audit and timestamps | Done | #1630 | staff-documents e2e (the import's audit names its file); mock "SM38: Staff Management times are in the firm's time zone" |
| SM20 Imported name preservation | Done | #1621 (db), #1630 | staff-write e2e "SM20 and SM21: a compound first name stays whole, and an invitation reads as sent only once emailed"; db `r60-staff-names` |
| SM21 Invitation status accuracy | Done | #1621 (db), #1630 | staff-write e2e "SM20 and SM21…"; invites e2e (the email's send on record) |
| SM15 Department counts | Done | #1636 | departments e2e (both counts on the detail and the list); mock `r60-staff-review2-b` "SM15: department and team counts name both the active and the assigned staff" |
| SM02 Custom role by Admin | Done | #1636 | custom-roles e2e "SM02: only what the granter has"; staff-write e2e "SM02: an Admin gives no cell they lack themselves…"; web unit `staff-grants-mock.test.ts`. Her retest as an Admin stays hers |
| SM08 Workload | Done | #1636 | team e2e "SM08: says what each person carries…"; web unit `workload.test.ts`; mock "SM08: assigning a client past someone’s maximum warns, and still assigns" |
| SM12 Sessions and last login | Done | #1636 | my-security e2e "SM12: a sign-in over the saved limit ends the oldest, audited; Last Login is the newest sign-in"; mock "SM12: Active Sessions marks this session on your own record only" |
| SM05, SM17, SM33, SM40 | Open | next PR | — |
| SM23, SM24, SM26, SM29, SM31, SM32, SM35, SM36, SM37, SM39, SM41, SM42, SM43 (PURPLE) | Her retest | — | — |
