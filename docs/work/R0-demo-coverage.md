# Demo data coverage map (R0, PART 2)

Every `page.tsx` under `apps/web/src/app`, the demo seed rows that fill it, and its stage. A page
with no seed rows yet shows the gap and the stage that is expected to close it, per Rasel's
coverage rule (Oct 16): nothing should open to an empty frame once all stages are done.

Stages:

- **Stage 1** (this PR): the demo firm itself, settings and reference data, staff/departments/teams,
  the 25-client directory, one client portal login. `seed-demo-org.ts`.
- **Stage 2** (planned, next PR): engagements, tasks (every status), invoices (paid/open/overdue),
  payments, appointments, documents (records only), message threads.
- **Stage 3** (planned): leads (every pipeline stage), intake forms and submissions, Firm Sign
  requests (completed and pending), Begin Online submissions, notification bell items.
- **Stage 4** (planned): Super Admin side -- 8 firms in different statuses, applications,
  subscriptions.
- **Stage 5** (planned, where tables/API exist): bookkeeping, tax planning, compliance &
  deadlines, automations, payroll, business advisory, services & pricing detail rows.
- **Gap -- no API/screen yet** (R39 brief): templates, communications, integrations, reports.
  These load through the generic `modules/[slug]` placeholder; no dedicated seed until that work
  itself ships (not a demo-seed gap, a product gap, listed here only so it isn't forgotten).

## Super Admin (`admin.firmivra.com`)

| Page | Seed file / rows | Stage |
| --- | --- | --- |
| `/admin/(console)/page.tsx` (dashboard) | -- | Stage 4 |
| `/admin/(console)/applications/page.tsx`, `/[id]` | -- | Stage 4 (`firm_applications`) |
| `/admin/(console)/firms/page.tsx`, `/[id]` | -- | Stage 4 (8 firms, subscriptions) |
| `/admin/sign-in`, `forgot-password`, `reset-password` | existing Super Admin seed (`seed-platform-team.ts`) | done (not this PR) |

## Firm workspace (`app.firmivra.com`)

| Page | Seed file / rows | Stage |
| --- | --- | --- |
| `/firm/(workspace)/page.tsx` (dashboard) | partial: staff/client counts render; activity feed needs Stage 2/3 | Stage 1 partial |
| `/firm/apply`, `apply/done`, `setup`, `activate`, `welcome`, `sign-in`, `forgot-password`, `reset-password` | existing LVP-style application/onboarding seed | done (not this PR) |
| **Team** `/team`, `team/[id]`, `team/[id]/created` | `seed-demo-org.ts`: owner + 6 staff, `Membership`, `StaffProfile` | **Stage 1** |
| `team/departments`, `team/org-chart` | `seed-demo-org.ts`: 3 `Department` rows, `MemberDepartment` links | **Stage 1** |
| `team/teams` | `seed-demo-org.ts`: 3 `Team` rows, `TeamMember` rosters | **Stage 1** |
| `team/roles` | role set is global (R35 `FIRM_ROLES`); demo staff use 6 of the 8 roles | **Stage 1** |
| `team/[id]/security`, `security/permissions` | `StaffSecuritySettings` row per staff member | **Stage 1** |
| `team/[id]/security/login`, `security/history`, `security/sessions`, `security/activity` | no login history / session / audit rows seeded yet | Stage 2 gap |
| `team/activity` | no audit log rows for the demo firm yet | Stage 2 gap |
| `team/import`, `team/new/*`, `team/settings` | forms/wizards; no seed needed (create flows) | n/a |
| **Clients** `/clients` (directory) | `seed-demo-org.ts`: 25 `Client` + `ClientProfile` rows, mixed types/assignees | **Stage 1** |
| `clients/[id]` (profile) | same 25 clients | **Stage 1** |
| `clients/[id]/documents`, `/invoices`, `/messages`, `/signatures` | no engagement/document/invoice/message rows per client yet | Stage 2 gap |
| **Settings** `settings/overview`, `profile`, `legal`, `tax-statuses`, `branding`, `preferences`, `data` | `seedFirmBasics`: `BusinessSettings`, `FirmLegalDocument`, `TaxStatus` rows (reused from LVP's reference lists) | **Stage 1** |
| `settings/users` (staff list) | same as Team | **Stage 1** |
| `settings/users/roles/new` | create flow; no seed needed | n/a |
| `settings/security`, `notifications`, `communications`, `forms-documents`, `workflow`, `portal`, `availability`, `billing`, `payments` | defaults only; no demo-specific override rows yet | Stage 2/5 gap |
| **Services & pricing** `services-pricing` and all sub-pages (`[id]`, `categories`, `inactive`, `new`, `packages/*`, `promotions`) | `seedServices`: 6 `Service` rows (reused from LVP's list) | **Stage 1** (packages/promotions: gap, Stage 5) |
| **Calendar** `/calendar` and all sub-pages, `availability`, `list`, `new`, `today`, `types` | `seedAppointmentTypes`: 3 `AppointmentType` rows only; no `Appointment` rows yet | Stage 2 gap |
| **Invoices** `/invoices` | no `Invoice`/`Payment` rows yet | Stage 2 gap |
| **Documents** `/documents` | `seedDocumentCategories`: 8 `DocumentCategory` rows only; no `Document` records yet | Stage 2 gap |
| **Workspaces (engagements)** `workspaces`, `workspaces/[engagementId]` | no `Engagement`/`Task` rows yet | Stage 2 gap |
| **Leads** `/leads` and all sub-pages (`[id]/*`, `convert/*`) | no `Lead` rows yet | Stage 3 gap |
| **Intake forms** `/intake-forms` and all sub-pages (`[id]/*`, `builder/*`, `send`, `settings`, `templates`) | no `Intake`/`IntakeForm` rows yet | Stage 3 gap |
| **Firm Sign** `/firm-sign` and all sub-pages (`bulk`, `new`, `reports`, `requests/*`, `settings`, `templates/*`), `(kiosk)/firm-sign/in-person*` | no Firm Sign request rows yet | Stage 3 gap |
| **Messages** `/messages` | no `MessageThread`/`Message` rows yet | Stage 2 gap |
| `audit-log` | no `AuditLog` rows for the demo firm yet | Stage 2 gap |
| `sign-ups` | no `PlatformUserSignup`/client sign-up rows for the demo firm yet | Stage 3 gap |
| `modules/[slug]` (generic placeholder: bookkeeping, tax planning, compliance, automations, payroll, advisory, integrations, reports, templates, communications) | no module rows yet; integrations/reports/templates/communications have no API yet (R39) | Stage 5 gap / product gap |

## Client portal (`portal.firmivra.com/demo`)

| Page | Seed file / rows | Stage |
| --- | --- | --- |
| `(public)/page.tsx`, `sign-in`, `sign-up*`, `forgot-password`, `reset-password` | `seed-demo-org.ts`: one working portal login (Harper Collins, client key `01`) | **Stage 1** |
| `(public)/begin/*` (Begin Online forms) | no submissions seeded yet | Stage 3 gap |
| `(public)/calculators/*` | public calculators; no client data needed | n/a |
| `(client)/(tabs)/business`, `documents`, `invoices`, `messages`, `taxes` | portal login exists; tab content (documents/invoices/messages/tax returns) needs Stage 2 engagement/invoice/document/message rows for client `01` | Stage 2 gap |
| `(client)/(tabs)/intake`, `intake/[form]` | no intake submissions yet | Stage 3 gap |
| `(client)/appointments` | no appointment rows yet | Stage 2 gap |
| `(client)/profile` | `ClientProfile` row (client `01`) | **Stage 1** |
| `(client)/signatures` | no signature rows yet | Stage 3 gap |
| `(client)/services` | firm's `Service` rows (shared with firm workspace) | **Stage 1** |
| `(client)/notifications` | no notification rows yet | Stage 3 gap |
| `(client)/resources/*`, `calculator/*` | static/public content; no client data needed | n/a |
| `(signing)/sign`, `sign/samples` | no Firm Sign signing session rows yet | Stage 3 gap |

## Marketing

| Page | Seed file / rows | Stage |
| --- | --- | --- |
| `/page.tsx`, `/portal/page.tsx` | static marketing pages; no seed needed | n/a |

## Notification bell

No `Notification` rows exist for the demo firm or demo client yet (the bell reads from
`notifications`/`notification_deliveries`). Planned for Stage 3, alongside leads and Begin Online,
since several bell items are triggered by those flows (new lead, new submission, new signature
request).
