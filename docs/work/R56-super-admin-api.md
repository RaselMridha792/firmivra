# R56: Super Admin API (Notifications, Communications and Broadcasts, Integrations)

From Oct 19 (Rasel's go, relayed by the Scrum thread): R56 moves from firm screens to the Super Admin console's API for three modules whose tables R0 merged in Stage B. Tumit (Integrations) and Arfan (Notifications, Communications, Broadcasts) built the screens mock-first; R56 writes the zod contract first (one contract PR per module), then the API. Their screens and mocks are not changed here: `api.*` points at a contract mock built on their fixtures, and the mapping tables below are what a small follow-up needs to switch each screen.

Read first: `CLAUDE.md`, `docs/work/README.md`, `docs/work/R0-schema.md` (Stage B), `docs/work/R0-stage-b1-notifications.md`, `R0-stage-b6-communications.md`, `R0-stage-b8-integrations.md`.

## Owned paths

`packages/types/src/admin-notifications/**`, `admin-communications/**`, `admin-integrations/**` and their tests under `packages/types/test/`; `apps/web/src/mocks/admin-*-api.ts` (contract mocks); the `admin*` entries in `apps/web/src/lib/api.ts`; `apps/api/src/admin-notifications/**`, `admin-communications/**`, `admin-integrations/**` with their tests in `apps/api/test/`; the module's lines in the admin isolation test's `WRITES` map; this file.

## Rules (from the Scrum thread, Oct 19)

- Contracts follow the database (B6: a firm's clients are never recipients). Routes under `/api/v1/admin/*`, `@Roles('SUPER_ADMIN')`, `AdminPrisma` (never `forPlatform` in a route handler), platform audit entries, no firm data without a support grant, unit tests, an e2e test per route, static routes before `:id`, synthetic data only.
- Send and broadcast go through the existing email and SMS adapters (`EMAIL_MODE`, `SMS_MODE`); the same code runs against AWS later. Credentials are stored only as a secret reference. What cannot be sent yet is recorded and queued, and the PR says so.
- No schema edits: missing tables go under "Needs from others".
- Order: Notifications; Communications (inbox, then broadcasts); Integrations (catalog, then API keys, webhooks, logs). At most 2 non-contract PRs open.

## Steps

- [x] 1. Notifications contract (`packages/types/src/admin-notifications`, contract mock, `api.adminNotifications`)
- [x] 2. Notifications API (`/api/v1/admin/notifications`)
- [x] 3. Communications inbox contract (`packages/types/src/admin-communications`), then API (#873, #878)
- [x] 4. Broadcasts contract, then API (#886, #891)
- [ ] 5. Integrations catalog and platform contract, then API
- [ ] 6. API keys, webhooks, logs and usage contract, then API
- [ ] 7. Screens (Rasel, Oct 19): once a module's API is on main, switch its screens from the local mock to the contract (Arfan's Notifications and Communications, Tumit's Integrations), finish the placeholder pages (communications/new, templates, templates/new, templates/[id]/edit) and fix design gaps against `docs/mockups/super-admin`. Files Arfan or Tumit still change (Arfan's open #853, #862, #869) are coordinated through the Scrum thread.

## Mock to contract mappings

### Notifications (Arfan, `mocks/admin-notifications.ts` → `AdminNotification`)

| Mock (`AdminNotificationFixture`) | Contract |
| --- | --- |
| `id` (`platform-notification-001`) | `id` (uuid) |
| `title` | `title` |
| `description` | `body` (nullable) |
| `relatedName` | `source.label` |
| `relatedType` (`Firm Account`, `Firm Application`, `Platform Update`) | `source.type` (a record code: `business`, `firm_application`, `system`...); the firm, when there is one, is `business { id, name }` |
| `category`, `priority`, `attention` | the same enums (`PlatformNotification*`) |
| `isRead` | `readAt !== null` |
| `actionLabel` (`Review` / `View Details`) | not in the contract: `Review` when `attention === 'ACTION_REQUIRED'`, else `View Details` |
| (new) | `type` (event key), `requiresAction`, `resolvedAt`, `resolvedBy`, `dismissedAt`, `createdAt` |
| Status filter `UNREAD` / `READ` / `ACTION_REQUIRED` / `RESOLVED` / `DISMISSED` | `status` query, same five values |
| Filter `CRITICAL` (summary card) | `priority: 'CRITICAL'` |
| `listAdminNotifications()` (all 124, filtered and paged on the page) | `api.adminNotifications.list({ ...filters, page, pageSize })` (server paging); cards from `summary()` (`total`, `unread`, `actionRequired`, `critical`, `resolvedToday`); bulk bar `bulk({ ids, action })`; "Mark all as read" `markAllRead(filters)`; row actions `read`, `unread`, `resolve`, `dismiss` |

### Communications inbox (Arfan, `mocks/admin-communications-inbox.ts` → `admin-communications`)

| Mock (`CommunicationsMock`, `CommunicationConversation`, `CommunicationMessage`) | Contract |
| --- | --- |
| `CommunicationChannel` `Email` / `SMS` / `Internal` | `CommChannel` `EMAIL` / `SMS` / `INTERNAL` (also `IN_APP`) |
| `CommunicationContactType` `Client` / `Support` | `FIRM` (a firm's people; a firm's own clients are never contacts, B6) |
| `Lead` / `Internal` | `LEAD` / `TEAM` |
| conversation `id` (`blue-ridge`) | `id` (uuid) |
| `name`, `initials`, `avatarTone` | `contact.name` (initials and tone are the screen's own) |
| `preview`, `time` (display strings) | `lastMessage.excerpt`, `lastMessage.at` / `lastMessageAt` (ISO; format on the screen) |
| `channel` | `lastMessage.channel` |
| `unread`, `mention`, `scheduled` | `unread`, `mentionsMe`, `hasScheduled` (also `hasFailed`) |
| `assignedTo` (a name) | `assignedTo { userId, name }` |
| `messages` (in the list) | only in `conversations.get(id).messages` |
| message `from: 'contact' \| 'admin'` | `direction` `INBOUND` / `OUTBOUND` / `INTERNAL` |
| message `sender` (a name), `time` | `sender { userId, name }` (null inbound) or `fromAddress`; `sentAt` / `createdAt` |
| (new) | message `status`, `subject`, `recipients` with delivery results, `mentions`, `scheduledAt`, `errorCode` |
| `summary.unread`, `open`, `waiting`, `scheduled`, `failed` | `summary()` `unread`, `open`, `waitingOnReply`, `scheduled`, `failed` |
| `summary.channels` (`All`, `Email`, `SMS`, `Internal`) | `byChannel` (`EMAIL`, `SMS`, `INTERNAL`, `IN_APP`); All is their sum |
| `summary.trends`, `trendNote` | not in the contract: no history to compare; leave the trend chips out |
| `contactDetails` (plan, status, source) | `contact` (type, business, email, phone); plan and status are the firm record's (Firms page) |
| `tags` (label + tone) | `tags` (strings); the tone is the screen's own |
| `activity` | not in the contract (the audit trail is Audit & Security's) |
| `currentAdmin` | the signed-in admin (`api.adminMe` / session), not this module |

### Broadcasts (Arfan, `mocks/admin-communications-broadcasts.ts`, `-audience.ts`, `-review.ts` → `api.adminBroadcasts`)

| Mock | Contract |
| --- | --- |
| `AdminBroadcastStatus` `DRAFT` / `SCHEDULED` / `SENT` / `FAILED` | `CommBroadcastStatus`, also `SENDING`, `PARTIALLY_SENT`, `CANCELLED` |
| broadcast `channel` (one) | `channels[]` (EMAIL, SMS, IN_APP), each with its own subject, body, status and counts |
| `audience` (a name) | `segment { id, name }` |
| `recipients` | `recipientCount` (counted when the send starts) and `channels[].sentCount` / `failedCount` |
| `date`, `dateLabel`, `timeLabel` | `scheduledAt` + `scheduledTimeZone`, or `finishedAt` (ISO; format on the screen) |
| `createdBy` (a name) | `createdBy { userId, name }` |
| `description` | not stored (no column in B6); see "Needs from others" |
| `openRate`, `clickRate` | not tracked (no open or click events); show the quiet empty state, not numbers |
| `metrics` (total, drafts, scheduled, sent, failed) | `broadcasts.summary()` |
| `listBroadcastOptions().categories` | template categories (`api.adminCommunications.categories.list`) |
| `listBroadcastOptions().templates` | `api.adminCommunications.templates.list` |
| `AudienceSegment` `contacts`, `updatedLabel` | `lastCount`, `lastCountedAt` |
| `AudienceSegment` `icon`, `tone` | the screen's own |
| audiences "All Clients", "Active Clients"... | **not allowed**: a firm's clients are never reached (B6). Audiences are firm owners (by firm status or a list of firms), sales leads and the team (`definition.contactTypes`) |
| review `category`, `filters`, `uploadedList` | `filters` is the segment's `definition`; `category` and an uploaded list are not stored (see "Needs from others") |

### Integrations, part 1 (Tumit, `mocks/admin-integrations.ts` → `api.adminIntegrations`)

The contract keeps Tumit's method names and field names, so his screens switch with few changes. `api.adminIntegrations` points at his mock object in mock mode (cast) until then.

| Mock | Contract |
| --- | --- |
| `listPlatform({ status: [a, b] })` | `status: 'A,B'` (comma separated) |
| `includeRemoved`, `descending` (booleans) | `'true'` / `'false'` in the query |
| `LogoFile.contentType` (string) | one of `image/png`, `image/jpeg`, `image/webp` |
| `firmOptions().planId`, `planName` (always set) | nullable (a firm with no plan) |
| `INTEGRATION_ERRORS` | `ADMIN_INTEGRATION_ERRORS` (adds `NOT_FOUND`, `DUPLICATE_PROVIDER`) |
| `platformUsage`, API keys, webhooks, logs, usage, thresholds, `auditTrail` | part 2 contract (usage thresholds and an integrations audit trail have no B8 table: see "Needs from others") |
| `CATEGORIES`, `INTEGRATION_STATUSES`, run statuses, environments | the database enums (`PlatformIntegrationCategory`, `PlatformIntegrationStatus`, `IntegrationSyncRunStatus`, `IntegrationEnvironment`): same values |
| `uptime30d` (seeded numbers) | the share of successful calls over 30 days from `platform_integration_usage_daily`; null (N/A) without calls |
| `highlights` `activeSubscriptions` (Stripe) | not returned: no source for it |
| `dependents.webhooks` | always empty: B8's webhook endpoints name no integration |
| `webhookUrl` | only providers whose route exists (Stripe: `APP_BASE_URL/api/v1/webhooks/stripe`) |
| a test's result | a local check (every required value set, with the environment's prefix); the message says the provider is not called yet |
| `reconnectPlatform` | OAuth providers run the test, which says the account is not linked (the provider sign-in needs R1); others 409 INVALID_STATE |
| errors 422 in the mock | 409 with the same code (NOT_FOUND 404, validation 400) |

### Integrations, part 2 (Tumit, same mock → `api.adminIntegrations`)

| Mock | Contract |
| --- | --- |
| `ApiKey.createdBy` (always set) | nullable (a key from a seed) |
| `usage24h.requests` | the rollup's latest day for the key; null without a row |
| `usage24h.peakPerMinute`, `rateLimited` | null: not tracked |
| `CreateWebhookBody.integrationId`, `WebhookEndpoint.integration` | B8 links no endpoint to an integration: no body field, `integration` always null |
| `signingSecretHint` (`whsec_••••91c2`) | `whsec_••••••••` when set (no last four is kept) |
| `WebhookDelivery.payload` | null (B8 keeps none); `retries` is the earlier attempts of the event |
| `redeliver` result | a `PENDING` attempt: R1's webhook worker sends it |
| `IntegrationLog.action` | a label made from the stored action code |
| `LogQuery.platformOnly`, `descending` | `'true'` / `'false'` in the query (`descending` defaults to true) |
| `exportLogs({ query, format })` → file `content` | 202 with a queued `AdminExportJob` (B1); CSV only (B1's `ReportFormat` has no JSON); R1's export worker makes the file; `logExports()` lists mine |
| `usage().planDistribution`, `alerts` | always empty: the rollup has no per-plan counts and thresholds have no table |
| `thresholds`, `saveThresholds` | not in the contract (no table; "Needs from others") |
| `auditTrail` | from `audit_logs` (`integrations.*` actions); `changes` lists the changed fields, never values |

## Needs from others

- **R1: the communications dispatcher job** (platform scope): moves `SCHEDULED` messages to `SENDING` at their time and sends them (the API's `CommInboxService.dispatch` does the sending for one message), and wires SES and SNS delivery events to the recipients by `provider_message_id`, plus inbound mail and SMS as `RECEIVED` messages (B6 "Needs from R1"). Until then a scheduled message stays scheduled and delivery stops at `SENT`.
- **Cc on one email**: NotifyService sends one address per message, so a Cc or Bcc recipient gets their own copy (no shared Cc header). R6 could add `cc` to `NotifyMessage` later.
- **R0: broadcast fields the screens show but B6 does not store** (schema request, not edited here): a broadcast's `description` and `category`, and an uploaded recipient list (a list of addresses as an audience). Open and click rates need email open and click events (SES event wiring, R1). Until then the screens leave them out.
- **R1: Integrations workers and secrets** (B8 "Needs from R1"): the sync worker (a `SYNC` run stays `QUEUED` until it runs), real provider connection tests (today a local check of the values), the health checks, the daily usage rollup (`platform_integration_usage_daily`; until it runs, usage and uptime show N/A), the API role's Secrets Manager grant on `firmivra/platform/integrations/*` (SECRETS_MODE=aws), the S3 grant on `platform/integrations/*` for catalog logos (the contract keeps the logo's metadata only), and an OAuth app per OAuth provider (DocuSign) for reconnect.
- **R0: webhook to integration link** (schema request, not edited here): `platform_webhook_endpoints` has no integration column, so an integration's dependents list no webhooks.
- **R0: Integrations part 2 gaps** (schema request, not edited here): a usage alert thresholds table (error rate, latency, quota, cost, sync failures, versioned); per-plan adoption in `platform_integration_usage_daily` (the Usage page's plan distribution); a redacted payload on `platform_webhook_deliveries` (the deliveries drawer shows one).
- **R1: Integrations part 2 workers**: the webhook delivery worker (sends `PENDING` deliveries, redeliveries included, and writes each result), the export worker for `INTEGRATION_LOGS` jobs (the file under `platform/exports/<id>/`), and B1's download route (`GET /api/v1/admin/exports/:id` with a signed URL).

- **R1: Integrations workers and secrets** (B8 "Needs from R1"): the sync worker (a `SYNC` run stays `QUEUED` until it runs), real provider connection tests (today a local check of the values), the health checks, the daily usage rollup (`platform_integration_usage_daily`; until it runs, usage and uptime show N/A), the API role's Secrets Manager grant on `firmivra/platform/integrations/*` (SECRETS_MODE=aws), the S3 grant on `platform/integrations/*` for catalog logos (the contract keeps the logo's metadata only), and an OAuth app per OAuth provider (DocuSign) for reconnect.
- **R0: webhook to integration link** (schema request, not edited here): `platform_webhook_endpoints` has no integration column, so an integration's dependents list no webhooks.
- **R0: Integrations part 2 gaps** (schema request, not edited here): a usage alert thresholds table (error rate, latency, quota, cost, sync failures, versioned); per-plan adoption in `platform_integration_usage_daily` (the Usage page's plan distribution); a redacted payload on `platform_webhook_deliveries` (the deliveries drawer shows one).
- **R1: Integrations part 2 workers**: the webhook delivery worker (sends `PENDING` deliveries, redeliveries included, and writes each result), the export worker for `INTEGRATION_LOGS` jobs (the file under `platform/exports/<id>/`), and B1's download route (`GET /api/v1/admin/exports/:id` with a signed URL).
- **R55 / Fahad: firm Integrations gaps** (from Ibrahim's drafts and R56's tabs): `IntegrationCard` has no secondary action, so the main page shows Sync Now or Test by sync mode instead of the design's per-provider pair; the connect flow's Add Custom Folder has no contract field (shown disabled); the kit has no provider logo set, so cards show the provider's initial.

## Progress log

- 2026-10-19: Plan agreed with the Scrum thread; this file added.
- 2026-10-19: Notifications contract #858. Notifications API (`apps/api/src/admin-notifications`): 12 routes, `AdminPrisma` only, audit rows for resolving or dismissing security and billing items; unit (9) and e2e (12) tests; the admin isolation test's `WRITES` has the six writes and now keeps one dev token per person (a token per call hit the token rate limit).
- 2026-10-19: Communications inbox contract: summary, contacts, conversations, messages (draft, send, schedule, cancel, retry, delete draft), templates and categories, merge fields; contract mock on Arfan's inbox data; 8 contract tests.
- 2026-10-19: Broadcasts contract (`api.adminBroadcasts`): broadcasts with per-channel content, audiences (segments) and counts, the file library upload ticket, recipient results; contract mock on Arfan's broadcast and audience fixtures; 6 contract tests.
- 2026-10-19: Communications inbox API (`apps/api/src/admin-communications`), stacked on #873: 25 routes; send now through NotifyService (two new Firmivra templates, `platform.message-email` and `platform.message-sms`); scheduled messages wait for the dispatcher job (R1); unit (11) and e2e (16) tests; the admin isolation test's `WRITES` has the 19 writes, each on a seeded record.
- 2026-10-19: Broadcasts API (`admin-broadcasts.controller.ts`, `comm-broadcasts.service.ts`), stacked on #878 and #886: 19 routes; audiences resolved per channel (firm owners, leads, team; in-app to the team's bells), send and retry through NotifyService with per-recipient results, schedules wait for the dispatcher (R1); unit (5) and e2e (9) tests; 14 more writes in `WRITES`.
- 2026-10-19: Broadcasts contract #886 and API #891 merged. Integrations contract, part 1 (`packages/types/src/admin-integrations`: summary, access, providers, plans, firm options, platform integrations, catalog), committed on `rasel/R56-admin-integrations-contract`; 6 contract tests; `api.adminIntegrations` points at Tumit's mock (cast).
- 2026-10-19: Integrations contract part 1 PR #896. Integrations API part 1 (`apps/api/src/admin-integrations`), stacked on #896: 24 routes (dashboard, providers, platform integrations, runs, catalog, plans and firm rules, preview); provider definitions in code; credentials in a platform secret store (a new reference per save, so the database stamps each rotation; masked hints only); a test is a TEST run queued in admin scope and finished by `IntegrationRunWorker` in platform scope (only the platform moves a run); audit rows carry B4's fields (INTEGRATION, SECURITY for credentials); unit (13) and e2e (18) tests; 16 writes in `WRITES` (`admin-integrations-writes.ts`, plus a `params` hook for `:planId`).
- 2026-10-19: Integrations contract, part 2 (`packages/types/src/admin-integrations/operations.ts` and the client): API keys, webhooks and deliveries, logs (filters, facets, record, B1 export job), usage report, the audit trail; 5 contract tests; committed on `rasel/R56-admin-integrations-contract-2` (stacked on #896), opened after #896 merges.
- 2026-10-20: Screens (step 7), Notifications: the page reads `api.adminNotifications` (server paging and filters, the cards, row and bulk actions, mark all as read, read on open); unread rows get the blue outlined action and status events a solid icon, as in the design; screenshots at 1440 px (data, empty) and 375 px in `apps/web/e2e/screenshots/arfan-notifications/`.
- 2026-10-19: Integrations contract part 1 #896 and API part 1 #904 merged. Integrations API part 1 (`apps/api/src/admin-integrations`), stacked on #896: 24 routes (dashboard, providers, platform integrations, runs, catalog, plans and firm rules, preview); provider definitions in code; credentials in a platform secret store (a new reference per save, so the database stamps each rotation; masked hints only); a test is a TEST run queued in admin scope and finished by `IntegrationRunWorker` in platform scope (only the platform moves a run); audit rows carry B4's fields (INTEGRATION, SECURITY for credentials); unit (13) and e2e (18) tests; 16 writes in `WRITES` (`admin-integrations-writes.ts`, plus a `paramsFn` hook for `:planId`).
- 2026-10-19: Integrations contract, part 2 (`packages/types/src/admin-integrations/operations.ts` and the client): API keys, webhooks and deliveries, logs (filters, facets, record, B1 export job), usage report, the audit trail; 5 contract tests; PR #906.
- 2026-10-19: Integrations API, part 2 (`admin-integrations-ops.controller.ts`, `api-access.service.ts`, `integration-insights.service.ts`), stacked on the API part 1 and contract part 2 branches: 17 routes (API keys issued once with the hash only, rotate, revoke; webhooks with the signing secret once and rotation; deliveries and redelivery as a later PENDING attempt; the log with filters, facets, a record and a B1 export job; usage from the rollup; the module's audit trail from `audit_logs`); unit (18 in the file) and e2e (11) tests; 7 more writes in `WRITES`. Branch `rasel/R56-admin-integrations-api-2`.
- 2026-10-20: Notifications deep links (`rasel/R56-notifications-links`, PR when a slot frees): opening an item marks it read and goes to the record behind it (the notifications spec, §8 and §9): application, firm, support ticket, invoice, audit event, platform integration, catalog entry or log record by `source.type` and id; otherwise the firm it is about; otherwise the details panel. The mock sends the API's snake_case source types, and its two application items open records of the firm-applications mock; `r56-notifications-links.spec.ts` checks both paths.
- 2026-10-20: Screens (step 7), Communications, on `rasel/R56-communications-screens` (PR after #918 or #907 merges): inbox, New Message, templates (with Edit Template, a placeholder until now), the broadcasts dashboard and its four-step wizard, all on `api.adminCommunications` and `api.adminBroadcasts`. The wizard makes the draft in step 1 and carries `?id=`; step 1's description, category and template stay in the tab (B6 keeps none). Nothing is seeded; activity, trends, opens and clicks keep their frames empty. The contract mock now carries Arfan's 24 templates. Arfan's `mocks/admin-communications-review.ts`, `-broadcast-message.ts` and `-create-template.ts` have no importer any more (his to remove).
- 2026-10-20: Communications design pass at 1440 px (main merged in after #918): inbox columns at the design's 30/45/25 split and slimmer channel chips; the composer toolbar draws plain glyphs; the contract mock turns Arfan's preview-only threads into one contact message (previews, times, channel counts); Broadcasts' cards compact and all five status tabs shown (search and dates below them under 2xl); the audience step puts Selected Audience below the segments under 2xl so every column shows; the review preview opens on the broadcast's own channel; step 1's summary shows a saved draft's segment, count and message. Screenshots in three states in `apps/web/e2e/screenshots/r56-communications/`.
- 2026-10-20: Integrations screens on the contract (`rasel/R56-integrations-screens`): the 44 screen files import `integrations/_components/integrations-contract.ts` (`api.adminIntegrations`, the UI constants, and the contract's types by the screens' names) instead of Tumit's mock. Mock mode is the contract over Tumit's store (`mocks/admin-integrations-api.ts`: text flags, comma-separated statuses, the log export as a B1 job; no key peaks, alerts, plan counts, payloads or webhook links, as the API). Where B8 keeps nothing, the widget keeps its frame with a quiet line: alert thresholds (Usage and the wizard's Alerts), plan distribution, a key's peak, a delivery's payload. The inbound webhook's integration picker is gone (no column). Export queues a CSV job and the logs page lists Recent Exports. Tumit's four integrations specs (28 tests) pass in mock mode.
- 2026-10-20: Integrations design pass at 1440 px against the five frames in `docs/mockups/super-admin/integrations/source`: compact summary cards (the design's check and dots on solid discs, no ring on the default Total card), panel buttons beside their headers, catalog tiles that fit, the catalog's status switch and word on one line, the plain link glyph in URL fields; the mock drops webhook dependents (no B8 link). Screenshots in `apps/web/e2e/screenshots/r56-integrations/`. Kept differences: six section tiles (the spec's sections; the design's Settings tile has no page), the kit menu's caret beside the row kebab, plan pills that wrap at 1440, category marks where the design has brand logos (no logo uploaded).
- 2026-10-20: Firm Integrations (`rasel/R56-firm-integrations`, at the Scrum thread's request): Ibrahim's four drafts merged (#761 list, #765 marketplace, #776 connect, #840 Manage Overview; his commits kept), then the five Manage tabs on the R55 contract: Sync Settings (only changed fields; directions an enabled object cannot use are refused), Data Mapping (Configure Mapping per scope), Permissions (missing ones with Reconnect), Sync History (filters, paging, run guidance), Troubleshooting (connection test, quick fixes), and the Custom API & Webhooks setup for a `custom_api` connection (write-only secret). One Manage shell (header with a real overflow menu, six tabs); `/integrations/{provider}/setup` takes the OAuth return to the connect flow. Fixes: the list's four tabs fit at 1440 px; the marketplace says when access is denied; two of Ibrahim's specs updated to his last screen changes. Specs: Ibrahim's four plus `r56-integration-manage-tabs.spec.ts` (42 tests) pass in mock mode.
- 2026-10-20: Design pass on the Super Admin Dashboard, Firms and Applications (`rasel/R56-admin-core-design`): the dashboard's applications table has its own Email column at 1440 and one-line Review buttons; Platform Modules open the built modules instead of saying Coming Soon (Leads / CRM opens the pipeline); Firms' search sits on the title row and Open Firm shows at 1440; every card keeps its frame with a dash when the API is down (dashboard, Firms, Applications), and the firm applications mock has an empty mode (`NEXT_PUBLIC_API_MOCK_EMPTY=firmApplications`). Not built for want of an API: Add Firm Manually, Edit Firm Details, Deactivate Firm (R4's firm calls).
- 2026-10-20: Design pass on R60's Support and Billing screens (`rasel/R56-r60-design-pass`, agreed with R60 by cross-session message: no adapter files; Sales after #930, Subscriptions and Team after #951 and #952): Support's buttons on the title row, compact cards with the trend beside the number, a content-width ticket status pill, the slim attachment row, Support Settings card buttons beside their titles; Billing's buttons on the title row, py-2 rows, smaller status badges and quick actions, Payments and Estimates columns that fit beside their details panels. R60's six specs (39 tests) pass.

## Handoff for a fresh session (written Oct 20, 21:00 UTC)

**State.** Merged from R56: the notifications, communications and integrations contracts and APIs (#858 to #907), the Super Admin screens on them (#918, #922, #924, #928), their design pass (#942), the firm Integrations module (#937) and its Manage page design (#949), the Support and Billing design pass (#956), and the Dashboard, Firms and Applications design pass (#960). Open:

- **#963** `rasel/R56-form-controls`: the shared form controls (`packages/ui` Input, Select, Textarea, Checkbox, Radio, FormField, FormSection; the new `label-text.tsx` draws a red trailing " *"), plus three Begin field files agreed with R60: `begin/_blocks/intake-scale.module.css`, `intake-grid.tsx` and `form-blocks.tsx` (unchanged). Tell R60 when it merges.
- **#967** `rasel/R56-firm-integrations-tabs`: the Connect wizard against the Microsoft 365 frame; Sync History and Troubleshooting in the Manage Overview's language.

Limits: at most 2 open non-contract PRs; `git merge origin/main`, never rebase or force-push; local checks only (lint, typecheck, the touched mock specs); at most two heavy jobs at a time. Every PR body: the mockup beside 1440 px screenshots in three states (with data, empty, API unreachable; for form controls, empty, filled and errors) and the ticked `docs/design-match.md` checklist. No "Co-Authored-By" or "Generated with Claude Code" lines.

**Ownership (Rasel, Oct 20).** The developers keep no work. Sessions may change any file `docs/junior/PAGE-MAP.md` lists under a developer, inside their task, after merging main. R60 owns Support, Billing, Sales, Subscriptions and Team, so agree file splits with R60 (`firmivra-r60-f6`) by cross-session message and keep visual fixes out of the `*-api.ts` adapters. R60 also owns Begin Online outside the three field files above.

**Next, in order:**

1. **Firmivra's Privacy Policy and Terms of Service pages** (Rasel approved, branch `rasel/R56-legal-pages`):
   - Build them from `docs/specs/Firmivra_Privacy_Policy.docx` and `Firmivra_Terms_of_Service.docx`; extract with python-docx into the scratchpad and keep the wording.
   - First check for an existing public legal route (platform legal documents #885, the sign-up consent) and reuse it.
   - Put the real URLs in `apps/web/src/lib/company.ts` (`privacyUrl`, `termsUrl`, built from config, no hard-coded hosts) so the footers link to them. No Security page (no text exists).
   - `company.ts` has PLACEHOLDER `legalName` and `county`: do not invent them; list them in the PR body.
2. **Sales design pass** (Super Admin `sales/`, free since R60's #930 merged): Sales Center and Pipeline against `docs/mockups/super-admin/sales/source/`, three states, no adapter changes.
3. **Settings > Overview rewrite and Settings > Locations** (after the Locations database and API exist; Rasel is deciding who builds them). Read `docs/specs/settings-review-2026-10-20/CHANGE-LIST.md` first. Octavia's change: "Active Companies" becomes "Locations". Overview items 1 to 31 in `overview--*.md`; mockups in `.../overview/` and `.../locations/`.

**How the design passes were done.**
- A temporary Playwright spec (never committed, `e2e/mock/zz-*.spec.ts`) shoots pages at 1440 px into the scratchpad.
- Empty state: start mock mode with `NEXT_PUBLIC_API_MOCK_EMPTY=<module>`.
- API unreachable: a temporary `playwright.r56.config.ts` that imports `playwright.mock.config.ts` and sets `NEXT_PUBLIC_API_MOCK` to every module except the one under test (`NEXT_DIST_DIR: '.next/r56'`). Delete both afterwards.
- Firm API screens without a mock are served by `page.route('**/api/v1/business/...')` with contract-parsed fixtures (`src/mocks/integrations-*.ts`).

**Gotchas.**
- Bash heredocs break on apostrophes inside Python: write the script with the Write tool and run it.
- Windows Python cannot open `/f/...` paths: `cd` there and use relative paths.
- Run Prettier only on the files you changed, never a whole folder.
- A full parallel spec run times out long intake tests on this laptop: rerun failures alone before blaming the change.
- `r22-begin-online` (Begin header link count) and `fahad-firm-responsive` (Invoices chart at 320 px) fail on main for reasons outside R56's files.
