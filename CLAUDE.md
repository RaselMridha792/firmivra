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
- `docs/SCRUM-PLAN.md`: team, process, sprints, Definition of Ready and Done.
- `docs/mockups/{begin-online,client-portal,super-admin}/`: Octavia's mockups. Screens must match them.
- `docs/specs/`: Octavia's written instructions (.docx) for each area.
- `docs/tasks/<NAME>.md`: each developer's ticket plan (on their onboarding branch).

Naming: the design docs say tenant / `tenant_id`. In code the tenant is the `Business` model, the field is `businessId` and the column is `business_id`.

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
docker compose up -d  # local Postgres, LocalStack (S3, SES, SNS, KMS), Mailpit
pnpm dev              # run web and api
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm db:migrate       # apply migrations to local Postgres
pnpm db:seed          # seed Super Admin, LVP and a second test business
pnpm db:studio
```

Local hosts: `admin.localhost:3000`, `app.localhost:3000`, `portal.localhost:3000/lvp`. API: `localhost:4000/api/v1`. These commands arrive during Sprint 0; the README says what works today.

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
