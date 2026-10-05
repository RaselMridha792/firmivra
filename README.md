# Firmivra

One multi-tenant platform where any business signs up under its own name, runs its own team, and gives each client a private, branded portal. Every business sees only its own data. The first business is LVP Accounting & Taxes (beta: Jan 8, 2027).

| App                 | Production                   | Dev (every merge to `main` deploys here) |
| ------------------- | ---------------------------- | ---------------------------------------- |
| Super Admin console | `admin.firmivra.com`         | `admin.dev.firmivra.com`                 |
| Firm workspace      | `app.firmivra.com`           | `app.dev.firmivra.com`                   |
| Client portal       | `portal.firmivra.com/{firm}` | `portal.dev.firmivra.com/{firm}`         |

## Stack

pnpm + Turborepo monorepo · Next.js (App Router) · NestJS · Prisma + PostgreSQL with row-level security · Amazon Cognito · S3 + KMS · ECS Fargate, ALB, CloudFront · Route 53 · SES · SNS · Stripe · AWS CDK · GitHub Actions. Region us-east-1.

## Repo layout

```
apps/web         Next.js: admin, firm workspace and client portal, chosen by host name
apps/api         NestJS REST API (/api/v1)
packages/ui      design system and Storybook
packages/types   shared types and zod schemas (API contracts)
packages/db      Prisma schema, migrations, seed (owned by Rasel)
infra/           AWS CDK (owned by Rasel)
docs/            design, plan, mockups and specs
```

## Local setup

You need Node.js 22.22.1 or newer (`.nvmrc`), pnpm 10 (`corepack enable` or `npm install -g pnpm`) and Docker Desktop. Nobody needs AWS access to work locally.

```bash
cp .env.example .env     # PowerShell: Copy-Item .env.example .env
docker compose up -d     # Postgres, s3mock, Mailpit; wait until `docker compose ps` shows all healthy
pnpm install
pnpm db:migrate          # tables and row-level security
pnpm db:seed             # fake Super Admin, LVP (owner, staff, client), Test Firm B
pnpm dev                 # API and web app
```

Then open:

| Site                | URL                                   | Seeded users (local sign-in)                            |
| ------------------- | ------------------------------------- | ------------------------------------------------------- |
| Firm workspace      | `http://app.localhost:3000`           | `owner@lvp.test`, `staff@lvp.test`, `owner@firm-b.test` |
| Client portal (LVP) | `http://portal.localhost:3000/lvp`    | `client@lvp.test`                                       |
| Super Admin         | `http://admin.localhost:3000`         | `superadmin@firmivra.test`                              |
| API                 | `http://localhost:4000/api/v1/health` | docs at `http://localhost:4000/api/docs`                |

Chrome, Edge and Firefox resolve `*.localhost` to your machine without any hosts-file change. If ports 3000 or 4000 are taken on your machine, change `WEB_PORT`, `API_PORT` and the four `*_BASE_URL` values in your `.env`.

Checks before a PR: `pnpm lint && pnpm typecheck && pnpm test` (unit, isolation and API e2e tests; needs Docker running) and `pnpm --filter @firmivra/web test:e2e` (browser tests; run `pnpm --filter @firmivra/web exec playwright install chromium` once).

If PowerShell blocks `pnpm` because of the script execution policy, use `pnpm.cmd`.

| Service       | Where                                                                            | Stands in for |
| ------------- | -------------------------------------------------------------------------------- | ------------- |
| PostgreSQL 16 | `localhost:5433`, database `firmivra`, owner `firmivra`, app role `firmivra_app` | RDS           |
| s3mock        | `http://localhost:9090` (path-style), bucket `firmivra-docs-local`               | S3            |
| Mailpit       | inbox at `http://localhost:8025`, SMTP `localhost:1025`                          | SES           |
| API log       | SMS text is written to the API log (`SMS_MODE=log`)                              | SNS SMS       |
| `.env` key    | `LOCAL_KMS_KEY` encrypts sensitive fields (`KMS_MODE=local`)                     | KMS           |

Notes:

- The database init script (`docker/postgres/init/`) runs only when the volume is first created. To start over, run `docker compose down -v` (this deletes all local data).
- s3mock accepts pre-signed URLs without checking expiry or signature. Test link expiry against AWS, not locally.

## Docs

- [CLAUDE.md](CLAUDE.md): rules for everyone and for Claude Code
- [docs/SYSTEM-DESIGN.md](docs/SYSTEM-DESIGN.md): architecture, isolation, roles, data model
- [docs/PROJECT-DRAFT-v2.md](docs/PROJECT-DRAFT-v2.md): scope, screens, requirements, acceptance criteria
- [docs/SCRUM-PLAN.md](docs/SCRUM-PLAN.md): team, process and sprints
- [docs/mockups/](docs/mockups/) and [docs/specs/](docs/specs/): Octavia's designs and written instructions
- [docs/SETUP-LOG.md](docs/SETUP-LOG.md): Sprint 0 setup progress

## How we work

1. Branch from `main`: `<name>/FIR-<issue>-short-name`.
2. Open a small PR into `main` (under 400 lines) using the template; your pair pre-reviews.
3. CI must pass. Only Rasel approves and merges.
4. A merge to `main` deploys to dev. Production deploys from a `v*` release tag after approval.

Schema and AWS changes go through Rasel: open a "Schema or infra request" issue.
