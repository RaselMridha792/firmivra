# R1: Infra finish and CI/CD (Oct 6)

**Goal:** A merge to main builds the images and runs api and web on dev automatically.

**Owned paths (change only these):**

- `infra/**`
- `.github/workflows/**`
- `apps/api/Dockerfile`
- `apps/web/Dockerfile`
- `packages/db/Dockerfile`
- `docs/SETUP-LOG.md`

**Read first (nothing else):** CLAUDE.md, docs/work/README.md, this file, and:

- docs/SETUP-LOG.md
- infra/src/config.ts
- docs/AUTH-DESIGN.md is NOT needed

## Steps

- [x] 1. SES sandbox: verify identities for the team and Octavia (Rasel gives the emails in chat, never commit them)
- [x] 2. Deploy firmivra-dev-ci (GitHub OIDC role firmivra-dev-github-deploy, trust only environment dev and prod), show diff, wait for yes
- [x] 3. Re-run cdk bootstrap with the narrowed firmivra-cdk-cfn-exec policy; cdk diff --all shows no surprises
- [x] 4. Push rasel/setup-infra and open the PR; Rasel merges
- [x] 5. ci.yml on every PR: install, lint, typecheck, test, build (no AWS access)
- [x] 6. deploy-dev.yml on push to main (environment dev): build api, web, migrate images, push to ECR, run the migrate task, update ECS services to 1 task each, smoke test the three dev URLs. From the lead (Oct 5):
  - Before the first run: `packages/db/scripts/migrate-deploy.mjs` needs a separate Prisma URL with `sslmode=require&sslcert=/app/rds-ca.pem`, because Prisma's native engine ignores `verify-full` and `NODE_EXTRA_CA_CERTS`. Keep `verify-full` for `pg`.
  - Make one place own the running image tag, so a `cdk deploy` without `-c imageTag` cannot scale dev to 0.
- [ ] 7. deploy-prod.yml only on v* tags (environment prod, Rasel approves); keep it disabled until R8 creates prod stacks
- [x] 8. Confirm .github/workflows/ is in CODEOWNERS; developers' PRs cannot change workflows without Rasel
- [ ] 9. Dependabot alerts on main (4 open on Oct 5, all in pnpm-lock.yaml through other packages): mysql2 3.15.3 twice (high, medium) through the prisma 7.10.0 CLI; deepmerge-ts 7.1.5 (high) through @prisma/config 7.10.0; braces 3.0.3 (high) through @next/eslint-plugin-next, fast-glob and micromatch. Update the parent packages or add pnpm overrides, then confirm on GitHub that all four alerts close. Rasel's go (Oct 5): this step may change the overrides in the root package.json or pnpm-workspace.yaml, and pnpm-lock.yaml.
- [x] 10. Find why Windows blocks turbo.exe on Rasel's machine ("An Application Control policy has blocked this file", Oct 5; the SWC binding was blocked at times too) and fix it so `pnpm lint`, `pnpm typecheck` and `pnpm test` work from the repo root again; make sure ci.yml runs them from the root through turbo. Until then build the packages first, as turbo would (`pnpm --filter @firmivra/types --filter @firmivra/db run build`), then use `pnpm -r run <script>`. Never turn off a Windows security feature without Rasel's yes.
- [x] 11. CLAUDE.md and README.md still say dev runs on `*.cloudfront.net`; change them to `admin.`, `app.` and `portal.dev.firmivra.com`. The lead's go (Oct 5): this step may change CLAUDE.md and README.md.
- [x] 12. Cognito refresh token validity per pool: staff 7 days, admins 1 day, clients 30 days (Rasel, Oct 5). Show the `cdk diff` of firmivra-dev-auth, deploy with Rasel's yes, and tell R2 the new values.
- [x] 13. One-off "link dev users" command in the migrate image, run as an ECS task by Rasel after the first deploy is healthy. Cognito subs, emails, names and roles come in as task overrides (`LINK_USERS`), never committed. It creates the `users` rows (`SUPER_ADMIN` in the ADMIN pool; `OWNER`, `ADMIN` or `STAFF` in the STAFF pool), `platform_admins` for the Super Admin, and an ACTIVE membership in LVP for staff. LVP itself gets only the `businesses` row (ACTIVE) and `business_settings`; legal documents and tax statuses come through the setup wizard on dev. Code: `packages/db/src/link-users.ts` (uses `runInScope`), `packages/db/scripts/link-dev-users.mjs`, a test against the test database, and `packages/db/Dockerfile` ships `dist`. Guard: the migrate task gets `APP_ENV=dev` and the script refuses any other value. No CLIENT role until R3 asks. Rasel's go (Oct 5) for those `packages/db` paths; tell R0 in R0's "Needs from others".

- [ ] 14. Per-firm KMS keys (API role, tag-conditioned), the create-firm-key command for LVP, R4's EIN-hash secret, Cognito reset emails through SES (Rasel and the lead, Oct 8). One PR; nothing in AWS before Rasel's yes; merging deploys firmivra-dev-app. Deploy order: bootstrap policy versions, merge (Deploy dev), `firmivra-dev-auth`, one real reset on dev, the LVP key and `--check`, then one dev firm application (the email check).

Rasel's Oct 18 plan (Oct 8 evening): R1 keeps only work that needs AWS or a Stripe key, plus #118's follow-up and R5 part 2. Every AWS step outside Deploy dev is shown to Rasel first. AWS and Stripe secrets never go where a cloud thread can read them, and `.env` is never committed.

- [ ] 15. Oct 9, 13:00 window: the process PR (#137): path-guard (Tumit's `audit-log/`, Fahad's and Nahid's except lists for the signature and calculator pages), PAGE-MAP rows for R13-web, R14 and R16, `docs/work/README.md` for the new setup, and CLAUDE.md's mockup list.
- [ ] 16. Oct 9–10, with Rasel: the Firmivra Stripe account in test mode, Connect (Standard accounts, Account Links), the platform profile and branding. Test keys go only in R1's local `.env`.
- [ ] 17. Oct 9–10, with AWS: step 14's steps 3 to 5 (`docs/SETUP-LOG.md`). Oct 10: check on dev that R16's approve creates the firm key.
- [ ] 18. Oct 10–11: R5 part 2, plus #118's follow-up: `uploadFile()` (`apps/web/src/lib/upload.ts`) retries confirm's 503 with the same token after `retryAfter`, a few times.
- [ ] 19. Oct 10–11, with AWS: GuardDuty Malware Protection on the dev documents bucket, EventBridge to SQS, and one consumer that routes by key prefix: documents and leads are R1's, `tenant/<id>/esign/` goes to R13-api's handler and `tenant/<id>/agreements/` to R14's; each result is set once. Live by Oct 11 20:00. No bypass, so nothing on dev turns CLEAN before then.
- [ ] 20. Oct 11 ~21:30, with Rasel's yes: set-module on dev (`MODULE_CHANGE` `lvp:esign:on`, then `lvp:calculators:on`, with `MODULE_REASON`) on the migrate task; test the off path once.
- [ ] 21. Oct 12 morning: smoke-test R16's onboarding-link PR with the Stripe test key (`COMPLETE`, `paymentsEnabled` true) before its 13:00 merge.
- [ ] 22. Oct 12–13, with AWS: `STRIPE_SECRET_KEY` (test) and `STRIPE_WEBHOOK_SECRET` in dev Secrets Manager and the API task; the Connect webhook at `/api/v1/webhooks/stripe`.
- [ ] 23. Oct 13–15, with AWS and Rasel's yes on each diff: R8 step 5's prod stacks, step 7's `deploy-prod.yml`, GuardDuty on prod, live Stripe keys in prod.
- [ ] 24. Oct 14: R8 step 4, a point-in-time restore test of the dev database, written up here.
- [ ] 25. Daily from Oct 10: SES production access and SNS SMS registration. Oct 13 18:00: a checkpoint in the progress log. Oct 16: smoke-test the empty prod stacks.
- [ ] 26. Oct 17–18 (R9): tag `v1.0.0`, the prod deploy and migrations, set-module on prod with Rasel's yes.

## Done when

https://app.dev.firmivra.com, https://admin.dev.firmivra.com and https://portal.dev.firmivra.com/lvp answer 200 after a merge to main.

## Needs from others

**Needs from Rasel (Oct 19):**

- **Demo reseed on dev, parked:** waits for `aws sso login --profile firmivra-dev` (the session expired). Rasel's go (Oct 19) covers it: RDS snapshot, push the image built from `85419edc` (`firmivra-dev-migrate:demo-seed-85419edc`, built locally, not pushed), task definition `firmivra-dev-demo-seed:2`, `unseed-demo-task` then `seed-demo-task` (#782's real Begin Online forms need the unseed), then `link-dev-users` again: Rasel's staff login as OWNER of `demo`, and Harper's portal login (client mode, the same clients-pool sub as Oct 18), because the unseed deletes the firm's memberships and Harper's user. Check: `GET /api/v1/portal/demo/info` shows `#001F4B` and `#E68B18` (was `#2F6F4E`, `#C9A227`). If Deploy dev has moved past `85419edc` by then, rebuild from the deployed commit first.
- **Not R1's paths, proposals only (each needs Rasel's go):**
  - `docs/junior/PAGE-MAP.md` still lists Integrations (the section title and 12 rows) as Arfan's; the path guard gives it to Tumit since #797.
  - `.github/pull_request_template.md` asks for the mockup next to a screenshot at desktop width and 375 px; the review thread wants 1440 px in three states (data, empty, API unreachable).
