# R8: Support access, hardening, prod stacks (Oct 15-16)

**Goal:** The system is safe to put real client data in, and production exists.

**Owned paths (change only these):**
- `apps/api/src/support-access/**`
- `apps/api/test/isolation/**`
- `infra/**`

**Read first (nothing else):** CLAUDE.md, docs/work/README.md, this file, and:
- docs/AUTH-DESIGN.md (support access)
- ../Business-full-stack-project/docs/work/BOARD.md (in the main checkout)

## Steps

- [ ] 1. Support access flow API: Super Admin requests, firm owner approves (max 72 h), auto expiry, every action logged
- [ ] 2. Tenant isolation suite: for every endpoint, a user of firm B gets 404 on firm A's records; runs in CI
- [ ] 3. Rate limits, security headers, upload limits, error messages that leak nothing
- [ ] 4. Backup and point-in-time restore test of the dev database
- [ ] 5. Prod: firmivra-prod-* stacks in the same AWS account (unless Octavia decides otherwise by Oct 14), on-demand Fargate, deletion protection; show every diff and wait for yes
- [ ] 6. Enable deploy-prod.yml (v* tags, Rasel approves)

## Done when

Isolation suite green in CI; prod stacks deployed and empty.

## Needs from others

(none yet)

## Progress log

(newest last: date, step, what changed, commit)
