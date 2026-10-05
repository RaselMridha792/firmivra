# @firmivra/db

Prisma schema, migrations, seed and the tenant-scoped database client. **Owner: Rasel only.** Developers ask for changes with a `schema` issue.

## How isolation works

The API connects as `firmivra_app` (`DATABASE_URL_APP`), a role that cannot bypass row-level security. Every query runs inside one of three scopes, set per transaction with `set_config(..., true)`:

| Scope      | Set by                       | Sees                                                                                                                                      |
| ---------- | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `business` | `db.forBusiness(businessId)` | Only that firm's rows. Everything a firm user or client does.                                                                             |
| `user`     | `db.forUser(userId)`         | The person's own memberships, client accounts and their firms (for `/me` and the firm picker).                                            |
| `platform` | `db.forPlatform()`           | Platform tables: businesses (metadata), users, platform admins, firm applications, support grants, platform audit events. No firm data.   |
| `invite`   | `db.forInvite(tokenHash)`    | Only the invite whose SHA-256 token hash matches. For the signed-out "accept invite" step: read its `businessId`, then use `forBusiness`. |
| none       | –                            | Nothing. Every policy is false.                                                                                                           |

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
- Support access grants: the platform only requests; an ACTIVE OWNER of the firm approves in business scope with `expires_at` within 72 hours by the database clock (up to 1 minute over, from a fast API clock, is trimmed to exactly 72 hours); approvals cannot be edited and revocation is one-way; nobody deletes grants.
- Users can be updated only in platform scope or by the person themself (who cannot change id, Cognito sub, pool or email). Business status and slug change only in platform scope.
- Scopes use `set_config(..., true)` inside a transaction, so they never outlive it on a pooled connection.
- Emails in `users` and `client_accounts` are stored lower-case (a CHECK constraint enforces it). `users (pool, email)` is unique for STAFF and ADMIN (partial index `users_pool_email_staff_admin_key`, SQL only: Prisma cannot express it, and its diff leaves it alone). CLIENT users are excluded: a client has one user per firm, unique by `client_accounts (business_id, email)`.
- Links between firm tables use same-firm foreign keys `(business_id, x_id) → x(business_id, id)`. Foreign-key checks skip RLS, so a plain `x_id` could point at another firm's row.
- Firm Terms and Privacy (`firm_legal_documents`) are insert-only: a change is a new version.
- Clients: `clients` is the firm's record (with or without a portal login); `client_accounts.client_id` links logins to it (primary, spouse, authorized). Clients, profiles and tax statuses are archived or updated, never deleted (retention). `*_enc` columns hold ciphertext made with the firm's KMS key, never plain values.
- `client_tax_status_history` is written by a trigger on every change of `client_tax_statuses`; the app only reads it. An archived tax status cannot be assigned.
- Engagements (one service, one period, one client) are never deleted. `status` is the lifecycle (pending, active, completed, cancelled); `stage` must be one of the service's `stages`. A trigger writes `engagement_status_history` on every status or stage change, keeps the client and service fixed, and allows reactivating a cancelled engagement only within 90 days.
- Tasks and internal notes belong to a client and optionally to one of that client's engagements (a three-column foreign key enforces it). Neither is ever shown to clients.
- Workspace reports: only drafts can be deleted; a published report needs `published_at`. An attached `document_id` must belong to the same engagement.
- Documents always belong to an engagement. `s3_key` must start with `<business_id>/` (CHECK), at most 10 MB, SHA-256 hex. A new document starts `PENDING` (quarantine); the scan result is set once, with `scanned_at`. A client (`CLIENT_TO_FIRM`) uploads only while the engagement is PENDING or ACTIVE; the firm can upload any time. `INTERNAL` documents are never shown to clients.
- Deleting a document needs no legal hold and either `retention_until` in the past, or a client upload whose engagement is still open (the API checks the role and "own"). The row is deleted for real; the documents bucket is versioned, so R5 must also remove the object's old versions (or expire noncurrent versions with a lifecycle rule).
- Document requests are cancelled, never deleted. NOT_AVAILABLE ("I don't have this") and REJECTED ("marked missing") need a `status_note`.
- Invites (staff membership or client account, 7 days at most) store only the token's SHA-256. After insert, only `accepted_at` or `revoked_at` can be set, once; a revoked or expired invite cannot be accepted; nobody deletes invites.

## Commands

From the repo root:

```bash
pnpm db:migrate   # apply migrations to local Postgres (prisma migrate dev)
pnpm db:seed      # Super Admin, LVP (owner, staff, client), Test Firm B (owner, client)
pnpm db:studio
pnpm --filter @firmivra/db test   # isolation tests, against <database>_test
```

Seeded users (fake): `superadmin@firmivra.test`, `owner@lvp.test`, `staff@lvp.test`, `client@lvp.test`, `owner@firm-b.test`, `client@firm-b.test`.

## Adding a table (Rasel)

1. Add the model to `prisma/schema.prisma`. Tenant data gets `businessId String @map("business_id") @db.Uuid` and an index on it.
2. `pnpm --filter @firmivra/db exec prisma migrate dev --create-only --name <change>`, then add to the SQL:
   - `GRANT ... ON <table> TO firmivra_app;`
   - `ALTER TABLE <table> ENABLE ROW LEVEL SECURITY; ALTER TABLE <table> FORCE ROW LEVEL SECURITY;`
   - a policy, for tenant tables: `USING (business_id = app_current_business_id()) WITH CHECK (business_id = app_current_business_id())`
3. `pnpm db:migrate`, then add the table to the isolation test. `test/rls-coverage.test.ts` fails if any table lacks forced RLS or a policy.