- **CI after #829 (4 shards):** the first full run's slowest shard took 5.7 min (was about 7.5 min with 2 shards). The tenant-isolation sweep timeout is already 180 s on `main` (`SWEEP_MS`), so that flake needs nothing more.

Questions for Rasel (Oct 8 evening; BOARD.md is closed, so they live here):

- **Rasel: #101's order** (the commands are in `docs/SETUP-LOG.md`, step 14). The real `cdk diff` ran on Oct 8 and is posted on #101.
  1. The two bootstrap policy versions: done by Rasel on Oct 8 (both at v2). A read-only check before the auth deploy.
  2. The merge, which deploys `firmivra-dev-app`; R1 watches the run.
  3. `cdk deploy firmivra-dev-auth` and one real password reset.
  4. The LVP key one-off, then its `--check`.
  5. One firm application on dev from a verified sandbox address: the received email must arrive, and `/firmivra/dev/api` must have no "could not be sent" line.
- **Rasel: R2's leaked-password dev test**, after step 3, with a throwaway staff user whose inbox Rasel reads: its password is reset to a known leaked one, the API must answer `RESET_CODE_INVALID` (docs/api/auth.yaml), and Cognito's auth events must show the compromised-credentials block.
- **Rasel: a time on Oct 9 or 10 for the Stripe test account** (step 16).

- R8: the notes in R8-hardening.md "Decisions and notes (Oct 8)" (prod SES, sign-up and SMS alarms, KMS key count).

## Prod go-live checklist (Oct 22)

R1, Oct 18, from a read-only `cdk diff --all -c env=prod --method=template` on a local draft prod config (not on `main`; its values are the proposals in step 5). Nothing was created in AWS. Prod is the same account (778127141557, us-east-1) with its own `firmivra-prod-*` stacks.

**Yes** = Rasel's own yes before it runs. **SSO** = needs Rasel's `aws sso login --profile firmivra-dev`. **PR** = R1 opens it, Rasel merges.

**Start now (long lead times):**

1. **SES production access** (Yes, SSO or console). The account is still in the sandbox (200 emails a day, verified recipients only) and access was never requested. AWS reviews in about a day and may ask questions. The same account, so it also lifts dev's sandbox.
2. **DNS for firmivra.com** (decision, then Octavia). There is no Route 53 zone for it; the stacks need one for the certificate, the three site records and SES. Proposal: create a `firmivra.com` hosted zone, copy every record GoDaddy has today (website, MX for company email, SPF and other TXT, any `_dmarc`) and the `dev` NS records (the dev.firmivra.com delegation, or dev goes offline), then Octavia replaces the domain's 4 name servers at GoDaddy with the zone's. Keeping GoDaddy DNS instead needs code changes that are not ready for Oct 22.
3. **SMS** (decision). US SMS through SNS needs a registered toll-free or 10DLC number (days to weeks). Decide whether prod starts without SMS.
4. **Stripe live** (Rasel at Stripe): the account activated for live payments, Connect live settings and platform branding.

**PRs before any prod deploy:**

