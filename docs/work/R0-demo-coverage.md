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
- **Stage 2** (this map's update): engagements, tasks, notes, tax returns, invoices and payments,
  calendar, documents and requests, message threads.
- **Stage 3** (next): leads in every pipeline stage, Begin Online submissions, Firm Sign requests
  (completed and pending), intake forms and submissions, client sign-ups, the notification bell.
- **Stage 4**: Super Admin: 8 firms in different statuses, applications, subscriptions.
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

Dates are relative to the day the seed runs (overdue stays overdue, "today" is today). Run it again
and nothing changes; `pnpm db:unseed:demo` removes all of it.

## Super Admin (`admin.firmivra.com`)

| Page | Seed rows | Backend | Stage |
| --- | --- | --- | --- |
| `/admin/(console)/page.tsx` (dashboard) | Stage 4 firms and applications | yes | 4 |
| `/admin/(console)/applications`, `/[id]` | `firm_applications` | yes | 4 |
| `/admin/(console)/firms`, `/[id]` | 8 firms, subscriptions | yes | 4 |
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
| `clients/[id]/signatures` | Firm Sign requests | yes | 3 |
| **Workspaces** `workspaces`, `workspaces/[engagementId]` | 56 engagements with tasks, notes, documents | yes | 2 |
| **Invoices** `/invoices` | 21 invoices in every state, 8 payments | yes | 2 |
| **Messages** `/messages` | 10 threads, read and unread | yes | 2 |
| **Documents** `/documents` | 24 documents, 16 requests | part | 2 |
| **Calendar** `/calendar`, `calendar/[id]`, `calendar/types`, `calendar/availability` | 18 appointments, 3 types, working hours, a closure | yes | 2 |
| `calendar/list`, `calendar/today`, `calendar/new`, `calendar/[id]/edit` | same appointments | part (newer scheduling calls mocked) | 2 |
| **Leads** `/leads`, `leads/[id]` | leads in every stage | part (pipeline parts mocked) | 3 |
| `leads/[id]/*` tabs, `leads/[id]/convert/*` | lead activity, notes, documents | no (mocked) | 3 |
| **Intake forms** `/intake-forms` and every sub-page | forms, submissions | no (mocked) | 3 |
| **Firm Sign** `/firm-sign` and every sub-page, `(kiosk)/firm-sign/in-person*` | completed and pending requests, templates | yes | 3 |
| `sign-ups` | client sign-ups waiting for approval | yes | 3 |
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
| `(client)/(tabs)/intake`, `intake/[form]` | intake submissions | yes | 3 |
| `(client)/signatures`, `(signing)/sign*` | Firm Sign requests | yes | 3 |
| `(client)/notifications` | notification bell items | yes | 3 |
| `(public)/begin/*` | Begin Online forms (submissions show on the firm's Leads page) | yes | 3 |
| `(public)/calculators/*`, `(client)/calculator/*`, `(client)/resources/*` | static content and calculators | yes | n/a |

## Marketing

| Page | Seed rows | Backend | Stage |
| --- | --- | --- | --- |
| `/page.tsx`, `/portal/page.tsx` | static | n/a | n/a |
