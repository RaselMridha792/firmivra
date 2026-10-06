# @firmivra/db

Prisma schema, migrations, seed and the tenant-scoped database client. **Owner: Rasel only.** Developers ask for changes with a `schema` issue.

## How isolation works

The API connects as `firmivra_app` (`DATABASE_URL_APP`), a role that cannot bypass row-level security. Every query runs inside one of three scopes, set per transaction with `set_config(..., true)`:

| Scope      | Set by                       | Sees                                                                                                                                                                                                                                                                                                                                                                                                      |
| ---------- | ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `business` | `db.forBusiness(businessId)` | Only that firm's rows. Everything a firm user or client does. With `{ actorUserId }` it also records who acts: rows private to one person (a client's own notes) need it.                                                                                                                                                                                                                                 |
| `user`     | `db.forUser(userId)`         | The person's own memberships, client accounts and their firms (for `/me` and the firm picker).                                                                                                                                                                                                                                                                                                            |
| `admin`    | `db.forAdmin(adminUserId)`   | Super Admin pages, for a platform admin with role SUPER_ADMIN (anyone else sees only the admin list): read and review firm applications and their history; read firms and change only status and slug; read OWNER memberships and those owners' user rows (plus its own); read grants and request support as itself; read and write platform audit events as itself. Never firm data, never user updates. |
| `platform` | `db.forPlatform()`           | Identity work only (sign-in, session refresh, invites, activation, firm provisioning, link-users): users (read, insert, update), platform admins (read), businesses, firm applications, support grant requests, platform audit events. No firm data. No deletes of users or firms.                                                                                                                        |
| `invite`   | `db.forInvite(tokenHash)`    | Only the invite whose SHA-256 token hash matches. For the signed-out "accept invite" step: read its `businessId`, then use `forBusiness`.                                                                                                                                                                                                                                                                 |
| none       | –                            | Nothing. Every policy is false.                                                                                                                                                                                                                                                                                                                                                                           |

The policies are in `prisma/migrations/*_row_level_security/migration.sql`. Every table has RLS **enabled and forced**.

```ts
import { createDatabase } from '@firmivra/db';

const db = createDatabase(process.env.DATABASE_URL_APP!);
const members = await db.forBusiness(businessId).membership.findMany(); // only this firm

await db.withScope({ kind: 'business', businessId }, async (tx) => {
  // several statements in one transaction, all in the same scope (also for raw SQL)
});
```

Rules:

