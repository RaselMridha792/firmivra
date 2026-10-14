# R39 API brief: Communications, Templates, Reports, Integrations, Payroll, Business Advisory

The database for these six modules is in `packages/db` (R39 section of `schema.prisma`, migrations `*_r39_*`, sample rows in `prisma/seed-r39.ts`, tests in `packages/db/test`). No API and no screens exist yet. This file is the brief for the API sessions that follow. The designs and guides are in `docs/mockups/firm-workspace/<module>/source/`.

## Starter templates (decided Oct 14)

The migration and seed hold **one** LVP sample template only. The 48 starter templates from the Templates guide are **not** seeded in SQL. The API creates them **per firm when a firm is set up** (and on demand through `POST /business/templates/starter`), from a starter list kept in code (`packages/types`), one entry per template with a stable `starterKey`. `message_templates (business_id, starter_key)` is unique, so running it again skips templates the firm already has and never overwrites a firm's edits. The starter content uses merge fields and settings, never a hard-coded year, price, phone number or name.

## Database notes the API must respect

- Every table is a firm table with forced RLS: use `TenantPrisma.db`. `businessId` comes from the tenant context.
- Actor columns (`created_by_user_id`, `owner_user_id`...) are plain ids set from the session.
- Integrations hold **no secret**: `integration_connections.secret_ref` names where the secret is kept (Secrets Manager); settings never carry tokens or keys (the database refuses both).
- Payroll is tracking only. Figures stay empty until the provider confirms them; a filing is FILED or PAID only with the provider's or import's confirmation (the database enforces it).
- Rules in the database raise named errors (`COMMUNICATION_SENT`, `PAYROLL_RUN_BLOCKED`, `PLAN_VERSION_FROZEN`...): map them to 409 or 422.
- `integration_requests` are reviewed by Super Admin in admin scope (`db.forAdmin`), status and internal note only.
- Dates and money: money in cents (`*_cents`), dates as `Date`, times `Timestamptz`.

Roles: **STAFF+** = owner, admin, staff (`FIRM_STAFF`); **MGR** = owner, admin (`FIRM_MANAGERS`); **OWNER**; **CLIENT** = portal routes (`portal/:firmSlug/me/...`); **ADMIN** = Super Admin (`admin/...`). Every route writes `AuditService.log` for actions on client data; the finer module permissions in Octavia's guides (view, create, send, export...) are checked in each service from the member's role. Paths are under `/api/v1`. Lists are server-side paged. "Already there" lines name routes that exist today.

## Templates (`business/templates`)

| Method | Path | What | Roles |
| --- | --- | --- | --- |
| GET | `/business/templates` | List and search; tab (all, mine, shared, favorites), kind, category, status, owner, tag, sort | STAFF+ |
| GET | `/business/templates/overview` | Kind cards with counts, recent templates, tools | STAFF+ |
| POST | `/business/templates` | Create (draft or active), writes version 1 | STAFF+ |
| GET / PATCH | `/business/templates/:id` | Read; edit (new version; warns when an active automation uses it) | STAFF+ (edit: owner, or MGR) |
| POST | `/business/templates/:id/{archive,restore,duplicate}` | Archive (warns when used by automations), restore, duplicate | STAFF+ |
| POST | `/business/templates/:id/preview` | Resolve merge fields with sample or a client's data; flags unresolved fields | STAFF+ |
| POST | `/business/templates/:id/test-send` | Send to a test address or number, no client activity | STAFF+ |
| POST | `/business/templates/:id/use` | Record a use (`message_template_uses`) and return the resolved snapshot | STAFF+ |
| PUT / DELETE | `/business/templates/:id/favorite` | Own favourite | STAFF+ |
| PUT | `/business/templates/:id/shares` | Access (private, team, selected) and people | owner of the template, MGR |
| GET | `/business/templates/:id/versions` | Version history | STAFF+ |
| POST / DELETE | `/business/templates/:id/attachments` (+ upload and confirm) | Attachments by S3 key | STAFF+ |
| POST | `/business/templates/import` | DOCX, HTML or text, sanitised | STAFF+ |
| GET / POST / PATCH | `/business/template-categories` (+ `/reorder`, `/:id/archive`, `/:id/merge`) | Categories per kind | read STAFF+, write MGR |
| GET / POST / PATCH / DELETE | `/business/template-merge-fields` | Built-in catalog plus the firm's custom fields | read STAFF+, write MGR |
| GET / PUT | `/business/template-branding` | Footer, disclaimer, signature, letterhead | MGR |
| POST | `/business/templates/starter` | Seed the 48 starter templates for the firm (repeatable by `starter_key`) | MGR |

Already there: Firm Sign templates (`esign/templates`, separate and unchanged); `NotifyService` templates are code (`notify.types.ts`) and stay for system emails.

## Communications (`business/communications`)

