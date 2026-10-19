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

## Needs from others

- **R1: the communications dispatcher job** (platform scope): moves `SCHEDULED` messages to `SENDING` at their time and sends them (the API's `CommInboxService.dispatch` does the sending for one message), and wires SES and SNS delivery events to the recipients by `provider_message_id`, plus inbound mail and SMS as `RECEIVED` messages (B6 "Needs from R1"). Until then a scheduled message stays scheduled and delivery stops at `SENT`.
- **Cc on one email**: NotifyService sends one address per message, so a Cc or Bcc recipient gets their own copy (no shared Cc header). R6 could add `cc` to `NotifyMessage` later.
- **R0: broadcast fields the screens show but B6 does not store** (schema request, not edited here): a broadcast's `description` and `category`, and an uploaded recipient list (a list of addresses as an audience). Open and click rates need email open and click events (SES event wiring, R1). Until then the screens leave them out.

## Progress log

- 2026-10-19: Plan agreed with the Scrum thread; this file added.
- 2026-10-19: Notifications contract #858. Notifications API (`apps/api/src/admin-notifications`): 12 routes, `AdminPrisma` only, audit rows for resolving or dismissing security and billing items; unit (9) and e2e (12) tests; the admin isolation test's `WRITES` has the six writes and now keeps one dev token per person (a token per call hit the token rate limit).
- 2026-10-19: Communications inbox contract: summary, contacts, conversations, messages (draft, send, schedule, cancel, retry, delete draft), templates and categories, merge fields; contract mock on Arfan's inbox data; 8 contract tests.
- 2026-10-19: Broadcasts contract (`api.adminBroadcasts`): broadcasts with per-channel content, audiences (segments) and counts, the file library upload ticket, recipient results; contract mock on Arfan's broadcast and audience fixtures; 6 contract tests.
- 2026-10-19: Communications inbox API (`apps/api/src/admin-communications`), stacked on #873: 25 routes; send now through NotifyService (two new Firmivra templates, `platform.message-email` and `platform.message-sms`); scheduled messages wait for the dispatcher job (R1); unit (11) and e2e (16) tests; the admin isolation test's `WRITES` has the 19 writes, each on a seeded record.
- 2026-10-19: Broadcasts contract (`api.adminBroadcasts`): broadcasts with per-channel content, audiences (segments) and counts, the file library upload ticket, recipient results; contract mock on Arfan's broadcast and audience fixtures; 6 contract tests.
- 2026-10-19: Broadcasts API (`admin-broadcasts.controller.ts`, `comm-broadcasts.service.ts`), stacked on #878 and #886: 19 routes; audiences resolved per channel (firm owners, leads, team; in-app to the team's bells), send and retry through NotifyService with per-recipient results, schedules wait for the dispatcher (R1); unit (5) and e2e (9) tests; 14 more writes in `WRITES`.

## Handoff for a fresh session (written Oct 19)

**State:** #858, #866, #873 and #878 merged. Open: #886 (broadcasts contract, green) and #891 (broadcasts API, stacked on #886; main merged in by hand at 2488bb2c). Contract PRs open one at a time; at most 2 open non-contract PRs (#891 is one). After a lower PR is squash-merged, `git merge origin/main` into the stacked branch (never rebase or force-push; if a push is rejected because the review thread merged main on GitHub, merge `origin/<branch>` too and keep the wider resolution).

**Next, in order:**
1. **Integrations contract, part 1** (`packages/types/src/admin-integrations`): summary, providers, platform integrations (list, create draft, get, PATCH with `version`, test, activate, disable, enable, remove, `PUT credentials`, runs, usage) and the catalog (list, create, get, PATCH with `version`, plans and firms PUT/DELETE, preview). Tumit's mock (`apps/web/src/mocks/admin-integrations.ts`, 3,766 lines) is already shaped as a contract: each method's comment names its route. Mirror his interfaces in zod where they fit B8, so `api.adminIntegrations` can point at his `adminIntegrations` object and his screens barely change; his enums match the database (categories, statuses, LIVE/TEST, run statuses incl. PARTIAL). Fields B8 has no column for (long description, logo, status URL, sync schedule, features, data access, retry, firm exposure, setup step, required role, display label) live in the non-secret `settings` / `setup` / `advanced` JSON; provider templates stay in code (API).
2. **Integrations contract, part 2**: API keys (full key once, hash only, `fv_live_`/`fv_test_` prefix, rotate = new key with `rotated_from_id`), webhooks and deliveries (redeliver), logs (filters, export via B1 `platform_export_jobs`), usage (from `platform_integration_usage_daily`).
3. The APIs for both; credentials and signing secrets are stored as a **secret reference only** (Secrets Manager adapter is R1's; locally a reference string).
4. **Screens** (step 7): switch Notifications, Communications (inbox, broadcasts, templates) and Integrations from local mocks to the contracts using the mapping tables above; finish the placeholder pages; design gaps against `docs/mockups/super-admin`; three states at 1440 px; empty states, no fake numbers.

**Local checks (laptop rule, Oct 19):** lint the changed files, typecheck the changed package, run only the module's tests; never the isolation sweeps or Playwright from an API session (CI runs them). Build `@firmivra/db` (`prisma generate` then build) and `@firmivra/types` after merging main.

**Gotchas:** every new admin write needs an entry in `test/isolation/admin-scope.test.ts` `WRITES` with a seeded record (`comm` key, lazy bodies allowed); Prisma `create` on `platform_notifications` for another member fails (RETURNING meets the own-read policy): use `createMany`; B6 error codes must match `^[a-z][a-z0-9_.]{0,59}$`; only email rows carry a subject; a broadcast's recipients are inserted only while it is SENDING; NotifyService templates need entries in `TEMPLATE_CHANNEL`, `TEMPLATE_SENDER`, `ALWAYS_SENT`, `TEMPLATE_CATEGORY`, `templates.ts` and the notify unit tests' fixtures and tables.
