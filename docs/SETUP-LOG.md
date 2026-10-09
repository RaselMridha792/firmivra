# Sprint 0 setup log

Running checklist for the initial setup, following `SETUP-GUIDE.md` (Steps 1 to 10). Updated at the end of every phase.

## Status

| Step | What | Status |
| --- | --- | --- |
| 1 | Tools | Done (Oct 4) |
| 2 | GitHub repo, rules, labels, environments, board | Done (Oct 4), 2 items left for Rasel |
| 3 | Clone | Not needed: the existing clone at `F:\Business-full-stack-project` is the repo |
| 4 | Docs and repo conventions | Done (Oct 4, PR #1) |
| 5 | AWS foundation (one account: CLI, budget, Route 53, SES, SNS, Stripe) | In progress: CLI, budget, hosted zone and GoDaddy delegation done; root MFA, Stripe and SNS SMS open |
| 6 | Monorepo, Docker, database, API, web | Done. 6.1 and 6.2 merged (PR #2); 6.3 to 6.5 committed on `rasel/setup-foundations` (Oct 5, not pushed) |
| 7 | CDK infrastructure, deploy to dev | Done (Oct 5, PR #7): all six stacks deployed; bootstrap narrowed; `admin.`, `app.` and `portal.dev.firmivra.com` answer 503 until Step 8 starts the tasks |
| 8 | CI/CD | In progress (R1): `ci.yml` on every PR (PR #11); `deploy-dev.yml` on `rasel/R1-deploy-dev` |
| 9 | Developer branches, task docs, Sprint 0 and 1 issues | Branches and task docs done (Oct 4); issues to do |
| 10 | Sprint 0 done checklist | To do |

## Decisions from Rasel

| Date | Topic | Decision | Guide default it replaces |
| --- | --- | --- | --- |
| Oct 4 | Dev machine | Native Windows 11 (PowerShell and Git Bash), no WSL | WSL2 Ubuntu |
| Oct 4 | GitHub owner | Personal repo `RaselMridha792/firmivra`; no organization or teams | Organization `firmivra` |
| Oct 4 | Visibility | Public | Private |
| Oct 4 | Client docs in the repo | Commit all of them (option B): design, draft, mockups, specs. To confirm with Octavia | — |
| Oct 4 | Collaborators | Added by Rasel with Write; Claude only creates the developer branches | Org invites and teams |
| Oct 4 | Commits | Authored as RaselMridha792 only, no AI co-author lines | — |
| Oct 4 | AWS accounts | One existing account `778127141557`; no new dev and prod accounts. Only `firmivra-dev-*` stacks for now; prod stacks later, decided with Octavia | Separate dev and prod accounts under AWS Organizations |
| Oct 5 | Budget alerts | info@exprovia.com and octaviakholder@gmail.com | — |
| Oct 5 | Root MFA, Stripe, SNS SMS | Postponed; tracked under "Left for Rasel" | Done in Step 5 |
| Oct 5 | Local AWS stand-ins | No LocalStack (it now needs a paid token for commercial use). s3mock for S3, Mailpit for email, SMS to the API log, a local key from `.env` instead of KMS | LocalStack (S3, SES, SNS, KMS) |
| Oct 5 | Lint and TypeScript | ESLint 10 (ESLint 9 is end of life) with `@eslint-react`; TypeScript 5.9.3 (typescript-eslint supports below 6.1) | — |
| Oct 5 | Dev infrastructure (Step 7) | No NAT gateway: Fargate tasks in public subnets, inbound only from the ALB. 1 task each for api and web at 0.25 vCPU / 0.5 GB, **Fargate Spot**, x86, running 24/7. RDS PostgreSQL db.t4g.micro single-AZ. Cognito Plus tier (compromised-credential checks). Tags `project=firmivra`, `env=dev` on everything. `cdk diff` shown and approved before every deploy. Prod stays on-demand | NAT gateway, private subnets |
| Oct 5 | Database instance | `db.t3.micro` (x86, $13.14 a month): `db.t4g.micro` is not offered for PostgreSQL in this account, so the first data deploy failed and rolled back. Cleanup: empty stack deleted, empty access-logs bucket deleted, unused KMS key scheduled for deletion on Oct 12. Retained resources now use "retain except on create" so a failed first deploy cleans up | `db.t4g.micro` |
| Oct 5 | Documents CORS | Exactly the three site origins: the CloudFront domains (config `cloudFrontHosts`, filled in after the first app deploy), later the custom hosts. `https://*.cloudfront.net` only until the domains are known | `*.cloudfront.net` |
| Oct 5 | Dev domain (Step 7) | Do not wait for `dev.firmivra.com`: three CloudFront distributions (admin, app, portal) on their free `*.cloudfront.net` domains; no ACM certificate, no Route 53 records, no SES domain yet. The web app picks the site from config (`ADMIN_HOST`, `APP_HOST`, `PORTAL_HOST`); every base URL comes from config. Switching later is config only (see below) | Wait for the GoDaddy NS records |
| Oct 5 | CloudFront to load balancer | CloudFront VPC origin to an internal load balancer (HTTP 80 inside the VPC, plus the secret origin header). Without a certificate CloudFront cannot use HTTPS to a public load balancer, and plain HTTP over the internet would expose session cookies. Also removes the load balancer's 2 public IPv4 addresses | Public load balancer with HTTPS and the CloudFront prefix list |
| Oct 5 | Audit helper | `AuditService.log(action, entity, metadata)` everywhere, as in CLAUDE.md | — |
| Oct 5 | Framework versions | Prisma 7.10 (npm's "latest" tag points at 8.0 rc), NestJS 12 (ES modules), Next.js 16 (`proxy.ts` instead of `middleware.ts`), Storybook 10, Tailwind 4, Playwright 1.63, zod 4, vitest 5 | Nest 11, Next 15, Storybook 8 |
| Oct 5 | Database scopes | Three scopes instead of one: `forBusiness` (firm data), `forUser` (own memberships for `/me`), `forPlatform` (Super Admin tables); no scope sees nothing. RLS on **every** table, not only tenant tables | `forBusiness` and `forPlatform` |
| Oct 5 | Local ports | Docker Postgres on host port **5433** (a local PostgreSQL install often holds 5432). Ports are `.env` settings (`WEB_PORT`, `API_PORT`); Rasel's machine uses 3300/4300 because other apps hold 3000, 3100 and 4000 | 5432, 3000, 4000 |
| Oct 5 | API calls from the browser | Same origin: each site calls `/api/v1` on its own host (Next forwards locally, CloudFront in AWS), so session cookies are per site | Browser calls the API host directly |
| Oct 5 | Local sign-in | `AUTH_MODE=local` allowed in `development` and `test` (tests need it), refused in `production` | development only (AUTH-DESIGN.md) |
| Oct 5 | Authentication | `docs/AUTH-DESIGN.md` (decided Oct 4): Cognito, three pools, roles from the database, our own screens, `HttpOnly` cookies | — |

Team on GitHub: Fahad `Sefat-Ullah-Fahad`, Tumit `tumit-h-r-75`, Ibrahim `BFIbrahim`, Nahid `asratulhasannahid`. Octavia is not a collaborator. On Oct 8 Arfan replaced Ibrahim; his GitHub username is added when Rasel invites him.

## Step 1: tools (done)

git 2.55.0, node 22.23.2, pnpm 10.32.1, Docker 29.8.0, gh 2.101.0 (scopes include `admin:org`, `project`), aws-cli 2.37.9, cdk 2.1144.0.

## Step 2: GitHub (done)

- Merging: squash only, PR title and body as the commit, branches deleted after merge.
- Labels: frontend, backend, schema, infra, bug, blocked, sprint-0 to sprint-6.
- Ruleset `protect-main` (default branch): no deletion, no force push, linear history, restrict updates (only Rasel can merge), PR with 1 approval from a code owner, stale approvals dismissed, squash only. Bypass: repository admin (Rasel).
- Ruleset `protect-release-tags` (`refs/tags/v*`): only Rasel can create, move or delete release tags.
- Environment `dev`: deployable only from `main`. Environment `prod`: required reviewer Rasel, deployable only from `v*` tags.
- Public-repo hardening: approval needed before CI runs on PRs from outside contributors; workflow token read-only by default; secret scanning, push protection, Dependabot alerts and security updates on.
- Board: https://github.com/users/RaselMridha792/projects/3 with Status (Backlog, Ready, In progress, In review, Done), Points, and Sprint (2-week iterations, Sprint 0 from Oct 5 to Sprint 6 from Dec 28). Linked to the repo; Assignees is the owner field.

## Public repo safety (Oct 5, Rasel: the repo stays public)

- Secret scanning and push protection: on (since Oct 4); checked again Oct 5. Dependabot alerts and security updates: on. Non-provider patterns: requested via the API on Oct 5; GitHub accepted the call but the setting stays `disabled` (probably not offered for repos owned by a personal account). Validity checks: off.
- `.gitignore` covers `.env` and every `.env.*` except `.env.example`, key files (`*.pem`, `*.key`, `*.p12`, `*.pfx`), and local data that may hold real client information: database dumps and backups (`*.dump`, `*.backup`, `*.bak`, `*.sql.gz`, `*.sql.zip`) and the folders `/dumps/`, `/exports/`, `/backups/`, `/client-data/`, `/tmp/`. Checked with `git check-ignore`; no tracked file is affected.
- Local services keep their data in Docker volumes, outside the repo. Only synthetic data is allowed in code, tests, seeds and fixtures (CLAUDE.md rule 9).
- **Rule for Steps 7 and 8 (Rasel, Oct 5):** the GitHub OIDC deploy role trusts only `repo:RaselMridha792/firmivra:environment:dev` and `repo:RaselMridha792/firmivra:environment:prod` (no branch-based `sub`). Every deploy job declares its environment, and GitHub limits the environments: `dev` deploys only from `main`, `prod` only from `v*` tags with Rasel's approval (both set up in Step 2).

## Step 4: docs and conventions (done, PR #1)

- `docs/SCRUM-PLAN.md` (copy), `docs/SYSTEM-DESIGN.md` (text from the HTML, diagrams written as lists), `docs/PROJECT-DRAFT-v2.md` (text from the PDF).
- `docs/mockups/`: begin-online (26), client-portal (18), super-admin (5). Original file names kept; one leading space removed (`Business Startup Guide Dashboard.png`).
- `docs/specs/`: client-portal (8), super-admin (2), platform-guide (1) `.docx` files.
- `CLAUDE.md`, `.github/CODEOWNERS`, PR template, issue templates (feature, bug, schema-or-infra-request), `.editorconfig`, `.nvmrc`, `.gitattributes`, `.gitignore`, `README.md`. Removed the empty `index.html`.

## Step 5: AWS foundation, one account (in progress)

- Account `778127141557` ("Firmivra"), region us-east-1 for everything we build. It is the management account of organization `o-i2ha640j3z` (the only member), which IAM Identity Center needs. No new accounts.
- CLI: profile `firmivra-dev` in `~/.aws/config` through IAM Identity Center (portal `https://d-9a675f50bd.awsapps.com/start`, Identity Center region **us-east-2**), permission set `AdministratorAccess`. Sign in with `aws sso login --profile firmivra-dev`. The Identity Center user is "Nizam".
- Account state on Oct 4: no stacks, no CDK bootstrap, only default VPCs (us-east-1 and eu-north-1). No IAM users, no root access keys, **root MFA off**. SES in sandbox (200 emails a day). No Route 53 hosted zones; firmivra.com is not registered in this account.
- Budget (done, Oct 5): `firmivra-monthly-cost`, $150 a month, email alerts at 50%, 80% and 100% of actual cost to info@exprovia.com and octaviakholder@gmail.com (each address confirms an AWS subscription email). "My Zero-Spend Budget" deleted.
- Route 53 (done, Oct 5): public hosted zone `dev.firmivra.com`, id `Z09182951RY8TUAZ5WCXR` ($0.50 a month). Name servers: `ns-1114.awsdns-11.org`, `ns-705.awsdns-24.net`, `ns-168.awsdns-21.com`, `ns-1942.awsdns-50.co.uk`.
- firmivra.com DNS is at **GoDaddy** (`ns05.domaincontrol.com`, `ns06.domaincontrol.com`). `dev.firmivra.com` is delegated to Route 53 (4 NS records for `dev` added by Rasel Oct 5, old `dev` CNAME removed; checked at both GoDaddy name servers, 8.8.8.8 and 1.1.1.1).
- SES domain identity and DKIM records come from CDK in Step 7; production access is requested after the domain is verified.

## Step 6: monorepo and local services (6.1 and 6.2 done, Oct 5)

- 6.1 `6928259`: pnpm 10.32 workspace (`apps/*`, `packages/*`, `infra`), Turborepo 2.11 (`dev`, `build`, `lint`, `typecheck`, `test`), strict `tsconfig.base.json`, `@firmivra/config-typescript` (base, nextjs, nestjs), `@firmivra/config-eslint` (base, node, nestjs with type-aware promise rules, react, nextjs), Prettier, Husky + lint-staged pre-commit. Placeholders with lint and typecheck for `apps/web`, `apps/api`, `packages/ui`, `packages/types`, `packages/db`, `infra`. Node 22.22.1 or newer (lint-staged 17 needs it). Turborepo's automatic `AGENTS.md` is turned off (`"agentGuidance": false`); `CLAUDE.md` is the one instruction file.
- 6.2 `6628a77`: `docker-compose.yml` with `postgres:16` (5432; local-only app role `firmivra_app` without BYPASSRLS, created by `docker/postgres/init/`), `adobe/s3mock:5.2.3` (9090, bucket `firmivra-docs-local`), `axllent/mailpit:v1.31.4` (8025 inbox, 1025 SMTP). `.env.example` with a comment on every variable; Stripe and Cognito values empty. README "Local setup". Checked: all three healthy, app role logs in with `bypassrls=false`, file put and get on s3mock, mail caught by Mailpit.
- s3mock limits: path-style URLs only; pre-signed URLs are accepted without checking expiry or signature.
- 6.3 `0594593` (`packages/db`): Prisma 7.10 schema (`businesses`, `users`, `memberships`, `client_accounts`, `platform_admins`, `support_access_grants`, `audit_logs`, `firm_applications`; snake_case tables, `business_id` on tenant tables). Migration `row_level_security`: app role `firmivra_app` (no BYPASSRLS), RLS enabled and forced on every table, scope functions `app_scope()`, `app_current_business_id()`, `app_current_user_id()`, audit log append-only, lower-case email checks. Client `createDatabase()` with `forBusiness` / `forUser` / `forPlatform` / `withScope`. Seed: Super Admin, LVP (owner, staff, client), Test Firm B (owner, client), fake data. Tests: 14 isolation and coverage tests against `firmivra_test`; a deliberately leaky policy made 8 of them fail.
- 6.4 `6388c3d` (`apps/api`, `packages/types`): NestJS 12. Global guards in order: throttler, `AuthGuard` (cookie or Bearer; Cognito or local key; user loaded by `sub`), `TenantGuard` (firm from `:slug`, `x-business-id` or the only firm; role from `Membership` / `ClientAccount`; 404 when not linked, 403 `BUSINESS_INACTIVE`), `RolesGuard` (default deny). `AuditService.log(action, entity, metadata)`, `GET /health`, `GET /me`, `GET /business`, `GET /portal/:slug/business`, `POST /dev/token` and `/dev/sign-out` (local only). Zod-validated config, request ids, pino logs with redaction, helmet, CORS, rate limits, OpenAPI at `/api/docs`, one error format. Tests: guard unit tests and e2e (32) against `firmivra_test_api`. Docker image runs healthy as non-root.
- 6.5 `ef75c68` (`apps/web`, `packages/ui`): Next.js 16 with `proxy.ts` routing `admin.*`, `app.*`, `portal.*/{slug}` to `src/app/admin`, `firm`, `portal/[firmSlug]`; sign-in and `/me` pages per site; `/healthz`. `packages/ui`: Tailwind 4 tokens in one file (placeholder values for Fahad), `Button`, `Input`, `Card`, Storybook 10. Playwright: 8 tests (each site loads, sign-in end to end, client of LVP gets `NOT_FOUND` on Test Firm B). Docker image (standalone, 294 MB) runs healthy as non-root.
- Checks at the end of Step 6: `pnpm lint` (10 tasks), `pnpm typecheck` (9), `pnpm format:check`, `pnpm test` (4 + 14 + 32 tests), `pnpm build`, Playwright 8 of 8, both images built and started.
- `apps/web/AGENTS.md` and `apps/web/CLAUDE.md` are written by `next dev` when an AI agent runs it (no setting to turn it off); they point to the Next.js docs in `node_modules/next/dist/docs` and are committed. Turborepo's root `AGENTS.md` is turned off (`agentGuidance: false`).

## Step 7: dev cost estimate (Oct 5, us-east-1 prices from the AWS Pricing API)

| Resource | Monthly |
| --- | --- |
| Fargate Spot, 2 tasks × 0.25 vCPU / 0.5 GB, 24/7 (on-demand would be $18.02) | ~$5.50 |
| Application Load Balancer (hourly + light LCU) | ~$16.90 |
| Public IPv4: 2 for the ALB, 1 per task | $14.60 |
| RDS db.t4g.micro single-AZ + 20 GB gp3 | $13.98 |
| KMS, Secrets Manager, CloudWatch, Route 53, ECR, S3, Cognito Plus (~20 users) | ~$5.60 |
| CloudFront, ACM, SES, SQS, Lambda, egress under 100 GB | $0 |
| **Total** | **≈ $57** |

Later: SMS toll-free number $2 a month once approved. Not in dev: WAF, GuardDuty, Security Hub, CloudTrail trail (prod).

## Step 9: developer branches (done, Oct 4)

`fahad/FIR-0-onboarding`, `nahid/FIR-0-onboarding`, `tumit/FIR-0-onboarding`, `ibrahim/FIR-0-onboarding`, each with `docs/tasks/<NAME>.md` (a short repo note on top, then the original task doc). Sprint 0 and Sprint 1 issues on the board are still to do.

Oct 5, Tumit's branch: `bfb1c83` adds `docs/AUTH-DESIGN.md`; `a582d02` updates `docs/tasks/TUMIT.md` with Rasel's new version (auth design section, rebase routine, s3mock and Mailpit), keeping Tumit's own "Local setup notes" (`11a2ee0`).

Oct 5, all four branches: LocalStack replaced with s3mock, Mailpit and a local key; `AuditService.log(action, entity, metadata)` instead of `AuditService.record()`. Commits: Fahad `af5790d`, Nahid `1b7fb19`, Tumit `31eda21`, Ibrahim `a36da5b`.

## Windows Smart App Control (Oct 5)

- Rasel's machine has Smart App Control on (policy `VerifiedAndReputableDesktop`). It blocks an unsigned program unless Microsoft's cloud reputation vouches for it. The turbo Windows binary and the `@swc/core` binding are unsigned, so a release only a few days old can be blocked: `spawn UNKNOWN`, "An Application Control policy has blocked this file". Smart App Control stays on.
- turbo 2.11.7 (published Oct 2) was blocked; 2.11.6 is allowed. Root `package.json` pins turbo to exactly `2.11.6` (PR #6). Tested in a scratch folder: SAC blocked 2.11.7 and 2.10.12 and allowed 2.11.6, 2.11.4, 2.11.0, 2.10.13 and 2.9.18.
- Before raising turbo, run the new binary once from a scratch folder (`npm pack @turbo/windows-64@<version>`, extract it, run `bin\turbo.exe --version`). If a native tool fails suddenly, check the log: `Get-WinEvent -LogName 'Microsoft-Windows-CodeIntegrity/Operational' -MaxEvents 200 | ? Id -in 3033,3077 | fl TimeCreated, Message`.
- `@swc/core` 1.16.13 (API tests) was blocked twice on Oct 5 and loaded later the same day. Workaround while a binary is blocked: `pnpm --filter @firmivra/types --filter @firmivra/db run build`, then `pnpm -r run <script>`.

## Left for Rasel

- [ ] Board: switch "View 1" to Board layout and save (the API cannot change the layout).
- [ ] Nahid and Arfan: accept their repo invitations.
- [ ] Confirm with Octavia that her mockups and specs can be public.
- [ ] Step 8: add `ci` as a required status check in `protect-main` after the first CI run.
- [ ] Root user MFA on account `778127141557` (sign in as root → Security credentials → Assign MFA device); root password in Octavia's password manager.
- [ ] Stripe: create the Firmivra account in test mode; the test keys go into GitHub environment secrets in Step 8.
- [ ] Company details from Octavia (pending; nothing blocks on them): legal name, address, support email, privacy and terms URLs. They go in one place, `apps/web/src/lib/company.ts` (placeholders now), then into the two requests below.
- [ ] SES production access: **send before beta, needs company details from Octavia** and a firmivra.com page that describes the product. Request text: `docs/aws/SES-PRODUCTION-REQUEST.md`. Until then SES stays in the sandbox (200 a day, verified addresses only).
- [ ] SES sandbox: the team's 6 addresses (Rasel, Fahad, Nahid, Tumit, Ibrahim, Octavia) were added Oct 5 and are pending until each person clicks the link in the AWS email (valid 24 hours). Addresses are not listed here (public repo). Check: `aws sesv2 list-email-identities --profile firmivra-dev --region us-east-1`. Arfan's address is not added yet (an AWS change that needs Rasel's yes).
- [ ] SNS SMS: **send before beta, needs company details from Octavia** and a live firmivra.com page. What the registration needs: `docs/aws/SNS-SMS-REGISTRATION.md`; clicks under "SNS SMS steps" below. Review takes 2 to 3 weeks; the earlier target was to submit by Oct 16 so SMS works by Sprint 2 (Nov 2).
- [x] GoDaddy (done by Rasel, Oct 5): **My Products → firmivra.com → DNS → Add New Record**, type **NS**, name **dev**, value one name server, TTL 1 hour. Repeat for all 4: `ns-1114.awsdns-11.org`, `ns-705.awsdns-24.net`, `ns-168.awsdns-21.com`, `ns-1942.awsdns-50.co.uk`. Check: `Resolve-DnsName dev.firmivra.com -Type NS` lists the four.

## SNS SMS steps (console, region us-east-1)

1. **Amazon SNS → Text messaging (SMS) → Exit SMS sandbox.** This opens a support case. Region US East (N. Virginia). Ask to exit the SMS sandbox and, in the same case, for an account spend threshold of $50 a month (default $1). Use case: verification codes and account notifications for Firmivra client-portal users who enter their phone at sign-up; no marketing.
2. **AWS End User Messaging SMS → Configurations → Phone numbers → Request originator.** Country United States, use case Transactional, type Toll-free.
3. **Registrations → Create registration → US toll-free number registration**, for the new number. Company name, address and contact (from Octavia), website firmivra.com (must be live), use case one-time passcodes and account notifications, opt-in "user enters their phone at sign-up and verifies it" (screenshot: `docs/mockups/client-portal/Verify phone.png`), sample message `Firmivra: your verification code is 123456. It expires in 10 minutes. Reply STOP to opt out.`, volume under 1,000 a month. Review takes about 2 to 3 weeks; the number cannot send until approved.

Console menu names change from time to time; pick the closest match.

## Auth design: points to settle before Sprint 1 (Oct 19)

- Cookie `SameSite`: the auth design says `Lax`, SYSTEM-DESIGN.md and PROJECT-DRAFT-v2.md say `Strict`.
- Cookie names: solved by the same-origin decision. Each site calls `/api/v1` on its own host, so `fv_access` on `app.` and on `portal.` are separate cookies. Step 7 must route `/api/*` on every site host to the API (CloudFront behaviour).
- `fv_refresh` path `/api/v1/auth/refresh` is not sent to the portal or admin refresh routes.
- Settled Oct 8 (see docs/AUTH-DESIGN.md, "Password reset email"): Cognito sends the forgot-password code through our SES identity, with plain wording; firm branding later through a custom message Lambda (R8).
- Schema: done in 6.3 (`users.email` not unique; `client_accounts` unique on business and email).

## Database rules tightened (Oct 5, before the first push of Step 6)

Migration `tighten_grants_users_businesses`; RLS decides which rows a scope can touch, triggers decide how a row may change (triggers also apply to the table owner and superusers):

- Support access grants: platform scope can only insert a request (no approver, no expiry, not revoked) and cannot update it; only business scope can approve, and only with `granted_by_user_id` = an ACTIVE OWNER of that firm and `expires_at` in the next 72 hours. An approval cannot be changed; revocation is one-way; a declined request cannot be approved; the app cannot delete grants.
- Users: only platform scope or the person themself (user scope) can update a user row (USING and WITH CHECK). In user scope, `id`, `cognito_sub`, `pool` and `email` cannot change.
- Businesses: only platform scope can change `status`, `slug` or `id`; a firm can still edit its other fields.
- Pooled connections: every scope is set with `set_config(..., true)` inside a transaction (`forBusiness`, `forUser`, `forPlatform` via a batch transaction per query; `withScope` via an interactive transaction). A test with a one-connection pool shows the next query on the same connection has no scope and sees no rows, also after a failed transaction.
- Coverage test now also fails if any table in `public` lacks a grant for `firmivra_app`, and pins the limits: no UPDATE or DELETE on `audit_logs`, no DELETE on `support_access_grants`, no access to `_prisma_migrations`.
- db tests: 37 (isolation 11, policies 17, pooling 4, coverage 5). Each new rule was checked by breaking it on purpose: dropping the business trigger, revoking a grant, and switching `set_config` to session-wide each made the matching tests fail.

## Step 7: AWS CDK, dev (in progress, Oct 5)

- `infra/` (CDK 2.272, cdk-nag 3): stacks `firmivra-dev-network`, `-data`, `-auth`, `-app`, `-ci` (and `-email` only with a custom domain). Every resource tagged `project=firmivra`, `env=dev`. cdk-nag: no unacknowledged findings; every accepted finding has its reason in `infra/src/nag.ts`. 28 tests in `infra/test/` pin the decided settings and the deploy guardrails, for both the CloudFront-domain setup and the custom-domain switch. Tests and the nag report build with the `cdk.json` feature flags, like `cdk deploy`. Every log group keeps 14 days and is deleted with its stack, also the ones CDK helpers create.
- Bootstrap: `CDKToolkit` created Oct 5 with the default execution policy AdministratorAccess; narrowed the same day, before any workflow runs (see "Deploy guardrails" below).
- Deployed Oct 5: network; data (`db.t3.micro`, PostgreSQL 16.13); auth (pools `firmivra-dev-staff`, `-clients`, `-admins`, Plus tier, compromised-credential block). Data and auth have termination protection.
- App design: internal load balancer (isolated subnets, HTTP 80, requests without the `X-Origin-Verify` header get 403) reached by one CloudFront VPC origin; three distributions (admin, app, portal), each with `/api/*` to the API, caching off except `/_next/static/*`. Services start at 0 tasks until Step 8 deploys images. Emails are logged (`EMAIL_MODE=log`) until the SES domain exists.
- Images: API image trusts the RDS certificate bundle (`NODE_EXTRA_CA_CERTS`) and builds its database URL from `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_APP_USER`, `DB_APP_PASSWORD` with `sslmode=verify-full`. Migration image (`packages/db/Dockerfile`): `prisma migrate deploy` as the owner, then `ALTER ROLE firmivra_app LOGIN PASSWORD` from Secrets Manager (tested against local Postgres).
- Site URLs (since the switch, Oct 5): `https://admin.dev.firmivra.com`, `https://app.dev.firmivra.com`, `https://portal.dev.firmivra.com` (certificate for `dev.firmivra.com` and `*.dev.firmivra.com`, TLSv1.2_2021). They answer 503 until Step 8 starts the tasks. The distributions' own domains (admin `d9q8sm5p4gja`, app `d1wyghmynm8dbl`, portal `d37wpe29mp47x1`, all `.cloudfront.net`) no longer serve a site.
- SES: domain identity `dev.firmivra.com` verified (DKIM and MAIL FROM `mail.dev.firmivra.com` both SUCCESS), configuration set `firmivra-dev-email`; the API sends with `EMAIL_MODE=ses` from `no-reply@dev.firmivra.com`. Account still in the SES sandbox.
- VPC origin lesson (Oct 5): CloudFront traffic through a VPC origin keeps CloudFront's origin-facing source addresses (`130.176.x.x` in the flow log), not the VPC range. The load balancer security group allows port 80 from the managed prefix list `com.amazonaws.global.cloudfront.origin-facing` (`pl-3b927c52`); a VPC-range rule made every request time out (504).

## Deploy guardrails (before any workflow runs, Rasel Oct 5)

- GitHub environments (set up in Step 2, checked Oct 5; admin bypass turned off on both, Oct 5): `dev` deploys only from `main`; `prod` only from `v*` tags, with Rasel as required reviewer. Ruleset `protect-release-tags`: only admins (Rasel) create, move or delete `v*` tags. Rasel is the only admin; the four developers have write access.
- CODEOWNERS: `/.github/workflows/` and `/.github/CODEOWNERS` are Rasel's even if the `*` rule is widened later; `protect-main` requires code owner review.
- Two IAM managed policies, defined in `infra/src/bootstrap-policies.ts`, printed by `pnpm exec tsx scripts/bootstrap-policies.ts exec|boundary`, created and updated by Rasel with the AWS CLI (not in a stack, so CloudFormation cannot change its own limits):
  - `firmivra-cdk-cfn-exec` replaces AdministratorAccess on the CDK execution role: only the services our stacks use; ECR, load balancer, Lambda, logs, RDS, S3 and secrets only for `firmivra-*` names; DNS records only in the `dev.firmivra.com` zone; roles only `firmivra-*` and only created with the boundary; the only managed policy it may attach is `AWSLambdaBasicExecutionRole`.
  - `firmivra-permissions-boundary` on the execution role and on every role our stacks create (also the GitHub deploy role): caps them at the services we use; IAM, S3 and secrets only for `firmivra-*` names; refuses roles without this boundary, boundary removal, changes to the two policies and changes to the `cdk-hnb659fds-*` bootstrap roles.
  - Tests check that every role carries the boundary, that the execution policy covers every resource type in our stacks, and that every action of our roles fits inside the boundary. IAM Access Analyzer: no findings on either policy.
- Done Oct 5: both policies created (v1); ci stack deployed (role `firmivra-dev-github-deploy`: trusts only `environment:dev` and `environment:prod`, 1-hour sessions, carries the boundary); every `firmivra-dev-*` role carries the boundary (10 roles). Bootstrap re-run with `--cloudformation-execution-policies arn:aws:iam::778127141557:policy/firmivra-cdk-cfn-exec --custom-permissions-boundary firmivra-permissions-boundary`: the execution role no longer has AdministratorAccess. `cdk diff --all` through it: no differences in any stack. IAM policy simulator on the execution role: the 19 kinds of change our stacks make are allowed; roles without the boundary, boundary removal, changes to the guardrail policies or bootstrap roles, AdministratorAccess, other buckets, secrets and zones, EC2 instances, IAM users and Organizations are refused. The first real deploy through it is the next stack change; if a permission is missing, CloudFormation rolls back and the fix is a new policy version.
- To change a policy later: edit `infra/src/bootstrap-policies.ts`, run the tests, then `aws iam create-policy-version --policy-arn arn:aws:iam::778127141557:policy/<name> --policy-document file://<printed json> --set-as-default` (IAM keeps 5 versions; delete the oldest first).

## Step 8: CI/CD (R1, Oct 5)

- `ci.yml` (PR #11): every pull request into `main` runs `pnpm install --frozen-lockfile`, `format:check`, `lint`, `typecheck`, `test` and `build` from the root through turbo. Postgres 16 runs as a service like `docker-compose.yml`, and `.env.example` is copied to `.env`. No AWS access. First run: green in 1m24s.
- `deploy-dev.yml`: every push to `main` (except `docs/**`), in environment `dev` through the OIDC role:
  1. Build the `api`, `web` and `migrate` images in parallel and push them to ECR, tagged with the commit sha. A re-run skips images that already exist.
  2. `cdk deploy firmivra-dev-app --exclusively` with `MigrateImageTag=<sha>`: only the migration task changes.
  3. Run the migration task. The deploy stops unless it exits 0, and its log is printed.
  4. `cdk deploy` with `ImageTag=<sha>`: api and web roll to 1 task each, and the ECS circuit breaker rolls back a release that does not get healthy.
  5. Smoke test: `/` on admin and app, `/lvp` on the portal, and `/api/v1/health` on all three. The URLs come from the stack outputs.
- **The running image tags** are the `ImageTag` and `MigrateImageTag` parameters of `firmivra-dev-app`. Both default to `none`, which means 0 tasks; otherwise each service runs `config.task.count`. Only `deploy-dev.yml` sets them. A manual `cdk deploy` without `--parameters` keeps the previous values, so an infra deploy never stops or swaps the running images. `-c imageTag` is gone, and the CDK app refuses it.
- **Only `firmivra-dev-app` deploys from `main`.** Template changes merged to `main` go live with the next push; the diff is in the job log. Network, data, auth, email and ci stay manual: `cdk diff`, then Rasel's yes.
- **Migration TLS** (lead follow-up, Oct 5): Prisma's schema engine (`prisma migrate deploy`) ignores `verify-full` and `NODE_EXTRA_CA_CERTS`. It also has two traps:
  - Without `sslaccept=strict` it accepts **any** certificate. `sslmode=require&sslcert=...` alone connected with a wrong CA.
  - `sslcert` reads only the **first** certificate of a file, so the RDS bundle (100+ CAs) would trust just one.

  `migrate-deploy.mjs` therefore gives Prisma `sslmode=require&sslaccept=strict` and `SSL_CERT_FILE` = the bundle (OpenSSL loads every certificate in it), and keeps `verify-full` for `pg`. It was tested against a local TLS Postgres with an unrelated CA first in the bundle: the right bundle connects, a wrong CA and a wrong host name are refused, and `DB_SSLMODE=disable` still works locally. The API is not affected: it uses Prisma's `pg` adapter, so `verify-full` applies.

## Link dev users (R1 step 13, one-off ECS task)

Links people who already exist in Cognito to the dev database:
- `users` rows: `SUPER_ADMIN` goes in the ADMIN pool; `OWNER`, `ADMIN` and `STAFF` in the STAFF pool;
- `platform_admins` for the Super Admin;
- an ACTIVE membership in LVP for staff.

If LVP is missing, it creates LVP with only the `businesses` row (ACTIVE) and empty `business_settings`; contact details, legal documents and tax statuses come from the setup wizard. It is safe to run again. It refuses to move a user to another pool. A firm always keeps an active owner (R0's `LAST_ACTIVE_OWNER` rule): to change an owner's role, list the new owner first in `LINK_USERS`. It runs only where `APP_ENV=dev` (set on the dev migrate task). Code: `packages/db/src/link-users.ts`, `packages/db/scripts/link-dev-users.mjs`.

**No emails or names in the repo, the task input or the logs.** ECS task overrides are recorded in CloudTrail, so the input `LINK_USERS` holds only Cognito subs and roles; any other key is refused. The task reads each email and name from Cognito with `ListUsers` and the filter `sub = "<sub>"`. That is the migrate task role's only Cognito permission, limited to the staff and admins pools. Our pools sign in by username, and `AdminGetUser` does not take the sub there (Oct 7). The task log shows user ids and roles only.

1. **Cognito logins** (R2's sign-in finds the user by email in our database, then by `sub` in Cognito, and does not support Cognito's temporary-password step):
   - username: a random UUID;
   - attributes: `email`, `email_verified=true`, `name`. In PowerShell put each one in double quotes (`"Name=email,Value=$email"`): bare, aws.exe receives the literal text `$email`;
   - no invite email (`--message-action SUPPRESS`);
   - then `admin-set-user-password --permanent`.

   MFA is set up at the first sign-in. The pool ids are in the `firmivra-dev-auth` outputs.
2. **Overrides file** outside the repo, for example `%TEMP%\link-users.json`. `LINK_USERS` holds subs and roles only; optional: `LINK_FIRM_SLUG` (default `lvp`) and `LINK_FIRM_NAME` (used only when the firm is created).
   ```json
   {"containerOverrides":[{"name":"migrate","command":["node","scripts/link-dev-users.mjs"],"environment":[
     {"name":"LINK_USERS","value":"[{\"sub\":\"<admins-pool sub>\",\"role\":\"SUPER_ADMIN\"},{\"sub\":\"<staff-pool sub>\",\"role\":\"OWNER\"}]"}]}]}
   ```
3. **Run it** with the subnets and security group from the `firmivra-dev-app` outputs (`TaskSubnets`, `MigrateSecurityGroup`):
   `aws ecs run-task --cluster firmivra-dev-cluster --task-definition firmivra-dev-migrate --capacity-provider-strategy capacityProvider=FARGATE,weight=1 --network-configuration "awsvpcConfiguration={subnets=[<subnets>],securityGroups=[<sg>],assignPublicIp=ENABLED}" --overrides file://<that file> --profile firmivra-dev`
4. **Read the result** in the log group `/firmivra/dev/migrate`.

## Firm KMS keys, EIN-hash key, Cognito email (R1 step 14, Oct 8)

Nothing here is in AWS before Rasel's yes. Merging the PR deploys `firmivra-dev-app` at once (Deploy dev); the bootstrap policies and `firmivra-dev-auth` are manual.

**API task role, firm keys** (`infra/src/firm-key-policy.ts`). Each firm gets its own KMS key, tagged `firmivra:env=<env>`, `firmivra:businessId=<id>` and `firmivra:purpose=firm-data`, and named `alias/firmivra/<env>/business/<id>`. The role may:
- create a key only with exactly those three tags (env pinned, a UUID-shaped id), and only a single-Region symmetric encryption key with key material from KMS (`kms:KeyOrigin=AWS_KMS`, `kms:MultiRegion=false`; the adapter sends both). CreateKey with the key policy lockout check bypassed is denied;
- tag a key (CreateKey with tags needs `kms:TagResource`) only with the three firm tags, never changing a firm tag a key already has to another value (`StringEqualsIfExists` against the requested values), never on a key that has an alias, and never on a CDK key (they carry the `project` tag). This holds whether or not KMS fills the new key's tags from the request, so the first real run needs no fallback;
- create aliases only under `alias/firmivra/<env>/business/`, and only on firm keys of the env (env and purpose tags, KMS key material, one Region);
- read keys of the env: `DescribeKey`, `GetKeyPolicy`, `ListResourceTags`, `ListGrants` (the adapter's checks);
- use a key (`GenerateDataKey`, `Decrypt`, the only calls field encryption makes) only when it is a firm key of the env and the encryption context's `businessId` equals its `firmivra:businessId` tag.

Never: `ScheduleKeyDeletion`, `DisableKey`, `PutKeyPolicy`, `UntagResource`, `UpdateAlias`, `DeleteAlias`, `CreateGrant`. A person removes a key.

**Key policy:** the adapter sends none, so KMS attaches its default for keys made through the API: one statement, `kms:*` for the account root (`arn:aws:iam::778127141557:root`), which hands control to IAM. For a key the adapter made, the statements above are all the API can do with it.

**Known limits, and what covers them:**
- KMS has no condition key for CreateKey's `Policy`. A compromised API task could make a key with a firm's tags and its own key policy (or grants), and name it with that firm's alias before the firm has a key. So the adapter checks every key it adopts by its alias (a repeat, or a key another call named first): enabled, a customer key of this account, `AWS_KMS`, one Region, symmetric encryption, exactly the three tags of that firm, KMS's default key policy, and no grants. Anything else stops with `FirmKeyError`, and nothing is stored; a person decides.
- `TagResource` can add firm tags to a key outside CDK that has no tags and no alias. The adapter refuses such a key unless its policy is the default and it has no grants, so it can do no more than a key the adapter made.
- Tags take up to five minutes to reach authorization. In that window IAM sees a new firm key as untagged, so a compromised task could give it another firm's id. Use still needs the encryption context to equal the tag: this can make a key unusable for its firm, but never lets one firm's id open another firm's data. `--check` after five minutes proves the tags on the real key, and R8 gets an alarm on `TagResource` calls by the API role.

**EIN-hash key** (R4 submit): Secrets Manager `firmivra/dev/firm-applications/ein-hash-key`, in the app stack, 64 lower-case hex characters (32 random bytes), injected into the API task as `EIN_HASH_KEY`. Never rotate it and never change its name or generation settings: a new value breaks the duplicate-EIN check. Kept if the stack is deleted or the resource is removed (`DeletionPolicy: RetainExceptOnCreate`, `UpdateReplacePolicy: Retain`). Never `get-secret-value` in a shared terminal.

**Cognito through SES:** the pools send reset codes from `no-reply@dev.firmivra.com` through the `dev.firmivra.com` identity and `firmivra-dev-email`. Cognito creates the service-linked role `AWSServiceRoleForAmazonCognitoIdpEmailService` on the first pool update, with the CloudFormation execution role, so `email.cognito-idp.amazonaws.com` was added to the service-linked roles both bootstrap policies allow. SES is still in the sandbox: only verified addresses get the email.

### Step 14 commands (Rasel, after his yes; Git Bash, from the repo root)

Every command is for the dev account and takes `--profile firmivra-dev`. `aws sso login --profile firmivra-dev` first if the session has expired.

In Git Bash, run `export MSYS_NO_PATHCONV=1` first. Otherwise Git Bash turns an argument that starts with `/`, such as the log group `/firmivra/dev/api`, into a Windows path, and `aws logs` refuses it (seen on Oct 10).

**0. The diffs, before review** (read-only). Run on Oct 8 after Rasel's `aws sso login`, results on #101: network, data, email and ci had no differences; auth had property updates only on the three pools (no replacement); app had this PR's changes plus the two usual image-tag lines that every diff without the pipeline's tags shows. The commands:

```bash
cd infra
pnpm exec cdk diff firmivra-dev-app -c env=dev --exclusively --profile firmivra-dev
pnpm exec cdk diff firmivra-dev-auth -c env=dev --exclusively --profile firmivra-dev
```

Expected: app, the API task role's policy (the seven `FirmKeys*` statements), a new API task definition revision (`APP_ENV`, `EIN_HASH_KEY`), the new secret `EinHashKey` and its read right on the API execution role. Auth, `EmailConfiguration` (SES, `From`, `SourceArn`, `ConfigurationSet`) and `VerificationMessageTemplate` on the three pools, nothing replaced. Anything else: stop.

**1. Bootstrap policy versions** (before the auth deploy). Rasel made both on Oct 8: v2 is the default, with `email.cognito-idp` in it. Check that first (read-only); if both lines say v2 and at least 1 line, skip the rest of this step (no v3):

```bash
for name in firmivra-cdk-cfn-exec firmivra-permissions-boundary; do
  arn=arn:aws:iam::778127141557:policy/$name
  v=$(aws iam get-policy --policy-arn "$arn" --query Policy.DefaultVersionId --output text --profile firmivra-dev)
  n=$(aws iam get-policy-version --policy-arn "$arn" --version-id "$v" --output json --profile firmivra-dev | grep -c email.cognito-idp)
  echo "$name: default $v, $n line(s) with email.cognito-idp"
done
```

Otherwise:

```bash
cd infra
pnpm exec tsx scripts/bootstrap-policies.ts exec > cfn-exec.json
pnpm exec tsx scripts/bootstrap-policies.ts boundary > boundary.json
for name in firmivra-cdk-cfn-exec firmivra-permissions-boundary; do
  aws iam list-policy-versions --policy-arn arn:aws:iam::778127141557:policy/$name \
    --query 'Versions[].[VersionId,IsDefaultVersion,CreateDate]' --output table --profile firmivra-dev
done
# Only for a policy that already has 5 versions: delete its oldest version that is not the default.
aws iam delete-policy-version --policy-arn arn:aws:iam::778127141557:policy/<name> --version-id <oldest non-default, e.g. v1> --profile firmivra-dev
aws iam create-policy-version --policy-arn arn:aws:iam::778127141557:policy/firmivra-cdk-cfn-exec \
  --policy-document file://cfn-exec.json --set-as-default --profile firmivra-dev
aws iam create-policy-version --policy-arn arn:aws:iam::778127141557:policy/firmivra-permissions-boundary \
  --policy-document file://boundary.json --set-as-default --profile firmivra-dev
rm cfn-exec.json boundary.json
```

**2. Merge the PR.** Deploy dev deploys `firmivra-dev-app` at once (firm key rights, `APP_ENV`, the EIN-hash secret). Wait for it to be green.

**3. Auth stack, then one real reset:**

```bash
cd infra
pnpm exec cdk deploy firmivra-dev-auth -c env=dev --exclusively --profile firmivra-dev
```

Then one password reset on dev with an SES-verified address (sandbox), and check the wording and the From address.

**4. The LVP key** (the one-off task on the API task definition, in the API's subnets and security group, with a public IP: there is no NAT):

```bash
q() { aws cloudformation describe-stacks --stack-name firmivra-dev-app --profile firmivra-dev \
  --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text; }
run() {
  task=$(aws ecs run-task --cluster firmivra-dev-cluster --task-definition firmivra-dev-api \
    --capacity-provider-strategy capacityProvider=FARGATE,weight=1 \
    --network-configuration "awsvpcConfiguration={subnets=[$(q TaskSubnets)],securityGroups=[$(q MigrateSecurityGroup)],assignPublicIp=ENABLED}" \
    --overrides "{\"containerOverrides\":[{\"name\":\"api\",\"command\":[\"node\",\"dist/firm-applications/create-firm-key.cli.js\",$1]}]}" \
    --started-by create-firm-key-lvp --query 'tasks[0].taskArn' --output text --profile firmivra-dev)
  echo "Task: $task"
  aws ecs wait tasks-stopped --cluster firmivra-dev-cluster --tasks "$task" --profile firmivra-dev
  aws ecs describe-tasks --cluster firmivra-dev-cluster --tasks "$task" --profile firmivra-dev \
    --query 'tasks[0].[containers[0].exitCode,stoppedReason]' --output text
  aws logs get-log-events --log-group-name /firmivra/dev/api --log-stream-name "api/api/${task##*/}" \
    --start-from-head --query 'events[].message' --output text --profile firmivra-dev
}
run '"lvp"'            # makes, names and stores the key; exit code 0; safe to run again
sleep 300; run '"lvp","--check"'   # five minutes later: own id wraps, another id is refused
```

The log prints `Firm lvp (<LVP id>): stored key <key arn>`. Read-only checks with those values:

```bash
aws kms describe-key --key-id alias/firmivra/dev/business/<LVP id> --profile firmivra-dev
aws kms list-resource-tags --key-id <key arn> --profile firmivra-dev
aws kms get-key-policy --key-id <key arn> --policy-name default --output text --profile firmivra-dev
aws kms list-grants --key-id <key arn> --profile firmivra-dev
```

A `Failed: The key ... ; a person decides` line means the alias names a key the adapter would not make: nothing was stored; look at that key before anything else.

**5. The email check** (the first dev application). Send one firm application on dev from an SES-verified address (sandbox). The received email must arrive, and the API log must have no "could not be sent" line in the last hour (read-only; empty output is the pass):

```bash
aws logs filter-log-events --log-group-name /firmivra/dev/api --filter-pattern '"could not be sent"' \
  --start-time $(( ($(date +%s) - 3600) * 1000 )) --query 'events[].message' --output text --profile firmivra-dev
```

From this application on, rollback (c) is no longer safe: its stored EIN hash needs the same key.

### Step 14 rollback, per item (no full revert needed)

- **(a) KMS rights and `APP_ENV`:** a PR that drops the `firmKeyStatements` loop (and `APP_ENV`) from `app-stack.ts`; its merge deploys the app stack. Only before any value is encrypted with a firm key: after that, the API could no longer read it. Until R4 approve lands, only the one-off command can make a key (no `FIRM_KEYS` provider is registered), so not running step 4 is enough to stop key creation.
- **(b) The LVP key**, only while nothing is encrypted with it: clear `businesses.kms_key_id` for LVP in platform scope (a one-off migrate-task SQL with R0; the app cannot), then `aws kms delete-alias --alias-name alias/firmivra/dev/business/<LVP id> --profile firmivra-dev` and `aws kms schedule-key-deletion --key-id <key arn> --pending-window-in-days 30 --profile firmivra-dev`. Undo within 30 days: `aws kms cancel-key-deletion --key-id <key arn>`, then `aws kms enable-key --key-id <key arn>` (a cancelled key comes back disabled), then `aws kms create-alias` again.
- **(c) The EIN-hash secret:** leave it. R4 submit reads it since #107, so removing it is safe only before the first dev application (step 5): after that, the stored hashes need the same key. If it must go: a PR that removes `EinHashKey` and `EIN_HASH_KEY` (the secret stays, retained). The name stays taken while the secret exists or waits for deletion, so a later PR that adds it again fails the app deploy (and Deploy dev rolls the stack back). Before adding it again, while no hash is stored: `aws secretsmanager delete-secret --secret-id firmivra/dev/firm-applications/ein-hash-key --force-delete-without-recovery --profile firmivra-dev`. After a `delete-secret --recovery-window-in-days 30`, run `aws secretsmanager restore-secret --secret-id firmivra/dev/firm-applications/ein-hash-key --profile firmivra-dev` and then force-delete it, or keep the restored one and bring it back into the stack with `cdk import`.
- **(d) Cognito email:** a PR that removes `cognitoEmail` from the dev config (the pools go back to `COGNITO_DEFAULT`), then `pnpm exec cdk deploy firmivra-dev-auth -c env=dev --exclusively --profile firmivra-dev`. The policies: `aws iam set-default-policy-version --policy-arn arn:aws:iam::778127141557:policy/<name> --version-id <previous vN> --profile firmivra-dev` for each. The service-linked role stays (harmless).

## GuardDuty Malware Protection of uploads (R1 step 19, Oct 9)

Nothing here is in AWS before Rasel's yes. Everything is in `firmivra-dev-app` (`infra/src/stacks/malware-scan.ts`, used by `app-stack.ts`), so merging the infra PR deploys it through Deploy dev. The data stack does not change and needs no manual deploy. The bootstrap policies are manual and come first.

**What it adds:**
- **Plan role** `firmivra-dev-malware-scan`. It is AWS's template (malware-protection-s3-iam-policy-prerequisite), narrowed to `tenant/*` plus the validation object:
  - GuardDuty's managed rule `DO-NOT-DELETE-AmazonGuardDutyMalwareProtectionS3*`, with `events:ManagedBy` for writes;
  - the bucket's EventBridge setting and `ListBucket`;
  - get, get-version and tag (also by version) on objects;
  - `PutObject` on the validation object only;
  - `kms:Decrypt` and `GenerateDataKey` on the documents key, through S3 only (`kms:ViaService`);
  - no delete. The trust is exactly AWS's: `malware-protection-plan.guardduty.amazonaws.com`, with no condition, since none is documented for it.
- **The plan:** every new object under `tenant/` of `firmivra-dev-documents-778127141557`, tagged `GuardDutyMalwareScanStatus` with its result. No detector is needed.
- **Result queue** `firmivra-dev-malware-scan-results` (SSE-SQS, TLS only, long polling, 120 s visibility, 4 days) and its dead-letter queue `-dlq` (14 days, longer because a dead letter's age counts from its first enqueue). Only the results rule may send to either (`aws:SourceArn`).
- **Rules on the default bus:**
  - `firmivra-dev-malware-scan-results`: GuardDuty's "Object Scan Result" for this account and bucket, to the queue, with EventBridge's own delivery failures going to the dead-letter queue. It has no `resources` (plan ARN) filter, because AWS documents that only for upload-triggered scans, and on-demand rescans must come through too.
  - `firmivra-dev-malware-scan-plan-health`: the plan's status changes (Active, Warning or warning, Error) and failed tagging, straight to the alarm topic.
- **Alarm topic** `firmivra-dev-alarms`, shared with R8's later alarms. It has no subscription in the repo: Rasel subscribes by CLI after the deploy. It is not encrypted: CloudWatch and EventBridge cannot publish to a topic under `aws/sns`, and a customer managed key costs $1 a month. It carries alarm states and plan status only (names, ids and codes). Revisit for prod.
- **Five alarms**, each emailing on ALARM and on OK:
  - `dead-letters`: the dead-letter queue has messages. It stays in ALARM until the queue is redriven or purged (step 8).
  - `stuck`: the oldest result is over 40 minutes old, so the API is not reading the queue.
  - Three on markers in the API log `/firmivra/dev/api` (metric filters, namespace `Firmivra/dev`), each firing again for every new occurrence:
    - `unfinished` (`SCAN_UNFINISHED`): our side could not finish a scan (ACCESS_DENIED, FAILED, UNSUPPORTED without a file reason). The file stays "checking"; rescan it (step 7's command, for one key).
    - `rejected` (`SCAN_REJECTED`): a message the API did not take. A GuardDuty result it cannot read, or an unknown status, is kept so it dead-letters for a redrive once the parser reads it (AWS changed the event); a message for another account, region or bucket is deleted (our config is wrong).
    - `last-receive` (`SCAN_LAST_RECEIVE`): a result still without a record goes to the dead-letter queue next.
- **API task:**
  - `SCAN_RESULTS_QUEUE_URL`;
  - `sqs:ReceiveMessage`, `DeleteMessage` and `ChangeMessageVisibility` on the result queue only (no dead-letter queue, no KMS);
  - `stopTimeout` 60 s. Fargate Spot sends SIGTERM at the start of its 2-minute warning, and SIGKILL follows after `stopTimeout`. 60 s lets the result in hand (about 48 s worst case) and open requests finish.
- **Outputs:** `AlarmTopicArn`, `MalwareProtectionPlanId`, `MalwareScanRoleArn`, `ScanResultsQueueUrl`, `ScanResultsQueueArn`, `ScanResultsDeadLetterQueueArn`.

**Key policy: IAM delegation, data stack untouched.** The documents key's policy is KMS's default statement (`kms:*` for the account root), which turns on IAM policies for the key. The API role's `DocumentsKey` statement already relies on that, and the plan role's grant (with `kms:ViaService` S3) works the same way. A key-policy statement naming the plan role would need either a dependency cycle (app imports from data) or a hard-coded ARN. It would also need a manual deploy of the termination-protected stack that holds the database. Tests pin that the key keeps only the root statement.

**The queue's timing.**
- A result whose upload has no record yet (`UNKNOWN`) is not deleted. The API makes its first 5 receives visible again after 20 s (`ChangeMessageVisibility`), so a result that beats the confirm shows within seconds. After that, the 120 s default applies.
- `maxReceiveCount` is 20: 5 x 20 s + 15 x 120 s comes to about 32 minutes before the dead-letter queue. That is twice the 15-minute upload ticket, and below the 40-minute `stuck` alarm.
- 120 s is more than twice the consumer's worst case. A Fargate Spot stop mid-message only means the message comes back, and the set-once scan result makes the repeat a no-op.

**For the API PR** (the consumer, R5's path). It logs these markers, with ids and codes only:
- `SCAN_UNFINISHED` for a PENDING outcome;
- `SCAN_REJECTED` with the message id and the reason for any message it rejects. A GuardDuty result it cannot read (`UNREADABLE_SCAN_RESULT`) or a status outside the five is kept for a redrive; not JSON, not a GuardDuty scan result, or another account, region or bucket is deleted;
- `SCAN_LAST_RECEIVE` when it keeps a message on receive 20.
- A documents result that is `UNKNOWN` and older than the confirm window (event `time` + 15 min ticket + 5 min) is final: `IGNORED`, logged as an orphan upload. `UNKNOWN` stays only for a prefix with no handler yet, so never-confirmed uploads do not fill the dead-letter queue.
- The API reads the queue URL from the env; it refuses to start in production without it, so it merges after this deploy is green.

**Cost, dev, per month (us-east-1):** about $0.00 to $0.10 at today's volume (a few hundred synthetic uploads, all under 10 MB).
- GuardDuty Malware Protection for S3: free for the first 12 months for 1,000 objects and 1 GB scanned per month, then $0.215 per 1,000 objects plus $0.09 per GB. On-demand rescans are not in the free tier (a few cents).
- GuardDuty's own S3 calls are billed as normal S3 requests and not in its free tier: the GET of each object, the tag, and the validation object's PUT. That is fractions of a cent.
- S3 object tags: $0.01 per 10,000 tags a month.
- SQS: one task long-polling makes about 130,000 receives a month, under the 1 million free requests.
- EventBridge: GuardDuty's events and same-account delivery are free; S3's events are under $0.01.
- CloudWatch: 5 alarms and 3 log metrics, inside the free 10 of each.
- SNS email: free (1,000 a month).
- KMS: inside the 20,000 free requests (bucket key on).
- Worst case at 5,000 uploads and 5 GB a month: about $1.30.
- Sources: aws.amazon.com/guardduty/pricing, the GuardDuty guide's "pricing-malware-protection-for-s3-guardduty", and the SQS, EventBridge, CloudWatch and S3 pricing pages.

**Networking:** API tasks have public IPs and allow all outbound, so they reach SQS's public endpoint. A move to private subnets would need an SQS interface endpoint, about $7.30 per AZ per month.

**Later, not in this PR:**
- Per-firm document keys (`docs/api/documents.yaml`, "KMS (pending)"): the plan role then needs `kms:Decrypt` and `GenerateDataKey` on the firm keys, with `kms:ViaService` S3. Without it, every scan is `ACCESS_DENIED` (`UNAUTHORIZED_TO_GET_OBJECT`), which leaves files PENDING and fires `unfinished`.
- If the data stack ever adds S3 notifications to the documents bucket, it must set `eventBridgeEnabled: true`, or the plan stops getting events.
- **Other prefixes:** R13's esign objects, R14's agreements and R15's leads are scanned too. That includes esign's server-written copies (PutObject, and CopyObject from the vault). Until each one registers its handler in the API's registry, their results go `UNKNOWN`, then to `last-receive` and the dead-letter queue, then step 8. The esign module is off on dev today, so this becomes noise only once it is on.

### Step 19 commands (Rasel, after his yes; Git Bash, from the repo root)

Every command is for the dev account and takes `--profile firmivra-dev`. `aws sso login --profile firmivra-dev` first if the session has expired.

In Git Bash, run `export MSYS_NO_PATHCONV=1` first. Otherwise Git Bash turns an argument that starts with `/`, such as the log group `/firmivra/dev/api`, into a Windows path, and `aws logs` refuses it (seen on Oct 10).

**0. The diffs, before review** (read-only), on the infra PR's branch (`git fetch origin && git switch rasel/R1-guardduty-infra`). Post the results on the PR:

```bash
cd infra
pnpm exec cdk diff firmivra-dev-app -c env=dev --exclusively --profile firmivra-dev
pnpm exec cdk diff firmivra-dev-data -c env=dev --exclusively --profile firmivra-dev
```

Expected for app:
- IAM: the new role `firmivra-dev-malware-scan` with its inline policy, the `ScanResultsQueue` statement on the API task role, and the queue and topic policies;
- new resources: the topic and its policy, 2 queues and 2 queue policies, the GuardDuty plan, 2 rules, 3 metric filters and 5 alarms;
- a new API task definition revision (`SCAN_RESULTS_QUEUE_URL`, `StopTimeout`), the stack description, and 6 new outputs;
- the two usual image-tag parameter lines.

Expected for data: no differences. Anything else, above all a replacement or anything in data: stop.

**1. Bootstrap policy versions, before the merge.** Without them the deploy fails and rolls back. Print the policies from the PR's branch (step 0's checkout), where the new statements are; switch back afterwards. Both should be at v2 today, so this makes v3:

```bash
cd infra
pnpm exec tsx scripts/bootstrap-policies.ts exec > cfn-exec.json
pnpm exec tsx scripts/bootstrap-policies.ts boundary > boundary.json
for name in firmivra-cdk-cfn-exec firmivra-permissions-boundary; do
  aws iam list-policy-versions --policy-arn arn:aws:iam::778127141557:policy/$name \
    --query 'Versions[].[VersionId,IsDefaultVersion,CreateDate]' --output table --profile firmivra-dev
done
# Only for a policy that already has 5 versions: delete its oldest version that is not the default.
aws iam delete-policy-version --policy-arn arn:aws:iam::778127141557:policy/<name> --version-id <oldest non-default> --profile firmivra-dev
aws iam create-policy-version --policy-arn arn:aws:iam::778127141557:policy/firmivra-permissions-boundary \
  --policy-document file://boundary.json --set-as-default --profile firmivra-dev
aws iam create-policy-version --policy-arn arn:aws:iam::778127141557:policy/firmivra-cdk-cfn-exec \
  --policy-document file://cfn-exec.json --set-as-default --profile firmivra-dev
rm cfn-exec.json boundary.json
# Check (read-only): both lines say v3 and at least 1 line.
for name in firmivra-cdk-cfn-exec firmivra-permissions-boundary; do
  arn=arn:aws:iam::778127141557:policy/$name
  v=$(aws iam get-policy --policy-arn "$arn" --query Policy.DefaultVersionId --output text --profile firmivra-dev)
  n=$(aws iam get-policy-version --policy-arn "$arn" --version-id "$v" --output json --profile firmivra-dev | grep -c MalwareProtectionPlan)
  echo "$name: default $v, $n line(s) with MalwareProtectionPlan"
done
```

**2. Merge the infra PR.** Deploy dev deploys `firmivra-dev-app`, and R1 watches the run; wait for green. The old API image ignores `SCAN_RESULTS_QUEUE_URL`. From now on, results collect in the queue (up to 4 days). Any upload before step 5 makes `stuck` go to ALARM after 40 minutes, and it clears once the consumer drains the queue. So merge the API PR right after this run is green.

**3. Subscribe to the alarms by email.** The address is typed in the terminal and never committed:

```bash
q() { aws cloudformation describe-stacks --stack-name firmivra-dev-app --profile firmivra-dev \
  --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text; }
aws sns subscribe --topic-arn "$(q AlarmTopicArn)" --protocol email --notification-endpoint <your address> --profile firmivra-dev
```

`q` reads a stack output; steps 4, 6 and 8 use it too. Click the link in the confirmation email, then test the path once:

```bash
aws cloudwatch set-alarm-state --alarm-name firmivra-dev-malware-scan-rejected --state-value ALARM --state-reason "path test" --profile firmivra-dev
```

An email arrives. The alarm goes back to OK at its next evaluation (within 5 minutes) and sends an OK email. The test uses a log-marker alarm on purpose: `dead-letters` and `stuck` keep their state when SQS sends no data (an empty, idle queue), so a forced ALARM on them would stay, and the first real dead letter would send no email.

**4. Plan status** (read-only). The plan's first "Active" event comes before the plan-health rule and the subscription exist, so no email arrives for it. This command is the check, and the rule covers later changes:

```bash
aws guardduty get-malware-protection-plan --malware-protection-plan-id "$(q MalwareProtectionPlanId)" --query '[Status,StatusReasons]' --profile firmivra-dev
```

- Expected: `ACTIVE`.
- `WARNING` or `ERROR` right after the deploy can be IAM propagation (for example `UNAUTHORIZED_TO_ASSUME_ROLE` or `INSUFFICIENT_TEST_OBJECT_PERMISSIONS`): CloudFormation makes the role and calls GuardDuty at once. Wait 5 minutes and check again.
- If it still shows, make GuardDuty validate again with the same role, then check again:

```bash
aws guardduty update-malware-protection-plan --malware-protection-plan-id "$(q MalwareProtectionPlanId)" --role "$(q MalwareScanRoleArn)" --profile firmivra-dev
```

Otherwise read the reason code in https://docs.aws.amazon.com/guardduty/latest/ug/troubleshoot-s3-malware-protection-status-errors.html.

**5. Merge the API PR** (the consumer). Deploy dev ships it; wait for green. It drains what queued up since step 2.

**6. The real-event check on dev,** with synthetic files only:
- (a) In the portal, as the LVP test client, upload a plain synthetic PDF. It should show as ready within about a minute.
- (b) Upload a synthetic PDF saved from Word with File > Save As > PDF > Options > "Encrypt the document with a password". It shows as ready (q24).
- (c) Read the log. Empty output is a fail:

```bash
aws logs filter-log-events --log-group-name /firmivra/dev/api --filter-pattern '?"Scan result" ?"SCAN_UNFINISHED" ?"SCAN_REJECTED"' \
  --start-time $(( ($(date +%s) - 3600) * 1000 )) --query 'events[].message' --output text --profile firmivra-dev
```

  Expected: `NO_THREATS_FOUND [] -> CLEAN` for (a), and `UNSUPPORTED [PASSWORD_PROTECTED] -> UNSCANNED` for (b). That confirms GuardDuty sends the reason; write it here. If (b) instead shows `SCAN_UNFINISHED ... UNSUPPORTED []`, R1 opens the PDF `/Encrypt` fallback PR, and after it deploys, rescan (b).
- (d) An on-demand rescan of (a)'s object must come through the rule too. Its log line says `-> IGNORED` (the result is already set):

```bash
B=firmivra-dev-documents-778127141557
aws guardduty send-object-malware-scan --s3-object "Bucket=$B,Key=tenant/<LVP id>/documents/<upload id of (a)>" --profile firmivra-dev
```

  Then run (c)'s command again a minute later.
- (e) Tag and queue checks (read-only):

```bash
aws s3api get-object-tagging --bucket $B --key tenant/<LVP id>/documents/<upload id> --profile firmivra-dev   # GuardDutyMalwareScanStatus
aws sqs get-queue-attributes --queue-url "$(q ScanResultsQueueUrl)" --attribute-names ApproximateNumberOfMessages ApproximateNumberOfMessagesNotVisible --profile firmivra-dev
```

**7. Rescan uploads made before the plan existed.** They stay "checking", because GuardDuty scans new objects only. These are on-demand scans, a few cents:

```bash
aws s3api list-objects-v2 --bucket $B --prefix tenant/ --query 'Contents[].Key' --output text --profile firmivra-dev | tr '\t' '\n' | while read -r k; do
  [ -z "$k" ] || [ "$k" = None ] && continue
  t=$(aws s3api get-object-tagging --bucket $B --key "$k" --query "TagSet[?Key=='GuardDutyMalwareScanStatus'].Value" --output text --profile firmivra-dev)
  [ -z "$t" ] || [ "$t" = None ] || continue
  aws guardduty send-object-malware-scan --s3-object "Bucket=$B,Key=$k" --profile firmivra-dev && echo "sent ${k##*/}"
done
```

Objects that were uploaded but never confirmed have no record, so their results are orphans: the API ignores them after the confirm window.

**8. After each `dead-letters` or `last-receive` email:** look at the count, then redrive or purge, so the alarm goes back to OK and the next dead letter emails again.

```bash
aws sqs get-queue-attributes --queue-url "$(aws sqs get-queue-url --queue-name firmivra-dev-malware-scan-results-dlq --query QueueUrl --output text --profile firmivra-dev)" \
  --attribute-names ApproximateNumberOfMessages --profile firmivra-dev
# Once the waiting handler (R13 esign, R14 agreements, R15 leads) is on dev, within 14 days of the upload:
aws sqs start-message-move-task --source-arn "$(q ScanResultsDeadLetterQueueArn)" --destination-arn "$(q ScanResultsQueueArn)" --profile firmivra-dev
# Or, when nothing in it is needed:
aws sqs purge-queue --queue-url "$(aws sqs get-queue-url --queue-name firmivra-dev-malware-scan-results-dlq --query QueueUrl --output text --profile firmivra-dev)" --profile firmivra-dev
```

`--destination-arn` is required. Without it, SQS returns messages to their source queue, and the messages EventBridge wrote there itself (delivery failures) have no source queue.

**After a `rejected` email:** the API did not take a queue message. A GuardDuty result it cannot read, or one with a status it does not know, stays in the queue and dead-letters: the `last-receive` and `dead-letters` emails follow. GuardDuty has already tagged those objects, so step 7's loop would skip them. Once the API reads them (a fix merged and deployed), redrive them as above. A message for another account, Region or bucket is deleted: check the results rule and `S3_DOCUMENTS_BUCKET`.

### Step 19 rollback, per item

- **(a) The email subscription:** `aws sns list-subscriptions-by-topic --topic-arn "$(q AlarmTopicArn)" --profile firmivra-dev`, then `aws sns unsubscribe --subscription-arn <arn> --profile firmivra-dev`.
- **(b) The consumer:** revert the API PR first. Its config refuses to start in production without `SCAN_RESULTS_QUEUE_URL`, so the infra revert must come after it.
- **(c) The scan, queues, rules, alarms and topic:** a PR that removes `MalwareScan`, the topic, the API's `ScanResultsQueue` statement, `SCAN_RESULTS_QUEUE_URL` and the 6 outputs. Its merge deletes them; uploads then stay "checking" on dev. Deleting the plan should make GuardDuty remove its managed rule with the plan role. CloudFormation deletes the role right after the plan, so check that the rule is gone (read-only):

```bash
aws events list-rules --name-prefix DO-NOT-DELETE-AmazonGuardDutyMalwareProtectionS3 --profile firmivra-dev
```

  If a rule is left: `aws events list-targets-by-rule --rule <name>`, then `aws events remove-targets --rule <name> --ids <ids> --force` and `aws events delete-rule --name <name> --force` (each with `--profile firmivra-dev`).
- **(d) The bootstrap policies,** only after (c) is deployed: `aws iam set-default-policy-version --policy-arn arn:aws:iam::778127141557:policy/<name> --version-id v2 --profile firmivra-dev`, for each of the two.
- **(e) What stays, harmless:** the bucket's EventBridge setting, which GuardDuty turned on; the `GuardDutyMalwareScanStatus` tags on objects; the API's 60 s `stopTimeout` (a separate one-line revert if wanted).

## Switching to dev.firmivra.com (config, certificate and aliases only; no code change)

Done Oct 5: steps 1 to 3 (`customDomain: DEV_FIRMIVRA_COM`; the diff matched step 3; deployed network, email, app, data, auth in that order). Tests and the nag report still cover the CloudFront-domain setup (`customDomain: undefined`, `CLOUDFRONT_DOMAINS=1`).

1. GoDaddy: add the 4 NS records for `dev` (see "Left for Rasel"). Check: `Resolve-DnsName dev.firmivra.com -Type NS` lists the four Route 53 name servers.
2. `infra/src/config.ts`, dev: `customDomain: DEV_FIRMIVRA_COM` instead of `customDomain: undefined`. That is the only edit.
3. `pnpm --filter @firmivra/infra exec cdk diff -c env=dev --profile firmivra-dev`, then deploy `firmivra-dev-data`, `firmivra-dev-email` and `firmivra-dev-app` with Rasel's yes. The diff should show only:
   - data: documents bucket CORS origins become `https://admin.dev.firmivra.com`, `https://app.dev.firmivra.com` and `https://portal.dev.firmivra.com` (instead of `https://*.cloudfront.net`);
   - email (new stack): SES domain identity with DKIM, MAIL FROM `mail.dev.firmivra.com`, DMARC record;
   - app: an ACM certificate for `dev.firmivra.com` and `*.dev.firmivra.com` (validated through Route 53), one alias per distribution with TLSv1.2_2021, 6 Route 53 alias records (A and AAAA for each site), web `ADMIN_HOST`/`APP_HOST`/`PORTAL_HOST` and both apps' `*_BASE_URL` set to the custom hosts, API `EMAIL_MODE=ses` with the SES sender and configuration set.
4. Nothing to rebuild: the web app reads its host map at runtime, and the API reads its URLs from the task environment. The `*.cloudfront.net` URLs then stop serving a site (their host is no longer in the host map).
5. Afterwards: request SES production access, update the README dev URLs, and close the GoDaddy item in this log.

## Notes for Step 7 (from Step 6)

- CloudFront: done as three distributions with `/api/*` to the API through the internal load balancer. Health checks: API `/api/v1/health`, web `/healthz`.
- Deployed environments run with `NODE_ENV=production` and `AUTH_MODE=cognito`; the API refuses `AUTH_MODE=local` in production (tested).
- Migration task: done, separate image `packages/db/Dockerfile` (Prisma CLI, config, migrations, `scripts/migrate-deploy.mjs`); it also sets the app role's login password from Secrets Manager.
- API image is 758 MB: about 150 MB is Prisma tooling that pnpm installs as peer dependencies of `@prisma/client`. Trim when the migration image is decided.

## Still open from the plan

- Who has the GoDaddy login for firmivra.com (Octavia?)
- Secret scanning non-provider patterns: check in the browser under Settings, Advanced Security (or Code security) whether "Scan for non-provider patterns" is offered for this repo; if not, it needs an organization-owned repo.
- LVP's own Terms and Privacy, approved calculators and formulas, mockups for appointments, My Services, notification center and service workspaces.
