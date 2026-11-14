# Dashboard: Review 2 QA map

This file maps every row of Octavia's Dashboard Review 2 (the Developer Working Guide of Nov 2, 2026 and its comprehensive companion) to the PR that changed it and the test that covers it. A row that needed no code instead gets the exact steps on dev that show it, and a row still open is a **GAP** with a plan. The reports are kept privately, outside the repo; rows are named by their IDs and headings only.

**Where the tests are**
- API e2e: `apps/api/test/e2e/`
- Mock specs: `apps/web/e2e/mock/`
- db tests: `packages/db/test/`
- Isolation: `apps/api/test/isolation/` (every firm route, both firms)

**Steps on dev.** Use `https://app.dev.firmivra.com` with the QA logins Rasel hands over: `qa-owner-b@`, `qa-admin-b@` and `qa-staff-b@dev.firmivra.com` (all in Test Firm B), `qa-client-b@dev.firmivra.com` (a Test Firm B client, at `https://portal.dev.firmivra.com/test-firm-b`) and `qa-superadmin@dev.firmivra.com` (`https://admin.dev.firmivra.com`). Staff logins set up an authenticator at their first sign-in. Your own LVP login is the second firm for the multi-firm rows. Test Firm B has twelve upcoming appointments for a synthetic client (QA seed part 4, #1463). They are already marked reminded, so nothing is emailed by itself.

**Definitions the rows ask for**
- **Time zone (U2):** the firm's time zone in Settings > Preferences is the one rule. The header clock, the dashboard's date, "today", every period's first and last day, and the due labels all use it. The browser's own zone is never used in the firm workspace. The Super Admin console belongs to no firm and shows the person's own zone.
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
  - A bar or a slice opens All Payments for the same days (and service). All Payments shows each payment net of its refunds, so a refund confirmed on a later day appears in the dashboard on that later day.
- **Refresh (V4):** the dashboard reads its numbers when it opens (a copy at most 30 seconds old is reused), when a period changes, and after an action taken on it (completing a task, cancelling or completing an appointment, sending a reminder). There is no live push; Reload always shows the latest. Each firm's cache is its own: the data cache is emptied when another person signs in on the tab.
- **Phone (R2 NEW2):** NEW2 supersedes Overview item 20's self-service phone. An employee no longer changes their own number. The firm's Owner sets it in Edit Staff as the firm's own number for them, and the employee proves it with a code. The Owner still changes their own number on My Profile.

## Header and global controls

| Row | Status | PR | Test or steps |
| --- | --- | --- | --- |
| U2: clock vs Preferences | Done | #1452 | `r1-dashboard-return` "the header clock shows the firm's time zone, not the browser's (U2)". Dev: Settings > Preferences, choose Central Time and Save; the header clock changes to CST at once. |
| N1: reminder visibility | Evidence | (earlier) #1148 | `r60-dashboard-lists` "opening the bell marks the notifications it shows as read". Dev: as `qa-owner-b`, open the bell. Opening it marks the items it shows as read. |
| N2: read state, badge after reload, history | Evidence | #1148 | Same spec. Dev: open the bell, reload: the badge stays down, and the list keeps the items. |
| N3: notification opens the exact appointment | Evidence | #1148 | Dev: an appointment notice in the bell opens that appointment, and the appointment page checks access again. A fixture notice is not seeded: one appears when an appointment is booked or rescheduled for `qa-owner-b`. |
| D3: report a problem | Evidence | (earlier) | The approved helper text is word for word. Report a Problem opens your own email app with the firm name and the page only: you review it there and attach what you choose. No secrets or record contents are added. Dev: ? > Report a Problem. |
| R2 NEW1: profile menu dismissal | Done | #1452 | `r1-dashboard-return` "the profile menu closes on a click outside and on Escape after focus left it (R2 NEW1)" |
| R2 NEW2: Owner profile editing | Done | #1459 (schema), #1461 | `staff-phone.e2e` "Dashboard Review 2 (R2 NEW2): My Profile" (both tests); `staff-write.e2e` "keeps the member's phone as the firm's own number, set by the Owner only"; `r1-my-profile-edit` |
| Tax season context | **GAP** | | The firm settings have no tax-season fields yet, so the dashboard reports none (`dashboard.e2e` "…no tax season until the firm's settings hold one"). Plan: schema and setting after Nov 17. |

## KPI cards and trends

| Row | Status | PR | Test or steps |
| --- | --- | --- | --- |
| K1: historical Total Clients | Done | #1449 | `dashboard.e2e` "opens Total Clients on the clients it counts, for a past period too"; `r1-dashboard-return` "a past period's Total Clients opens the books at its end; Show today clears it (K1)" |
| K2: keep the period on Back | Done | #1443 | `r1-dashboard-return` "a card keeps the chosen period: Back to Dashboard returns to it" |
| K4: In Progress with the period | Done | #1449 | `dashboard-cards.e2e` "opens each card on the list as it stood at the period end, the same number"; `r1-dashboard-return` "Tax Returns shows a past period's statuses as they stood then (K4)" |
| K8: trend calculation | Evidence | (earlier) | `dashboard.e2e` "counts the cards for the global period and its equivalent period before"; `r31-dashboard` "every widget of the design, with trends only where the API gives the period before" |
| V2: periods and boundaries | Evidence | #1443 | `dashboard.e2e` "refuses a Custom period without both days, ending after today or backwards", "gives Revenue Overview by month, quarter, year or Custom days, with the span before"; `r55-dashboard-periods` (all three) |
| Color system: text with every color | Evidence | (earlier) | Trends always carry words (Up/Down with the percentage, favourable or unfavourable, New, No change, N/A); `r31-dashboard` |

## Client Pipeline, Revenue, Service Breakdown

| Row | Status | PR | Test or steps |
| --- | --- | --- | --- |
| C5: Intake opens its filter | Done | #1443 | `dashboard.e2e` "counts each pipeline stage as the list it opens shows it" (client and lead forms, Owner and Staff); `r1-dashboard-return` "the Intake stage opens Not Finished as the selected filter" |
| C6: live stage counts | Evidence | #1443 | Same e2e for every stage and three periods. Dev: as `qa-owner-b`, send an intake form to a Test Firm B client; Intake grows by one on the next dashboard visit. |
| R2 NEW4: Pipeline Custom layout | Done | #1450 | `r1-dashboard-charts` "Custom keeps each title beside its dropdown, with whole date pairs below" at 1440 and 390 px |
| C2: revenue bar drill-down and hover | Done | #1450 | `r1-dashboard-charts` "a revenue bar shows its value on hover and opens the payments of its days"; `dashboard.e2e` "opens each revenue bar and each service on the payments that make it up" |
| C3: revenue source | Evidence | (earlier) | See Revenue above; `dashboard.e2e` "adds up this year's money by month and by service" |
| R2 NEW3: Revenue Custom layout | Done | #1450 | `r1-dashboard-charts` (Custom, 1440 and 390 px; screenshots in `apps/web/e2e/screenshots/r1-dashboard-charts/`) |
| C4: service segment drill-down | Done | #1450 | `r1-dashboard-charts` "a service's line shows its amount and opens that service's payments"; `dashboard.e2e` as for C2 |
| V3: totals, hover, attribution | Done | #1450 | As C2 and C4 |
| R2 NEW5: Service Breakdown Custom layout | Done | #1450 | `r1-dashboard-charts` (Custom) |
| DATA1: Intake mapping, Other revenue | Done | #1443, #1450 | See Intake and Revenue above |

## Messages, Tasks, Appointments

| Row | Status | PR | Test or steps |
| --- | --- | --- | --- |
| T1: message previews and View All | Done | #1443 | Previews open that client's conversation with Back to Dashboard (`from=`), and View All opens Messages with it too (`r60-dashboard-links`). Dev: send a message from the portal as `qa-client-b`, then open its preview as `qa-owner-b`. |
| T2: Tasks Due View All | Done | #1443 | `tasks-work.e2e` "filters, sorts, searches and pages the table" (`dueSet`); `r1-dashboard-return` "Tasks Due View All opens the widget's tasks…". The population is every open task with a due date that you reach, soonest first (overdue first). |
| R2 NEW7: Tasks origin label | Done | #1443 | `r1-dashboard-return` "Tasks Due View All…" (Back to Dashboard, no Home crumb) and "Tasks opened from the sidebar shows no origin" |
| T5: completion asks first | Evidence | #1148 | `r60-dashboard-lists` "a task title opens that task; the client is its own link; completing asks first" (Cancel leaves it, Mark Complete completes it once) |
| T6: completed task moves to Done | Evidence | #1148 | Same spec. Dev: complete one; it leaves Tasks Due and shows in Tasks > Completed Tasks. Nothing is deleted. |
| T7: all-day vs timed | Evidence | (Tasks) | An all-day task has no time. Switch All Day off in New Task to set Due Time (5:00 PM is only the starting value). Its reminders are counted back from that time; an all-day task's from the start of its day in the firm's time zone. |
| A1: upcoming fixture and View All | Done | #1463 | `seed-qa-appointments.test`. Dev: as `qa-owner-b`, Dashboard > Upcoming Appointments lists the seeded rows; View All opens Appointments with Back to Dashboard. |
| A2: row opens the exact record | Done | #1443, #1463 | `r60-dashboard-lists` "an appointment row opens that appointment, with its menu and a scrolling list" |
| A3: menu by permission, Cancel asks | Done | #1443, #1463 | Same spec (all seven actions, the Cancel dialog). The menu offers the changing actions only to a role that may edit appointments, and Open Client only to one that may view clients. Dev: compare `qa-owner-b` and `qa-staff-b`. |
| A4: long list | Done | #1463 | Same spec (scrolls, keyboard focusable). Dev: Test Firm B shows twelve rows. |

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
| V1: metric to list reconciliation | Done | #1443, #1449, #1450 | The KPI, pipeline, card, bar and service tests above. Each compares the dashboard number with the list's total for the Owner and Staff. |
| V4: refresh | Evidence | | See Refresh above. Dev: complete a task on the dashboard; Tasks Due drops it at once. A task added in Tasks shows on the next dashboard visit. |
| V6: loading, empty, error | Done | (earlier), this PR | Each widget has its own loading, empty and error state with Try again (`widget.tsx`). This PR gives the KPI row its own error and Try again (it showed skeletons for ever) and adds fault injection in mock mode (`failable` in `lib/mock.ts`). `r1-dashboard-failures` fails each call in turn (the summary, messages, appointments, the firm's time zone): the widgets it feeds say so, the others still show, and Try again recovers. |
| V5: roles | Evidence | (earlier) | `dashboard.e2e` "gives Staff the numbers of the clients assigned to them only"; `dashboard-cards.e2e` "a member who may not view Clients gets no clients card, and it is not counted". Dev: compare `qa-owner-b`, `qa-admin-b` and `qa-staff-b`. |
| Multi-firm | Evidence | (earlier) | `dashboard.e2e` "a firm only ever sees its own numbers; another firm's id is 404"; the isolation suite covers every dashboard route. Dev: your LVP login vs `qa-owner-b` in Test Firm B. |
| V7: audit | Evidence | (earlier) | `dashboard.e2e` "refuses a client (403) and audits each view without numbers"; actions use their modules' own routes and audits. |
| V8: performance | **GAP** | | One summary call for the numbers; messages and appointments load on their own. Plan: request timing in the API logs and a large-firm fixture, after Nov 17. |
| U3, V10: keyboard and screen readers | Evidence | #1450, #1452 | Bars and services are links with spoken values; menus close on Escape and return focus; `r1-dashboard-charts`, `r1-dashboard-return`. |
| U4: responsive | Evidence | #1450 | `r31-dashboard` "the dashboard has no horizontal scroll at 1440 and 390 px"; `r1-dashboard-charts` at 390 px |
| V11: authorized flows | Evidence | | Dev, all in Test Firm B: create a client, an invoice, a message and a bulk email draft; upload a document; complete a task; cancel a seeded appointment. |

## Return context and the breadcrumb inventory

| Row | Status | PR | Test or steps |
| --- | --- | --- | --- |
| V9, R2 NEW6: return with context | Done | #1443 | `r1-dashboard-return` (all). Back returns to the same periods and scroll position. |
| B01: Add New Client | Done | #1443 | `r60-dashboard-quick` "the five quick actions open each creation workflow" (Back to Dashboard on Clients) |
| B02: Send Message | Done | #1443 | Same (`from=` on the composer) |
| B03: Create Bulk Email | Done | #1443, #1458 | Same; `r1-dashboard-return` (Q3) |
| B04: Generate an Invoice | Done | #1443 | Same |
| B05: Upload Documents | Done | #1443 | Same |
| B06: Recent Messages View All | Done | #1443 | `r60-dashboard-links` "Recent Messages, View All opens /messages?from=%2F" |
| B07: message previews | Done | #1443 | As T1 |
| B08: Tasks View All and task details | Done | #1443 | `r60-dashboard-lists` (task and client links carry `from=`) |
| B09: KPI and Pipeline drill-downs | Done | #1443, #1449 | `r60-dashboard-kpis` "each card opens its list filtered to what it counts"; `r55-pipeline-drilldown` |
| B10: calendar and appointments | Done | #1443 | `r60-dashboard-lists` (View Details opens with Back to Dashboard) |
| B11: header New and search | Evidence | (earlier) | `r60-dashboard-quick` "+ New offers each place something new starts, and closes as a menu should" |
| B12: other modules | Evidence | (SH1) | Links out of service workspaces carry their exact origin (`r56-origin-back`); a direct sidebar visit shows none. |

## Oct 31 test blockers

| Blocker | Status | PR | Steps |
| --- | --- | --- | --- |
| Pending applications | Ready | (seed) | Super Admin > Firm Applications: three Pending Review and one Awaiting Information (`seed-qa-extra`). The Dashboard and the badge count Pending + In Review (SA-APP-Y04). |
| A visible way to apply | Done | #1437 | `r25-apply` "the firm sign-in page links to the application (Oct 31 test blocker)". The signed-out app root opens Welcome. |
| Sales data | Ready | (seed) | Sales Center: three opportunities. |
| Role logins | Ready | | The QA logins above. Emails go to any address (SES is out of the sandbox); plus-addresses on one inbox work for new test accounts. |
