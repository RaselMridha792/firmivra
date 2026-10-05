# Firmivra: instructions for Claude Code

Read this file at the start of every session. It applies to everyone working in this repo.

## What Firmivra is

Firmivra is one multi-tenant platform shared by many businesses. Each business (tenant) sees only its own data.

| App                 | Host                             | Who uses it                                                                 |
| ------------------- | -------------------------------- | --------------------------------------------------------------------------- |
| Super Admin console | `admin.firmivra.com`             | Firmivra team: approve, request info, decline, activate, suspend businesses |
| Firm workspace      | `app.firmivra.com`               | Each business's staff (Owner, Admin, Staff)                                 |
| Client portal       | `portal.firmivra.com/{firmSlug}` | Each business's clients, in the firm's branding                             |

- Dev environment: `admin.dev.firmivra.com`, `app.dev.firmivra.com`, `portal.dev.firmivra.com/lvp`, `api.dev.firmivra.com`.
- First business (beta tenant): LVP Accounting & Taxes, slug `lvp`. Beta launch: Jan 8, 2027.
- Isolation is enforced by four walls: the API tenant guard, PostgreSQL row-level security, per-business S3 prefixes, and per-business KMS keys. A bug in one wall must never be enough to leak data.

## Read before you build

- `docs/SYSTEM-DESIGN.md`: architecture, isolation, roles and permissions, data model, AWS layout.
- `docs/PROJECT-DRAFT-v2.md`: scope, the 62 screens, security requirements, API outline, acceptance criteria.
- `docs/AUTH-DESIGN.md`: Cognito pools, sign-in flow, cookies, guards (see "Authentication" below).
- `docs/SCRUM-PLAN.md`: team, process, sprints, Definition of Ready and Done.
- `docs/mockups/{begin-online,client-portal,super-admin}/`: Octavia's mockups. Screens must match them.
- `docs/specs/`: Octavia's written instructions (.docx) for each area.
- `docs/tasks/<NAME>.md`: each developer's ticket plan (on their onboarding branch).

Naming: the design docs say tenant / `tenant_id`. In code the tenant is the `Business` model, the field is `businessId` and the column is `business_id`.

## Authentication

The decided design is in `docs/AUTH-DESIGN.md`. Read it before touching sign-in, sessions, guards or roles. In short:

- AWS Cognito with three user pools: staff, clients, Super Admin. Cognito says only who the person is; firm and role come from our database (`Membership`, `ClientAccount`, `PlatformAdmin`) on every request, never from token claims or Cognito groups.
- Our own sign-in screens call our API; the API talks to Cognito and sets the tokens as `HttpOnly` cookies. No Cognito Hosted UI and no tokens in browser JavaScript.
- Sign-in, sign-up and password reset never reveal whether an account exists.
- Locally: `AUTH_MODE=local` and `POST /api/v1/dev/token`; the same guards run. `AUTH_MODE=local` is refused outside `NODE_ENV=development`.

## Repo layout

| Path                 | What                                                                       | Owner                       |
| -------------------- | -------------------------------------------------------------------------- | --------------------------- |
| `apps/web`           | Next.js App Router. Serves admin, app and portal by host name (middleware) | Frontend                    |
| `apps/api`           | NestJS REST API at `/api/v1`                                               | Backend                     |
| `packages/ui`        | Design system: tokens and components, with Storybook                       | Frontend (Fahad)            |
| `packages/types`     | Shared types and zod schemas for API contracts                             | Pairs agree, both sides use |
| `packages/db`        | Prisma schema, migrations, seed, tenant-scoped client                      | **Rasel only**              |
| `infra/`             | AWS CDK (TypeScript)                                                       | **Rasel only**              |
| `.github/workflows/` | CI/CD                                                                      | **Rasel only**              |

The monorepo is being scaffolded in Sprint 0. If a folder does not exist yet, do not create it unless the task asks for it.

Web routing: `apps/web/src/proxy.ts` maps hosts to route folders: `admin.*` to `src/app/admin/`, `app.*` to `src/app/firm/`, `portal.*/{slug}` to `src/app/portal/[firmSlug]/`. Links in the browser use the public paths (`/sign-in`, `/lvp/...`), never the folder names. The browser calls the API at `/api/v1` on its own host.

