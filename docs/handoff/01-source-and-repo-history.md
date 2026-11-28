# 01. Source Code & Repository History

## 1. Monorepo Organization & Architecture
The Firmivra platform is architected as an enterprise-grade TypeScript monorepo managed with `pnpm` workspaces and `Turborepo` task orchestration.

```
firmivra/
├── apps/
│   ├── web/               # Next.js 16 App Router frontend (Firm workspace, Client portal, Super Admin)
│   └── api/               # NestJS 11 REST API backend service
├── packages/
│   ├── types/             # Shared contracts, Zod schemas, API clients, enum definitions
│   ├── db/                # Prisma ORM schema, migrations, seed data, tenant-scoping utilities
│   ├── ui/                # Firmivra Design System (Phosphor/Lucide icons, accessible components)
│   ├── config-typescript/ # Base TypeScript tsconfig presets
│   └── config-eslint/     # Base ESLint rule configurations
├── infra/                 # AWS Cloud Development Kit (CDK) Infrastructure-as-Code
├── docs/                  # Architecture specs, security packs, QA checklists, handoff deliverables
└── .github/workflows/     # CI/CD automation pipelines (test, lint, typecheck, build, deploy)
```

### 1.1 Workspace Packages & Dependencies
1. **`@firmivra/web` (`apps/web`)**:
   - Framework: Next.js 16 (App Router, Server & Client Components, React 19).
   - Styling: Tailwind CSS v4, custom CSS variables for firm brand theming.
   - Data Fetching & Cache: `@tanstack/react-query` v5 with optimistic updates and background invalidation.
   - Multi-Host Routing: Edge proxy middleware (`src/proxy.ts`) dynamically resolves domains:
     - `app.firmivra.com` (Firm staff workspace).
     - `portal.firmivra.com/{firmSlug}` (Client portal).
     - `admin.firmivra.com` (Platform Super Admin console).
2. **`@firmivra/api` (`apps/api`)**:
   - Framework: NestJS 11 on Node.js 22 LTS.
   - Security: Guards (`AuthGuard`, `TenantGuard`, `EsignRoute`, `Roles`), Pipes (`ZodValidationPipe`), Interceptors.
   - Cloud Integrations: AWS SDK v3 (S3, Cognito, SES, KMS), Stripe API (`stripe`), Mailpit for local SMTP.
3. **`@firmivra/types` (`packages/types`)**:
   - Single source of truth for all API contracts, request/response models, and Zod schemas.
   - Auto-generated type-safe API client wrappers (`ApiRequest`) used across web and integration tests.
4. **`@firmivra/db` (`packages/db`)**:
   - Data Access: Prisma Client 7 connecting to PostgreSQL 16 on Amazon RDS.
   - Multi-Tenancy: Custom connection scoping (`Database.withScope()`, `runInScope()`) guaranteeing tenant boundary isolation at the database level.
5. **`@firmivra/ui` (`packages/ui`)**:
   - Design System adhering to WCAG 2.1 AA accessibility guidelines.
   - Reusable primitives: Button, Modal, Card, Input, Select, Table, Checkbox, Tabs, Toast.
6. **`@firmivra/infra` (`infra`)**:
   - Infrastructure-as-Code using AWS CDK v2 (TypeScript).
   - Modular CloudFormation stacks for Networking, Data, Auth, Compute, Mail, and Malware Scanning.

---

## 2. Git Repository & Branching Strategy
The repository strictly adheres to a trunk-based development workflow with protected main branches and automated CI enforcement:

### 2.1 Branching Conventions
- **`main`**: The canonical production trunk. Direct commits and force pushes are strictly prohibited.
- **Feature & Fix Branches**: Named by author and ticket/task identifier:
  - `<developer>/<issue>-<short-description>` (e.g. `rasel/Q38-security-pack`, `rasel/Q31-firm-sign`).
  - Branched directly from the latest `origin/main`.

### 2.2 Commit Message Standards
Commit messages adhere to Conventional Commits format:
- `feat(<module>): <imperative summary>`
- `fix(<module>): <imperative summary>`
- `docs(<module>): <imperative summary>`
- `test(<module>): <imperative summary>`
- `chore(<module>): <imperative summary>`

### 2.3 Pull Request & Quality Gates
Every Pull Request requires passing automated GitHub Actions checks prior to merge:
1. `pnpm lint`: ESLint check across all packages with zero warnings/errors.
2. `pnpm typecheck`: Full recursive TypeScript compilation (`tsc --noEmit`) with `--max-old-space-size=8192`.
3. Unit & Integration Tests: Vitest execution across `@firmivra/types`, `@firmivra/api`, and `@firmivra/web`.
4. Mock E2E Verification: Playwright test sweeps covering critical user journeys.
5. Pull Request Template adherence: Must include issue rows, code changes, and test verification output.

---

## 3. Platform Development Chronology
The platform was engineered through structured milestones leading to production readiness:

| Phase / Milestone | Period | Key Deliverables & Outcomes |
|---|---|---|
| **Sprint 0: Foundations** | Oct 1–7, 2026 | Monorepo scaffolding, PostgreSQL schema baseline, Prisma migrations, AWS CDK stack initializations, authentication contracts. |
| **Sprint 1–3: Core Workspace** | Oct 8–20, 2026 | Staff and Client authentication with AWS Cognito, Firm Onboarding, Appointments scheduling, Client Records, Document Storage. |
| **Sprint 4–6: Business Modules** | Oct 21–31, 2026 | Invoices & Payments with Stripe, Tax Planning & Return Workspace, Bookkeeping & Payroll, Leads Pipeline, Communications. |
| **Reviews One & Two** | Nov 1–16, 2026 | Formal developer feedback audits, Firm Sign E-Signature engine, multi-signer workflows, Audit Logging, Client Portal completion. |
| **Fix Phase (Ledger Closeout)** | Nov 21–28, 2026 | Systematic verification of 300+ review checklist rows across all modules, 100% ledger resolution, tenant isolation hardening. |
| **Acceptance & Handoff** | Nov 28–30, 2026 | Q38 Security Acceptance Pack, Q39 Platform Handoff Pack, final production cutover preparation. |
