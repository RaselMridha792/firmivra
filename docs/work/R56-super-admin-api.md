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

## Progress log

- 2026-10-19: Plan agreed with the Scrum thread; this file added.
- 2026-10-19: Notifications contract #858. Notifications API (`apps/api/src/admin-notifications`): 12 routes, `AdminPrisma` only, audit rows for resolving or dismissing security and billing items; unit (9) and e2e (12) tests; the admin isolation test's `WRITES` has the six writes and now keeps one dev token per person (a token per call hit the token rate limit).
- 2026-10-19: Communications inbox contract: summary, contacts, conversations, messages (draft, send, schedule, cancel, retry, delete draft), templates and categories, merge fields; contract mock on Arfan's inbox data; 8 contract tests.
- 2026-10-19: Broadcasts contract (`api.adminBroadcasts`): broadcasts with per-channel content, audiences (segments) and counts, the file library upload ticket, recipient results; contract mock on Arfan's broadcast and audience fixtures; 6 contract tests.
- 2026-10-19: Communications inbox API (`apps/api/src/admin-communications`), stacked on #873: 25 routes; send now through NotifyService (two new Firmivra templates, `platform.message-email` and `platform.message-sms`); scheduled messages wait for the dispatcher job (R1); unit (11) and e2e (16) tests; the admin isolation test's `WRITES` has the 19 writes, each on a seeded record.
- 2026-10-19: Broadcasts API (`admin-broadcasts.controller.ts`, `comm-broadcasts.service.ts`), stacked on #878 and #886: 19 routes; audiences resolved per channel (firm owners, leads, team; in-app to the team's bells), send and retry through NotifyService with per-recipient results, schedules wait for the dispatcher (R1); unit (5) and e2e (9) tests; 14 more writes in `WRITES`.
- 2026-10-19: Broadcasts contract #886 and API #891 merged. Integrations contract, part 1 (`packages/types/src/admin-integrations`: summary, access, providers, plans, firm options, platform integrations, catalog), committed on `rasel/R56-admin-integrations-contract`; 6 contract tests; `api.adminIntegrations` points at Tumit's mock (cast).
- 2026-10-19: Integrations contract part 1 #896 and API part 1 #904 merged. Integrations API part 1 (`apps/api/src/admin-integrations`), stacked on #896: 24 routes (dashboard, providers, platform integrations, runs, catalog, plans and firm rules, preview); provider definitions in code; credentials in a platform secret store (a new reference per save, so the database stamps each rotation; masked hints only); a test is a TEST run queued in admin scope and finished by `IntegrationRunWorker` in platform scope (only the platform moves a run); audit rows carry B4's fields (INTEGRATION, SECURITY for credentials); unit (13) and e2e (18) tests; 16 writes in `WRITES` (`admin-integrations-writes.ts`, plus a `paramsFn` hook for `:planId`).
- 2026-10-19: Integrations contract, part 2 (`packages/types/src/admin-integrations/operations.ts` and the client): API keys, webhooks and deliveries, logs (filters, facets, record, B1 export job), usage report, the audit trail; 5 contract tests; PR #906.
- 2026-10-19: Integrations API, part 2 (`admin-integrations-ops.controller.ts`, `api-access.service.ts`, `integration-insights.service.ts`), stacked on the API part 1 and contract part 2 branches: 17 routes (API keys issued once with the hash only, rotate, revoke; webhooks with the signing secret once and rotation; deliveries and redelivery as a later PENDING attempt; the log with filters, facets, a record and a B1 export job; usage from the rollup; the module's audit trail from `audit_logs`); unit (18 in the file) and e2e (11) tests; 7 more writes in `WRITES`. Branch `rasel/R56-admin-integrations-api-2`.

## Handoff for a fresh session (written Oct 19, 15:20 UTC)

**State:** merged #858, #866, #873, #878, #886, #891. Open: the Integrations contract part 1 PR (`rasel/R56-admin-integrations-contract`, main merged in). Contract PRs open one at a time and do not count against the 2 open non-contract PRs. After a lower PR is squash-merged, `git merge origin/main` into the stacked branch (never rebase or force-push; if a push is rejected because the review thread merged main on GitHub, merge `origin/<branch>` too and keep the wider resolution).

**Next, in order:**
1. Integrations contract part 1 PR: opened (above).
2. **Integrations API, part 1** (`apps/api/src/admin-integrations/`): provider definitions in code (Stripe, Twilio, SES, S3, an AI provider at least; fields, auth type, test support, volume unit); platform integrations on `platform_integrations` with Tumit's extra fields in the non-secret `settings` JSON; credentials through a secret-store adapter (local: a reference string; AWS Secrets Manager is R1's); connection tests recorded as `platform_integration_runs` (kind TEST) and `platform_integration_logs` (a local tester checks that required values are present and carry the environment's prefix; real provider calls come with R1's secrets); activation rules (passing test, or `confirmWithoutTest` when the provider has no test); disable, enable, remove are SUPER_ADMIN; versioned saves (`version`, 409 CONFLICT); one live connection per provider and environment; catalog CRUD with plans and firm rules (`platform_integration_catalog*`), access-loss warning, preview; summary and stats from `platform_integration_usage_daily`. Audit: category INTEGRATION, SECURITY for credentials. Add every write to the admin isolation test's `WRITES`.
3. **Integrations contract and API, part 2:** API keys (`fv_live_`/`fv_test_`, hash only, shown once, rotate, revoke), webhooks and deliveries (signing secret once, redeliver), logs (filters, facets, record with related events, export via B1 `platform_export_jobs`), usage report from the rollup, `platformUsage`. Usage thresholds and an integrations audit trail have no B8 table: put them under "Needs from others" (R0).
4. **Screens** (Rasel, Oct 19): switch Notifications, Communications (inbox, broadcasts, templates) and Integrations from local mocks to the contracts using the mapping tables above; finish placeholder pages; match `docs/mockups/super-admin` (every widget, empty states, no fake numbers, no seeding); three states at 1440 px. Coordinate files Arfan or Tumit still change through the Scrum thread.

**Local checks (laptop rule, Oct 19):** lint the changed files, typecheck the changed package, run only the module's tests; never the isolation sweeps or Playwright from an API session (CI runs them). After merging main: `pnpm install --frozen-lockfile`, `pnpm --filter @firmivra/db generate` and build, `pnpm --filter @firmivra/types build`.

**Gotchas:** every new admin write needs a `WRITES` entry in `test/isolation/admin-scope.test.ts` with a seeded record (`comm`-style key, lazy bodies allowed; Support's writes use `record`); Prisma `create` on `platform_notifications` for another member fails (RETURNING meets the own-read policy): use `createMany`; B6/B8 error codes match `^[a-z][a-z0-9_.]{0,59}$`; only email rows carry a subject; a broadcast's recipients are inserted only while it is SENDING; NotifyService templates need entries in `TEMPLATE_CHANNEL`, `TEMPLATE_SENDER`, `ALWAYS_SENT`, `TEMPLATE_CATEGORY`, `templates.ts` and the notify unit tests' fixtures and tables; `toQuery` takes scalars only (lists as comma strings).
