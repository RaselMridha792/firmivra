# R60: Backend gaps (Super Admin Support, Billing, Sales, then the rest)

Workstream for the API modules that have screens but no working API and no other owner, so that
every screen runs on the real API by Oct 20. Worktree `F:/firmivra-R60`, branch
`rasel/R60-backend`, web port 3600, API port 4600, database `firmivra_r60`.

## Scope and owned paths

- Contracts: `packages/types/src/admin-support/`, `admin-billing/`, `admin-sales/` (then
  `admin-team/`, `admin-subscriptions/` and the small firm gaps below), their tests in
  `packages/types/test/`, the export lines in `packages/types/src/index.ts`, the module's lines
  in `apps/web/src/lib/api.ts` and its typed mock in `apps/web/src/mocks/admin-*-api.ts`.
- API: `apps/api/src/admin-support/`, `admin-billing/`, `admin-sales/` (then the next modules),
  their tests in `apps/api/test/`, the isolation cases in `apps/api/test/isolation/cases/` (and
  the WRITES map for admin routes), the module lines in `apps/api/src/app.module.ts`.
- Not mine: `packages/db` (R0), `infra/` and `.github/` (R1), Bookkeeping Terms (R55, #857),
  Audit & Security, System Settings, Reports (R55), Notifications, Communications,
  Integrations (R56), the screens (their owners in `docs/junior/PAGE-MAP.md`).

Rules for every module: contract PR first (from fresh `main`), then the API PR. `@Roles` on every
route, `AdminPrisma` for admin routes (never `forPlatform` in a handler), the tenant-scoped
client for firm routes, `AuditService.log` on every action on client data, zod +
`ZodValidationPipe`, unit tests, one e2e test per route, an isolation case. No data means empty
lists and zeros, never made-up numbers. At most 2 open non-contract PRs.

## Gap list (Oct 19)

How it was found: a probe called every method of every `create*Client` in `packages/types` with
a recording `request` (1,028 distinct calls) and matched them against every `@Controller` route
in `apps/api/src` (1,051 routes, declaration order kept, to find static paths shadowed by
`:id`). The admin console screens were then checked for direct imports from
`apps/web/src/mocks/` (no contract client at all). 339 screens: 82 admin, 211 firm, 46 portal.

Ordered by screens affected. "Mock only" = the screens import `apps/web/src/mocks/admin-*.ts`
directly; outside mock mode every call fails.

| #   | Module                                                                                                                                    | Screens                                | State on main                                                            | Tables                                                                | Owner                                            |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- | ------------------------------------------------------------------------ | --------------------------------------------------------------------- | ------------------------------------------------ |
| 1   | Super Admin Billing (invoices, estimates, credit notes, payments, recurring, settings)                                                    | 12                                     | Mock only (`admin-billing.ts`, 4,779 lines; `admin-billing-settings.ts`) | B3 (15 tables)                                                        | **R60**, after Support                           |
| 2   | Firm Settings: Overview, Users & Roles (`GET /business/settings/overview`, `GET /business/users`, `/users/summary`, `POST /users/invite`) | 4 (overview, users, billing, security) | Contract on main (R42's `settings-contract.md`), no routes               | memberships, invites, audit_logs, staff_security_settings             | **R60** (no owner found)                         |
| 3   | Super Admin Sales (Sales Center, opportunity, pipeline, pipeline builder)                                                                 | 4                                      | Mock only (`admin-sales.ts` + `admin-sales-seed.ts`)                     | B5 (12) + D1 (3)                                                      | **R60**, after Billing                           |
| 4   | Super Admin Support (dashboard, ticket detail, settings)                                                                                  | 3                                      | Mock only (`admin-support.ts`, 2,653 lines)                              | B2 (13)                                                               | **R60, first**                                   |
| 5   | Super Admin Team (list, new, edit)                                                                                                        | 3                                      | Mock only (`admin-team.ts`, `admin-team-catalog.ts`)                     | platform_admins, org chart, platform_role_permissions                 | **R60** (no owner found)                         |
| 6   | Super Admin Subscriptions                                                                                                                 | 1                                      | Mock only (`admin-subscriptions.ts`, 2,711 lines)                        | stage A `platform_firm_subscriptions`, plans, B3 subscription history | **R60** (no owner found; could sit with Billing) |
| 7   | Firm Sign request detail: `POST /esign/requests/:id/resend-copy`, `GET /esign/requests/:id/download`                                      | 1                                      | Client calls them, no route                                              | esign tables                                                          | **R60** (R13 finished)                           |
| 8   | Templates: `PATCH /business/template-categories/:id` (rename)                                                                             | 1 (template dialogs)                   | Client calls it, no route (create, merge, archive, restore exist)        | template_categories                                                   | **R60**                                          |

Owned elsewhere, not on my list:

- Bookkeeping Terms (12 client calls without routes): R55's #857.
- Admin Audit & Security (3), System Settings (8), Reports (17): R55. Admin Notifications (1),
  Communications (10), Integrations (12): R56 (contracts #858, #859 open).
- Firm Integrations: Ibrahim's drafts #761, #765, #776, #840 add their own mocks
  (`integrations-marketplace.ts`, `-connect.ts`, `-manage.ts`); the API they need should be in
  R56's Integrations contract (see Needs from others).
- Arfan's #853 (admin communications templates library): R56's Communications.

Checked and fine:

- #716 (Payroll), #718 (Bookkeeping), #719 (Compliance) are merged; every call of their clients
  has a route.
- Advisory, Tax Planning, Tasks, Templates, Automations, Payroll, Compliance, Bookkeeping (firm):
  every client call has a route.
- No static path shadowed by `:id`: `esign/requests/summary`, `leads/pipeline`, `leads/options`
  and `documents/summary` are registered before their `:id` routes.
- False positives in the probe: notifications (routes on a base class two controllers extend),
  firm invoices (controller in `payments/invoices/invoices.module.ts`).
- Not checked here: a firm page that calls an existing route whose answer does not fit the
  contract (that shows only at run time). A crawl of every page against the seeded API is a
  later step if time allows.

## Steps

- [x] 1. Gap list (above).
- [x] 2. Support contract: `packages/types/src/admin-support/` (`createAdminSupportClient`,
      `api.adminSupport`), the typed mock, client tests. Own PR from fresh `main`.
- [ ] 3. Support API: `apps/api/src/admin-support/` under `/api/v1/admin/support`.
- [ ] 4. Billing contract.
- [ ] 5. Billing API.
- [ ] 6. Sales contract (Pipeline B5 + Sales Center D1).
- [ ] 7. Sales API.
- [ ] 8. Firm Settings Overview and Users API (contract already on main).
- [ ] 9. Super Admin Team contract and API.
- [ ] 10. Super Admin Subscriptions contract and API.
- [ ] 11. Small firm gaps: e-sign resend-copy and download, template category rename.

## Progress log

- 2026-10-19: step 1, gap list (above). Scrum's correction: Support, Billing and Sales first.
- 2026-10-19: step 2, the Super Admin Support contract (`packages/types/src/admin-support/`,
  `createAdminSupportClient` as `api.adminSupport`, 12 client tests). Notes below.

### Support contract (step 2)

The screens' mock (`apps/web/src/mocks/admin-support.ts`) set the shapes and method names; the B2
tables set what is stored. Where they differ:

1. **Statuses** are the database's five. Escalated and Overdue are flags and tabs (R0's B2
   decision): an escalated ticket has `escalation`, an overdue one `sla.state` BREACHED. The mock's
   ESCALATED status goes; its filter is `escalated: YES` and the ESCALATED tab.
2. **SLA** is worked out on every read. The API keeps the pending response's due time in
   `first_response_due_at`: cleared by a reply sent to the client and while waiting on the
   customer, set again on reopen or when the wait ends. WARNING is under a quarter of the target
   left on the support clock. Warnings and breaches are history rows (`sla.warning`,
   `sla.breached`), once per ticket; a resolved ticket that breached stays BREACHED, otherwise MET.
3. **Targets** are `{ amount, unit }`, stored in minutes, a business day being 480 minutes as in
   the seeded priorities (Medium 480 = 1 business day, Low 960 = 2). A whole number of business days
   reads back as BUSINESS_DAYS, anything else as HOURS. A business-day target runs for the length of
   an open day in the business hours.
4. **Colours** are named tokens (red, orange, yellow, green, blue, purple, grey); the column keeps
   a hex from a fixed table (the seeded #DC2626, #EA580C, #CA8A04 and #2563EB read as red, orange,
   yellow and blue; an unknown hex reads as grey).
5. **Team.** Agents are the Super Admins (role OWNER) and the ACTIVE members of the Customer
   Success / Support department whose role is Customer Support Manager (LEAD), or Customer Support
   Representative or Technical Support Specialist (AGENT). The permission grid is stored as
   `support.*` keys (`view_all`, `view_own`, `assign`, `escalate`, `resolve`, `close`, `merge`,
   `edit_settings`, `delete`, `view_internal_notes`, `manage_canned`) in
   `platform_role_permissions` on those role definitions (OWNER on the CEO's); a role with no
   `support.*` row reads the spec's defaults. Today only a Super Admin can sign in to the console,
   so every caller is OWNER.
6. **Contacts** are the firm's ACTIVE owners, the only firm people admin scope may read. A ticket
   whose contact is another member (raised from the firm's side later) shows "Firm member".
7. **Notification rules** map to `support_notification_rules` rows: ASSIGNEE is
   `notify_assignee`, ADMINS the key `support.view_all`, LEAD `support.escalate`, CLIENT
   `firm.contact` (the ticket's contact; client events only). Events: NEW_TICKET `ticket.created`,
   ASSIGNED `ticket.assigned`, REASSIGNED `ticket.reassigned`, REPLY `ticket.replied` (a new row),
   ESCALATED `ticket.escalated`, SLA_WARNING `sla.warning`, SLA_BREACH `sla.breached`, RESOLVED,
   CLOSED and REOPENED `ticket.resolved` / `.closed` / `.reopened`, CUSTOMER_RESPONSE
   `ticket.customer_replied`. The page's channels are written to every rule.
8. **Escalation rules** are the three `support_escalation_rules` rows by kind (`is_active` =
   enabled). An SLA breach notifies ADMINS when `notify_user_id` is empty, and LEAD when it names
   the Support Lead (409 NO_SUPPORT_LEAD when there is none).
9. **Files:** the documents' five checked types (PDF, JPG, PNG, .xlsx, .docx), 10 MB, at most 10
   per action, under `tenant/<firm>/support/`. `createUpload` (with the firm) first, then the
   action takes the tokens; download only once the scan is clean. The mock also took .doc, .xls,
   .csv and .txt; the API's file checks cover only the five.
10. **Merge** keeps each row on its own ticket (messages, notes and history are insert-only): the
    target's detail also shows the merged tickets' messages, notes and files with `mergedFrom`.
11. **Not stored yet** (see Needs from others): different hours on different days (the API takes
    one opening time for every open day; 422 NOT_SUPPORTED_YET otherwise), `defaultQueue` off, and
    an agent's `available` (reads as `active`).
12. **No mock** in `api.ts`: the screens keep `mocks/admin-support.ts` until they switch.
13. **Firm and contact are fixed** (a B2 trigger: firm, number, source, contact and creator never
    change), so the mock's Change Firm / Contact is not in the contract: a ticket raised for the
    wrong firm is closed and raised again. A new ticket is stored OPEN and moved to the form's
    status in the same transaction (the database starts every ticket OPEN).

## Needs from others

- **R0 (Support, B2), small columns for what the settings page offers:** per-day opening hours
  (`support_settings` has one `opens_at` / `closes_at` for all working days), a `default_queue`
  flag, an agent's availability (round robin skips members who are away), and admin-scope read of
  a ticket contact's name and email when the contact is not an owner (portal-raised tickets).

- **Screen owners (admin Support, Billing, Sales, Team, Subscriptions):** the screens import
  `apps/web/src/mocks/admin-*.ts` directly. Once a contract lands they switch to `api.<module>`
  (one import per file; the typed mock then runs only in mock mode).
- **R56:** do the Integrations contract and API cover the firm-side screens in Ibrahim's drafts
  (#761, #765, #776, #840)? Their mocks define marketplace, connect and manage shapes that are not
  in `createIntegrationsClient` today.
