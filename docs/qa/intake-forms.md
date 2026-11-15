# Intake Forms: Review Two QA map

This file maps every row of Octavia's Intake Forms Review Two (Nov 10, 2026) to the PR that built it and the test that covers it, or marks it as a **GAP**. That means her consolidated register: source items 1 to 24 with their sub-items, and the eleven INTAKE and DOCUMENTS rows. Her review and checklist are kept privately, outside the repo. Rows are named by their IDs and headings only; her text is not copied here.

Her status is in the second column. "Her retest" means her Review Three check of something built (live delivery, encryption, roles, history), not open code work. R1's I3 rows (10c, 14b, DOCUMENTS-LIMIT-01) are filled in by #1525.

**Where the tests are**
- API e2e: `apps/api/test/e2e/` `intake-workspace`, `intake-workspace-actions`, `intake-link`, `intake-link-uploads`, `intake-share`, `intake-self-service`
- db: `packages/db/test/review-two-schema.test.ts`, `lead-link-uploads.test.ts`, `intake-schedule.test.ts`, `intake-engine.test.ts`
- Mock specs: `apps/web/e2e/mock/` `r60-intake-settings`, `r1-intake-i3`, `r22-intake-forms`, `r1-intake-i2a`, `r1-intake-i2b`, `r56-intake-detail`, `r55-portal-assigned-intake`, `r55-intake-link`, `r55-intake-share`, `tumit-intake-send`, `r60-intake-layout`

## Consolidated register: items 1 to 24

