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
- R0 (low priority), R0's open item (c): asks now run in the admin scope, so drop the platform branch of `support_access_grants_request`. Today a bug in any platform-scope caller could still plant a request naming anyone, a firm's own staff member included, whose rows the firm's log would then show as Firmivra Support. The test fixtures that insert grants in platform scope (`packages/db/test/policies.test.ts`, and my `apps/api/test/e2e/audit-log.e2e.test.ts`) move to the admin scope with it.
- R0 (low priority): let the admin scope read the name of a Super Admin who asked for support access (`users_admin_platform_admins` has those who reviewed applications, not these), so a former Super Admin's asks keep their name in `GET /admin/support-access`. Today the name is `''`.
- R19 (from R21): the Stripe webhook is limited by its signature, not by IP: add it to `NO_OWN_LIMIT` in `apps/api/test/e2e/hardening.e2e.test.ts` with that reason, and read its raw body with its own parser (the JSON limit in `configure-app.ts` is 100 KB).
- Web (from R21): `packages/types` has no client for `GET /admin/firms/{businessId}/audit-log` yet (only `api.auditLog` for the firm); the admin support view needs one, with `AuditLogQuery` and `AuditLogPage`.
- R0 (from #171's pre-review, high priority): #215, a definer function that writes the firm's `support.requested` row from admin scope inside the ask's transaction (actor shown as Firmivra Support, no IP or user agent). Until it lands the API writes that row afterwards in the firm's scope, best effort.
- Web or R1 (from R13-web): when the web app gets a Content-Security-Policy, the Firm Sign PDF viewer needs `worker-src 'self'` and `'wasm-unsafe-eval'` in `script-src` (pdf.js decoders from `_next/static/media`). The API's CSP in `configure-app.ts` covers API responses only.
- R6: a notice to the firm's Owners when Firmivra Support asks for access (and, optionally, when a grant is about to expire). Until then the API logs it by id.
- R1: a dev check of the sign-in limits with real Cognito. Cognito's own per-user lockout (about 5 wrong passwords, doubling up to about 15 minutes; not configurable) lets attacker networks lock the real user at Cognito, and their right password then returns NotAuthorizedException, so INVALID_CREDENTIALS counted against their own network. "Failures from one network lock only that network" can only be shown on dev.

## Decisions (Rasel's q31: the lead's defaults of Oct 8, confirmed by Rasel the same day)

- Beta support access is read-only support views on the admin site, the firm's audit log first; never the firm's workspace under a Super Admin session.
- The firm's Owner and Admins see requests; only an Owner decides (the database also requires an active Owner to approve).
- The firm sees "Firmivra Support" and the reason, never which Super Admin asked.

## Progress log

(newest last: date, step, what changed, commit)

Steps 1-3 taken by cloud thread R21 on Oct 9; steps 4-6 stay with Rasel and R1.

- 2026-10-08, step 1 contract (contract-only PR from fresh main, branch `rasel/R8-contract-support-access`; the R2 session takes R8 steps 1-3, BOARD line 9): `packages/types/src/support-access`. Statuses derived from R0's `support_access_grants` (PENDING, ACTIVE, EXPIRED, DECLINED, REVOKED). Firm side, `api.supportAccess`: list (open ones first, paged), approve `{ hours: 1-72, 24 by default }`, decline, revoke; Owner and Admin read, only an Owner decides; the firm's view has the reason and status, never the Super Admin. Admin side, `api.adminSupportAccess`: request `{ reason: one line, at most 500 characters, the shared text rule }` for a firm, and list (every firm's or one's). Codes: 409 `SUPPORT_REQUEST_OPEN`, 409 `SUPPORT_REQUEST_DECIDED` (approve or decline after an answer), 409 `SUPPORT_GRANT_NOT_ACTIVE` (revoke without an active grant), 403 `SUPPORT_GRANT_REQUIRED`. Mock `apps/web/src/mocks/support-access.ts` with one store for both sides; tests in `packages/types/test/support-access`.
- 2026-10-08, step 3, search text (contract-only PR from fresh main at the lead's request, branch `rasel/R8-contract-search-text`; the lead's yes to change only the search lines of R10, R4 and R7 and their tests): `?search=%00` answered 500 on the clients, firm applications and firms lists, since Postgres text cannot hold NUL. One shared `SearchText` in `packages/types/src/clients/text.ts` (trimmed, at most 100 characters, no control characters or lone surrogates: "Remove the special characters") for the search filters of clients, firm applications, firms, invoices and the client's invoices, and in place of the workspaces contract's own copy. Documents waits for #118 (R1), then switches to it. Tests: `packages/types/test/clients/search-text.test.ts`; e2e 400 on `GET /business/clients`, `/admin/firm-applications` and `/admin/firms`. A query string can't carry a lone surrogate (the URL decoder turns its bytes into U+FFFD), so the surrogate case is covered by the unit test.
- 2026-10-08, step 1 API, first of two PRs (branch `rasel/R8-support-access-api`): `apps/api/src/support-access/` (`SupportAccessModule`, registered in `app.module.ts`). Admin side: `POST /admin/firms/{businessId}/support-access` in the admin scope (the database stores it only as a request by that Super Admin; one open request per firm and Super Admin under a try-lock, else 409), `GET /admin/support-access` (every firm's or one's, open ones first, offset cursor). Firm side: `GET /business/support-access` (Owner and Admin, never the Super Admin) and approve, decline, revoke (Owner only) with the row locked FOR UPDATE and the database's clock; R0's trigger has the last word on who approves (an Owner demoted meanwhile is 403). Audit, ids only: the platform's row of an ask commits with it and the firm's follows ("Firmivra Support"); the firm's row of an answer commits with it and the platform's copy follows (the lead's yes: `AuditService` takes `businessId: null` for the platform's row, `undefined` unchanged). Tests: `test/e2e/support-access.e2e.test.ts` (15), `test/unit/support-access.test.ts`, `test/unit/audit-service.test.ts`. Next PR: the audit log read under an active grant (grant FOR SHARE, the firm's `support.viewed` in the read's transaction).
- 2026-10-09, step 1 (R21): R2's branch `rasel/R8-support-access-api` merged with main (lint, typecheck, test green) and re-read against q31; split into two stacked PRs since its code is over 400 lines: the service, `grants.ts` and the `AuditService` change with their unit tests first (branch `rasel/R21-support-access-hardening-xdn8ov`), then the routes and their e2e on R2's branch.
- 2026-10-09, step 1, support scope (R21, branch `rasel/R21-support-scope`, stacked on R2's routes): `SupportScope.read(admin, firm, view, fn)` in `apps/api/src/support-access/support-scope.ts` opens the admin scope and calls `app_enter_support_scope` first (R0's #123 answer); no grant is 403 `SUPPORT_GRANT_REQUIRED`, 55P03 is a retryable 409 (`CONFLICT`, Retry-After 2). The Owner's revoke sets `lock_timeout = '2s'` and answers the same 409. First support view: `GET /admin/firms/{businessId}/audit-log` (the existing contract) reads the firm's log through it, read-only; the database writes `support.viewed` in both logs per page, so the viewer skips its own `audit_log.viewed` row there. `test/isolation/admin-scope.test.ts` calls every admin GET route and fails if one opens a business scope (AuditService's firm audit rows excepted). The web client for the admin audit log is not in `packages/types` yet (only `api.auditLog` for the firm).
- 2026-10-09, q20 (R21, branch `rasel/R21-sign-in-lockout`, from main): sign-in failures lock per email and network (`SIGN_IN_LIMIT.perEmailNetwork`, 10 in 15 minutes from one /24 or /48), so a stranger elsewhere can't lock a person out; past `perEmailCeiling` (50 from every network) each attempt waits 2 s and a warning is logged, never a 429. The attempt row carries `netKey`, a keyed hash of the network (HKDF label `fv-auth-network-key-v1`), never the IP; the count still reads audit rows through R0's emailKey index, no schema change. Tests in `test/e2e/sign-in-limits.e2e.test.ts`.
- 2026-10-09, step 2 (R21, branch `rasel/R21-isolation-suite`, from main): `apps/api/test/isolation/tenant-isolation.test.ts`, in the normal `pnpm test`. Routes come from Nest's metadata at test time (`routes.ts`); a firm or portal route with a record id needs a `RECORD_CASES` entry or the suite fails. Checks: firm Q's member gets 404 naming firm P and on P's records; P's client gets 404 at Q's portal; client Y gets 404 on client X's records; P's own people find each record. All 150 routes on main passed. R13-api, R14, R15, R16, R18, R19 and R20 were told the table shape.
- 2026-10-09, step 3 (R21, branch `rasel/R21-hardening`, from main): `configure-app.ts` sends a strict CSP (`default-src 'none'`), HSTS for a year and `Cache-Control: no-store` on API responses (Swagger UI keeps helmet's default) and sets the one JSON body limit (100 KB) after the cross-site guard. `ApiExceptionFilter`: only our own HttpExceptions (with a `code`) choose their words; a 500 logs its request id, kind and stack frames, never the message. `test/e2e/hardening.e2e.test.ts` also requires an explicit limit of at most 30 a minute on every public route that changes something (sign-outs excepted, with the reason).
- 2026-10-09, step 5 hardening (R21, R15's ask via the Scrum thread): the cross-site guard now treats `fv_bo_*` (the Begin Online draft cookie) as a session cookie alongside `fv_portal_*`, so a state-changing request carrying only that cookie and no `Origin` or `Sec-Fetch-Site` is refused (403 `ORIGIN_NOT_ALLOWED`). Test in `apps/api/test/e2e/cross-site.e2e.test.ts`.
