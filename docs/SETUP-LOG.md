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

Team on GitHub: Fahad `Sefat-Ullah-Fahad`, Tumit `tumit-h-r-75`, Ibrahim `BFIbrahim`, Nahid `asratulhasannahid`. Octavia is not a collaborator.

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
- [ ] Nahid and Ibrahim: accept their repo invitations.
- [ ] Confirm with Octavia that her mockups and specs can be public.
- [ ] Step 8: add `ci` as a required status check in `protect-main` after the first CI run.
- [ ] Root user MFA on account `778127141557` (sign in as root → Security credentials → Assign MFA device); root password in Octavia's password manager.
- [ ] Stripe: create the Firmivra account in test mode; the test keys go into GitHub environment secrets in Step 8.
- [ ] Company details from Octavia (pending; nothing blocks on them): legal name, address, support email, privacy and terms URLs. They go in one place, `apps/web/src/lib/company.ts` (placeholders now), then into the two requests below.
- [ ] SES production access: **send before beta, needs company details from Octavia** and a firmivra.com page that describes the product. Request text: `docs/aws/SES-PRODUCTION-REQUEST.md`. Until then SES stays in the sandbox (200 a day, verified addresses only).
- [ ] SES sandbox: the team's 6 addresses (Rasel, Fahad, Nahid, Tumit, Ibrahim, Octavia) were added Oct 5 and are pending until each person clicks the link in the AWS email (valid 24 hours). Addresses are not listed here (public repo). Check: `aws sesv2 list-email-identities --profile firmivra-dev --region us-east-1`.
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
- Cognito sends forgot-password codes itself; branded SES email needs a Cognito custom email sender (Lambda + KMS key, Step 7) or our own reset codes.
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