| Method | Path | What | Roles |
| --- | --- | --- | --- |
| GET | `/business/communications` | List by tab (bulk campaigns, announcements, scheduled, sent history, drafts), channel, status, date range, search | STAFF+ |
| GET | `/business/communications/overview` | Metric cards, recent, upcoming, quick-action readiness (channel and provider ready) | STAFF+ |
| POST | `/business/communications` | New draft (email, text, announcement) or from a template (snapshot) | STAFF+ |
| GET / PATCH | `/business/communications/:id` | Read; autosave (draft or scheduled only) | STAFF+ |
| PUT | `/business/communications/:id/audience` | Segments, individuals, manual exclusions | STAFF+ |
| POST | `/business/communications/:id/audience/preview` | Selected, automatic exclusions by reason, final eligible count (recomputed) | STAFF+ |
| POST | `/business/communications/:id/{test,review,send,schedule,cancel,pause,resume,archive,restore}` | Test send, final review checks, send now (idempotency key), schedule, cancel, pause, archive | STAFF+ (send, schedule: MGR or send permission) |
| POST | `/business/communications/:id/{duplicate,resend-failed,follow-up}` | New draft from a sent one | STAFF+ |
| POST | `/business/communications/:id/save-as-template` | New template from content | STAFF+ |
| GET | `/business/communications/:id/results` | Metrics, funnel, daily engagement, delivery breakdown | STAFF+ |
| GET | `/business/communications/:id/recipients` | Recipient table (masked address, status, engagement, failure reason) | STAFF+ |
| GET | `/business/communications/:id/events` | Activity timeline | STAFF+ |
| POST | `/business/communications/:id/export` | CSV of results (own permission, audited) | MGR |
| GET / POST / PATCH | `/business/communication-segments` (+ `/:id/{members,preview,duplicate,archive,refresh}`) | Dynamic segments and static lists, member preview | STAFF+ |
| GET / PUT | `/business/communication-consents` | Opt-in, opt-out, suppression per contact and channel | STAFF+ |
| POST | `/webhooks/communications/:provider` | Provider events into `communication_events` (signature checked) | public, signed |
| GET (portal) | `portal/:firmSlug/me/announcements` | Published announcements for the client | CLIENT |

Already there: client Messages (`business/message-threads`, `portal/.../me/messages`) stay as they are; the bell and the email and SMS outbox (`notifications`, `NotifyService`) stay for system notices; the audience picker reads `business/clients` and `business/leads`.

## Integrations (`business/integrations`)

| Method | Path | What | Roles |
| --- | --- | --- | --- |
| GET | `/business/integrations` | Marketplace plus the firm's connections: status counts, tabs, category, search, Live or Test | STAFF+ (read), MGR (write) |
| GET | `/business/integrations/health` | Authorization issues, failed syncs, pending records, last check | MGR |
| POST | `/business/integrations/:provider/connect` | Start the provider's authorization (OAuth redirect URL) | MGR |
| GET | `/business/integrations/:provider/callback` | OAuth return; stores the secret in the secret store, keeps only its reference | MGR |
| GET / PATCH | `/business/integrations/:id` | Overview; configure (entities, frequency, direction, mode, non-secret settings) | MGR |
| POST | `/business/integrations/:id/{sync,pause,resume,test,disconnect,reconnect,rotate-secret}` | Sync now, pause auto sync, connection test, disconnect, rotate | MGR |
| GET / PUT | `/business/integrations/:id/mappings` | Field mappings | MGR |
| GET | `/business/integrations/:id/sync-runs` | Sync history with error detail | MGR |
| GET / POST | `/business/integration-requests` | Request an integration not listed | read own: STAFF+, create MGR |
| GET / PATCH | `/admin/integration-requests` | Review: status, internal note, requester notified | ADMIN |

Already there: Stripe (`business/payments/setup`, `stripe_accounts`) and the per-staff meeting link (`appointments/availability`, `memberships.meeting_url`) stay as they are; the new `Integration` list shows them as read-only cards.

## Reports (`business/reports`)

| Method | Path | What | Roles |
| --- | --- | --- | --- |
| GET | `/business/reports/overview` | KPI cards, category cards, quick reports, recent, scheduled, insights for a date range | STAFF+ (by report permission) |
| GET | `/business/reports/catalog` | Built-in categories, quick reports, data sources and fields the caller may use | STAFF+ |
| POST | `/business/reports/run` | Run a definition (saved, quick or unsaved): KPIs, charts, table (paged, sorted), comparison | STAFF+ |
| POST | `/business/reports/preview` | Limited preview for the builder | STAFF+ |
| GET / POST | `/business/reports/definitions` (+ `PATCH /:id`, `POST /:id/{save-as,archive}`, `PUT /:id/shares`, `PUT/DELETE /:id/favorite`) | Saved reports | STAFF+ (shared edit: owner, MGR) |
| POST | `/business/reports/export` | CSV, XLSX, PDF; large ones queued as a run | STAFF+ with export permission (audited) |
| GET | `/business/reports/runs` | Recent reports and exports | STAFF+ |
| GET / POST / PATCH / DELETE | `/business/reports/schedules` (+ `/:id/{run-now,pause,resume}`) | Scheduled reports | STAFF+ own, MGR any |
| GET / PUT | `/business/reports/settings` | Revenue basis, defaults | MGR |

