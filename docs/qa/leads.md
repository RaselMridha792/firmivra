# Leads: Review Two QA (R55)

One line per row of the Leads Review Two table (Octavia, Nov 8; 46 rows): **PASS** with the merged PR(s) and the automated test that covers it; **PASS (manual)** when the change is merged but only checked by hand; **GAP** with why. R2 16 and R2 18 moved to R55 on Nov 14 and are in progress. API e2e tests are in `apps/api/test/e2e/`, mock specs in `apps/web/e2e/mock/`, and the tenant-isolation cases in `apps/api/test/isolation/cases/leads.ts`.

Short names: LP `leads-pipeline.e2e`, LPT `leads-pipeline-tabs.e2e`, LR2 `leads-review-two.e2e`, LRT `leads-routing.e2e`, LSQ `leads-sequences.e2e`, LFU `lead-follow-ups.e2e`, LC `lead-campaigns.e2e`, LBC `leads-bulk-convert.e2e`, LE `lead-email.e2e`, LTR `leads-transfer.e2e`, LRP `leads-reports.e2e`, BO `begin-online.e2e`.

| Row | Status | PR(s) | Test |
| --- | --- | --- | --- |
| 14 setup | Email: PASS on dev; SMS: pending carrier registration | #762, #1412 | `r56-communications.spec` (send a test). Dev email delivers to any address (SES production access); SMS goes to the log until the toll-free number is registered. |
| 14 test | PASS | #1059, #1070 | LC: Add to Campaign puts the leads in the audience and sends nothing; `r55-create-campaign.spec` |
| 20 | PASS | #1078 | LP: Staff and a Manager get 403 on delete and restore; Owner and Admin may |
| 24 | Covered by ACCESS-02 once it lands | #1089, #1082, #1113 | BO: starts a draft. Today the Begin Online link captures website leads; the intake share link and embed (ACCESS-02, R55) add a public form on the firm's own site. |
| 1 | PASS | #586, #769, #1035 | LP: counts the six cards; `r55-leads-overdue.spec` |
| 2 | PASS | #1035 | `r55-leads-overdue.spec`; `r55-lead-overview.spec` (an overdue follow-up is red) |
| 3 | PASS | #586, #769, #1098, #1107 | LP: creates leads in several stages; `r55-lead-create.spec` |
| 4 | PASS | #1030, #687 | `r55-lead-overview.spec`: the name and More > View open that lead's Overview |
| 5 | PASS | #586, #769, #1428 | LP: returns the profile after an edit; `r55-lead-contacts.spec` |
| 6 | PASS | #772, #687 | LPT: adds and lists notes; `r56-lead-tabs.spec` (Activity) |
| 7 | PASS (manual) | #586, #772 | LPT: logs a call. No calling integration: the call opens the phone and the outcome is logged by hand. |
| 8 | PASS | #1042, #1044, #1049 | LE: sends the cleaned HTML; `r55-lead-email.spec` |
| 9 | Email: PASS on dev; SMS: pending carrier registration | #1032 | `r55-lead-sms.spec`; LP: sends through NotifyService. Texts reach phones once the toll-free number is registered (dev logs them, #1412). |
| 10 | PASS | #769, #586 | LP: assigns, changes the stage and adds tags; LP: Staff see only their leads |
| 11 | PASS | #769, #586, #1377 | LP: closes the follow-up with a closed stage; LR2: R2 7 |
| 12 | PASS | #1048, #1050, #1058 | `r55-tags.spec`; `tags.e2e` |
| 13 | PASS | #1050, #1061 | `r55-add-tag.spec`; `tags.e2e` |
| 15 | PASS | #1303, #1364 | LFU: several steps at creation; `r55-lead-follow-ups.spec` |
| 16 | PASS | #1036 (with Arfan's #675, #689, #691, #693, #695) | `r55-lead-convert.spec`: edits the client, services, staff, carry-over and invitation |
| 17 | PASS | #772, #1036, #1108, #1435 | LPT: makes the client and carries notes and tags; LR2: R2 4 (files and tasks carried) |
| 18 | PASS | #769, #586 | LP: archives (kept, out of the table and cards) |
| 19 | PASS | #1075 | LP: archived leads only under Archived Leads, Restore; `r55-leads-archived.spec` |
| 21 | PASS | #586, #769, #1035, #1393 | LP: filters by stage, source, priority, staff, service, overdue, tag, date and search |
| 22 | PASS | #1098 | `r55-leads-search.spec`; LP: pages newest first |
| 23 | PASS | #769, #772, #1075, #1108 | LBC: converts each lead or skips with the reason; `r55-leads-archived.spec` (bulk restore) |
| 25 | PASS | #769, #1078 and each PR's isolation cases | LP: firm B reads and changes none of firm A's leads; `tenant-isolation.test` |
| 26 | PASS | #1080, #1083, #1108 | `r55-leads-preferred.spec`; `r55-lead-appointment.spec`. Booking an appointment for a lead before conversion is not built (appointments have no lead link). |
| R2 1 | PASS (manual) | #1393 | The list keeps its search, filters, page size and page in its address; no spec yet. |
| R2 2 | PASS | #1404, #1435 | LR2: R2 2 (the lead's own task); `r55-lead-tasks-files.spec` (Add Task opens on the lead and returns to it) |
| R2 3 | PASS | #1393, #1425 | `intake-link.e2e`; `r55-intake-link.spec` (the Back-to-lead link is checked by hand) |
| R2 4 | PASS | #1404, #1435 | LR2: R2 4 (kept internal at conversion); `r55-lead-tasks-files.spec` (Upload Document from the lead) |
| R2 5 | PASS | #1377 | LR2: R2 5 (the exact time kept through repeated saves) |
| R2 6 | PASS | #1393, #1435 | `r1-firm-leads-tasks.spec`: the leads table fits at 1440 px (pinned columns checked by hand) |
| R2 7 | PASS | #1377, #1428 | LR2: R2 7; `r55-tags.spec` (Edit Lead saves and the page shows it) |
| R2 8 | PASS | #1377, #1428 | LR2: R2 8; `r55-lead-contacts.spec` |
| R2 9 | PASS | #1404, #1428 | LR2: R2 9; `r55-lead-contacts.spec` |
| R2 10 | PASS | #1393 | `r55-leads-archived.spec` and `r55-leads-overdue.spec` (the active-filter chips) |
| R2 11 | PASS | #1377 | LR2: R2 11 (her messages, word for word) |
| R2 12 | PASS | #1393 | `r55-leads-archived.spec` (More Filters take effect on Apply) |
| R2 13 | PASS (manual) | #1377 | The reversed range says "End date must be on or after the start date"; no spec yet. |
| R2 14 | PASS (manual) | #1377 | Escape returns focus to Add New Lead (the dialog restores its opener); no spec yet. |
| R2 15 | PASS | #1439, #1442 | LR2: merges on purpose, and Not a duplicate; `r55-lead-merge.spec` |
| R2 16 | PASS | #1460 | LTR: a dry run checks each row and creates nothing; import creates only the new rows, skips possible duplicates or adds them for Review Duplicates, and a repeat creates none; export of the selected, filtered or all leads with the chosen columns, Staff only with Leads EXPORT; `r55-leads-import-export.spec` |
| R2 17 | PASS | #1439, #1447 | LRT: routes a new lead with no owner; `r55-lead-routing.spec` |
| R2 18 | PASS | #1467 | LRP: the funnel with each lead's history, closed and conversion, aging, every number's leads, the list's filters, Staff only their own; `r55-leads-report.spec` (from the summary cards and the Reports overview) |
| R2 19 | PASS | #1439, #1455 | LSQ: applies a sequence with the edited steps, once; `r55-lead-sequences.spec` |
