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

- [ ] 1. SES sandbox: verify identities for the team and Octavia (Rasel gives the emails in chat, never commit them)
- [ ] 2. Deploy firmivra-dev-ci (GitHub OIDC role firmivra-dev-github-deploy, trust only environment dev and prod), show diff, wait for yes
- [ ] 3. Re-run cdk bootstrap with the narrowed firmivra-cdk-cfn-exec policy; cdk diff --all shows no surprises
- [ ] 4. Push rasel/setup-infra and open the PR; Rasel merges
- [ ] 5. ci.yml on every PR: install, lint, typecheck, test, build (no AWS access)
- [ ] 6. deploy-dev.yml on push to main (environment dev): build api, web, migrate images, push to ECR, run the migrate task, update ECS services to 1 task each, smoke test the three dev URLs
- [ ] 7. deploy-prod.yml only on v* tags (environment prod, Rasel approves); keep it disabled until R8 creates prod stacks
- [ ] 8. Confirm .github/workflows/ is in CODEOWNERS; developers' PRs cannot change workflows without Rasel

## Done when

https://app.dev.firmivra.com, https://admin.dev.firmivra.com and https://portal.dev.firmivra.com/lvp answer 200 after a merge to main.

## Needs from others

(none yet)

## Progress log

(newest last: date, step, what changed, commit)
