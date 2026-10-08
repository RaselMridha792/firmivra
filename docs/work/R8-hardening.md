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
- [ ] 2. Tenant isolation suite: for every endpoint, a user of firm B gets 404 on firm A's records; runs in CI. It also covers the lead's T02-T04 and R10-R12
- [ ] 3. Rate limits, security headers, upload limits, error messages that leak nothing
- [ ] 4. Backup and point-in-time restore test of the dev database
- [ ] 5. Prod: firmivra-prod-* stacks in the same AWS account (unless Octavia decides otherwise by Oct 14), on-demand Fargate, deletion protection; show every diff and wait for yes
- [ ] 6. Enable deploy-prod.yml (v* tags, Rasel approves)

## Done when

Isolation suite green in CI; prod stacks deployed and empty.

## Rules

- Contract first for every module (Rasel, Oct 6): the module's first PR is its zod schemas and client functions in `packages/types`, registered on `api` in `apps/web/src/lib/api.ts`, plus typed mock fixtures in `apps/web/src/mocks/<module>.ts`. The developers build the screen against it the same day.
- Never edit screens: in apps/web change only `src/mocks/<module>.ts` and your lines in `src/lib/api.ts`.

## Decisions and notes (Oct 8)

- Prod Cognito pools get their own SES identity and From address. Without SES production access by Oct 17, prod stays on COGNITO_DEFAULT (at most 50 such emails a day for the whole account). Firm-branded client reset emails come later through a custom message Lambda (docs/AUTH-DESIGN.md, "Password reset email").
- (q2) The per-IP and per-network sign-up limits stay shared across firms for the beta, with a CloudWatch alarm on R3's warning lines (ids only; see R3-client-auth.md "R8 (note)"). A refusal at the per-IP or per-network limit answers 429 without a warning line today; decide whether refusals need a line of their own.
- (q3) The silent SMS skip at a firm's daily cap stays, with an alarm on "is at its daily SMS cap" before real SMS. That alarm is a release blocker for real SMS.
- KMS key count: one key per firm, made only by approve and the create-firm-key command (R1 step 14). Add an alarm on the number of keys tagged `firmivra:env=<env>`, or an AWS Budgets alert on KMS, before real firms sign up. Also an alarm on CloudTrail `TagResource` calls by the API task role on firm keys (tags take up to five minutes to reach authorization; see SETUP-LOG step 14, known limits).
- Prod: the EIN-hash secret and the firm key rights for `firmivra-prod-*`; the create-firm-key command refuses anything but `APP_ENV=dev`.

## Needs from others

(none yet)

## Progress log

(newest last: date, step, what changed, commit)
