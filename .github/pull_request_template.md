## What and why

<!-- What does this change do, and why? -->

Closes #

## Screenshots

<!-- UI changes: the mockup from docs/mockups next to your result at 1440 px, in three states (with data, empty, API unreachable), plus one at 375 px. Delete this section and "Design match" if there is no UI. -->

| State                | Mockup | Result at 1440 px |
| -------------------- | ------ | ----------------- |
| With data            |        |                   |
| Empty                |        |                   |
| API unreachable      |        |                   |
| With data, at 375 px |        |                   |

Differences that could not be removed, and why:

-

## Design match

<!-- From docs/design-match.md. UI PRs only. -->

- [ ] Every part of the design was cropped and enlarged, and its elements listed and counted (rule 1)
- [ ] Every element is built; no widget was dropped (rule 2)
- [ ] Where there is no data, the widget shows its frame with a quiet empty state: no invented numbers, no "Coming soon" inside a widget (rule 2)
- [ ] The page was checked in three states (with data, empty, API unreachable) and every widget's frame shows in each (rule 2)
- [ ] Icons are solid Phosphor icons; every icon that is not exact is listed above (rule 3)
- [ ] Colours and sizes were measured from the image and come from `packages/ui` tokens; a new token only where the design colour has none (rule 4)
- [ ] The page was rendered at 1440 px and compared region by region, and the fixes repeated until no difference is visible (rule 5)
- [ ] The screenshots above sit next to the design, and every difference that could not be removed is listed, and why (rule 6)
- [ ] Components come from `docs/ui-kit.md`; a kit addition was requested only for a design element the kit lacks

## How to test

1.

## Checklist

- [ ] Tests added or updated (unit, e2e for endpoints)
- [ ] Tenant-scoped: database access goes through `forBusiness()`, `businessId` comes from the tenant context, and new tenant data has an isolation test
- [ ] Audit log entry for any action on client data
- [ ] No changes to `packages/db/prisma`, `infra/` or `.github/workflows/` (or a linked, approved schema/infra issue)
- [ ] No secrets and no real client data
- [ ] `pnpm lint`, `pnpm typecheck` and `pnpm test` pass locally
- [ ] One ticket or one page in this PR
- [ ] Pre-reviewed by my pair
