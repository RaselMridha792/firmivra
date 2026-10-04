## What and why

<!-- What does this change do, and why? -->

Closes #

## Screenshots

<!-- UI changes: the mockup from docs/mockups next to your result, at desktop width and at 375 px. Delete this section if there is no UI. -->

| Mockup | Result |
| --- | --- |
|  |  |

## How to test

1.

## Checklist

- [ ] Tests added or updated (unit, e2e for endpoints)
- [ ] Tenant-scoped: database access goes through `forBusiness()`, `businessId` comes from the tenant context, and new tenant data has an isolation test
- [ ] Audit log entry for any action on client data
- [ ] No changes to `packages/db/prisma`, `infra/` or `.github/workflows/` (or a linked, approved schema/infra issue)
- [ ] No secrets and no real client data
- [ ] `pnpm lint`, `pnpm typecheck` and `pnpm test` pass locally
- [ ] Under 400 changed lines
- [ ] Pre-reviewed by my pair
