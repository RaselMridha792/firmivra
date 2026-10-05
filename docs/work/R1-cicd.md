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
- [ ] 6. deploy-dev.yml on push to main (environment dev): build api, web, migrate images, push to ECR, run the migrate task, update ECS services to 1 task each, smoke test the three dev URLs. From the lead (Oct 5):
  - Before the first run: `packages/db/scripts/migrate-deploy.mjs` needs a separate Prisma URL with `sslmode=require&sslcert=/app/rds-ca.pem`, because Prisma's native engine ignores `verify-full` and `NODE_EXTRA_CA_CERTS`. Keep `verify-full` for `pg`.
  - Make one place own the running image tag, so a `cdk deploy` without `-c imageTag` cannot scale dev to 0.
- [ ] 7. deploy-prod.yml only on v* tags (environment prod, Rasel approves); keep it disabled until R8 creates prod stacks
- [x] 8. Confirm .github/workflows/ is in CODEOWNERS; developers' PRs cannot change workflows without Rasel
- [ ] 9. Dependabot alerts on main (4 open on Oct 5, all in pnpm-lock.yaml through other packages): mysql2 3.15.3 twice (high, medium) through the prisma 7.10.0 CLI; deepmerge-ts 7.1.5 (high) through @prisma/config 7.10.0; braces 3.0.3 (high) through @next/eslint-plugin-next, fast-glob and micromatch. Update the parent packages or add pnpm overrides, then confirm on GitHub that all four alerts close. Rasel's go (Oct 5): this step may change the overrides in the root package.json or pnpm-workspace.yaml, and pnpm-lock.yaml.
- [x] 10. Find why Windows blocks turbo.exe on Rasel's machine ("An Application Control policy has blocked this file", Oct 5; the SWC binding was blocked at times too) and fix it so `pnpm lint`, `pnpm typecheck` and `pnpm test` work from the repo root again; make sure ci.yml runs them from the root through turbo. Until then build the packages first, as turbo would (`pnpm --filter @firmivra/types --filter @firmivra/db run build`), then use `pnpm -r run <script>`. Never turn off a Windows security feature without Rasel's yes.
- [x] 11. CLAUDE.md and README.md still say dev runs on `*.cloudfront.net`; change them to `admin.`, `app.` and `portal.dev.firmivra.com`. The lead's go (Oct 5): this step may change CLAUDE.md and README.md.

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
