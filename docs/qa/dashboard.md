# Dashboard: Review 2 QA map

This file maps every row of Octavia's Dashboard Review 2 (the Developer Working Guide of Nov 2, 2026 and its comprehensive companion) to the PR that changed it and the test that covers it. A row that needed no code instead gets the exact steps on dev that show it, and a row still open is a **GAP** with a plan. **Built (test gap)** means the code is in but part of it is not yet under a test. The reports are kept privately, outside the repo; rows are named by their IDs and headings only.

**Where the tests are**
- API e2e: `apps/api/test/e2e/`
- Mock specs: `apps/web/e2e/mock/`
- db tests: `packages/db/test/`
- Isolation: `apps/api/test/isolation/` (every firm route, both firms)

**Steps on dev.** Use `https://app.dev.firmivra.com` with the QA logins Rasel hands over: `qa-owner-b@`, `qa-admin-b@` and `qa-staff-b@dev.firmivra.com` (all in Test Firm B), `qa-client-b@dev.firmivra.com` (a Test Firm B client, at `https://portal.dev.firmivra.com/test-firm-b`) and `qa-superadmin@dev.firmivra.com` (`https://admin.dev.firmivra.com`). Staff logins set up an authenticator at their first sign-in. Your own LVP login is the second firm for the multi-firm rows. QA seed part 4 (#1463) gave Test Firm B twelve appointments, 2 to 16 days after Nov 14, for a synthetic client. They are already marked reminded, so nothing is emailed by itself.

**Definitions the rows ask for**
- **Time zone (U2):** the firm's time zone in Settings > Preferences is the one rule. The header clock, the dashboard's date, "today", every period's first and last day, and the due labels all use it. The browser's own zone is not used in the firm workspace, with one exception: when the firm's time zone cannot be read, the header clock shows the browser's and says "Using your device's time zone" (see U2). The Super Admin console belongs to no firm and shows the person's own zone.
- **Periods (C1, V2):**
  - The Dashboard period drives Total Clients, New Leads and the service cards. Outstanding Invoices and Appointments Today are always as of today.
  - Client Pipeline has its own period for Leads and Accepted; Intake and In Progress are open now.
  - Revenue Overview and Service Breakdown share their own period.
  - This month, quarter and year run to date. Last month and last year are the whole period. Comparisons are against the equivalent elapsed period before. A Custom start must be on or before its end, and the end may not be after today.
- **A past period (K1, K4, V1):** a card for a period that ended before today counts the books as they stood at its last day. Clients count if they were added by then and not archived then. A status is the one the history gives at that moment. Its list opens with `asOf` on that day and shows the same records.
- **In progress (K4):** In Preparation, Waiting on Client, Ready for Review, Ready for Signature and Ready to File.
- **Intake (C5, DATA1):** every intake form, a client's or a lead's, that is not finished: sent, in progress, to correct, submitted or under review. It is exactly what Intake Forms' Not Finished filter lists, in the same reach for Staff.
- **Revenue (C3, V3):** money received, by the firm's calendar day:
  - online payments on the day paid, less refunds on the day they are confirmed;
  - checks and cash on the day received;
  - a voided payment never counts.
  - Service Breakdown splits the same money by the service of the invoice's engagement. "Other" means an invoice of no engagement.
  - A bar or a slice opens All Payments for the same days (and service).
  - **Refunds (decided Nov 15):** a refund counts on the day it is confirmed, in every period total, on the dashboard and in All Payments alike; All Payments shows the payment whole on its day and each confirmed refund as its own Refunded row (a negative amount) on its day, and Payment Methods takes it off on that day too (#1564).
- **Refresh (V4):** the dashboard reads its numbers when it opens (a copy at most 30 seconds old is reused), when a period changes, and after an action taken on it (completing a task, cancelling or completing an appointment, sending a reminder). There is no live push; Reload always shows the latest. Each firm's cache is its own: the data cache is emptied when another person signs in on the tab.
- **Phone (R2 NEW2):** NEW2 supersedes Overview item 20's self-service phone. An employee no longer changes their own number. The firm's Owner sets it in Edit Staff as the firm's own number for them, and the employee proves it with a code. The Owner still changes their own number on My Profile.
- **Name (R2 NEW2, decided Nov 15):** an employee's name is their own sign-in identity across firms. The employee changes it in Profile; the Owner does not.

## Header and global controls

| Row | Status | PR | Test or steps |
| --- | --- | --- | --- |
| U2: clock vs Preferences | Built (test gap) | #1452, #1564 | `r1-dashboard-return` "the header clock shows the firm's time zone, not the browser's (U2)" (a Central-time browser, a New York firm). The API's "today" and every period use the firm's zone in code, but every test firm keeps New York. When the firm's time zone cannot be read, the clock shows the device's and says so, "Using your device's time zone" (#1564, mock `r55-header-clock-fallback`). Dev: Settings > Preferences, choose Central Time and Save; the header clock changes to CST at once. **Test gap:** R60 adds the check after the product items (Nov 15). |
| N1: reminder visibility | Evidence | (earlier) #1148 | `r60-dashboard-lists` "opening the bell marks the notifications it shows as read". Dev: as `qa-owner-b`, open the bell. Opening it marks the items it shows as read. |
| N2: read state, badge after reload, history | Evidence | #1148 | Same spec. Dev: open the bell, reload: the badge stays down, and the list keeps the items. |
| N3: notification opens the exact appointment | Evidence | #1148 | Dev: an appointment notice in the bell opens that appointment, and the appointment page checks access again. A fixture notice is not seeded: one appears when an appointment is booked or rescheduled for `qa-owner-b`. |
| D3: report a problem | Evidence | (earlier) | The approved helper text is word for word. Report a Problem opens your own email app with the firm name and the page only: you review it there and attach what you choose. No secrets or record contents are added. Dev: ? > Report a Problem. |
| R2 NEW1: profile menu dismissal | Done | #1452 | `r1-dashboard-return` "the profile menu closes on a click outside and on Escape after focus left it (R2 NEW1)" |
| R2 NEW2: Owner profile editing | Done | #1459 (schema), #1461 | `staff-phone.e2e` "Dashboard Review 2 (R2 NEW2): My Profile" (both tests); `staff-write.e2e` "keeps the member's phone as the firm's own number, set by the Owner only"; `r1-my-profile-edit`. Decided, no build: an employee's name is their own sign-in identity across firms; the employee changes it in Profile, not the Owner (Edit Staff refuses a name change, `staff-write.e2e` "refuses a change of the person's name or email…"). |
| Tax season context | Done | #1475, #1477 | The season is the firm's setting (System Preferences, Tax Season: two days, every year in the firm's time zone, both or neither), never hard-coded. The dashboard shows Tax Season or Off-Season (with the next season) beside the company-local date. `dashboard.e2e` "shows the firm's tax season from its settings…" (in season, off season, across Jan 1, each firm its own); `settings.e2e` "keeps the tax season…"; unit `tax-season.test`; mock `r1-tax-season`. Dev: `qa-owner-b` (Test Firm B, Jan 15 to Apr 15 from QA seed part 5) sees Off-Season, next Jan 15 – Apr 15, 2027. On LVP, with no season set, an Owner or Admin sees "Set your tax season in Settings". |

## KPI cards and trends

| Row | Status | PR | Test or steps |
| --- | --- | --- | --- |
| K1: historical Total Clients | Done | #1449 | `dashboard.e2e` "opens Total Clients on the clients it counts, for a past period too"; `r1-dashboard-return` "a past period's Total Clients opens the books at its end; Show today clears it (K1)" |
| K2: keep the period on Back | Built | #1443, this PR | `r1-dashboard-return` "a card keeps the chosen period: Back to Dashboard returns to it" (the period). The scroll position: `r56-dashboard-review2` "K2, V9, R2 NEW6: Back to Dashboard returns to the same place on the page" (this PR). |
| K4: In Progress with the period | Done | #1449 | `dashboard-cards.e2e` "opens each card on the list as it stood at the period end, the same number"; `r1-dashboard-return` "Tax Returns shows a past period's statuses as they stood then (K4)" |
| K8: trend calculation | Evidence | (earlier), this PR | `dashboard.e2e` "counts the cards for the global period and its equivalent period before"; `r31-dashboard` "every widget of the design, with trends only where the API gives the period before"; a fall: `r56-dashboard-review2` "K8: a number that fell says Down with the percentage, and that it is unfavourable" (this PR). |
| V2: periods and boundaries | Evidence | #1443 | `dashboard.e2e` "refuses a Custom period without both days, ending after today or backwards", "gives Revenue Overview by month, quarter, year or Custom days, with the span before"; `r55-dashboard-periods` (all three) |
| Color system: text with every color | Evidence | (earlier) | Trends always carry words (Up/Down with the percentage, favourable or unfavourable, New, No change, N/A); `r31-dashboard` |

## Client Pipeline, Revenue, Service Breakdown

| Row | Status | PR | Test or steps |
| --- | --- | --- | --- |
| C5: Intake opens its filter | Done | #1443 | `dashboard.e2e` "counts each pipeline stage as the list it opens shows it" (client and lead forms, Owner and Staff); `r1-dashboard-return` "the Intake stage opens Not Finished as the selected filter" |
| C6: live stage counts | Evidence | #1443 | Same e2e for every stage and three periods. Dev: as `qa-owner-b`, send an intake form to a Test Firm B client; Intake grows by one on the next dashboard visit. |
| R2 NEW4: Pipeline Custom layout | Done | #1450 | `r1-dashboard-charts` "Custom keeps each title beside its dropdown, with whole date pairs below" at 1440 and 390 px |
| C2: revenue bar drill-down and hover | Done | #1450, #1564 | `r1-dashboard-charts` "a revenue bar shows its value on hover and opens the payments of its days"; `dashboard.e2e` "opens each revenue bar and each service on the payments that make it up"; `invoice-payment-methods.e2e` "the dashboard, All Payments and Payment Methods agree on the payment day, the refund day and both" (a card payment with a refund confirmed three days later: each day's bar, All Payments and Payment Methods match); mock `r55-payments-refund-day`. |
| C3: revenue source | Done | (earlier), #1564 | See Revenue above; `dashboard.e2e` "adds up this year's money by month and by service" (cash fixtures only); unit `dashboard.test` "subtracts refunds, and leaves a service at or below zero out of the breakdown"; the refund rule: `invoice-payment-methods.e2e` "the dashboard, All Payments and Payment Methods agree on the payment day, the refund day and both". |
| R2 NEW3: Revenue Custom layout | Done | #1450 | `r1-dashboard-charts` (Custom, 1440 and 390 px; screenshots in `apps/web/e2e/screenshots/r1-dashboard-charts/`) |
| C4: service segment drill-down | Done | #1450, #1564 | `r1-dashboard-charts` "a service's line shows its amount and opens that service's payments"; `dashboard.e2e` as for C2. A refund confirmed on a later day: as C2. |
| V3: totals, hover, attribution | Done | #1450, #1564 | As C2 and C4, the refund rule included. |
| R2 NEW5: Service Breakdown Custom layout | Done | #1450 | `r1-dashboard-charts` (Custom) |
| DATA1: Intake mapping, Other revenue | Done | #1443, #1450 | See Intake and Revenue above |

## Messages, Tasks, Appointments

| Row | Status | PR | Test or steps |
| --- | --- | --- | --- |
| T1: message previews and View All | Built | #1443, this PR | View All: `r60-dashboard-links` "Recent Messages, View All opens /messages?from=%2F". A preview opens that client's conversation with `from=` and Back to Dashboard: `r56-dashboard-review2` "T1, B07: a message preview opens that client's conversation, with Back to Dashboard" (this PR). The unread count is the thread's own (`unreadCount` from the message threads list, the same the conversation list reads). Dev: send a message from the portal as `qa-client-b`, then open its preview as `qa-owner-b`. |
| T2: Tasks Due View All | Done | #1443, #1564 | `dashboard.e2e` "T2: Tasks Due and its View All list the same tasks; an archived one is in neither" (an archived open task due today is in neither, nor in a client's open tasks); `tasks-work.e2e` "filters, sorts, searches and pages the table" (`dueSet`); `r1-dashboard-return` "Tasks Due View All opens the widget's tasks…". |
| R2 NEW7: Tasks origin label | Done | #1443 | `r1-dashboard-return` "Tasks Due View All…" (Back to Dashboard, no Home crumb) and "Tasks opened from the sidebar shows no origin" |
| T5: completion asks first | Evidence | #1148 | `r60-dashboard-lists` "a task title opens that task; the client is its own link; completing asks first" (Cancel leaves it, Mark Complete completes it once) |
| T6: completed task moves to Done | Built | #1148, this PR | `dashboard.e2e` "T6: a task completed leaves Tasks Due at once and is Done, not deleted" (this PR). Dev: complete one; it leaves Tasks Due and shows in Tasks > Completed Tasks. Nothing is deleted. |
| T7: all-day vs timed | Evidence | (Tasks), this PR | An all-day task has no time. Switch All Day off in New Task to set Due Time (5:00 PM is only the starting value). A days reminder goes out at its own time, or at 9:00 AM in the firm's time zone when it has none (an all-day task's too); a Custom reminder counts back from the due time. A reminder more than an hour past its moment never goes: `notify-jobs.e2e` "an all-day task: a same-day reminder goes at 9:00 firm time; more than an hour late, never" (this PR). |
| Reminder delivery (section 9) | Built | this PR | The task page's Reminders card has a Reminder history (`GET /business/tasks/{id}/notices`): who reminders reach (the assignee and additional assignees, or with none the member who made the task; never the client), when each goes next in the firm's time zone, and each one that went out: when, to whom, for which due moment, whether the bell item was read, and its email copy's delivery (Queued, Sent, Failed with tries and a short provider code, or Skipped; the provider's message id). A reminder with the bell switched off is emailed directly and leaves no per-person record; the history says so. Tests: `notify-jobs.e2e` "Dashboard Review Two §9: the task's reminder history names who got each one, how and when" (after a real reminder run) and the all-day test under T7; `r56-dashboard-review2` "§9: a task's page shows its reminder history". Her own task of Nov 1 got nothing because task reminders were not sent before Nov 16 (Tasks T-D12) and they reach staff, not the client. Still hers to decide: whether a client-visible task's reminder should also reach the client. |
| A1: upcoming fixture and View All | Done (dev: needs a seed run) | #1463, #1564 | `seed-qa-appointments.test` "rolls: once one has gone past, a re-run puts them back on the plan from today, ours only". The QA seed rolls: a re-run puts its still-scheduled fixed-id appointments 2 to 16 days from the run day (cancelled ones and every other row stay as they are). Dev: after the QA seed task runs again, as `qa-owner-b`, Dashboard > Upcoming Appointments lists the seeded rows; View All opens Appointments with Back to Dashboard. |
| A2: row opens the exact record | Done | #1443, #1463 | `r60-dashboard-lists` "an appointment row opens that appointment, with its menu and a scrolling list" |
| A3: menu by permission, Cancel asks | Built (test gap) | #1443, #1463 | Same spec, as the Owner (all seven actions, the Cancel dialog). The menu offers the changing actions only to a role that may edit appointments, and Open Client only to one that may view clients, by the role's own grid (`lists.tsx`); no test runs it as another role yet. Dev: compare `qa-owner-b` and `qa-staff-b`. **Test gap:** R60 adds the check after the product items (Nov 15). |
| A4: long list | Done (dev: needs a seed run) | #1463, #1564 | Same spec (scrolls, keyboard focusable). Dev: Test Firm B lists its seeded appointments of the next 14 days (eleven at most). The rolling QA seed: as A1 (#1564). |

