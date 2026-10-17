# R55: handoff

For the next R55 session. Read `CLAUDE.md`, `docs/work/README.md`, this file, then the R55 notes files: `R55-catalog-documents-api.md`, `R55-tasks-api.md`, `R55-templates-api.md`.

## Merged

- Services & Pricing catalog API (#685).
- Documents: compared with the contract, nothing missing (notes in `R55-catalog-documents-api.md`).
- Tasks contract (#709).

## Open

- #702 `rasel/R55-scan-handlers`: scan handlers for leads, esign and agreements. CI "format, lint, typecheck" red only because API `tsc` runs out of heap; fixed by #713. After #713 merges: `git merge origin/main`, push.
- #712 `rasel/R55-tasks-core`: Tasks API (overview, work, task types, templates, recurring series and the idempotent generation job). Same wait for #713, then merge `origin/main` and push. Its notes are in `R55-tasks-api.md`; only #702 touches `R55-catalog-documents-api.md`.
- #717 `rasel/R55-templates-contract`: Templates contract (`packages/types/src/templates/`, `api.templates`). Main merged in, green locally.

## Local only, not pushed

- `rasel/R55-templates-api`: Templates API in progress. Done: merge fields (35 built-in, `fill`, `smsLength`), HTML sanitizer (`sanitize-html`), unit tests (15), `template-input.ts`, `templates.common.ts` (errors, visibility rules, mappers). Still to write: render service, templates service (summary, list, get, create and update with versions and etag, duplicate, archive, restore, favourite, shares, versions, bulk, preview, import, starters), categories, custom merge fields and branding, attachments (mirror `AgreementFilesService` upload tickets), the 48 starter templates, controllers, module, `app.module.ts`, e2e, unit and isolation cases. Open the PR only when a slot frees (at most 2 non-contract PRs open).
- `rasel/R55-compliance-contract`: draft Compliance contract. Compliance was reassigned: do not push it.

## Next steps, in order

1. Templates API (above). Test send has no `NotifyService` template (that is R6's `notify.types.ts`): the route validates and answers 503; add `TEST_SEND_UNAVAILABLE` to the contract enum if kept; list under "Needs from others".
2. Automations (contract, then API).
3. Communications (contract, then API).
4. Advisory.
5. Tax Planning.

Bookkeeping, Payroll and Compliance were reassigned.

## Conventions I follow

- Contract first in its own small PR (`packages/types/src/<module>/` + `createXClient` wired in `apps/web/src/lib/api.ts`), then the API, one PR per module. Titles `feat: <what> (R55)`. PR text: Before, After, short How, endpoints, tests. No Claude attribution lines.
- Merge `origin/main` into branches; never rebase, never force-push, never merge PRs, never push to `main`. No edits to `packages/db/prisma`, `infra/`, `.github/workflows/`; schema gaps go under "Needs from others".
- API pattern: `@Roles` + `@Access('MODULE')` on controllers, `TenantPrisma.db` / `Database.withScope`, `AuditService.log` with ids and field names only, `ZodValidationPipe` with contract schemas, staff reach rule (404 for clients out of reach). App DB role has no DELETE on many tables: archive or reconcile instead.
- Tests: unit, an e2e per endpoint, isolation cases in `test/isolation/cases/*.ts` (and `NOT_RECORDS` in `body-ids.ts`). Run `SCAN_MODE=local S3_ENDPOINT=http://localhost:9` for the isolation suite. Before a push run the whole `apps/api/test/unit` folder.
- Laptop: one heavy command at a time. API `tsc` needs `NODE_OPTIONS=--max-old-space-size=8192` locally until #713. Rebuild `packages/types` (`pnpm --filter @firmivra/types build`) before typechecking web or api.
- Zod 4: no `.omit()` on refined schemas; use `z.partialRecord` for partial enum records; booleans in queries are `z.union([z.boolean(), z.stringbool()])`; watch name collisions across `export *`.
- Windows: no Python on the PATH (use node scripts in the scratchpad), use the Write tool for text with quotes.
