# Leads: Review Two QA (R55)

One line per row of the Leads Review Two table (Octavia, Nov 8; 46 rows): **PASS** with the merged PR(s) and the automated test that covers it; **PASS (manual)** when the change is merged but only checked by hand; **Merged; test gap** when the change is on main but no automated test checks all of the row yet; **Not built yet** with the workstream it is assigned to; **After Nov 17 (decided)** for work the lead moved past delivery. R2 16 and R2 18 moved to R55 on Nov 14 and are merged (#1460, #1467). Every open item is in the Gaps list at the end (Nov 15). API e2e tests are in `apps/api/test/e2e/`, mock specs in `apps/web/e2e/mock/`, and the tenant-isolation cases in `apps/api/test/isolation/cases/leads.ts`.

Short names: LP `leads-pipeline.e2e`, LPT `leads-pipeline-tabs.e2e`, LR2 `leads-review-two.e2e`, LRT `leads-routing.e2e`, LSQ `leads-sequences.e2e`, LFU `lead-follow-ups.e2e`, LC `lead-campaigns.e2e`, LBC `leads-bulk-convert.e2e`, LE `lead-email.e2e`, LTR `leads-transfer.e2e`, LRP `leads-reports.e2e`, BO `begin-online.e2e`.

| Row | Status | PR(s) | Test |
| --- | --- | --- | --- |
| 14 setup | Email: PASS (Firmivra Mail); SMS: not connected until the toll-free number is registered | #762, #1412, this PR | Campaigns could not be created on dev: only the local stand-ins were registered, so email answered CHANNEL_UNAVAILABLE. Now **Firmivra Mail** is every firm's built-in email channel, sent by our own mailer (SES) in the firm's name. The firm's connection is made by its first email campaign (a write), once, and shows as connected "Firmivra Mail" in Integrations and Communications. On this test site an email goes only to the firm's own team (an active member's login email, exactly) or an exact address in COMMUNICATIONS_TEST_RECIPIENTS. Everyone else is recorded "Held on this test site (not sent)" and never sent, and the builder and the results say so. Nothing is sent or enrolled when a campaign is created. Text messages say they are not available yet while the toll-free number is registered. e2e `communications-firmivra-mail` (4: ready with no account and a read makes nothing; the first campaign makes one connection in the firm's name; the team and listed addresses go while a gmail client and another firm's member are held; a disconnected one is not remade), unit `firmivra-mail` (live, hold, the list ignores domains). Mock `r55-firmivra-mail`. Dev: as `qa-owner-b`, make a lead with your own login email, add it to a new email campaign and send; it arrives, and any other address shows Held. |
| 14 test | PASS | #1059, #1070, this PR | LC: Add to Campaign puts the leads in the audience and sends nothing; `r55-create-campaign.spec`. On dev a campaign is created and sent through Firmivra Mail (14 setup), reaching only the firm's own team on the test site. |
| 20 | PASS | #1078 | LP: Staff and a Manager get 403 on delete and restore; Owner and Admin may |
| 24 | PASS | #1089, #1082, #1113, #1487, this PR | Website lead capture is an intake form's share link or website button (a plain link styled as a button, never an iframe), so it works on any site that takes a link or HTML: the share dialog's "How to add it to your website" says where to paste it on WordPress, Wix, GoDaddy and Shopify. No platform apps or plug-ins are needed. Integrations' Website & Lead Forms now says so and opens Intake Forms, with no connect step and no claim of a form endpoint. Mapping: the firm from the link, the contact from the start card, the service from the form, source Website Form, and the campaign from the link's utm_source, utm_medium and utm_campaign as the lead's source detail. A known email: once the visitor submits, the lead is listed in Review Duplicates (R2 15) beside the earlier one, never merged by itself, and the visitor is never told. While the form is only started (a draft), it is not yet a lead in the pipeline, so nothing is listed then. Failures: a dead link, the hourly cap and a bad entry each give the visitor a clear message. e2e `intake-share` (7): "a known email is a possible duplicate in the firm’s review once submitted; the campaign rides along" (a signed Tax Planning form, submitted), "a campaign that is not plain text is refused as a bad start", "refuses a honeypot, a made-up link, another firm, and a link turned off at once" and "takes at most its hourly cap of starts". Mock `r55-website-capture` (the visitor's messages, the guide, the Integrations card), `r55-intake-share`; BO: starts a draft. |
| 1 | PASS | #586, #769, #1035 | LP: counts the six cards; `r55-leads-overdue.spec` |
| 2 | PASS | #1035 | `r55-leads-overdue.spec`; `r55-lead-overview.spec` (an overdue follow-up is red) |
| 3 | PASS | #586, #769, #1098, #1107 | LP: creates leads in several stages; `r55-lead-create.spec` |
| 4 | PASS | #1030, #687 | `r55-lead-overview.spec`: the name and More > View open that lead's Overview |
| 5 | PASS | #586, #769, #1428 | LP: returns the profile after an edit; `r55-lead-contacts.spec` |
| 6 | PASS | #772, #687 | LPT: adds and lists notes; `r56-lead-tabs.spec` (Activity) |
| 7 | Not built yet (assigned to R55): Call logs the real outcome | #586, #772 | LPT: logs a call. Today Call opens the phone and logs "Called the lead" with no outcome. The telephony integration: After Nov 17 (decided). |
| 8 | PASS | #1042, #1044, #1049 | LE: sends the cleaned HTML; `r55-lead-email.spec` |
| 9 | Email: PASS on dev; SMS: pending carrier registration | #1032 | `r55-lead-sms.spec`; LP: sends through NotifyService. Texts reach phones once the toll-free number is registered (dev logs them, #1412). |
| 10 | PASS | #769, #586 | LP: assigns, changes the stage and adds tags; LP: Staff see only their leads |
| 11 | PASS | #769, #586, #1377 | LP: closes the follow-up with a closed stage; LR2: R2 7 |
| 12 | PASS | #1048, #1050, #1058 | `r55-tags.spec`; `tags.e2e` |
| 13 | PASS | #1050, #1061 | `r55-add-tag.spec`; `tags.e2e` |
| 15 | PASS | #1303, #1364 | LFU: several steps at creation; `r55-lead-follow-ups.spec` |
| 16 | PASS | #1036 (with Arfan's #675, #689, #691, #693, #695) | `r55-lead-convert.spec`: edits the client, services, staff, carry-over and invitation |
| 17 | After Nov 17 (decided): communications, appointments and campaign carried to the client | #772, #1036, #1108, #1435 | Done: LPT: makes the client and carries notes and tags; LR2: R2 4 (files and tasks carried). Not carried yet: communications, appointments and the campaign (`lead-convert.service.ts` counts them 0); they stay on the converted lead. |
| 18 | PASS | #769, #586 | LP: archives (kept, out of the table and cards) |
| 19 | PASS | #1075 | LP: archived leads only under Archived Leads, Restore; `r55-leads-archived.spec` |
| 21 | PASS | #586, #769, #1035, #1393 | LP: filters by stage, source, priority, staff, service, overdue, tag, date and search |
| 22 | Not built yet (assigned to R55): search matches the campaign | #1098 | `r55-leads-search.spec`; LP: pages newest first. Search matches the name, business, email, phone, source, source details and notes. **Test gap:** R60 adds a multi-page navigation check after the product items (Nov 15). |
| 23 | PASS | #769, #772, #1059, #1075, #1108 | LP: assigns, changes the stage and adds tags to the leads the member reaches; LC: Add to Campaign puts the leads in the audience; LBC: converts each lead or skips with the reason; `r55-leads-archived.spec` (bulk restore) |
| 25 | PASS | #769, #1078 and each PR's isolation cases | LP: firm B reads and changes none of firm A's leads; `tenant-isolation.test` |
| 26 | After Nov 17 (decided): appointments for leads | #1080, #1083, #1108 | Done: `r55-leads-preferred.spec`; `r55-lead-appointment.spec` (the dialog shows the lead's phone and email). Booking for a lead that is not yet a client is refused (appointments have no lead link), so no appointment or its activity is saved on the lead. |
| R2 1 | PASS (manual) | #1393 | The list keeps its search, filters, page size and page in its address; no spec yet. |
| R2 2 | PASS | #1404, #1435 | LR2: R2 2 (the lead's own task); `r55-lead-tasks-files.spec` (Add Task opens on the lead and returns to it) |
| R2 3 | Merged; test gap | #1393, #1425 | `intake-link.e2e`: a lead's secure link is emailed, opened, saved and signed; `r55-intake-link.spec`: the lead opens it signed out. Neither opens Send Intake Form from a lead (the lead preselected, Back to the lead). **Test gap:** R60 adds the check after the product items (Nov 15). |
| R2 4 | PASS | #1404, #1435 | LR2: R2 4 (kept internal at conversion); `r55-lead-tasks-files.spec` (Upload Document from the lead) |
| R2 5 | Merged; test gap | #1377 | LR2: R2 5 (the API keeps the exact time through repeated saves). No spec opens the follow-up editor on a saved time. **Test gap:** R60 adds the check after the product items (Nov 15). |
| R2 6 | Merged; test gap | #1393, #1435 | `r1-firm-leads-tasks.spec`: the leads table fits at 1440 px. Narrower windows and the pinned select, name and action columns are not checked. **Test gap:** R60 adds the check after the product items (Nov 15). |
| R2 7 | Merged; test gap | #1377, #1428 | LR2: R2 7 (the API answers with the new status, audited with it). No spec changes a status on the lead page and checks the saved message and the new status. **Test gap:** R60 adds the check after the product items (Nov 15). |
| R2 8 | PASS | #1377, #1428 | LR2: R2 8; `r55-lead-contacts.spec` |
| R2 9 | PASS | #1404, #1428 | LR2: R2 9; `r55-lead-contacts.spec` |
| R2 10 | Merged; test gap | #1393 | `r55-leads-archived.spec` and `r55-leads-overdue.spec`: an active-filter chip shows and its own Remove clears it. Removing one of two active filters while the other stays is not checked. **Test gap:** R60 adds the check after the product items (Nov 15). |
| R2 11 | PASS | #1377 | LR2: R2 11 (her messages, word for word) |
| R2 12 | Merged; test gap | #1393 | `r55-leads-archived.spec`: Archived Leads takes effect after Apply. The list staying the same while choices are pending, and several choices applied together, are not checked. **Test gap:** R60 adds the check after the product items (Nov 15). |
| R2 13 | PASS (manual) | #1377 | The reversed range says "End date must be on or after the start date"; no spec yet. |
| R2 14 | PASS (manual) | #1377 | Escape returns focus to Add New Lead (the dialog restores its opener); no spec yet. |
| R2 15 | PASS | #1439, #1442 | LR2: merges on purpose, and Not a duplicate; `r55-lead-merge.spec` |
| R2 16 | PASS | #1460 | LTR: a dry run checks each row and creates nothing; import creates only the new rows, skips possible duplicates or adds them for Review Duplicates, and a repeat creates none; export of the selected, filtered or all leads with the chosen columns, Staff only with Leads EXPORT; `r55-leads-import-export.spec` |
| R2 17 | PASS | #1439, #1447 | LRT: routes a new lead with no owner; `r55-lead-routing.spec` |
| R2 18 | PASS | #1467 | LRP: the funnel with each lead's history, closed and conversion, aging, every number's leads, the list's filters, Staff only their own; `r55-leads-report.spec` (from the summary cards and the Reports overview) |
| R2 19 | PASS | #1439, #1455 | LSQ: applies a sequence with the edited steps, once; `r55-lead-sequences.spec` |

## Gaps (Nov 15)

Not built yet, assigned to R55:

- 14 setup and 14 test: an SES-backed email campaign channel, safe on dev (Nov 15).
- 7: Call logs the real outcome.
- 22: search matches the campaign.

After Nov 17 (decided):

- 14: text (SMS) campaigns. The toll-free number is not registered yet, so no real text can go out; R55 makes the readiness reason say so plainly.
- 7: a telephony integration.
- 17: communications, appointments and the campaign carried to the client on conversion.
- 26: appointments for leads before conversion, with their activity on the lead.

Test gaps, R60 (after the product items, Nov 15):

- 22: moving across several pages of leads.
- R2 3: Send Intake Form from a lead preselects that lead and returns to it.
- R2 5: the follow-up editor opens on the saved time.
- R2 6: the table at a narrower window, with the pinned columns.
- R2 7: a status saved on the lead page shows the saved message and the new status.
- R2 10: removing one active filter keeps the others.
- R2 12: More Filters choices wait for Apply and apply together.