| Row | Her status | Code status | PR | Test |
| --- | --- | --- | --- | --- |
| 1 Builder settings | Historically passed | Done | before Review Two | Mock `tumit-intake-builder`; her Review Three retest |
| 2 Notification settings | Historically passed | Done | before Review Two | Mock `r60-intake-settings`; live delivery is row 22 |
| 3 Automation settings | Historically passed | Done | before Review Two | Mock `r60-intake-settings`; execution is row 23 |
| 4 Branding | Scoped recheck | Done | before Review Two | Mock `r60-intake-settings` "each Edit opens its category's panel, and Branding opens Settings" |
| 5 Security settings | Historically passed | Done | before Review Two | Mock `r60-intake-settings`; enforcement is rows 12b and 23 |
| 6 Navigation and previews | Scoped recheck | Done | before Review Two | Mock `tumit-intake-preview` |
| 7 Search and send setup | Scoped recheck | Done | before Review Two | Mock `r22-intake-forms`, `tumit-intake-send` |
| 8 Settings Edit panels | Fixed | Done | before Review Two | Mock `r60-intake-settings` "each Edit opens its category's panel ..." |
| 9a Additional email controls | Fixed | Done | before Review Two | Mock `r60-intake-settings` "additional emails to notify are added, checked, removed and saved (I7)" |
| 9b Submission notifications | Deferred (Review Three) | Done; her retest | #1407, #1425 (submit) | A client's and a lead's submit both send the submission notice (`submitted-notice.ts`); she deferred its delivery check until access was fixed |
| 10a Reminder timing options | Verified | Done | before Review Two | Mock `r60-intake-settings` "the first reminder counts from sending, the final back from the expiry, ..." |
| 10b First 30 days | Correction | Done | #1398 | The First reminder offers 30 days |
| 10c Final 5 minutes | Correction and clarification | Done | #1491 (db), #1514 (the schedule), #1525 (settings and screens) | The final reminder counts back from the expiry, so both lists offer 5 minutes and neither depends on the other; a form with no expiration gets the first only. e2e `intake-workspace` "No reminders saves as off ... (I8, I9, 10c)" (5 and 5 minutes, 30 days and 1 day taken); e2e `intake-workspace-actions` "the intake schedule ..." (#1514, the final at expiry minus its time); mock `r1-intake-i3` "10c: ..." (both), `r60-intake-reminders` (Reminder Schedule) |
| 11 Expiration alert choices | Verified | Done | before Review Two; the alert is sent by #1514 | Mock `r60-intake-settings` "No alert and an alert 30 minutes before expiry save (I9)"; e2e `intake-workspace-actions` (#1514) |
| 12a Intake size persistence | Fixed | Done | before Review Two | Mock `r60-intake-settings` |
| 12b Intake upload limits | Pending | Done; her retest | #1407, #1479 | e2e `intake-link-uploads` (over the limit refused, the slot cap); the client's uploads through the assigned form (#1407) |
| 13a Encryption wording | Verified | Done | before Review Two | Mock `r60-intake-settings` |
| 13b Encryption protection | Pending | No code gap; her verification | | Uploads use per-business storage prefixes and per-business KMS keys (docs/SYSTEM-DESIGN.md) |
| 14a Custom retention years | Fixed | Done | before Review Two; #1525 | Mock `r60-intake-settings` "a data retention period in years saves, and can be cleared (I12, 14b)". Since 14b it is Apply to all, 1 to 30 years; a value saved before over 30 is read and shown as it is |
| 14b Retention model | Required correction | Done (settings); deletion and enforcement are not built | #1404 (db: retention minimums), #1525 | Six categories, each 1 to 30 years or not set, and Apply to all (fills the six; an empty category uses it). Each says what it covers and that its clock starts at the record's job or task completion; nothing is deleted or archived. A record with no job or task is kept and not counted: her open decision. e2e `intake-workspace` "14b: keeps six category minimums ..." (apply to all, own values, what is in effect, reload, refusals, Staff 403, nothing deleted, firm B) and "saves a data retention period ..." (a saved 50 read, never blocking another save); unit `packages/types` workspace test; mock `r1-intake-i3` "14b: ..." (`retention.png`) |
| 15a Current Submission Rules | Fixed | Done | before Review Two | Mock `r60-intake-settings` |
| 15b Original shortcut | Deferred retest | No code gap; her retest | | The old "Go to Settings" shortcut no longer exists in the app; Submission Rules opens directly (15a) |
| 16 Test Reminder Email | Open, deferred | Done | before Review Two; #1523 | The destination shows before the click (the member's own address from the session). Mock `r60-intake-settings` "Test Reminder Email says where it went ..."; e2e `intake-workspace` (Owner/Admin send, Staff 403). Her production retest is deferred; the Owner's own Work Email edit is Staff Management, after Nov 17 |
| 17a Publish title validation | Fixed | Done | before Review Two | Mock `tumit-intake-builder` "an empty Form Name blocks Publish Form with the field error" |
| 17b Published QA state | Fixed | Done | before Review Two | Client access is INTAKE-ACCESS-01/02 |
| 17c Dashboard create route | Correction | Done | #1398 | Create Intake Form asks which service the blank form is for and opens the builder |
| 18a Fresh duplicate draft | Verified | Done | before Review Two | Mock `tumit-intake-templates` "a duplicate stays in the library as a draft and in the numbers" |
| 18b Current library counts | Fixed | Done | before Review Two | Mock `tumit-intake-templates` "shows the numbers, the eight template cards ..." and the duplicate case |
| 18c Historical record audit | Pending | No code gap; her audit | | |
| 18d Copy and Overview fidelity | Correction | Done | #1517 | e2e `intake-workspace-actions` "18d: a copy keeps every question, the description, the settings, the notes and the default assignee, and stays its own form"; mock `r1-intake-i2b` |
| 19a App send and records | Verified | Done | before Review Two | Mock `tumit-intake-send` |
| 19b Intake email receipt | Required investigation | Done | #1490 | e2e `intake-workspace-actions` (the exact-form link, a SENT outbox row, a refused reminder left FAILED with its reason, no email for a Portal send) |
| 19c Portal notifications | Verified | Done | #1407 (the notice opens the form) | Mock `r55-portal-assigned-intake`; the `notificationLink` unit check |
| 20 Publish and distribution | Partially corrected | Done | #1481, #1487, #1497 | See INTAKE-ACCESS-02 |
| 21 Recipient workflow | Partial and blocked | Done | #1407, #1425, #1490 | See INTAKE-ACCESS-01 and 19b |
| 22 Reminder delivery | Pending live test | Done; her live test | #1491 (db), #1514 | e2e `intake-workspace-actions` (first and final reminders, the expiration alert and Expired, each once, with the stop rules); db `intake-schedule` |
| 23 Automation and security | Pending live test | No code gap; her live test | | Isolation cases `intake-forms`, `intake-link`, `intake-workspace`, `intakes`. Operational retention is 14b (I3) |
| 24a Dashboard snapshot | Verified | Done | before Review Two | Mock `r22-intake-forms` |
| 24b Notes and PDF export | Pending | Done; her retest | #1496 (a clear Export PDF failure) | Mock `r1-intake-i2a`; the PDF itself is her retest |
| 24c Other baseline actions | Pending | No code gap; her retest | | |

