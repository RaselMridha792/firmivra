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

## Needs from others (infra, for Rasel; nothing is changed in `infra/` by R55)

1. **Secrets Manager (Integrations).** The API task role needs `secretsmanager:CreateSecret`, `PutSecretValue`, `GetSecretValue` and `DeleteSecret` on `firmivra/tenant/*/integrations/*`. Set `SECRETS_MODE=aws` in dev and production (in-memory is refused in production).
2. **OAuth redirect address (Integrations).** Register `<APP_BASE_URL>/api/v1/integrations/callback` with each provider that connects by OAuth, per environment.
3. **S3 write for Reports.** `s3:PutObject` on `tenant/*/reports/*` of the documents bucket (the role has Get and Delete for documents only). Set `REPORT_FILES` to the bucket in dev and production.
4. **S3 write for Automations.** `s3:PutObject` on `tenant/*/automations/*` of the documents bucket (run-log exports).
5. **Background jobs.** `AUTOMATION_JOBS=on` on exactly the API tasks that should run the 5-minute automation job (the job takes a Postgres advisory lock, so more than one task is safe); `off` elsewhere. The Communications delivery job uses the same pattern (`COMMUNICATION_JOBS=on|off`, every minute, advisory lock).
6. **Dependency.** `@aws-sdk/client-secrets-manager` was added to `apps/api`; the image build installs it from the lockfile.
7. **Email and SMS for Communications.** A verified SES identity and an SNS SMS origination number per environment, or the firms' own providers through Integrations; until one is connected the Communications channels answer `CHANNEL_UNAVAILABLE`.
8. **Communications result exports** go to `tenant/<business>/reports/communication-<id>.csv`, the prefix item 3 already covers.
9. **Decisions for Rasel (not infra):** the email and SMS provider adapters (Gmail, Outlook, Textmagic) need the connection's secret from the secret store and a send API each; the public unsubscribe link and SMS STOP route, and the provider webhook routes, need signed tokens and per-provider signature checks. Until they exist the Communications channels answer "not available yet" for a connected provider.
10. **Communication attachments** are written under `tenant/<business>/communications/` of the documents bucket (presigned PUT, then head, get and delete by the API role): the role needs `s3:GetObject`, `s3:DeleteObject` and the presign on `tenant/*/communications/*`, as it has for `tenant/*/templates/*`.

## Handoff, 2026-10-18 (restart this session in a fresh window)

**Done and merged (or green and waiting):** Tax Planning, Advisory, Reports, Integrations, Templates, Communications, Departments/teams/org chart, Roles and the permission grid, the staff directory read side (#773), the Tasks/Reports/Tax Planning audit and the demo data script (#778).

**In flight:** `rasel/R55-intake-gaps` (Intake workspace read side + settings; notes in `docs/work/R55-intake.md`).

**Next, in this order (one PR each, cap 2 open):**
1. Intake step 2 (send, send drafts, record, notes, update, resend, remind, archive, PDF) and step 3 (the form builder).
2. Staff write side: create (idempotency key, draft, invite through `InvitesService`), update, lock/unlock/deactivate/reactivate/resend/revoke, security (access settings, sessions, login history, activity, reset password/MFA), per-member permissions (`member_permissions`), notes, compensation, documents, drafts, the import (preview token needs a small store: staff drafts table).
3. Tax Returns workspace API (extend `apps/api/src/tax-returns`; R56 builds the screens; read `docs/mockups/firm-workspace/tax-return`).
4. Bookkeeping Terms contract and API (R56 reported the Terms design missing in #750).
5. Super Admin APIs for modules whose tables exist on main: Team, Sales and Pipeline, Subscriptions, Support, Billing, Notifications, Reports, Integrations, Communications, System Settings. Check `packages/db/prisma/schema.prisma`; list missing tables in the PR; never edit the schema.

**Method that works:** compare `packages/types/src/<module>/*client*.ts` with the controllers (`grep -nE "@Controller|@(Get|Post|Put|Patch|Delete)\("`), build what is missing, then check on the demo firm: `pnpm db:migrate`, `pnpm db:bootstrap-platform-org`, `pnpm db:seed:demo`, start the API (`cd apps/api && pnpm exec nest start`, port from `.env`), `node apps/api/scripts/seed-demo-work.mjs <demo business id>`, and call the routes as `owner@demo.test` (`POST /api/v1/dev/token`).

**Gotchas:**
- Bash heredocs with some characters (curly quotes, certain quote mixes) fail to parse: write files with the Write tool, or write a Python/Node script file and run it.
- Python on Windows resolves `/f/...` differently from git-bash: use `apps/api/...` relative paths from the repo root in scripts.
- CRLF noise shows files as modified: `git checkout -- .` before switching branches; `/tmp/resolve.py` strips conflict markers in barrel files (keep both sides).
- The roles guard lets legacy `STAFF` through any `@Roles(...FIRM_STAFF)` route: for sensitive modules check the grid in the service (`PermissionGrantsService.can`), as Departments and Staff do.
- `tenant-isolation.test.ts`: every record param or body id needs a case; flags that end in `Id` need a `NOT_RECORDS` entry; the body sweep times out on a loaded laptop (passes in CI and alone).
- Count tests with a firm-scoped `where` (other test files run in parallel on the same database).
- Full-suite runs: shards flake under load (429, 503, timeouts); rerun the failing files alone before suspecting the code. Date-dependent specs use the New York date.
- Static routes (`summary`, `options`, `import/template`) before `:id`; audit with ids and field names only; no `Co-Authored-By` lines.