## Quick actions, customization

| Row | Status | PR | Test or steps |
| --- | --- | --- | --- |
| Q3: straight to the composer | Done | #1458 | `r60-dashboard-quick` "Send a Message opens a new message, and Bulk Email opens its composer, saving nothing"; `r1-dashboard-return` "Create Bulk Email opens the composer; its first save makes the draft and keeps Back (Q3)" |
| D1: client form validation | Evidence | (Clients) | Dev: Add Client, switch to Business and leave the business name empty; Save is refused with the field marked, and nothing is saved. |
| D4: service-card templates | Evidence | (earlier) | `dashboard-cards.e2e` (all); `r60-dashboard-cards`. Dev: Settings > Dashboard Cards as `qa-owner-b`. |
| D5: fixed cards, Accepted only | Evidence | (earlier) | `dashboard-cards.e2e` "shows Returns In Progress and Accepted Returns, the same numbers as the KPIs", "refuses choices that do not fit, and a label that would disguise the count" |
| OPT1: blank Custom cue | Not approved | | Left as is until approved. |

## Data, states, permissions, multi-firm, security

| Row | Status | PR | Test or steps |
| --- | --- | --- | --- |
| C1: period controls, Custom validation, return | Done | #1443 | `r55-dashboard-periods` "a Custom period applies only a valid pair of dates and explains a bad one"; `r1-dashboard-return` (period kept on Back) |
| V1: metric to list reconciliation | Built (test gap) | #1443, #1449, #1450 | Total Clients, the pipeline, the service cards, the bars and the services each match their list for the Owner and Staff (the tests above). Outstanding Invoices and Appointments Today are not compared with their lists yet, and no test compares Reports totals. **Test gap:** R60 adds the check after the product items (Nov 15). |
| V4: refresh | Evidence | | See Refresh above. Dev: complete a task on the dashboard; Tasks Due drops it at once. A task added in Tasks shows on the next dashboard visit. |
| V6: loading, empty, error | Built | (earlier), #1476, this PR | Each widget has its own loading, empty and error state with Try again (`widget.tsx`). #1476 gives the KPI row its own error and Try again (it showed skeletons for ever) and adds fault injection in mock mode (`failable` in `lib/mock.ts`). `r1-dashboard-failures` fails each call in turn (the summary, messages, appointments, the firm's time zone): the widgets it feeds say so, the others still show, and Try again recovers. A failed task completion and a failed Send Reminder say so and leave things as they were: `r56-dashboard-review2` "V6: a task that cannot be completed, or a reminder that cannot be sent, says so" (this PR). |
| V5: roles | Built | (earlier), this PR | `dashboard.e2e` "gives Staff the numbers of the clients assigned to them only"; `dashboard-cards.e2e` "a member who may not view Clients gets no clients card, and it is not counted". The summary leaves out every number whose list the member may not view (the same check as the cards): Total Clients (Clients), New Leads and the Leads stage (Leads), the return cards and stages (Tax Returns), Intake (Intake Forms), Outstanding Invoices, Revenue Overview and Service Breakdown (Invoices & Payments), Appointments Today (Appointments), Tasks Due (Tasks). The card or widget says "You don't have access to …" and offers no link. Tests: `dashboard-cards.e2e` "V5: a number whose list the member may not view is not sent at all" (a Read Only member, and a Staff member whose Invoices & Payments view is off), `r56-dashboard-review2` "V5: a card or widget whose module the member may not view says so, with no number or link" (this PR). Dev: compare `qa-owner-b`, `qa-admin-b` and `qa-staff-b`. |
| Multi-firm | Evidence | (earlier) | `dashboard.e2e` "a firm only ever sees its own numbers; another firm's id is 404"; the isolation suite covers every dashboard route. Dev: your LVP login vs `qa-owner-b` in Test Firm B. |
| V7: audit | Evidence | (earlier) | `dashboard.e2e` "refuses a client (403) and audits each view without numbers"; actions use their modules' own routes and audits. |
| V8: performance | Built (dev check after deploy) | this PR | Target (DECISIONS Nov 17): the summary under 1 s of server time on a large firm, every widget within 2.5 s cold on dev. **Large-firm fixture:** `dashboard-perf.e2e` "sends the summary in the same few queries as for a one-client firm, and logs the times" (one firm with 3,000 clients, 1,500 returns with their status history, 1,500 leads, 1,000 engagements, 600 intakes, 2,000 appointments, 5,000 tasks, 2,000 open invoices and 1,000 cash payments). The CI guard is deterministic: the summary takes the same number of database queries for that firm as for a firm with one client (28 on Nov 18; at most 30), so nothing grows with the data. The time is logged with only a 5 s ceiling, because a shared CI runner took 2.7 s. The 1 s target is measured, not gated: locally 448 ms (main) and 510 to 592 ms (this PR) on Nov 18; on dev by R61 after the deploy. **Before and after**, local, back to back on the same laptop with other suites running, Nov 18: summary median 448 ms (slowest 771) with main's code, 510 ms (809) with this PR's (V5's module check adds a step; within noise). Other calls, median before/after: time zone 61/59 ms, messages 55/67 ms, appointments 105/122 ms. **Browser:** Recent Messages and Upcoming Appointments start with the page instead of after the firm's time zone call, and show once the summary or the availability answers (the summary now carries the zone); Tasks Due waits only for the summary. That takes one round trip (the time zone call, 0.80 s median on dev on Nov 14) off those widgets' first load. Running the summary's steps side by side was tried and dropped: under load it held more connections and timed out. The slowest part on a large firm is Outstanding Invoices (one paid-amount call per open invoice: 144 to 378 ms for 2,000). Earlier measurement: **Dev measurement on Test Firm B's seeded data** (a small firm), Nov 14, 20:26 UTC: headless Chrome at 1440 px from a laptop over the internet, signed in as a dev-only perf login (an Owner of Test Firm B, not one of the QA logins). Eight loads of the dashboard. First (cold) load: KPIs 4.5 s, everything 5.4 s. Warm loads, median: KPIs 2.3 s, everything 2.5 s (slowest 3.1 s and 3.7 s). Request times seen by the browser (warm median): summary 0.93 s, firm time zone 0.80 s, messages 0.47 s, appointments 0.49 s. One summary call carries the numbers; messages and appointments load on their own. API logs on dev, Nov 8 to 14, all firms, server time only: summary median 811 ms (90th percentile 2.6 s, 57 calls), time zone 598 ms (2.3 s, 67), message threads 460 ms (1.6 s, 210), appointments 434 ms (0.9 s, 48). **Still open:** the 2.5 s cold load measured on dev once this PR is deployed. |
| U3, V10: keyboard and screen readers | Evidence | #1450, #1452 | Bars and services are links with spoken values; menus close on Escape and return focus; `r1-dashboard-charts`, `r1-dashboard-return`. |
| U4: responsive | Evidence | #1450 | `r31-dashboard` "the dashboard has no horizontal scroll at 1440 and 390 px"; `r1-dashboard-charts` at 390 px |
| V11: authorized flows | Evidence | | Dev, all in Test Firm B: create a client, an invoice, a message and a bulk email draft; upload a document; complete a task; cancel a seeded appointment. |

## Return context and the breadcrumb inventory

| Row | Status | PR | Test or steps |
| --- | --- | --- | --- |
| V9, R2 NEW6: return with context | Built | #1443, this PR | `r1-dashboard-return` (all): Back returns to the same periods; `r56-dashboard-review2` "K2, V9, R2 NEW6: Back to Dashboard returns to the same place on the page" (the scroll position, this PR). Each destination checks its own permission on its own route (the list it opens is the module's, with its guard). Other modules: `r56-origin-back`. |
| B01: Add New Client | Done | #1443 | `r60-dashboard-quick` "the five quick actions open each creation workflow" (Back to Dashboard on Clients) |
| B02: Send Message | Done | #1443 | Same (`from=` on the composer) |
| B03: Create Bulk Email | Done | #1443, #1458 | Same; `r1-dashboard-return` (Q3) |
| B04: Generate an Invoice | Done | #1443 | Same |
| B05: Upload Documents | Done | #1443 | Same |
| B06: Recent Messages View All | Done | #1443 | `r60-dashboard-links` "Recent Messages, View All opens /messages?from=%2F" |
| B07: message previews | Done | #1443, this PR | As T1: `r56-dashboard-review2` "T1, B07: a message preview opens that client's conversation, with Back to Dashboard". |
| B08: Tasks View All and task details | Done | #1443 | `r60-dashboard-lists` (task and client links carry `from=`) |
| B09: KPI and Pipeline drill-downs | Done | #1443, #1449 | `r60-dashboard-kpis` "each card opens its list filtered to what it counts"; `r55-pipeline-drilldown` |
| B10: calendar and appointments | Done | #1443 | `r60-dashboard-lists` (View Details opens with Back to Dashboard) |
| B11: header New and search | Evidence | (earlier) | `r60-dashboard-quick` "+ New offers each place something new starts, and closes as a menu should" |
| B12: other modules | Evidence | (SH1) | Links out of service workspaces carry their exact origin (`r56-origin-back`); a direct sidebar visit shows none. |

## Verified in Review 2

Rows the review found working. They stay here with their tests so a later change cannot drop them.

| Row | Status | PR | Test or steps |
| --- | --- | --- | --- |
| U1: global search | Evidence | (earlier) | `r56-settings-shell` "the header search finds clients and team members and opens them" |
| D2: Help and Support | Evidence | (earlier) | `r55-help-support` "Help offers the configured channels, sends nothing on open, and sends a message on Send" |
| K3: New Leads opens New Lead for the period | Evidence | (earlier) | `r60-dashboard-kpis` "New Leads: Leads at New Lead for this month, then Back to Dashboard"; `dashboard.e2e` "counts each pipeline stage as the list it opens shows it" |
| K5: Accepted Returns, Accepted only | Evidence | (earlier) | `r60-dashboard-kpis` "Returns In Progress and Accepted Returns open Tax Returns with those filters"; `dashboard-cards.e2e` "shows Returns In Progress and Accepted Returns, the same numbers as the KPIs" |
| K6: Outstanding Invoices, every unpaid balance | Evidence | (earlier) | `r60-dashboard-kpis` "Outstanding Invoices lists every unpaid invoice with its total" (the count against the list: V1) |
| K7: today's appointments | Evidence | (earlier) | `r60-dashboard-kpis` "Appointments Today and View Calendar open today’s appointments" (the firm's today) |
| T3: a due task stays after reload | Evidence | (earlier) | `dashboard.e2e` "lists open tasks with a due date, soonest first". Dev: reload the dashboard; Tasks Due lists the same tasks. |
| T4: task title opens the task | Evidence | #1148 | `r60-dashboard-lists` "a task title opens that task; the client is its own link; completing asks first" |
| U5: everything back after reload | Evidence | (earlier) | Dev: reload the dashboard; the greeting, date, numbers and appointments come back. |
| Q1, Q7: Add Client opens the form | Evidence | (earlier) | `r60-dashboard-quick` "the five quick actions open each creation workflow" and "+ New offers each place something new starts, and closes as a menu should" (both open Add New Client) |
| Q2, Q11: a new message | Evidence | (earlier) | `r60-dashboard-quick` "Send a Message opens a new message, and Bulk Email opens its composer, saving nothing" |
| Q4: Create Invoice | Evidence | (earlier) | `r60-dashboard-quick` "the five quick actions open each creation workflow" (`/invoices/new`) |
| Q5: Upload Documents | Evidence | (earlier) | Same, and `r60-dashboard-links` "Upload Now opens /documents/upload?from=%2F" |
| Q6: eight + New entries | Evidence | (earlier) | `r60-dashboard-quick` "+ New offers each place something new starts, and closes as a menu should" |
| Q8: + New invoice | Evidence | (earlier) | Dev: + New > New invoice opens a blank invoice. |
| Q9: + New appointment | Evidence | (earlier) | Dev: + New > New appointment opens the calendar to book from. |
| Q10: + New closes | Evidence | (earlier) | `r60-dashboard-quick` "+ New offers each place something new starts, and closes as a menu should" (Escape with focus back, a click elsewhere, a choice, arrow keys) |

