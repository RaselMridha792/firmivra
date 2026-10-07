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

## Done when

https://app.dev.firmivra.com, https://admin.dev.firmivra.com and https://portal.dev.firmivra.com/lvp answer 200 after a merge to main.

## Needs from others

(none yet)

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
- 2026-10-07, developer path guard (kit plan: "own pull_request_target path guard"): `.github/workflows/path-guard.yml`. A PR by Fahad, Tumit, Nahid or Ibrahim may change only their "Your files" from `docs/junior/PAGE-MAP.md`, plus their own `e2e/mock/<name>-*.spec.ts`. It knows a developer by GitHub login (Fahad's and Tumit's so far), else by branch prefix. Rasel's PRs are skipped, and any other author fails. It reads only file names through the API: no checkout, no PR code. Tested locally on the script embedded in the YAML: the 7 real developer PRs pass, and 8 synthetic cases (outside files, exceptions, renames, unknown author) behave. It runs only once it is on main. Branch `rasel/R1-path-guard`.
- 2026-10-07, portal session (R3's need "serve mocks/client-auth.ts in mock mode", plus a fix):
  - The portal's sign-in check read `GET /me`, but portal cookies reach only `/api/v1/portal/{slug}/` (client-auth.yaml), so on dev it would never see a session. After #62, local sign-in sets the same cookies. Now `SignedIn` reads `portalAuth(slug).me()` and signs out through `portalAuth(slug).signOut()`.
  - Mock mode: `portalAuth(slug)` is one `createPortalAuthMock` per firm (signed in as an active client; `NEXT_PUBLIC_API_MOCK_CLIENT` sets another start), and the `me` mock answers `api.portalBusiness`.
  - e2e: `mock/portal-session.spec.ts`; `sites.spec.ts` now expects a client on another firm's portal to be signed out (R3's rule), and checks portal sign-out.
  - With #62 merged locally (a scratch branch, never pushed): sites and skeleton-portal 11/11, mock suite 3/3. It must merge right after #62. Branch `rasel/R1-portal-session`.