## INTAKE and DOCUMENTS rows

| Row | Her status | Code status | PR | Test |
| --- | --- | --- | --- | --- |
| INTAKE-ACCESS-01 Exact assigned form | Required correction | Done | #1407, #1425, #1471, #1479 | Mock `r55-portal-assigned-intake` (the client opens the exact form from its email, its portal notice or Intake Forms, fills, signs and submits); e2e `intake-link` and `intake-link-uploads` (a lead's secure link: open, save, upload, sign, submit; another firm, a made-up token, a resend, an expired link); db `lead-link-uploads` |
| INTAKE-ACCESS-02 Publication and self-service | Required correction | Done | #1404 (db), #1481 (db), #1487, #1497 | e2e `intake-share` (a stable share link and a button, not an iframe; Publish in client portal, off by default); e2e `intake-self-service` (a portal-published form for every client, started on a PENDING service); db `intake-engine`; mock `r55-intake-share` |
| INTAKE-EXPIRY-01 Expiry timestamp and clarity | Required correction | Done | #1496 | e2e `intake-workspace-actions` (later than now, on its field; the default at 11:59 PM in the firm's time zone); mock `r1-intake-i2a` |
| DOCUMENTS-LIMIT-01 Regular Documents limit | Required correction | Done | #1404 (db: the documents size limit), #1525 | Documents > Settings > File Settings offers 5, 10, 20, 30, 50 or 100 MB (100 by default). Every regular upload ticket refuses a bigger file (400 at `sizeBytes`, "Files can be at most 20 MB"): the library, a client's documents page and the client portal. Intake forms keep their own limit; Forms & Documents > Allowed Files names both and where each is set. e2e `documents-library` "DOCUMENTS-LIMIT-01: ..." (save and reload, refusals, limit + 1 byte refused and the limit taken, firm B), `documents-portal` "DOCUMENTS-LIMIT-01: ..." (portal and client page); mock `r1-intake-i3` "DOCUMENTS-LIMIT-01: ..." (`documents-file-settings.png`) |
| INTAKE-USABILITY-01 Visible date labels | Required correction | Done | #1398 | The date fields read "Date Sent: From" and "To" |
| INTAKE-USABILITY-02 Preserve search on return | Required correction | Done | #1398 | The dashboard keeps its search when you come back |
| INTAKE-USABILITY-03 Direct form management | Required correction | Done | #1496 | Assign Staff, Extend Expiration, Duplicate and Archive on the form and its row; mock `r1-intake-i2a` |
| INTAKE-USABILITY-04 Export failure feedback and context | Required correction | Done | #1496 | A failed Export PDF stays on the intake and says what to do; mock `r1-intake-i2a` |
| INTAKE-DESIGN-01 Compact client summary | Approved design correction | Done | #1517 | Mock `r1-intake-i2b` (`client-summary.png`) |
| INTAKE-DESIGN-02 Fit list space to results | Approved design correction | Done | #1517 | The list fits its results; the side column's height is unchanged, as she asked for no column redesign. Mock `r1-intake-i2b` (`list-1165.png`, `list-1440-one.png`) |
| INTAKE-DESIGN-03 Keep Actions visible | Approved design correction | Done | #1517 | Actions stay in view while the other columns scroll; mock `r1-intake-i2b` |

## From her checklist's pending list

| Item | Status | PR | Test |
| --- | --- | --- | --- |
| Mobile layout: developer to verify, then Octavia to check | Done (developer check) | #1528 | Mock `r60-intake-layout`: list, templates, detail (overview, responses, documents, history), send, settings, builder (questions, logic, preview) at 768, 1165 and 1440 with the sidebar expanded and collapsed, then 390. No sideways scroll and no text out of its box at any of them |

## GAPs

None. The two found on Nov 15 are closed: row 16's destination before sending (#1523) and the developer's mobile layout check (#1528).

**After Nov 17 (the lead's list).** The Owner editing their own Work Email is Staff Management, and she deferred it to production Review Three.
