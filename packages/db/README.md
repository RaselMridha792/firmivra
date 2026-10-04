# @firmivra/db

Prisma schema, migrations, seed and the tenant-scoped database client. **Owner: Rasel only.** Developers ask for changes with a `schema` issue.

## How isolation works

The API connects as `firmivra_app` (`DATABASE_URL_APP`), a role that cannot bypass row-level security. Every query runs inside one of three scopes, set per transaction with `set_config(..., true)`:

| Scope      | Set by                       | Sees                                                                                                                                    |
| ---------- | ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `business` | `db.forBusiness(businessId)` | Only that firm's rows. Everything a firm user or client does.                                                                           |
| `user`     | `db.forUser(userId)`         | The person's own memberships, client accounts and their firms (for `/me` and the firm picker).                                          |
| `platform` | `db.forPlatform()`           | Platform tables: businesses (metadata), users, platform admins, firm applications, support grants, platform audit events. No firm data. |
| none       | –                            | Nothing. Every policy is false.                                                                                                         |

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
- Emails in `users` and `client_accounts` are stored lower-case (a CHECK constraint enforces it).

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
