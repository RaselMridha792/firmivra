# Firmivra

One multi-tenant platform where any business signs up under its own name, runs its own team, and gives each client a private, branded portal. Every business sees only its own data. The first business is LVP Accounting & Taxes (beta: Jan 8, 2027).

| App | Production | Dev |
| --- | --- | --- |
| Super Admin console | `admin.firmivra.com` | `admin.dev.firmivra.com` |
| Firm workspace | `app.firmivra.com` | `app.dev.firmivra.com` |
| Client portal | `portal.firmivra.com/{firm}` | `portal.dev.firmivra.com/lvp` |

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

The monorepo is being scaffolded in Sprint 0 (Oct 5 to Oct 16, 2026). Local setup instructions are added here as each part lands.

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