API building blocks (`apps/api/README.md`): `@Roles(...)` on every controller, `TenantPrisma.db` for firm data, `AuditService.log(action, entity, metadata)`, `ZodValidationPipe` with schemas from `packages/types`.

## Hard rules

1. Never edit `packages/db/prisma` (schema, migrations), `infra/` or `.github/workflows/` unless the user is Rasel and asks for it. Anyone who needs a schema or infra change opens an issue with the "Schema or infra request" template and the `schema` or `infra` label.
2. Every database access in application code goes through the tenant-scoped client: `forBusiness(businessId)` or the request-scoped `TenantPrisma` provider. The owner `prisma` client is for migrations and seed only. `forPlatform()` is only for Super Admin queries on platform tables.
3. `businessId` always comes from the server-side tenant context (host or route plus a verified membership), never from the request body or query. On client routes the client id comes from the token, never the URL.
4. Never log or return another business's data. No passwords, tokens, SSNs, bank numbers or document content in logs, emails or SMS.
5. No secrets in code or committed files. Use `.env` locally (git-ignored); `.env.example` holds placeholders only.
6. New UI uses only the tokens and components from `packages/ui`. No hard-coded colours, font sizes or spacing.
7. Every feature gets tests: unit tests for logic, an e2e test for each API endpoint, and a tenant-isolation test for any new tenant data.
8. Every action on client data writes an audit log entry (`AuditService.log`).
9. Synthetic data only. Never put real client data in code, tests, fixtures, seeds or AI tools.

## Commands

```bash
pnpm install          # install all workspaces
docker compose up -d  # local Postgres, s3mock (S3), Mailpit (email)
pnpm dev              # run web and api
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm db:migrate       # apply migrations to local Postgres
pnpm db:seed          # seed Super Admin, LVP and a second test business
pnpm db:studio
```

Local hosts: `admin.localhost:3000`, `app.localhost:3000`, `portal.localhost:3000/lvp`. API: `localhost:4000/api/v1`. Ports come from `.env` (`WEB_PORT`, `API_PORT`). Browser tests: `pnpm --filter @firmivra/web test:e2e`.

Local stand-ins for AWS (no LocalStack): S3 is s3mock (`S3_ENDPOINT`, path-style), SES is Mailpit (`EMAIL_MODE=smtp`), SNS SMS goes to the API log (`SMS_MODE=log`), KMS is `LOCAL_KMS_KEY` (`KMS_MODE=local`). Code talks to these through adapters that switch on those variables, so the same code runs against AWS.

## Branches and pull requests

- Branch from the latest `main`: `<name>/FIR-<issue number>-short-name`, for example `fahad/FIR-42-login-screen`.
- Open a PR into `main` under 400 changed lines and fill in the PR template. UI PRs include the mockup next to a screenshot of the result.
- CI must pass. Your pair pre-reviews first (frontend: Fahad and Nahid; backend: Tumit and Ibrahim). Only Rasel approves and merges (squash).
- A merge to `main` deploys to dev. Production deploys only from a `v*` tag that Rasel creates, after approval.
- Never push to `main`, never force-push a branch someone else uses, never commit `.env`.
- Commit messages follow Conventional Commits: `feat:`, `fix:`, `chore:`, `docs:`, `test:`, `refactor:`.
- Do not add `Co-Authored-By: Claude` or "Generated with Claude Code" lines to commits or PR descriptions.

## How to work

- Plan first and wait for the user's go before writing code.
- Read the matching spec in `docs/specs/` and the mockup in `docs/mockups/` before building a screen or endpoint.
- Keep each change to its ticket. Ask instead of guessing when a requirement is unclear.
- TypeScript strict everywhere.

## Parallel sessions

- Rasel's workstreams (R0 to R9) are in `docs/work/`, one file each. The rules for them (worktrees, branches, PR size, the database lock) are in `docs/work/README.md`.
- A workstream session reads only `CLAUDE.md`, `docs/work/README.md` and its own R file (plus the files that R file lists under "Read first").
- It edits only its own R file and the paths that R file owns.
- Only the lead session (the main checkout, `Business-full-stack-project/`) edits `docs/work/BOARD.md` and merges. `BOARD.md` is git-ignored and exists only in the main checkout.
- Where these rules differ from the rest of this file (branch names, PR size and titles, what to read), `docs/work/README.md` and the R file win.