5. **Prod config** (PR, values to decide): sites `admin.`, `app.` and `portal.firmivra.com`, sender `no-reply@firmivra.com`; RDS t3.small (dev: t3.micro), 20 to 100 GiB, 14 days of backups, single-AZ (the data stack fixes `multiAz: false`; Multi-AZ doubles the database cost); Fargate 0.5 vCPU / 1 GB, on demand (no Spot), 2 tasks per service; logs 14 days; Stripe secret `firmivra/prod/stripe`; no SES sandbox rule.
6. **`firmivra-prod-ci` conflicts with dev** (PR). The diff would create a second GitHub OIDC provider and a second `ecr-public` pull-through cache rule; each exists once per account (`firmivra-dev-ci` owns both). The prod stack must reuse them.
7. **Bootstrap policies** (Yes, SSO). The CDK execution role may change records only in the dev zone (`HOSTED_ZONE_IDS`); add the prod zone id. `firmivra-cdk-cfn-exec` is at v5 of IAM's 5: delete the oldest non-default version first.
8. **`deploy-prod.yml`** (PR, step 7): on `v*` tags only, GitHub environment `prod` (exists: required reviewers, and deployments only from `v*` tags), the prod deploy role (trusts environment `prod` only), the same images into `firmivra-prod-*` ECR, the migrate task, the rollout and a smoke test of the three prod sites. Then narrow `firmivra-dev-github-deploy`, which trusts `dev` and `prod` today, to `dev`.
9. **First Super Admin and LVP in prod** (gap). `link-dev-users` refuses anything but `APP_ENV=dev`, as it should. Prod needs a reviewed one-off for the first Super Admin and the LVP firm (`packages/db`, R0's path).

**Deploy order (each a Yes, SSO, diff shown first):**

10. The zone resolves through Route 53; the bootstrap policy versions are in place.
11. `firmivra-prod-network` (VPC, 2 public and 2 isolated subnets, no NAT, flow log), `-data` (RDS PostgreSQL, documents and access-log buckets, documents KMS key, owner and app DB secrets), `-auth` (3 Cognito pools with deletion protection, the API clients secret), `-email` (SES identity `firmivra.com`: 3 DKIM records, MAIL FROM `mail.firmivra.com`, DMARC), `-ci`.
12. By hand before the app: `firmivra/prod/stripe` with the live `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY` and `STRIPE_WEBHOOK_SECRET`. The stacks make the other secrets (DB, Cognito clients, CloudFront origin header, EIN-hash key).
13. `-app` through the first `v1.0.0` tag: 3 ECR repositories, the ECS cluster and 2 services, the load balancer, 3 CloudFront distributions with one certificate, 6 site records, the GuardDuty malware plan, scan queues, 5 alarms and the alarm topic (confirm its email subscription).
14. Stripe live Connect webhook at `https://app.firmivra.com/api/v1/webhooks/stripe` (the events dev uses), its signing secret into `firmivra/prod/stripe`, then a redeploy.
15. Prod data: the Super Admin (step 9), LVP and its KMS key (`create-firm-key`, then `--check`), set-module for LVP with reasons.
16. Smoke test: the three sites answer 200, staff sign-in with MFA, a password reset email arrives, a portal sign-in, a document upload turns CLEAN.

## Handoff (R1 session, Oct 23)

This is newer than every handoff below, so read it first. Where they differ, this one wins.

### What this session did (Oct 19 to 23; Rasel merged all of it)
- **Firm screens and their tests:**
  - #955: dashboard.
  - #957: Leads and Tasks tables.
  - #978: Clients screen to its design. It shows month-on-month change on the first two cards only, has no sort parameter, and has three-state screenshots.
  - #980: the Leads specs, rewritten to the current screens.
- **Clients and dashboard API:**
  - #962: the contract.
  - #964: the work fields, summary, bulk actions, period selectors, task priority and revenue against last year. Tax season stays `null` until `business_settings` has its columns (R0).
- **`/api` proxy:** #966, a route handler. A request the browser aborted now gets 499, not 500. It also added vitest to `apps/web`.
- **Schema:**
  - #995: Locations on `firm_offices` (contact, status, manager, services, hours, scheduled actions, the address duplicate check), `appointment_types.meeting_methods`, custom roles and the Business Consultant role, 100 MB on the document paths, link-code settings, secure document links and their codes.
  - #1013: `firm_office_members`.
  - Both are applied on dev.
- **Infra:**
  - #1000: 35-day database backups and 35-day old document versions. The data stack was deployed on Oct 21 with Rasel's go; the snapshot taken first is `firmivra-dev-pre-backup35-20261021`.
  - #1003: CloudFront read timeout 60 s, ALB idle 120 s, API task 1024 MiB (`apiMemoryMiB`), and `s3:ListMultipartUploadParts`. Deployed on merge.
- **#1009, uploads up to 100 MB:**
  - Files over 16 MB upload in 10 MB parts, through a 1-hour session.
  - Confirm completes the upload and checks it.
  - A multipart object's download check uses `x-amz-meta-sha256`.
  - One 320 MB read budget per API process.
  - The web uploader retries parts.
  - Support, communications and template attachments stay at 10 MB.
- **Locations:**
  - #1015: the contract.
  - #1021: the API, the real `GET /business/settings/overview` route, and `LocationActionsJob` (`LOCATION_JOBS`). Rasel decided:
    - Super Administrator means the Owner, or an Admin with SETTINGS MANAGE (custom roles included);
    - a firm's first ACTIVE location becomes primary;
    - a cancelled, suspended or expired subscription sets no location limit;
    - the conflict rule stays strict;
    - deactivating a location keeps its appointments, warns, and hides it from new bookings.
- **#1024:** Firm Sign allows 100 MB per document and 100 MB in all per request (`REQUEST_TOO_LARGE`).
- **#1025, I10:** intake file sizes 2, 5, 10, 50 or 100 MB, enforced at the upload ticket for portal intake and Begin Online. A firm with no settings row gets 10 MB. A legacy saved 25 MB stays valid.
- **#1027** (merged): the refunds e2e reads its audit rows in order. It was flaky because of a missing `orderBy`.
- **Open at handoff, waiting for Rasel:**
  - **#1037:** the intake upload screens show the firm's own size limit. It adds a required `maxFileSizeMb` to `MyIntake` and `BeginOnlineForm`, and Begin Online checks it before upload.
  - **#1040:** Octavia's item A1. Appointment types offer 1 to 3 meeting methods, bookings must use one of them, and errors name the field (`methods.N`, `method`, `locationKind`). The screens are another session's. The web mock still has the one-method check for type configuration, kept so R56's #1029 spec passes. Lift it when the types screen moves to A1.

### Dev data fix (Oct 22, Rasel's own block)
- **What changed:** Octavia's LVP login is now OWNER. Membership `01a1306a-4b71-7388-b87a-ed142b919c0c` went from ADMIN to OWNER.
- **No one was demoted.** The first Owner, membership `01a11307-65da-74ea-b744-73724ef85ece`, stays OWNER, so LVP has 2 active Owners.
- **Audit:** `membership.role_changed` (actor type SYSTEM, reason "Dev data fix (Rasel, Oct 22)").
- **How it ran:** a one-off task on the `firmivra-dev-migrate` task definition, with an inline `node --input-type=module -e` script.
  - It finds her by the SHA-256 of her email's local part, so no email goes into the overrides, which CloudTrail records.
  - It reads `memberships` in LVP's business scope (`app.scope = business`, `app.current_business_id`), because RLS forces it.
- **Undo, only on Rasel's word:** the same task with the direction reversed. In LVP's business scope, `UPDATE memberships SET role = 'ADMIN'` on that membership, plus an audit row. Only do it while the other Owner is active, and `memberships_keep_an_owner` guards it anyway.
- **Platform contact:** the platform's contact for a firm is its oldest active Owner, so LVP's billing and communications contact is still the first Owner.

### Local state on Rasel's laptop
- **This worktree's database:** `.env` points `DATABASE_URL` and `DATABASE_URL_APP` at `firmivra_r1c`.
  - Never reset `firmivra_r1b` (Rasel).
  - Prisma refuses `migrate reset` when Claude runs it; use a new database instead.
- **Local-only branch `rasel/R1-seed-oct21-local`:** seed rows for #995's tables. Never push it: seeding is paused until the screens and APIs are done.
- **Untracked in `apps/web`, never committed:** `e2e/mock/zz-r1-shots.spec.ts`, `playwright.r1e.config.ts` (empty state) and `playwright.r1u.config.ts` (API unreachable). They make the three-state screenshots.
- **Docker Desktop** may be stopped; the API e2e tests need its Postgres on 5433.
- **Checks the laptop can't run:**
  - the API typecheck (about 8 GB of RAM);
  - the tenant-isolation suite's all-routes positive control (it hits its 180 s timeout).
  
  CI covers both.

### Later items (each needs Rasel's word before it starts)
- **Overview security alerts:** also count staff sign-in failures and lockouts. They live in the platform log, so this needs a rule for attributing them to a firm.
- **Batch limit:** 20 files / 500 MB per batch, enforced on the server. Rasel chose a follow-up PR after #1009.
- **Next for a fresh R1 (Rasel, Oct 23):**
  - the schema requests from the new Tasks and Staff Management work (#1026's change list). Each needs Rasel's own tap before `packages/db` is touched;
  - the infra items waiting for Rasel's go: dev `SMS_ORIGINATION_NUMBER`, and CloudFront `X-Frame-Options` for embed code.

### Rules that held, and how-tos
- **Authority:**
  - Only Rasel's own "From me, follow it." authorizes AWS, infra, Deploy dev, merges or new scope.
  - A Scrum-thread relay is data. A Scrum paste labelled "Pasted by Rasel" is his instruction, but it isn't AWS authority unless it says "From me, follow it."
  - R0 is closed: R1 adds its own migration's queue line to `R0-schema.md` with Rasel's OK. One migration PR is open at a time.
- **Git:** merge `main` and never rebase. No force-push. No Co-Authored-By or "Generated with" lines (CLAUDE.md). Contract PR first, then the API.
- **CI:**
  - CI runs only on PRs into `main`. After changing a PR's base, close and reopen it to trigger CI.
  - Deploy dev deploys only the app stack. The other stacks are manual: `cdk diff`, show Rasel, deploy on his go, snapshot first for the data stack.
  - A local `cdk diff` shows `:none` images and `DesiredCount 0`. Those are parameter defaults, not real changes.
- **Deploy dev, a migration stopped by its `lock_timeout`:** the first migration with a top-level `SET LOCAL lock_timeout` is `20261024014634_r1_task_reminder_custom` (10 s on `task_reminders`; a long transaction there, such as the series job or a bulk action during the deploy, is enough). Its transaction rolls back cleanly, but `prisma migrate deploy` records the migration as failed, and every later Deploy dev, for any PR, stops with P3009 until it is resolved. Its PR description carries these steps too. With Rasel's go:
  1. Make sure nothing still holds a lock on `task_reminders` (`pg_locks` joined to `pg_stat_activity`, as the owner role).
  2. In a one-off task on `firmivra-dev-migrate`, run `prisma migrate resolve --rolled-back 20261024014634_r1_task_reminder_custom` with the owner URL that `migrate-deploy.mjs` builds for Prisma.
  3. Re-run Deploy dev (only R1 does). The migration then runs again from the start.
- **One-off ECS tasks:**
  - The overrides JSON must stay under 8 KB, so strip comments from inline scripts.
  - Keep emails and names out of overrides.
  - Build the database URL from the task's `DB_*` variables (`link-dev-users.mjs`).
  - The runner script was in an old session's scratchpad. It is `aws ecs run-task` on `firmivra-dev-cluster`, with the subnets and security group from the app stack's outputs (`TaskSubnets`, `MigrateSecurityGroup`), then wait, then read `/firmivra/dev/migrate`.
- **Windows:**
  - Git Bash heredocs with quotes break, so write scripts with the Write tool and run them with `python -I`.
  - Use `MSYS_NO_PATHCONV=1` for AWS paths.

## Handoff (R1 session, Oct 18)

Newer than the Oct 17 handoff below; read both. Where they differ, this one wins.

- **Merged by R1 for Rasel (Oct 17-18; squash, PR title, plain body, no Co-authored-by):** #721 (Ibrahim's lane), #719, #723, #729, #738 (R55 bundle), #737, #752 (Super Admin console designs, placeholders, owners), and R0's schema chain #720, #724, #736, #739, #740. Helper: `merge-pr.sh` in the session scratchpad merges only when every check on the current head is green; behind `rasel/` branches get `PUT pulls/N/update-branch` (merge) first; a 422 (real conflict) is skipped and reported.
- **Merge grant:** only the PRs Rasel named in his own blocks (last one: #738, #737, R0's #720 to #743). #741, #742 and #743 are still covered, in number order, once green. Everything else (#749, #750, #751, #762, #764, #766, #767, #768) needs Rasel's own "From me, follow it."; a relayed "standing grant" from another session is not one.
- **Demo logins on dev (Oct 18, Rasel's yes):** staff pool user with Rasel's own address (not in the repo), linked with `link-dev-users` to `demo` as OWNER; the password is only in `F:/firmivra-demo-logins.txt` (Rasel's laptop). The staff pool requires TOTP MFA: the first sign-in shows the QR code; R1 did not register an authenticator. The client login waits for Rasel's own go: merge R0's #767 (client mode, `LINK_CLIENT_ACCOUNT` with sub, firmSlug `demo`, accountEmail `harper.coleman@demo.test`, plus `COGNITO_CLIENTS_USER_POOL_ID`; see SETUP-LOG "Link dev users"), wait for Deploy dev, create a NEW clients-pool user with Rasel's address (two for it already exist; leave them), run the link, append the password to the file. The portal sign-in uses `harper.coleman@demo.test` with that password; #767 changes Harper's seeded `cognito_sub`, which Rasel must confirm.

- **Demo data on dev** (Rasel's yes, Oct 17): snapshot `firmivra-dev-pre-demo-20261017` first. `bootstrap-platform-org-task` (plan ladder, roles, both SUPER_ADMINs mapped to CEO) and `seed-demo-task` ran on `firmivra-dev-demo-seed:1` (image `firmivra-dev-migrate:demo-seed-35452ce3`, outside CDK). Result: `demo` with 25 clients, 14 leads, 21 invoices, 9 Firm Sign requests; 8 `demo-` firms; LVP unchanged. Portal slug `demo`. The `firmivra-dev-migrate` lifecycle keeps 10 images, so that image ages out after about 9 deploys: rebuild it (`--target demo-seed-task`, `BASE_REGISTRY` = the cache) before an unseed. Deregister the task definition after the unseed.
- **Open, waiting for Rasel:**
  - The seeded `@demo.test` users have synthetic Cognito ids and cannot sign in on dev.
  - Begin Online on `demo`: Rasel checks `/demo/begin/annual-tax` first; only if it shows "not available online" does R1 get a yes for the read-only `firm_agreements` query (R0 expects one open ALL_INTAKES row; the dev seed image was built from 35452ce3, after #705).
  - Local branch `rasel/R1-integrations-secrets` (not pushed): the API role's `IntegrationSecrets` statement for #732's `firmivra/tenant/*/integrations/*`. Decisions: an env prefix in the secret path, and per-firm KMS key vs the Secrets Manager default key. Merge before the Integrations API's credential storage is used on dev.
- **Findings for others:** R0's `bootstrap-platform-org-task` logs the SUPER_ADMIN emails (ids only, CLAUDE.md rule 4). The tenant-isolation positive-control test times out at 30 s on bigger PRs; #732 raises it to 180 s.
- **CI note:** a PR keeps the `ci.yml` of its base until `main` is merged in; a re-run of an old job uses the old file.

## Handoff (R1 session, Oct 17)

For a fresh R1 window. Newer than the Oct 8 handoff below; where they differ, this one wins.

- **Live on dev AWS (all with Rasel's go):**
  - **Bootstrap policies:** `firmivra-cdk-cfn-exec` **v5** (v4 added the `EcrRegistrySettings` statement, v5 the service-linked role `pullthroughcache.ecr.amazonaws.com`), `firmivra-permissions-boundary` **v4** (the same service name). v1 to v3 of each are kept; IAM allows 5 versions, so delete the oldest non-default one before the next.
  - **`firmivra-dev-ci`** (manual stack, deployed Oct 17): the ECR pull-through cache rule `ecr-public` → `public.ecr.aws` (no repository creation template: Rasel chose least privilege), the pull-only OIDC role `firmivra-dev-github-ci-pull` (this repo's `pull_request` subject only), and the same pull rights on the deploy role. ECR made `ecr-public/docker/library/postgres` and `.../node` on the first pull; they have no lifecycle rule.
  - **GuardDuty malware scan** (#324, #326 merged): plan `ACTIVE`; the 3 objects from before the plan were rescanned (`NO_THREATS_FOUND`).
  - **Alarm topic `firmivra-dev-alarms`:** one email subscription, confirmed by Rasel (Oct 17). The address is not in the repo. The path test (forced `firmivra-dev-malware-scan-rejected`) sent the email.
  - **Platform team migrations** (#677): the trigger `platform_members_ceo_role_check` exists; `platform_admins` has 2 `SUPER_ADMIN` rows and `platform_members` is empty until R0's bootstrap task runs.
- **Open:**
  - #707 (this cache, infra code) and #708 (`ci.yml`, Deploy dev and the three Dockerfiles use the cache; fork PRs fall back to `mirror.gcr.io`). Rasel merges both. After #708, ask R0, R55 and R56 to merge `origin/main` into their PRs, and give Rasel the developer PRs (#671 to #676, #681, #689, #696).
  - Scan prefixes `esign`, `agreements` and `leads` have no handler yet: their results dead-letter and trip `dead-letters`. Purge only on Rasel's yes.
  - The real-event check (plain and password-protected PDF through the portal) waits for the Documents API; never ask for or read a login.
  - Demo seed and the platform org bootstrap on dev (R0's `demo-seed-task` image stage): RDS snapshot first, then Rasel's separate yes.
- **Rules unchanged:** only R1 starts, cancels or re-runs Deploy dev, with Rasel's yes; any AWS change needs his go after the diff; no Co-Authored-By or Generated-with lines.

## Handoff (R1 session, Oct 8 evening)

Where R1 stands, for a fresh session or after a context reset. Newest state first.

- **Rasel's Oct 18 plan (Oct 8 evening):** R1's order is steps 15 to 26 above. R4, R6 and R7 went to R16, with the pushed branches `rasel/R4-api-approve-wip` and `rasel/R6-notification-center-api`.
- **Open PRs:**
  - #101: infra (firm keys, the LVP key command, the EIN-hash secret, Cognito reset emails through SES). The real `cdk diff` is posted on it, and Rasel did step 1 himself: both bootstrap policies are at v2, with `email.cognito-idp` in them. Main is merged in again after #124; it waits for the cloud re-check and Rasel's merge. Steps 3 to 5 and R2's leaked-password test (with a throwaway staff user) come as Rasel's "From me, follow it." block. Merging it deploys `firmivra-dev-app`; R1 watches that run.
  - #137: step 15.
- **Being built:** R5 part 2, branch `rasel/R5-documents-api-part2` (on #118, now merged): the portal routes with the household rule, the request routes, the request path of confirm, and the scan-result method with q22 and q24. Its first commit, `MyDocument.uploadedBy`, goes out as its own contract PR from main. The API PR opens when a slot is free (at most 2 open).
- **After #101 merges** (Rasel's yes, Oct 8): four small PRs, one at a time, each with its real `cdk diff` where it touches AWS:
  - (a) `audit-log/` under Tumit in `path-guard.yml` (in #137);
  - (b) an s3mock service in `ci.yml`;
  - (c) `SCAN_MODE=local` on the dev API task only;
  - (d) R5's infra: GuardDuty with its result queue and alarm, expiry for unconfirmed uploads, and per-firm document keys.

  Any AWS step or deploy outside Deploy dev goes to Rasel first.

- **Answered by Rasel (Oct 8):** yes to (a) to (d); approve (R16 now) makes the default categories, and LVP on dev gets them through a one-off task after telling Rasel; q22 to q24 for documents; q12 household logins.
- **Local:**
  - The R1 checkout `F:/firmivra-R1` uses database `firmivra_r1b`. Prisma refuses an AI-run `migrate reset` without Rasel's own consent, so the old `firmivra_r1` is left for Rasel to drop.
  - `.env` has the `.env.example` `EIN_HASH_KEY`; local uploads need `SCAN_MODE=local`.
  - One worktree only, one heavy command at a time, at most 2 agents (Rasel, Oct 8).
- **Deploy dev:** R1 watches every run, and only R1 starts, cancels or re-runs one. A pending run cancelled by a newer push is normal; the newer run ships both.

## Progress log

(newest last: date, step, what changed, commit)

- 2026-10-05, step 1: SES sandbox identities created for the team and Octavia (6, pending until each person clicks the AWS link); addresses are not in the repo.
- 2026-10-05, step 2: firmivra-dev-ci deployed; role firmivra-dev-github-deploy trusts only environment:dev and environment:prod, 1-hour sessions, carries firmivra-permissions-boundary.
- 2026-10-05, step 3: bootstrap re-run with firmivra-cdk-cfn-exec and the boundary; cdk diff --all: no differences; IAM policy simulator: 19 kinds of change allowed, 12 refused as expected (d25d5d6).
- 2026-10-05, step 4 (part): rasel/setup-infra pushed at d25d5d6; PR not opened yet. The lead merged origin/main into it locally (012d1b3; .github/CODEOWNERS: kept both blocks); not pushed.
- 2026-10-05: Rasel added steps 9 (Dependabot alerts) and 10 (turbo blocked on Windows).
- 2026-10-05, step 10 (part): the cause is Smart App Control (unsigned turbo.exe 2.11.7, no reputation yet). turbo is pinned to exactly 2.11.6 on branch rasel/R1-turbo-pin (9c3e5d5), PR #6. `pnpm lint`, `pnpm typecheck` and `pnpm test` pass from the root. Notes in SETUP-LOG.md. Left: Rasel merges #6, every checkout runs `pnpm install`, and ci.yml (step 5) runs the checks through turbo.
- 2026-10-05, step 4: rasel/setup-infra pushed at 8529d9b and PR #7 opened ("feat: dev infrastructure with AWS CDK (R1)", 2,740 lines: the deployed Step 7 work in one piece). Tick when Rasel merges.
- 2026-10-05, steps 4 and 10: PRs #6 (turbo pin) and #7 (infra) merged; rasel/setup-infra merged with origin/main and `pnpm install` run (turbo 2.11.6). The lead's three follow-ups added (two under step 6, new step 11).
- 2026-10-05, step 5 (part): `.github/workflows/ci.yml` on branch rasel/R1-ci. It runs on every PR into main: job `ci`, read-only token, no AWS, actions pinned to SHAs, Postgres 16 service on 5433 with the app role from `docker/postgres/init`, `.env.example` copied to `.env`, then `pnpm install --frozen-lockfile`, `format:check`, `lint`, `typecheck`, `test` and `build` from the root through turbo. All pass locally. Tick steps 5 and 10 after the first green run on GitHub.
- 2026-10-05, step 8: checked. CODEOWNERS gives Rasel `/.github/workflows/` and `/.github/CODEOWNERS`. `protect-main` needs 1 code-owner approval (stale approvals dismissed; only the admin role can bypass). Environment `dev` takes only `main`; `prod` takes only `v*` tags and needs Rasel; admin bypass is off on both. The default token is read-only. No secrets or variables at repo, environment or Dependabot level, so a PR that edits a workflow cannot reach AWS or secrets before review. Keep deploy secrets in environment secrets only.
- 2026-10-05, steps 5 and 10: first CI run on PR #11 is green in 1m24s (run 37333851068): turbo 2.11.6 runs lint 10/10, typecheck 9/9, test 7/7 (types 4, db 37, api 34, infra 29 tests) and build 5/5 from the root. Left for Rasel: add `ci` as a required status check in `protect-main`.
- 2026-10-05, step 6 (part): `deploy-dev.yml` and both lead follow-ups on branch rasel/R1-deploy-dev. Image tags are now the `ImageTag` and `MigrateImageTag` parameters of firmivra-dev-app (`-c imageTag` refused). `migrate-deploy.mjs` gives Prisma `sslaccept=strict` with `SSL_CERT_FILE` = the RDS bundle: the lead's `sslcert` URL accepted any certificate, and `sslcert` reads only the first certificate of a file. Tested against a local TLS Postgres (6 Prisma cases and 5 script cases). actionlint clean; lint, typecheck and test green. `cdk diff --all`: only firmivra-dev-app differs (parameters, condition, new task definition revisions, 1 output). Tick after the first green deploy.
- 2026-10-05, step 11: CLAUDE.md and README.md show the dev.firmivra.com hosts (PR #14, merged).
- 2026-10-05, step 9: pnpm overrides mysql2 ^3.23.1 and deepmerge-ts ^8.0.2 (PR #18, merged); alerts #2 to #4 close on the next scan. braces #1 has no fixed release: dismissed as tolerable risk with Rasel's yes (lint tooling and the migrate task only, not in the API or web images).
- 2026-10-05, step 6: the first Deploy dev runs failed at the OIDC login. The repo uses GitHub's immutable OIDC subject (`repo:RaselMridha792@149437621/firmivra@1404534844:...`). firmivra-dev-ci was deployed with the new trust (Rasel's yes), PR #19. A manual re-run got AWS credentials and pushed images; it was cancelled before the deploy job, at Rasel's request, so the #19 merge starts the real first deploy.
- 2026-10-05, step 12 (part): auth stack sets refresh tokens per pool (staff 7 days, admins 1, clients 30). `cdk diff`: only the staff and admins app clients change (43200 to 10080 and 1440 minutes). R2 was told the values. The deploy waits for Rasel's yes.
- 2026-10-05, step 12: firmivra-dev-auth deployed at about 16:35 on Rasel's yes. The live app clients read back staff 10080, clients 43200 and admins 1440 minutes (access 15). PR #21 is open, so AWS is ahead of `main` until it merges. (Rasel's later message asked to deploy only after #21 merges; the deploy had already run, and it was not reverted, because reverting is another deploy.)
- 2026-10-05, end of day (Rasel): stopped with no fixes, no pushes and no deploys. Deploy dev run 37341275899 (from the #19 merge, 4856f89) was still running when I stopped: the web and migrate images were pushed, the api image was queued, and the deploy job had not started. No failure was seen.
- Next steps (Oct 6):
  1. Read the result of run 37341275899 (`gh run view 37341275899`). If it failed, log the failing step and error here, then fix. If it is green, check that https://app.dev.firmivra.com, https://admin.dev.firmivra.com and https://portal.dev.firmivra.com/lvp answer 200, then tick step 6.
  2. firmivra-dev-auth is already deployed. Once the lead merges #21, run `cdk diff firmivra-dev-auth`: expect no differences, then tick step 12. Merge origin/main into this branch first.
  3. Step 13, link dev users, after the deploy is healthy: build it as planned, and add the FYI in R0's "Needs from others".
- 2026-10-06, step 6: run 37341275899 (from the #19 merge) never failed: its api image job sat queued for 17 h without a GitHub runner, while its siblings and every CI run got runners. Holding the `deploy-dev` concurrency slot, it blocked all deploys; the waiting runs from #16 and #17 replaced each other and were cancelled. With Rasel's yes it was cancelled (the first cancel got HTTP 502, the retry worked), and Deploy dev was started by hand on main a0bee59, which includes #16 and #17: run 37442128460.
- 2026-10-06, step 6: run 37442128460 (manual) also stalled: GitHub held two of the three parallel `environment: dev` image jobs in "waiting", with no rule on dev. It was cancelled before its deploy job. Fix in PR #24: one job, so one GitHub deployment per run. The #24 merge (f6c56e8) started run 37446932875: green in 13m15s. Images took 6 min, the migration task applied all 7 migrations over strict TLS and set the app role's login, and api and web rolled out. https://app.dev.firmivra.com, https://admin.dev.firmivra.com and https://portal.dev.firmivra.com/lvp answer 200, and `/api/v1/health` on all three returns `{"status":"ok","db":"ok"}`. Step 6 done. Rule from Rasel (Oct 6): only R1 starts, cancels or re-runs Deploy dev runs; the lead merges and watches.
- 2026-10-06, R2's CSRF check (#23): the live settings show `Origin` and `Sec-Fetch-Site` reach the API unchanged. All three distributions use `Managed-AllViewer` (all headers) with caching off on `/api/*` and default, and have no CloudFront functions or Lambda@Edge. On the load balancer, `drop_invalid_header_fields` only drops malformed header names, there are no header-changing listener settings and no WAF, and `/api/*` is forwarded straight to the API. No fix needed. The proof follows once #23 is deployed: a sign-in POST with Origin https://app.dev.firmivra.com and a wrong password must answer INVALID_CREDENTIALS, not 403.
- 2026-10-06, step 12 done: #21 merged (9c4c4bd); `cdk diff firmivra-dev-auth` shows no differences, so AWS matches main (staff 7 days, admins 1 day, clients 30 days).
- 2026-10-06, step 13 (part): code on branch rasel/R1-link-dev-users:
  - `packages/db/src/link-users.ts`: `parseLinkUsers`, and `linkUsers` through `runInScope`;
  - `packages/db/scripts/link-dev-users.mjs`: refuses unless `APP_ENV=dev`; logs user ids and roles only;
  - `packages/db/Dockerfile`: builds `@firmivra/db` and ships `dist`;
  - the migrate task gets `APP_ENV=dev`;
  - R0 FYI added in `R0-schema.md`;
  - how-to in SETUP-LOG.

  Tests: 6 new db tests (validation, first link, re-run, pool refusal with nothing written, firm isolation); infra test pins `APP_ENV`. Ran the script locally and inside the built image against local Postgres. Nothing ran in AWS: Rasel sees the Cognito and run-task commands first.

- 2026-10-06, CSRF check live (after the #23 deploy, run 37448823378, green): sign-in POSTs with a made-up email and a wrong password. app.dev with `Origin: https://app.dev.firmivra.com` answered 401 INVALID_CREDENTIALS, and so did a request without `Origin` but with `Sec-Fetch-Site: same-origin`; admin.dev with its own Origin answered 401 INVALID_CREDENTIALS too. Controls answered 403 ORIGIN_NOT_ALLOWED: Origin https://evil.example, `Sec-Fetch-Site: cross-site`, and app's Origin on the admin sign-in. Both headers reach the API through CloudFront and the load balancer. The #20 deploy (run 37448607179) was green too.
- 2026-10-06, step 13: switched to subs and roles only (Rasel), so no emails land in CloudTrail through the task overrides.
  - The task reads email and name from Cognito with `AdminGetUser`, the migrate task role's only Cognito permission, on the staff and admins pool ARNs.
  - `LINK_USERS` refuses any key but `sub` and `role`; `LINK_FIRM_CONTACT` is dropped (the wizard sets contact details).
  - `@aws-sdk/client-cognito-identity-provider` (same 3.1146.0 as the API) is a dev dependency of `packages/db`: it ships in the migrate image, not the API image.
  - `cdk diff` app: the new policy and the migrate task's env (APP_ENV, AWS_REGION, two pool ids). Auth: no differences (the pool ARN outputs already exist).
  - The `:none` api and web images in `cdk diff` (also in the pipeline's diff step) only show the parameter defaults. `cdk deploy` keeps the previous values: `MigrateImageTag` stayed d62849a through the `ImageTag`-only step.
  - The stray remote branch rasel/R1-refresh-tokens was deleted (Rasel's yes) after checking that its commits are in main (#21) or #26.
- 2026-10-06, step 13: #26 merged (7fb588c) and is deployed: run 37489456004, after #28, green. Rasel runs the Cognito and run-task commands (subs and roles only); then tick step 13.
- 2026-10-06, new work from Rasel (plan change: the developers build only screens and tests).
  - **Web kit** (KIT-TASK.md) started on rasel/R1-web-kit: aa85e02, local, not pushed. It has the data hooks, `errorMessage`, PageState, RequireRole, QrCode, the uploadFile stub, mock mode and the module pattern in packages/types/README.md. The packages @tanstack/react-query, react-hook-form, @hookform/resolvers and qrcode.react are Rasel's yes. It's paused for the skeleton.
  - **Page skeleton** (SKELETON-TASK.md, PAGE-MAP.md), lucide-react for icons (Rasel's yes):
    - Super Admin with the shared app shell, SignedIn/useMe and PagePlaceholder: PR #33, open.
    - Client portal: 127db60 on rasel/R1-skeleton-portal, local and stacked on #33; 324 lines without placeholders; e2e 17/17.
  - The kit folder from Rasel still has an extra level (F:/firmivra-junior-kit/firmivra-junior-kit/). The files there are the evening versions I built from.
- Next steps (Oct 7):
  1. After #33 merges, merge origin/main into rasel/R1-skeleton-portal, check the e2e tests, and push the portal PR (ask first). Re-read the kit files if they move to the top-level folder.
  2. Firm workspace skeleton (rasel/R1-skeleton-firm, from main):
     - `(workspace)/layout.tsx` with the firm menu (Owner and Admin see Sign-ups, Team and Settings);
     - the `clients/[id]`, `settings` and `setup` layouts and the placeholders;
     - then delete session-panel.tsx.
  3. Kit: rebase onto the skeleton (SignedIn/useMe), add the reference screen on T04 (#29 merged: api.taxStatuses, mocks/tax-statuses.ts) with its mock-mode e2e, then the path guard PR (pull_request_target, lists from PAGE-MAP "Your files").
  4. Then the remaining R1 steps (7: deploy-prod.yml, disabled until R8), then R4.
- 2026-10-06 late, step 13: Rasel created both dev logins (Super Admin sub 74d81428-… in the admins pool, LVP owner sub 9478c4d8-… in the staff pool). The first link run stopped before writing anything: UserNotFoundException.
  - Cause, confirmed read-only: our pools sign in by username, so AdminGetUser does not take the sub. ListUsers with `sub = "<sub>"` finds the username, and the migrate task's pool ids are right.
  - Both users' `name` set to "Rasel Mridha" (Rasel's yes).
  - Fix committed locally: b9f9014 on rasel/R1-cognito-listusers, not pushed. ListUsers for the API role (three pools) and the migrate role (in place of AdminGetUser); the link lookup uses ListUsers; SETUP-LOG notes the PowerShell quoting and LAST_ACTIVE_OWNER. `cdk diff`: only those two IAM policies. Read-only test against the real pools: one match each, email present, name right.
  - Option B (store the Cognito username in `users`) waits until sign-in volume needs it.
- Next steps (Oct 7), in this order:
  1. Push rasel/R1-cognito-listusers and open its PR.
  2. When it and R2's #34 are deployed, ask Rasel's yes, run the link task with the two subs (SUPER_ADMIN, OWNER), show him the log lines, and tick step 13.
  3. Then the earlier list: the portal PR after #33 merges, the firm skeleton, the kit, the path guard.
- 2026-10-07 (night, Rasel: keep working), step 13 done:
  - #35 (ListUsers for the API and migrate roles) and R2's #34 were merged and deployed: #30's run included #35, then #34's run. The live task roles were checked read-only.
  - The link task ran with Rasel's yes (subs and roles only), exit 0:
    - "Firm lvp: 01a11307-637d-… (created, ACTIVE)";
    - "Created user 01a11307-644a-… as SUPER_ADMIN";
    - "Created user 01a11307-651a-… as OWNER".

    The overrides file was deleted. Rasel's first sign-in on admin.dev and app.dev sets up MFA.
- 2026-10-07, skeleton:
  - #33 (Super Admin) merged and deployed, green.
  - Portal: PR #36. `main` merged in; signed-in.tsx and the shell files were add/add conflicts, resolved with the portal versions; e2e 17/17.
  - Firm workspace: 75b5715 on rasel/R1-skeleton-firm, stacked on #36. The Owner and Admin menu is in place; session-panel.tsx is deleted; e2e 20/20.
  - PAGE-MAP and GUIDE in the repo (#28) are identical to the spec I built from.
- 2026-10-07, dev tooling: Next 16's on-disk Turbopack dev cache kept stale routes ("Page not found" for pages that exist) after routes were added or moved. `turbopackFileSystemCacheForDev: false` in next.config.ts: PR #43 from main, and the same line in the firm PR. The e2e smoke specs get 240 s (cold compiles in dev).
- Kit notes from R3 (Oct 7): the portal client is `portalAuth(slug)` in lib/auth.ts, mocked by `createPortalAuthMock(firmSlug, options)` in mocks/client-auth.ts, with state per instance, so keep one per slug across navigation. The firm's sign-ups are `api.clientSignUps`, mocked by `createClientSignUpsMock`.
- 2026-10-07 (early morning), lead review fixes, each pushed to its own PR:
  - #36: the proxy returns 404 unless the portal's first path segment is a slug (open redirect; e2e fails without the check); the portal signs out through `portalAuth(slug)`; case-insensitive pending check; token fixes. Merged as 4ff2b6c, deployed green.
  - #44: firm errors route to /setup, to sign-in, or to a message with Sign out; `encodeURIComponent`; sign-out on /setup; new e2e. Approved.
  - #45: query cache cleared per person and per firm, and on sign-out; one shared refresh on a 401, then sign-in (e2e/session.spec.ts); 403s handled by code. Approved.
- 2026-10-07, link task re-run after #32's green deploy (Rasel's yes): exit 0. Same firm and user ids ("Updated user … as SUPER_ADMIN / OWNER"), so the re-run is idempotent.
- 2026-10-07, dev tooling (correction): #43 alone didn't stop the phantom "Page not found". It came back once with the cache off. One run logged EPERM while renaming a `.next/dev` manifest on Windows, so the likely cause is a file lock from antivirus or the indexer. Excluding `.next` from scanning is Rasel's call.
- 2026-10-07, #45 merged (8be5b28) after two main merges (layout: ours; api.ts: both sides, with R10's lines). R4 contract #61 merged (848b43c); R4's progress is in R4-firm-onboarding.md.
- 2026-10-07, reference screen: branch `rasel/R1-reference-screen` from main, with c687885 cherry-picked (the old local branch was never pushed). New `apps/web/e2e/cache.spec.ts`: two firm owners on one tab, and the second person's list held back. It shows loading, never the first firm's rows. With both cache clears switched off it fails, so it tests the fix. Local runs pass: cache, skeleton-firm, session, and the mock suite. CI runs no Playwright.
- 2026-10-07, lazy mock fixtures (the follow-up Rasel and the lead agreed after #45). A production build showed fixtures in `.next/static`: tax-statuses (3 chunks) and client-auth's portal info and error bodies. They are parsed when the file loads, so the bundler kept them although `dev && mocked()` is false. Now every mock builds its fixtures on first use: `taxStatusFixtures()`, `clientFixtures()` (plus `firstClientId`), `engagementFixtures()`, `taxReturnFixtures()`, `clientAuthFixtures()`. `apps/web/eslint.config.mjs` refuses a call at a mock file's top level. After the change the build has no mock strings or code in `.next/static`. Branch `rasel/R1-lazy-mocks`.
- 2026-10-07, developer path guard (kit plan: "own pull_request_target path guard"): `.github/workflows/path-guard.yml`. A PR by Fahad, Tumit, Nahid or Arfan may change only their "Your files" from `docs/junior/PAGE-MAP.md`, plus their own `e2e/mock/<name>-*.spec.ts`. It knows a developer by GitHub login (Fahad's and Tumit's so far), else by branch prefix. Rasel's PRs are skipped, and any other author fails. It reads only file names through the API: no checkout, no PR code. Tested locally on the script embedded in the YAML: the 7 real developer PRs pass, and 8 synthetic cases (outside files, exceptions, renames, unknown author) behave. It runs only once it is on main. Branch `rasel/R1-path-guard`.
- 2026-10-07, portal session (R3's need "serve mocks/client-auth.ts in mock mode", plus a fix):
  - The portal's sign-in check read `GET /me`, but portal cookies reach only `/api/v1/portal/{slug}/` (client-auth.yaml), so on dev it would never see a session. After #62, local sign-in sets the same cookies. Now `SignedIn` reads `portalAuth(slug).me()` and signs out through `portalAuth(slug).signOut()`.
  - Mock mode: `portalAuth(slug)` is one `createPortalAuthMock` per firm (signed in as an active client; `NEXT_PUBLIC_API_MOCK_CLIENT` sets another start), and the `me` mock answers `api.portalBusiness`.
  - e2e: `mock/portal-session.spec.ts`; `sites.spec.ts` now expects a client on another firm's portal to be signed out (R3's rule), and checks portal sign-out.
  - With #62 merged locally (a scratch branch, never pushed): sites and skeleton-portal 11/11, mock suite 3/3. It must merge right after #62. Branch `rasel/R1-portal-session`.
- 2026-10-07, end of day (this session is R1, R4, R5 and R6). Merged today:
  - #45 kit, #61 R4 contract, #64 reference screen, #65 lazy mocks, #66 path guard, #67 portal session, #73 docs, #74 R4 honeypot;
  - every Deploy dev run since then succeeded (the last one checked: 4ddd4c9, F01).

  Next, in order:
  1. #75 (R5 documents contract): review fixes pushed at c2ad3b9; answer the re-review.
  2. When #75 merges, open the R6 NotifyService PR from this branch (12bcc28; merge fresh main first).
  3. R5's first API PR also carries Rasel's question 12 answer (Oct 7, household logins and documents): PRIMARY and SPOUSE have the same access ("MINE" is every upload by anyone in the household for this client; both see shared files and all requests, upload to any open service or request, and can say "I don't have this"); AUTHORIZED sees as "MINE" only its own uploads, `source=FIRM` is empty, it sees open requests and may upload for them, but not "I don't have this"; get and download of anything else are 404. For everyone: never INTERNAL, never another client's, every upload records the login, and portal items carry the uploader's name. Write it into R5's Decisions and the yaml's "Household logins" note, and make the mocks follow it. Not into #75 (already approved). Also the lead's "..pdf" nit.
  4. R4 API step 1 (the read side) as soon as R0's #52 merges. At that R4 touch, also raise or remove the honeypot's 500-character cap (lead's nit: a 400 naming the field tips off a bot).
  5. Then R4 submit (needs R0's ein columns; otherwise approve first), request info, decline and notes, then approve (KMS and invite: to Rasel before pushing).
  6. Open for Rasel: R5 file types and replacements; R6 password-reset email; the lead's other R5 questions (FAILED rescans, deferred deletes, uploads to PENDING engagements).
  7. Keep watching every Deploy dev run.

- 2026-10-08: #75 merged (4a9f707) with main merged in first (36c4d02); its Deploy dev run succeeded, as did #71's and #77's. A watcher that died on a network error had only been waiting. Next step 2 above: the R6 PR, opened now from fresh main.
- 2026-10-08, Super Admin mock session and skeleton checks by tab title (Rasel's answers to the review session's two questions; branch `rasel/R1-mock-admin-titles` from main, must merge before #58):
  - Mock module `adminAuth`: `mocks/admin-auth.ts` (`createAdminAuthMock(real)`: `me`, `refresh`, `signOut`) starts signed in as the invented Morgan Admin, the same person as ADMIN in `mocks/firm-applications.ts` (not imported, so it stays out of the production bundle). After sign-out `me` and `refresh` answer 401; a reload signs back in. `lib/auth.ts` picks it behind the inline NODE_ENV guard; `SignedIn` signs out through it before the local dev sign-out. The portal mock's Map is now created on first use, so nothing of the mocks runs when lib/auth.ts loads. New `e2e/mock/admin-session.spec.ts`.
  - Skeleton specs and `session.spec.ts` check each page by its tab title (`toHaveTitle`, from the page.tsx metadata) after nav "Main" and the URL, not the placeholder heading; `cache.spec.ts` keeps the reference screen's heading. The rule for page.tsx and what the tests read is in GUIDE.md step 2, AI-RULES.md and PAGE-MAP.md. Decisions: the root layout keeps its plain default title "Firmivra" (no template); a page's own title overrides it.
  - The two index pages that called `redirect()` are gone. Decision b said to move them into `src/proxy.ts`, but Next 16.3.8 turns a proxy response with a relative Location into a 500 (`TypeError: Invalid URL` in the proxy adapter, which parses Location with `new NextURL()` and no base), and an absolute target would need the request's origin. So each is a two-line route handler at its own path: `firm/(workspace)/settings/route.ts` (307, Location `/settings/profile`) and `portal/[firmSlug]/(client)/home/route.ts` (307, Location `/{slug}/intake`). Targets are fixed strings plus the slug, which the proxy's PORTAL_SLUG check already passed (the handler checks it again); exact paths only (Next routes are case-sensitive); the query is dropped. A well-formed slug that is not a firm still goes to `/{slug}/intake` on this site, as the old page did: the route can't know which firms exist, and the portal layout shows not-found there (R3's lookup).
  - Request-level tests: `/settings` and `/settings?next=//evil.example.test` give 307 to exactly `/settings/profile`; `/lvp/home` and `/no-such-firm/home` give `/lvp/intake` and `/no-such-firm/intake`; `/%2F%2Fevil.example.test/home` and `/%2Fevil.example.test/home` give 404 with no Location. A raw `//evil.example.test/home` never reaches the proxy: Next answers 308 to the same-site `/evil.example.test/home` first (its repeated-slash rule), which is a 404. That is not the "404 with no Location" the spec asked for (the app never sees the request), so the test checks the safety property instead of Next's exact answer: 308 or 404, any Location starts with one `/` (not `//` or a backslash), and following it gives 404. Needs Rasel's acceptance.
  - Firm audit log (Rasel q11, Oct 8): `/audit-log` placeholder in `(workspace)`, menu item for Owner and Admin (`managers`), skeleton row, PAGE-MAP row under Tumit, ticket F12 at the end of TUMIT.md (R12's `api.auditLog` contract, #71). The path guard's list for Tumit (`.github/workflows/path-guard.yml`) still needs `audit-log/` (next to `team/` and `calendar/`), or CI fails Tumit's F12 PR: not changed here (this session may not edit `.github/workflows/`). Rasel: this PR or an R1 follow-up before F12 starts?
  - Review follow-ups (same day): the branch is rebased onto main 6484b44 (after #81, #70 and #84). `admin-session.spec` now also goes back after sign-out and checks it lands on `/sign-in` again with no `me-email` (it fails if the mock's signOut stops ending the session). The raw `//` test checks the safety property (above). The settings layout comment names `settings/route.ts`; AI-RULES uses the same rule text as GUIDE and PAGE-MAP. Open for Rasel before merge: his yes for route handlers instead of `src/proxy.ts` (decision b, reason above), the raw `//` deviation, and the path guard line.
  - Checks on this branch (on 6484b44): lint and typecheck clean; test:e2e 28/28 and test:e2e:mock 4/4. Some runs lost tests to Windows `EPERM` renames in `.next/dev` or to a cold first compile (session.spec, sites, skeleton-firm); each passes on a re-run, and the last full run passed.
  - Checks on a local scratch merge with #58 (head 154b519, never pushed): lint and typecheck clean; test:e2e 30/30 (one earlier run lost sites' portal test to a cold compile; it passes alone and on the re-run). test:e2e:mock 4/5: #58's `tumit-dashboard` expects 3 pending applications, but R4's mock on main (#79) now has 4; it fails the same way on main + #58 without this branch, so #58 needs that update.
  - `next build` with `NEXT_PUBLIC_API_MOCK=all`, on this branch and on the scratch merge: no `morgan.admin@example.test` and no `0199b6a2-0000-7000-8000-0000000000a1` in `.next/static`.
- 2026-10-08, finding (not fixed here): a production build of main already carries sample text from mocks in a client chunk (Jamie Sample, Sam Staff, john@example.com, Mock User). It comes through imports between mock files (`mockMe` from appointments.ts in tasks.ts, `clientFixtures`, `taxStatusFixtures`) and the hoisted `portalAuthMock` in lib/auth.ts. Mock behaviour stays off and the data is invented, but it breaks the "no mock strings in .next/static" rule from the lazy-mocks work (Oct 7).
- 2026-10-08 evening: Rasel's new setup: only R0 and R1 run, the cloud threads review on GitHub, and Rasel merges. BOARD.md is closed, so R1's questions for Rasel are now under "Needs from others" here. Merged today: #91, #99, #106, #107, #110, #112, #113 (and #79 and #81). #101 and #118 are open. Every Deploy dev run since #99 was green.
- 2026-10-08, step 14: branch `rasel/R1-kms-secret-ses` (main merged at b482fc9). API task role: six tag-conditioned `FirmKeys*` statements (create, tag at creation, alias name, env keys, use with the encryption-context rule, deny the lockout bypass) and `APP_ENV`; R4's EIN-hash secret `firmivra/dev/firm-applications/ein-hash-key` as `EIN_HASH_KEY` (app stack, retained, never rotated); Cognito reset codes through SES with the decided wording; `email.cognito-idp.amazonaws.com` in both bootstrap policies. In R4's module: the FirmKeys adapter and the `create-firm-key` command (with `--check`). R10's KMS need is covered (dev, once LVP has its key); R6 q18's code change is left for R6's next PR. No `cdk diff` against AWS yet (the SSO session had expired); local synth and tests pass.
- 2026-10-08, step 14 review fixes (three findings, all real): the adapter now checks every key it adopts by its alias (customer key of this account, `AWS_KMS`, one Region, symmetric, exactly the firm's tags, KMS's default key policy, no grants) and sends `Origin` and `MultiRegion`; CreateKey requires `kms:KeyOrigin=AWS_KMS` and `kms:MultiRegion=false`; tagging can no longer rewrite a firm tag (`StringEqualsIfExists` against the requested values), nor touch a CDK key; alias and use need a firm key (env and purpose tags, `AWS_KMS`, one Region); a read-only statement for the adapter's checks (seven `FirmKeys*` statements now). SETUP-LOG step 14 has the exact commands (diffs, policy versions, the one-off task, log reading, read-only checks) and a rollback per item. `cdk diff` still not run (SSO expired); Rasel runs it before review.
- 2026-10-08 evening: Rasel's Oct 18 plan is steps 15 to 26 (R4, R6 and R7 went to R16). #101: main merged again after #124; from the cloud re-check, `docs/SETUP-LOG.md` step 1 is marked done by Rasel with a read-only check, and step 5 is the email check (the first dev application, after which rollback (c) is no longer safe). "Needs from others" keeps only the open asks.
- 2026-10-09, step 19 (infra): branch `rasel/R1-guardduty-infra`, all in `firmivra-dev-app` (`infra/src/stacks/malware-scan.ts`):
  - GuardDuty Malware Protection for S3 on the documents bucket (`tenant/`), with AWS's plan role narrowed to `tenant/*` and the validation object;
  - the result rule to an SSE-SQS queue (120 s visibility, 20 receives, about 32 minutes, then the dead-letter queue);
  - a plan-health rule, the alarm topic `firmivra-dev-alarms` with no subscription, and 5 alarms (dead letters, stuck, and the API markers `SCAN_UNFINISHED`, `SCAN_REJECTED`, `SCAN_LAST_RECEIVE`);
  - the API's receive, delete and change-visibility rights, `SCAN_RESULTS_QUEUE_URL`, and a 60 s `stopTimeout`.

  The documents key keeps its default policy (IAM delegation), and the data stack is unchanged (the tests pin it). New bootstrap statements need v3 of both policies before the merge. Tests now also check the plan role's inline policy against the boundary, by action and resource. The cdk diff, Rasel's steps 0 to 8, the cost and the rollback are in SETUP-LOG step 19. No AWS call was made. The consumer is the next PR, after this one deploys.
- 2026-10-10, Stripe keys on dev (Rasel's order, Oct 10): the API task gets `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY` and `STRIPE_WEBHOOK_SECRET` from `firmivra/dev/stripe` (`stripeSecretName` in config), imported by name. Rasel makes the secret by hand before the merge, because ECS cannot start a task whose secret lacks a key, and a secret in the template would get its values written over. The steps are in SETUP-LOG, "Stripe keys on dev"; 3 infra tests pin it. Not deployed: Rasel's yes first.
