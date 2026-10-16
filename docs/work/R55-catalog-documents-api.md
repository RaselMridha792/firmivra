# R55: Services & Pricing and Documents API

The web screens and the zod contracts for the firm's Services & Pricing catalog and for firm Documents exist; the API for them did not, so those pages could not load real data on `app.dev.firmivra.com`. This stream builds it.

Branch `rasel/R55-catalog-documents-api`. Local ports: API 4550, web 3550, database `firmivra_r55`.

## Read first

`CLAUDE.md`, `docs/work/README.md`, `apps/api/README.md`, `docs/AUTH-DESIGN.md`, the contracts `packages/types/src/services-pricing/` and `packages/types/src/documents/`, and `apps/api/src/storage`, `apps/api/src/field-encryption`.

## Owned paths

- `apps/api/src/catalog/`, `apps/api/src/documents/` (new modules; documents work may extend `apps/api/src/storage/` where the file says so)
- `apps/api/test/e2e/catalog.e2e.test.ts`, `apps/api/test/unit/catalog.test.ts`, `apps/api/test/isolation/cases/catalog.ts` (and the documents equivalents)
- the registering line in `apps/api/src/app.module.ts`
- this file

## Rules for this stream

- `@Roles` on every route: reads Owner, Admin, Staff; writes Owner or Admin. `@Access('SERVICES_PRICING')` / the documents module so the permission grid sees them.
- `TenantPrisma.db` for reads, `withScope` for transactions; `businessId` only from the tenant context.
- `AuditService.log` on every write, with field names and old and new values, never client data or document content.
- Never edit `packages/db/prisma`, `infra/` or `.github/workflows/`. A missing table or column goes under "Needs from others".

## Steps

- [x] 1. Services & Pricing under `/business/catalog`: services (list, create, get, update, activate, deactivate, archive, duplicate, delete, usage), packages (list, create, get, update, pricing panel, activate, deactivate, duplicate, archive), summary, categories (list, create, update, reorder, merge, delete) and promotions (list, create, update, end).
- [ ] 2. Documents: `/business/documents`, uploads and confirm, `/business/document-categories`, `/business/document-requests` and every other method `createDocumentsClient` lists.

## Progress log

- 2026-10-17: step 1 built. 5 controllers, 4 services under `apps/api/src/catalog/`; e2e (14 tests), unit (15) and the isolation cases pass.
- 2026-10-17: step 1 checked against the seeded LVP firm through the web host on port 3550 (summary, services, categories, packages, promotions all 200 with real data); rendered pages not viewed, no browser tool in the session.

## Needs from others

The tables from R36 cover the catalog, but a few contract fields do not map one to one. Each is handled in the API as described; none blocks the screens. For Rasel (schema owner) to decide whether a column or constraint should change.

1. **`allowDuplicateName` on a service** cannot be honoured for another service: `services` has `UNIQUE (business_id, name)`, an exact match. The API answers 409 `DUPLICATE_NAME` for any service with the same name; the flag only lets a name equal to a *package* name (or differing in case only) through.
2. **Category tone**: the contract has a token name (`info`, `purple`, ...); `service_categories` has only `color` (`#rrggbb`). The API stores a fixed hex per tone (`TONE_COLORS` in `apps/api/src/catalog/catalog.shared.ts`) and reads it back; any other stored colour reads as no tone. A `tone` column would remove the mapping.
3. **Text widths**: the database is narrower than the contract in four places, so the API refuses the longer text with 400 `VALIDATION_FAILED`: category description 200 (contract 300), package name 100 (120), promotion name 100 (120), add-on name 100 (120).
4. **Package add-ons**:
   - `service_package_add_ons` has no `offered` flag, so only ticked add-ons are stored and `offered` always reads `true`.
   - It links a service's add-on row (`service_add_on_id`), not a service, so the contract's `linkedServiceId` on a package add-on is refused (400) and always reads `null`.
5. **Promotion dates** are calendar days in the contract and instants in the table (`starts_at`, `ends_at`). Stored as UTC start and end of the day; the firm's own time zone is not applied.
6. **Billing frequency** `SEMI_MONTHLY` exists in the database but not in the contract; it reads as `MONTHLY`.
7. **Service usage `automations`** has no table yet and reads `0`.
8. **Grid roles** (Manager, Bookkeeper and the others): write routes are Owner and Admin only. Letting the grid's Create, Edit or Manage reach them needs `STAFF` in the write routes' `@Roles`, which also lets the legacy Staff role in. Left for a decision.

Shared test file touched: `apps/api/test/isolation/body-ids.ts` got three `NOT_RECORDS` entries (a new service or package refuses any line or add-on id; package add-on `linkedServiceId` is refused), each with its reason.