## Oct 31 test blockers

| Blocker | Status | PR | Steps |
| --- | --- | --- | --- |
| Pending applications | Ready | (seed) | Super Admin > Firm Applications: three Pending Review and one Awaiting Information (`seed-qa-extra`). The Dashboard and the badge count Pending + In Review (SA-APP-Y04). |
| A visible way to apply | Done | #1437 | `r25-apply` "the firm sign-in page links to the application (Oct 31 test blocker)". The signed-out app root opens Welcome. |
| Sales data | Ready | (seed) | Sales Center: three opportunities. |
| Role logins | Ready | | The QA logins above. Emails go to any address (SES is out of the sandbox); plus-addresses on one inbox work for new test accounts. |

## GAP list (Nov 15)

**Not built yet**
- **T2** (assigned to R1, Nov 15): the widget leaves out archived tasks, as View All does, with a reconciling test.
- **C2, C3, V3, and C4's refunds** (assigned to R1): a refund counts on the day it is confirmed, in every period total, the dashboard and All Payments alike; a payment row may still show its net with "refunded on {date}". The e2e fixtures are cash only today.
- **A1, A4** (assigned to R1): the QA seed rolls (dates relative to the run day, our seeded rows only).
- **V8:** the 2.5 s cold load on dev, measured once this PR is deployed (the large-firm fixture and the 1 s summary target are in this PR).

**Decided: fallback shown (Nov 15)**
- **U2:** when the firm's time zone cannot be read, the header clock keeps the browser's zone and says so: "Using your device's time zone". R1 adds the note in its Dashboard PR.

**Test gaps** (R60 adds the checks after the product items, Nov 15)
- **U2:** "today" and the periods for a firm zone other than New York.
- **A3:** the appointment menu as a role that may not edit appointments or view clients.
- **V1:** Outstanding Invoices and Appointments Today against their lists, and Reports totals.

**Decided, no build**
- **R2 NEW2:** an employee's name is their own sign-in identity across firms; the employee changes it in Profile, not the Owner.