- Use `forBusiness` for anything a firm user or client does. Never pass a `businessId` that came from the request body or query.
- Use `withScope` for multi-step work and for raw SQL. Raw queries on a scoped client are not scoped, so they see nothing.
- New identities (`users`) are created in `platform` scope, then linked to a firm in `business` scope.
- The audit log is append-only: the app role can insert and read, not update or delete.
- Firm applications: a Super Admin reviews in admin scope, setting `status`, `reviewed_by_user_id` (the acting admin), `reviewed_at` and `decision_reason` in one update; INFO_REQUESTED and DECLINED need a `decision_reason` (the message to the applicant). The database writes `firm_application_status_history`: the admin comes from the scope (NULL for platform-scope changes such as a resubmission), and the message only from the update that sets it or for INFO_REQUESTED and DECLINED. A new message on the same status is also a history row.
- Support access grants: the platform only requests; an ACTIVE OWNER of the firm approves in business scope with `expires_at` within 72 hours by the database clock (up to 1 minute over, from a fast API clock, is trimmed to exactly 72 hours); approvals cannot be edited and revocation is one-way; nobody deletes grants.
- Users can be updated only in platform scope or by the person themself (who cannot change id, Cognito sub, pool or email). Business status and slug change only in platform scope.
- Scopes use `set_config(..., true)` inside a transaction, so they never outlive it on a pooled connection.
- Emails in `users` and `client_accounts` are stored lower-case (a CHECK constraint enforces it), so every email uniqueness check is case-insensitive; the API lower-cases an email before writing it. `users (pool, email)` is unique for STAFF and ADMIN (partial index `users_pool_email_staff_admin_key`, SQL only: Prisma cannot express it, and its diff leaves it alone). CLIENT users are excluded: a client has one user per firm, unique by `client_accounts (business_id, email)`.
- Links between firm tables use same-firm foreign keys `(business_id, x_id) → x(business_id, id)`. Foreign-key checks skip RLS, so a plain `x_id` could point at another firm's row.
- Firm Terms and Privacy (`firm_legal_documents`) are insert-only: a change is a new version.
- Clients: `clients` is the firm's record (with or without a portal login); `client_accounts.client_id` links logins to it (primary, spouse, authorized). Clients, profiles and tax statuses are archived or updated, never deleted (retention). `*_enc` columns hold ciphertext made with the firm's KMS key, never plain values.
- `client_tax_status_history` is written by a trigger on every change of `client_tax_statuses`; the app only reads it. An archived tax status cannot be assigned.
- Engagements (one service, one period, one client) are never deleted. `status` is the lifecycle (pending, active, completed, cancelled); `stage` must be one of the service's `stages`. A trigger writes `engagement_status_history` on every status or stage change, keeps the client and service fixed, and allows reactivating a cancelled engagement only within 90 days.
- Tasks and internal notes belong to a client and optionally to one of that client's engagements (a three-column foreign key enforces it). Neither is ever shown to clients.
- Workspace reports: a published report needs `published_at`. The database sets `first_published_at` on the first publication and never lets it change or be cleared; a report can be unpublished, but once it was ever published it is never deleted. An attached `document_id` must belong to the same engagement.
- Documents always belong to an engagement. `s3_key` must start with `tenant/<business_id>/` (CHECK; matches the IAM policy `tenant/*`), at most 10 MB, SHA-256 hex. A new document starts `PENDING` (quarantine); the scan result is set once, with `scanned_at`. A client (`CLIENT_TO_FIRM`) uploads only while the engagement is PENDING or ACTIVE; the firm can upload any time. `INTERNAL` documents are never shown to clients. After insert, the S3 key, content type, hash, size, direction, engagement and uploader never change (only `file_name`, category, request, tax year, retention and legal hold can).
- `retention_until` only moves later: a later date or NULL (keep for good), never earlier, and NULL never becomes a date. Clearing `legal_hold` is allowed (the API limits it to managers and audits it) and so can never unlock an early delete.
- Deleting a document needs no legal hold and either `retention_until` in the past, or a client upload whose engagement is still open (the API checks the role and "own"). The row is deleted for real; the documents bucket is versioned, so R5 must also remove the object's old versions (or expire noncurrent versions with a lifecycle rule).
- Document requests are cancelled, never deleted. NOT_AVAILABLE ("I don't have this") and REJECTED ("marked missing") need a `status_note`.
- Intake forms are versioned per firm and service. A published version never changes and can only be retired; only drafts can be deleted. An intake uses a published form of its engagement's (or lead's) service.
- Intake submissions: one draft at a time (autosave), versions 1, 2, 3… in order; `submitted_at` locks a version for good. Unlocking means inserting the next version. A signature is a name and a time; IP and browser are stored only with it.
- Begin Online leads run in the firm's business scope (the firm comes from the site's route). The resume link stores only the token's SHA-256 and lasts at most 30 days (database clock). Converting sets `client_id` and an engagement of the lead's service once; a converted lead stays converted. The lead's intake then gets that engagement, once.
- Lead uploads follow the document file rules (`tenant/<business_id>/`, 10 MB, scan once, file fixed), are added only while the lead is a DRAFT and deleted only then. At conversion each becomes a document with `lead_upload_id` and the same S3 key, file and scan result; that is the only way a document starts already scanned.
- Notifications go only to a member or client account of the firm and always name the record they open (`entity_type`, `entity_id`). A producer sets `event_key` (unique per firm and recipient when set) so a retried job never creates a second bell item. `type` is a dotted key; `payload` is a small flat object (2 KB) of safe values, never SSNs, amounts, document content or message text. After insert only `read_at` changes; nothing is deleted. The API shows each person only their own.
- `notification_deliveries` is the email and SMS outbox: one row per notification and channel, no address or content stored. QUEUED → SENT (with `sent_at`), FAILED (back to QUEUED to retry) or SKIPPED; SENT and SKIPPED are final; `attempts` only go up.
- `notification_preferences`: email and SMS per person, firm and category; no row means email on, SMS off. There is no preference for ACCOUNT (security) notices.
- Appointments: no double booking. Two exclusion constraints (extension `btree_gist`, SQL only; Prisma ignores them) refuse overlapping live appointments for the same staff member or the same client; ranges are half-open, so back-to-back is fine, and a cancelled appointment frees its time. A trigger refuses times over the staff member's blocked time or a firm-wide closure (`blocked_times.user_id` NULL). Client bookings inside working hours is an API rule.
- A reschedule updates the times in place; the database sets `rescheduled_at` and `reschedule_count` (the app cannot write them) and clears `reminder_sent_at`, so the new time gets its own reminder. The client never changes; CANCELLED needs `cancelled_at` and is final; appointments are never deleted. Staff, working hours and blocked time point at memberships of the same firm.
- Messages: a thread belongs to one client (optionally one of its engagements and a related record). The firm side of a message must be an active member; the client side an active portal login of the thread's own client, and only while replies are enabled. A message never changes except `read_at` (read and unread); nothing is deleted. The database keeps `last_message_at`. Attachments are documents of the thread's client.
- A client's private notes are visible only with `db.forBusiness(businessId, { actorUserId })` where the actor is the note's own client login; staff sessions, other clients and sessions with no actor see none. Each save is a new row (no update, no delete). The reminder lives in `client_note_reminders` (date only), so the reminder sender finds due reminders in plain business scope without reading the note; a new `remind_at` clears `reminded_at`.
- Invoices: money in integer cents. The database keeps the totals: each line's `amount_cents` is `round(quantity × unit_amount_cents)`, the invoice `subtotal_cents` is the sum of its lines (the app cannot set it) and `total_cents = subtotal − discount` (never negative, so set a discount after the lines). A new invoice is an empty DRAFT. Paths: DRAFT → SCHEDULED or OPEN → PAID, and CANCELED from any of the first three; PAID and CANCELED are final. Lines change only while DRAFT or SCHEDULED; an issued invoice keeps its number, engagement and amounts. Never deleted.
- Payments start PENDING on an OPEN invoice in its currency. SUCCEEDED (and later REFUNDED) need a recorded `payment_events` row for that payment, so money is confirmed only by a verified webhook; an invoice becomes PAID only when SUCCEEDED payments cover its total. `payment_events.processor_event_id` is unique: a duplicate webhook delivery fails the insert. An event keeps only its type (no payload); its payment and `processed_at` are set once.
- Stripe Connect: each firm is paid into its own connected account, kept in `stripe_accounts` (one per firm; the `acct_` id never changes; COMPLETE needs charges and payouts enabled). The firm reads and updates its own row; platform scope can read all rows so the webhook can map `event.account` to a firm. A payment must run on the firm's own account with charges enabled; a webhook event is accepted only from the firm's own account, and only for a payment that ran on that account. So an event can only ever mark an invoice paid for the firm whose account sent it.
- `content_items` (content editor: RESOURCE and TIP with a body, EXTERNAL_LINK with an https URL and an optional `icon_key`, a design-system icon name, never a URL) and `calculator_definitions` (key, config, required disclaimer; results are never stored).
- Business settings: `brand_color` and `accent_color` are `#rrggbb` or empty; when one is empty the API sends its default.
- A firm always keeps at least one active owner. Demoting, deactivating or deleting the last ACTIVE OWNER fails with SQLSTATE `FV001` and a message starting `LAST_ACTIVE_OWNER:` (trigger `memberships_keep_an_owner`; it also refuses demoting every owner in one statement, and two owners demoting each other at once cannot both succeed). Check it with `isDbError(error, 'LAST_ACTIVE_OWNER')` from `@firmivra/db` (codes in `DB_ERRORS`).
- Sign-up verification codes (`verification_codes`, business scope): one row per code sent, storing the exact target (lower-case email or E.164 phone) and only the code's HMAC. The database sets `created_at` and keeps `expires_at` within 15 minutes of it (up to 1 minute over is trimmed). After insert only `attempts` (+1 at a time) and `consumed_at` change. A code is used once, only before it expires and only if it is the newest for its account and channel; `consumed_at` is then the database's time, and the row never changes again. Nothing is deleted.
- Invites (staff membership or client account, 7 days at most) store only the token's SHA-256. After insert, only `accepted_at` or `revoked_at` can be set, once; a revoked or expired invite cannot be accepted; nobody deletes invites.

