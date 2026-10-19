# Demo data coverage map (R0, PART 2)

Every `page.tsx` under `apps/web/src/app`, the demo seed rows that feed it, whether its backend
exists on `main`, and the stage that fills it. The demo firm is `demo` ("Demo Accounting Group"):
`app.dev.firmivra.com` for staff, `portal.dev.firmivra.com/demo` for its clients.

**Backend** column: **yes** means the page's API routes exist in `apps/api` on main, so seeded rows
show on dev as soon as the seed runs there. **no** means the routes don't exist yet: on dev such a
page shows data only through R1's dev-only demo mock (`NEXT_PUBLIC_DEMO_MOCK`), never from the seed,
until its API lands. **part** means some calls exist and some don't (the missing ones are mocked).

Stages (one PR each, in Rasel's priority order: pages whose backend already exists first):

- **Stage 1** (#679): the firm, its settings and reference data, owner and 6 staff, 3 departments,
  3 teams, 25 clients, one client portal login (Harper Coleman, `harper.coleman@demo.test`).
- **Stage 2** (#704): engagements, tasks, notes, tax returns, invoices and payments, calendar,
  documents and requests, message threads.
- **Stage 3**: leads in every pipeline stage, Begin Online submissions, Firm Sign requests
  (completed and pending), intake forms and submissions, client sign-ups, the notification bell.
- **Stage 4**: Super Admin: 8 more firms (`demo-` slugs) in every status, their applications and
  plan subscriptions, 4 applications still under review. Run the platform-org bootstrap
  (`bootstrap-platform-org-task.mjs`) first: stage 4 needs the plan ladder and acts as the earliest
  SUPER_ADMIN (decisions and subscriptions show that person as the reviewer, Rasel's choice).
- **Stage 5**: work modules with tables but no screens yet (bookkeeping, tax planning, compliance,
  automations, payroll, advisory), services and pricing detail (packages, promotions), audit and
  login history.

## What Stage 2 seeds (counts per demo seed run)

| Module file | Rows |
| --- | --- |
| `seed-demo-engagements.ts` | 56 engagements (every status; annual tax 2025 and 2024, bookkeeping, payroll, quarterly estimates, planning), 97 tasks (open at every progress, done, cancelled; some overdue, some due today), 9 staff notes, 35 tax returns (13 accepted for 2024, 22 in progress for 2025) |
| `seed-demo-billing.ts` | 21 invoices: 7 paid, 1 part paid, 4 open, 4 overdue, 2 draft, 1 scheduled, 1 canceled; 8 recorded offline payments (check, ACH, card, cash) |
| `seed-demo-calendar.ts` | working hours for 5 staff, 1 office closure, 18 appointments over the last 2 and next 2 weeks (completed, no-show, cancelled, scheduled, confirmed; video, in person, phone) |
| `seed-demo-documents.ts` | 16 document requests (requested, submitted, accepted, rejected, not available), 24 documents: 9 client uploads, 13 filed 2024 returns shared with clients (linked to their tax return), 2 internal workpapers. Records only: no file behind them |
| `seed-demo-messages.ts` | 10 threads, 13 messages (read and unread; one with an attachment; one archived thread). Client-sent messages come only from the portal client, the one client with a login |

## What Stage 3 seeds

| Module file | Rows |
| --- | --- |
| `seed-demo-intake.ts` | a published intake form per service, the real form of each kind (Begin Online and the portal), the firm's intake agreement v1, Firm Sign and calculators switched on, 4 portal intakes (2 sent, 1 in progress, 1 signed and submitted by Harper) |
| `seed-demo-leads.ts` | 14 leads, LD-10001 to LD-10014: draft, submitted, in review, declined, contacted, in follow-up, appointment scheduled, qualified, lost; from Begin Online, a referral, the website, Google, Facebook, Instagram, an event, a call, a walk-in and email; owners, priorities, next follow-ups, a second service on two, and an activity trail (the database adds created, status and assignment entries). The 4 submitted Begin Online leads carry a signed submission |
| `seed-demo-esign.ts` | Firm Sign settings, consent v1, 2 managers, 3 templates, 9 requests: 2 completed (signed final PDF and certificate filed in the client's Documents), 2 sent, 1 viewed, 1 declined, 1 expired, 1 voided, 1 draft; 28 events. Harper signs through her login (portal Signatures: one completed, one waiting) |
| `seed-demo-signups.ts` | 4 portal sign-ups: 3 waiting for approval, 1 declined |
| `seed-demo-portal.ts` | 37 client tax-year statuses (2025 by the return's stage, 2024 accepted) for the portal's "Where Your Taxes Stand"; 8 published content items: one resource per resource page, 3 external links, 1 tip (resources and links show to business clients only) |
| `seed-demo-notifications.ts` | 15 bell items: 10 for staff (new leads, sign-ups, uploads, a payment, a message, a booking, a submitted intake), 5 for Harper (a request, an invoice, a message, today's appointment, her shared return); some read |

## What Stage 4 seeds

| Module file | Rows |
| --- | --- |
| `seed-demo-platform.ts` | 8 firms: 5 active (one on trial, one past due), 1 pending setup, 1 suspended, 1 closed; each with an owner login, settings, services, its approved application (with history) and a plan subscription (every plan; active, trial, past due, suspended, cancelled; monthly and annual). 4 applications without a firm: 2 pending review, 1 info requested, 1 declined. The demo firm gets a Business plan subscription |

## What Stage 5 seeds (work modules, one group per PR)

| Module file | Rows |
| --- | --- |
| `seed-demo-templates.ts` | Templates: 7 template categories; 10 message templates (email, text, portal message, appointment; active, a draft, an archived one; one shared with selected staff) with their saved versions, favorites, uses and an attachment; the firm's template branding and 3 custom merge fields; 3 document request templates with 12 items (linked to document categories); 3 invoice templates (one default) |
| `seed-demo-compliance.ts` | Compliance & Deadlines: settings (reminders two weeks and three days ahead, tasks due 5 days early); this year's IRS calendar (4 entries) published, with its log; two recurring definitions (quarterly estimates from the calendar, a monthly sales tax return) and two applicability rules, with 23 decisions (confirmed with their deadline, suggested, needs review); compliance facts for every business client and half the individuals (classification, elections, payroll states, prior-year liability; some verified); 8 sales tax registrations; 62 deadlines: last year's return (filed with its document and confirmation number, or extended and still open, or waiting on the client), Q4 estimates linked to the return, Q3 941s for payroll clients, sales tax returns, state annual reports (two not applicable), with reminders on the open ones |
| `seed-demo-bookkeeping.ts` | Bookkeeping: the close checklist; a profile and activity for each of the 8 bookkeeping clients (on track, needs attention, missing documents, overdue); for 3 of them a QuickBooks or Xero connection with sync runs and two accounts, the month before last closed (reconciled, approved) and last month in progress with its checklist and reconciliation, last month's ledger (categorized, a split, a transfer pair, a refund, a processor payout matched to its settlement, two uncategorized), reports (P&L in progress with a version, balance sheet not started, a reconciliation delivered through a published engagement report) and the engagement terms in force. Settlement items stay empty, as for LVP |
| `seed-demo-tasks.ts` | Tasks: 7 task types (set on every demo task by its engagement), 4 templates (onboarding, annual return, monthly close, quarterly estimate), 2 recurring series (a monthly close and quarterly estimates) with 7 due dates (one made into a task each, upcoming ones, one skipped month), checklists on about half the open tasks (first step done) and a third of the done ones (all done), collaborators, reminders (3 days before by email, and on the day), client documents attached to tasks; 6 tags on half the clients (Harper: Referral Partner, Extension Filed) and on some leads |
| `seed-demo-automations.ts` | Automations: the firm's settings (failure alerts to the owner and admin); 7 rules across compliance, leads, invoices, documents, appointments and tax returns (four active with their first version, one paused, one draft, one archived); 20 runs over the last two weeks (successes, a partial success, a bounced email, a skipped duplicate) with their action executions; 3 saved workflow templates |
| `seed-demo-payroll.ts` | Payroll: the firm's payroll settings; the four payroll clients (Gusto, ADP, QuickBooks Payroll; biweekly), each with a roster of 3 to 5 workers (salaried, hourly, part-time, a contractor, one on leave, one new hire pending setup), two completed pay runs with lines and confirmed figures, and a current run that is ready for review, blocked by a missing direct deposit (an ERROR issue), submitted to the provider, or in progress; overtime warnings; this year's Q2 941 and state withholding filed and paid, Q3 941 in progress, last year's 940; registers per completed run; last year's year-end (delivered, reconciled, in progress); status history and activity |

Dates are relative to the day the seed runs (overdue stays overdue, "today" is today). Run it again
and nothing changes; `pnpm db:unseed:demo` removes all of it.

## Super Admin (`admin.firmivra.com`)

| Page | Seed rows | Backend | Stage |
| --- | --- | --- | --- |
| `/admin/(console)/page.tsx` (dashboard) | 9 demo firms by status, 12 applications | yes | 4 |
| `/admin/(console)/applications`, `/[id]` | 12 applications: 8 approved, 2 pending review, 1 info requested, 1 declined | yes | 4 |
| `/admin/(console)/firms`, `/[id]` | 9 firms in every status, each with its plan subscription | yes | 4 |
| `/admin/sign-in`, `forgot-password`, `reset-password` | real dev Super Admin logins | yes | n/a |

## Firm workspace (`app.firmivra.com`)

| Page | Seed rows | Backend | Stage |
| --- | --- | --- | --- |
| `/firm/(workspace)/page.tsx` (dashboard) | clients, engagements, tasks, invoices, appointments | yes | 1, 2 |
| `/firm/apply*`, `setup`, `activate`, `welcome`, `sign-in`, `forgot-password`, `reset-password` | sign-in and onboarding flows | yes | n/a |
| **Clients** `/clients`, `clients/[id]` | 25 clients with profiles, assigned staff, notes | yes | 1, 2 |
| `clients/[id]/documents` | requests and documents of that client | yes | 2 |
| `clients/[id]/invoices` | that client's invoices | yes | 2 |
| `clients/[id]/messages` | that client's threads | yes | 2 |
| `clients/[id]/signatures` | the client's Firm Sign requests (Harper, Blue Ridge, and 6 more) | yes | 3 |
| **Workspaces** `workspaces`, `workspaces/[engagementId]` | 56 engagements with tasks, notes, documents | yes | 2 |
| **Invoices** `/invoices` | 21 invoices in every state, 8 payments | yes | 2 |
| **Messages** `/messages` | 10 threads, read and unread | yes | 2 |
| **Documents** `/documents` | 24 documents, 16 requests | part | 2 |
| **Calendar** `/calendar`, `calendar/[id]`, `calendar/types`, `calendar/availability` | 18 appointments, 3 types, working hours, a closure | yes | 2 |
| `calendar/list`, `calendar/today`, `calendar/new`, `calendar/[id]/edit` | same appointments | part (newer scheduling calls mocked) | 2 |
| **Leads** `/leads`, `leads/[id]` | 14 leads in every pipeline status, owners, follow-ups | part (pipeline parts mocked) | 3 |
| `leads/[id]/*` tabs, `leads/[id]/convert/*` | lead activity (seeded); the tabs' API is not on main | no (mocked) | 3 |
| **Intake forms** `/intake-forms` and every sub-page | 6 published forms, 8 intakes (4 portal, 4 Begin Online) | no (mocked) | 3 |
| **Firm Sign** `/firm-sign` and every sub-page, `(kiosk)/firm-sign/in-person*` | 9 requests in every state, 3 templates, events | yes | 3 |
| `sign-ups` | 3 sign-ups waiting, 1 declined | yes | 3 |
| `audit-log` | audit rows | yes | 5 |
| **Team** `/team`, `team/[id]`, `team/[id]/created` | owner and 6 staff, profiles | yes | 1 |
| `team/departments`, `team/org-chart`, `team/teams`, `team/roles`, `team/settings`, `team/activity`, `team/import`, `team/new/*` | 3 departments, 3 teams | no (R54's staff-org API unmerged; mocked) | 1 |
| `team/[id]/security`, `security/permissions`, `security/login`, `security/history`, `security/sessions`, `security/activity` | security settings per staff member | no (mocked) | 1, 5 |
| **Settings** `settings/overview`, `profile`, `legal`, `tax-statuses`, `branding`, `users` | business settings, Terms, Privacy, 6 tax statuses, staff | yes | 1 |
| `settings/preferences`, `data`, `security`, `notifications`, `communications`, `forms-documents`, `workflow`, `portal`, `availability`, `billing`, `payments`, `users/roles/new` | defaults | part (mostly mocked) | 5 |
| **Services & pricing** `services-pricing` and every sub-page | 6 services (packages, promotions in stage 5) | no (R55's catalog API #685 unmerged; mocked) | 1, 5 |
| `modules/[slug]` (bookkeeping, tax planning, compliance, automations, payroll, advisory, integrations, reports, templates, communications) | none yet | no | 5 / product gap |

## Client portal (`portal.firmivra.com/demo`)

Sign in as the portal client, Harper Coleman (client `01`). Her account has rows in every tab.

| Page | Seed rows | Backend | Stage |
| --- | --- | --- | --- |
| `(public)/page.tsx`, `sign-in`, `sign-up*`, `forgot-password`, `reset-password` | the demo firm's branding, one portal login | yes | 1 |
| `(client)/(tabs)/taxes` | 2024 return accepted (with its PDF record), 2025 in progress | yes | 2 |
| `(client)/(tabs)/documents` | 3 requests (requested, submitted, accepted), her uploads, her filed return | yes | 2 |
| `(client)/(tabs)/invoices`, `invoices/[invoiceId]` | INV-2001 paid, INV-2002 open, INV-2003 overdue | yes | 2 |
| `(client)/(tabs)/messages` | 3 threads, including a back-and-forth with an attachment | yes | 2 |
| `(client)/(tabs)/business` | her engagements (2025 tax, 2024 tax, 2026 planning) | yes | 2 |
| `(client)/appointments` | 3 appointments (one past, one today, one in 2 weeks) | yes | 2 |
| `(client)/services` | her engagements | yes | 2 |
| `(client)/profile` | her profile | yes | 1 |
| `(client)/(tabs)/intake`, `intake/[form]` | her 2025 tax intake in progress, her planning intake submitted | yes | 3 |
| `(client)/signatures`, `(signing)/sign*` | her completed engagement letter, her Form 8879 waiting | yes | 3 |
| `(client)/notifications` | 5 bell items, 2 read | yes | 3 |
| `(public)/begin/*` | the 6 published forms and the intake agreement (submissions show on the firm's Leads page) | yes | 3 |
| `(public)/calculators/*`, `(client)/calculator/*`, `(client)/resources/*` | static content and calculators | yes | n/a |

## Marketing

| Page | Seed rows | Backend | Stage |
| --- | --- | --- | --- |
| `/page.tsx`, `/portal/page.tsx` | static | n/a | n/a |
