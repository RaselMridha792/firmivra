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

- R0 (lead sent it, high priority): a database-checked support scope, the fourth wall for a grant. Answered by R0's #123: `app_enter_support_scope(business_id, view, ip, user_agent, request_id)`, called first in a read-write transaction from admin scope. It needs the admin's own approved, unrevoked grant, unexpired by `clock_timestamp()`, and locks it FOR NO KEY UPDATE (a revoke waits, and later support transactions queue behind the revoke). It writes the platform's and the firm's `support.viewed` rows, sets the firm's scope and makes the transaction read-only. Behind a lock it gives up after 2 s (55P03: map it to a retryable 409, and revoke with `SET LOCAL lock_timeout` or NOWAIT). The API must never open a plain business scope for the admin site (add a `forSupport` entry point and a test or lint for it).
- R0 (low priority): a policy letting the requesting Super Admin withdraw their own PENDING request (set `revoked_at`). Today only the firm ends a request.
- R6: a notice to the firm's Owners when Firmivra Support asks for access (and, optionally, when a grant is about to expire). Until then the API logs it by id.
- R13 (via the Scrum thread, Oct 9): a size cap on `EsignPutFieldsBody`. 500 DROPDOWN fields with 50 options of 100 characters, a 200-character label and a 500-character value come to 3.06 MB in ASCII and 8.7 MB in three-byte characters, over the API's 2 MB body limit. Add a total-options limit or a size refine so every valid body fits.
- R1: a dev check of the sign-in limits with real Cognito. Cognito's own per-user lockout (about 5 wrong passwords, doubling up to about 15 minutes; not configurable) lets attacker networks lock the real user at Cognito, and their right password then returns NotAuthorizedException, so INVALID_CREDENTIALS counted against their own network. "Failures from one network lock only that network" can only be shown on dev.

## Decisions (Rasel's q31: the lead's defaults of Oct 8, confirmed by Rasel the same day)

- Beta support access is read-only support views on the admin site, the firm's audit log first; never the firm's workspace under a Super Admin session.
- The firm's Owner and Admins see requests; only an Owner decides (the database also requires an active Owner to approve).
- The firm sees "Firmivra Support" and the reason, never which Super Admin asked.

## Progress log

(newest last: date, step, what changed, commit)

- 2026-10-08, step 1 contract (contract-only PR from fresh main, branch `rasel/R8-contract-support-access`; the R2 session takes R8 steps 1-3, BOARD line 9): `packages/types/src/support-access`. Statuses derived from R0's `support_access_grants` (PENDING, ACTIVE, EXPIRED, DECLINED, REVOKED). Firm side, `api.supportAccess`: list (open ones first, paged), approve `{ hours: 1-72, 24 by default }`, decline, revoke; Owner and Admin read, only an Owner decides; the firm's view has the reason and status, never the Super Admin. Admin side, `api.adminSupportAccess`: request `{ reason: one line, at most 500 characters, the shared text rule }` for a firm, and list (every firm's or one's). Codes: 409 `SUPPORT_REQUEST_OPEN`, 409 `SUPPORT_REQUEST_DECIDED` (approve or decline after an answer), 409 `SUPPORT_GRANT_NOT_ACTIVE` (revoke without an active grant), 403 `SUPPORT_GRANT_REQUIRED`. Mock `apps/web/src/mocks/support-access.ts` with one store for both sides; tests in `packages/types/test/support-access`.
- 2026-10-08, step 3, search text (contract-only PR from fresh main at the lead's request, branch `rasel/R8-contract-search-text`; the lead's yes to change only the search lines of R10, R4 and R7 and their tests): `?search=%00` answered 500 on the clients, firm applications and firms lists, since Postgres text cannot hold NUL. One shared `SearchText` in `packages/types/src/clients/text.ts` (trimmed, at most 100 characters, no control characters or lone surrogates: "Remove the special characters") for the search filters of clients, firm applications, firms, invoices and the client's invoices, and in place of the workspaces contract's own copy. Documents waits for #118 (R1), then switches to it. Tests: `packages/types/test/clients/search-text.test.ts`; e2e 400 on `GET /business/clients`, `/admin/firm-applications` and `/admin/firms`. A query string can't carry a lone surrogate (the URL decoder turns its bytes into U+FFFD), so the surrogate case is covered by the unit test.
- Oct 8, R0 session (which took over R2's R8 work): Rasel's Oct 18 plan moves step 1, the support-access API, past Oct 18, so at launch a Super Admin has no way into a firm's data. The work stays pushed as it is on `rasel/R8-support-access-api` (R2's asks, lists and answers, main merged in, 20 tests passing), with no PR now; the database side (`app_enter_support_scope`, read-only) is on main (#123, #125). Steps 2 and 3 (the isolation suite and rate limits) are R0's, merged by Oct 14 21:00.
- 2026-10-09, step 5 hardening (R21, R15's ask via the Scrum thread): the cross-site guard now treats `fv_bo_*` (the Begin Online draft cookie) as a session cookie alongside `fv_portal_*`, so a state-changing request carrying only that cookie and no `Origin` or `Sec-Fetch-Site` is refused (403 `ORIGIN_NOT_ALLOWED`). Test in `apps/api/test/e2e/cross-site.e2e.test.ts`.
- 2026-10-09, step 3 follow-ups (R21, from the #213 re-check): the body-limit test names what it proves (Terms, 500 TEXT fields, an adopt) and notes the DROPDOWN gap, with the cap asked of R13 under Needs; the throttle check fails a limit or window that is not a number; an error whose stack does not start with its message logs no frames.