Already there: `business/dashboard/summary`, per-engagement reports (`business/workspaces/:engagementId/reports`, `engagement_reports`) and the audit log stay as they are; the new module reads them as sources.

## Payroll (`business/payroll`)

| Method | Path | What | Roles |
| --- | --- | --- | --- |
| GET | `/business/payroll/overview` | KPI cards, status donut, volume, by provider, providers, upcoming runs for a period | STAFF+ |
| GET | `/business/payroll/clients` | Payroll clients: tab, client type, provider, frequency, status, staff, next date, sync status, search | STAFF+ |
| POST | `/business/payroll/clients` | Add a client to payroll (creates the PAYROLL engagement when missing) | MGR |
| GET / PATCH | `/business/payroll/clients/:id` | Workspace header and settings | STAFF+ (PATCH: MGR for plan, frequency, assignment) |
| POST | `/business/payroll/clients/:id/{status,pause,resume,archive,remove-service,assign,frequency,plan}` | Service actions (each writes `payroll_client_changes`) | MGR (status: STAFF+) |
| GET / POST | `/business/payroll/clients/:id/activities` | Log activity | STAFF+ |
| GET / POST / PATCH | `/business/payroll/clients/:id/workers` | Employees and contractors (masked, no SSN) | STAFF+ |
| GET / POST | `/business/payroll/clients/:id/runs` | Run list; start or prepare a run | STAFF+ |
| GET / PATCH | `/business/payroll/runs/:id` (+ `/lines`, `/issues`) | Wizard steps 1 to 5, employee pay grid, exceptions | STAFF+ |
| POST | `/business/payroll/runs/:id/{save-draft,ready,approve,submit,reopen}` | Review and approval (approve and submit are separate) | ready: STAFF+; approve, submit, reopen: MGR |
| POST | `/business/payroll/clients/:id/sync` | Queue a provider sync | STAFF+ |
| GET | `/business/payroll/clients/:id/{filings,reports,year-end}` | Filing visibility, report library, year-end checklist | STAFF+ |
| POST | `/business/payroll/clients/:id/reports` | Pull or refresh a provider report | STAFF+ |
| GET / PUT | `/business/payroll/settings` | Firm payroll settings | MGR |

Already there: tasks (`business/tasks`), notes, documents and document requests (`business/clients/:id/documents`, `document-requests`), appointments, client messages and the `PAYROLL` service in `engagements`; the workspace reuses them by the client's PAYROLL engagement. Provider connections come from Integrations.

## Business Advisory (`business/advisory`)

| Method | Path | What | Roles |
| --- | --- | --- | --- |
| GET | `/business/advisory/overview` | KPI cards, recent advisory clients, upcoming meetings, goals, resources | STAFF+ |
| GET / POST | `/business/advisory/clients` | List, filter (client, advisor, service, stage, status); add an advisory client | STAFF+ |
| GET / PATCH | `/business/advisory/clients/:id` | Detail header, KPIs, business health (formula and factors) | STAFF+ |
| GET / POST / PATCH | `/business/advisory/clients/:id/services` | Service workstreams (primary and additional) | STAFF+ |
| GET / POST | `/business/advisory/plans` (+ `PATCH /:id`, `PUT /:id/steps/:step`) | Create and edit a plan across the five steps; list | STAFF+ |
| POST | `/business/advisory/plans/:id/{finalize,send,archive}` | Snapshot a version; deliver to the client | STAFF+ (send: MGR) |
| GET | `/business/advisory/plans/:id/versions` | Version history | STAFF+ |
| GET / POST | `/business/advisory/clients/:id/financials` | Financial snapshots; override needs a reason (audited) | STAFF+ (override: MGR) |
| GET / POST / PATCH | `/business/advisory/{goals,milestones,recommendations,action-items}` | Goals, milestones, recommendations, action items | STAFF+ |
| GET / PUT | `/business/advisory/settings` | Health formula, stale-data days | MGR |
| GET (portal) | `portal/:firmSlug/me/advisory` | The client's sent plan, client-visible action items | CLIENT |

Already there: the BUSINESS_DEVELOPMENT service and `engagements`, tasks, notes, documents, appointments (meetings), `content` (resource library) and per-engagement reports. The advisory workspace reads them by the client's advisory engagement.