## Commands

From the repo root:

```bash
pnpm db:migrate   # apply migrations to local Postgres (prisma migrate dev)
pnpm db:seed      # Super Admin, LVP (owner, staff, client), Test Firm B (owner, client)
pnpm db:studio
pnpm --filter @firmivra/db test   # isolation, rules, seed and enum checks, against <database>_test
pnpm --filter @firmivra/db gen:enums   # after changing an enum: regenerate packages/types/src/db-enums.ts
```

Seeded users (fake): `superadmin@firmivra.test`, `owner@lvp.test`, `staff@lvp.test`, `client@lvp.test`, `owner@firm-b.test`, `client@firm-b.test`.

## Adding a table (Rasel)

1. Add the model to `prisma/schema.prisma`. Tenant data gets `businessId String @map("business_id") @db.Uuid` and an index on it.
2. `pnpm --filter @firmivra/db exec prisma migrate dev --create-only --name <change>`, then add to the SQL:
   - `GRANT ... ON <table> TO firmivra_app;`
   - `ALTER TABLE <table> ENABLE ROW LEVEL SECURITY; ALTER TABLE <table> FORCE ROW LEVEL SECURITY;`
   - a policy, for tenant tables: `USING (business_id = app_current_business_id()) WITH CHECK (business_id = app_current_business_id())`
3. `pnpm db:migrate`, then add the table to the isolation test. `test/rls-coverage.test.ts` fails if any table lacks forced RLS or a policy.
