# R60: Settings review, Begin Online and Team (handoff, Oct 21)

Read first: `CLAUDE.md`, `docs/work/README.md`, this file. Then, per item, the files it names.
For the earlier R60 work (Super Admin Support, Billing, Sales, Subscriptions, Team APIs and
screens) see `R60-backend.md` and the other `R60-*.md` files; all of it is merged except Team
invites (below).

## Rules that still hold

- Rasel's standing message: the sessions finish everything; developers keep no work. R60 may edit
  the files `docs/junior/PAGE-MAP.md` lists under any developer, inside its task, after merging
  `main`.
- At most 2 open non-contract PRs. Every UI PR body: the mockup beside three-state 1440 px
  screenshots (data, empty, API unreachable) and the ticked `docs/design-match.md` checklist.
- Anything needing a database or infra change goes to Rasel as a written item, not built.
- Ask Rasel before touching the sign-in guards or anything in `apps/api/src/auth/`.
- Merge `main`, never rebase. Local checks: lint and prettier on the changed files, typecheck of
  the changed packages, the tests of the touched module only. Run the dev server only while
  checking a screen, then stop it and delete `.next`.
- Worktrees: `F:/firmivra-R60` (main), `F:/firmivra-R60-web`, `F:/firmivra-R60-links`, each with
  its own install and `.env`. All three use web 3600 and API 4600, so run one pair at a time.
  Database `firmivra_r60` (empty variant `firmivra_r60_empty`). Mock specs run on 3601.
  When stopping servers, kill only `F:\firmivra-R60\` (trailing backslash) or the ports: a looser
  pattern also matches the other two worktrees.
- Screenshot helpers live in the old session's scratchpad (`shots-*.cjs`, `compose.cjs`); rebuild
  them if gone: Playwright from `createRequire('<worktree>/apps/web/package.json')`,
  `--host-resolver-rules=MAP app.localhost 127.0.0.1` (or `admin.` / `portal.`), sign in with
  `fetch('/api/v1/dev/token', { email, pool })` (LVP owner `owner@lvp.test`, STAFF; empty firm
  `owner@firm-b.test`; Super Admin `superadmin@firmivra.test`, ADMIN), unreachable state with
  `page.route('**/api/v1/<route>**', r => r.abort('connectionrefused'))`. Sheets go under
  `apps/web/e2e/screenshots/r60-*/` and the PR links them by blob URL pinned to the commit sha
  with `?raw=true`.

## State on Oct 21

| PR / branch | What | State |
| --- | --- | --- |
| #985 `rasel/R60-settings-forms` | Settings Forms & Documents (Templates link, batch limits 20 files and 500 MB, retention wording) | Open. CI red only on `bookkeeping.e2e.test.ts` (see "Blocking CI"), not this PR |
| #993 `rasel/R60-settings-data` | Settings Data & Backups: monthly restore tests, "Not recorded yet" rows, honest Export and Restore, 35-day wording (Rasel approved 35 days; R1 raises infra) | Open |
| `rasel/R60-settings-preferences` (9848f5bf) | Settings Preferences: language saved but not applied yet; currency note | Pushed, `main` merged, sheet committed (`apps/web/e2e/screenshots/r60-settings-preferences/`). PR when a slot frees: run web `tsc`, ESLint and Prettier on the two files and `tumit-settings-preferences.spec.ts` first, and write the body like #993 (her guide is the design; no review screenshot) |
| `rasel/R60-settings-security` (08ef72da) | Settings Security: Octavia's rules on the page with "Not in force yet" notes; the MFA card reads `api.users.summary()` with Retry | Same as Preferences: sheet in `r60-settings-security/`, spec `tumit-settings-security.spec.ts` (4 tests). The body lists the enforcement map and the decisions in item 1 below. `GET /business/settings/overview` answers 404 on the local API (known, hidden badge) |
| `rasel/R60-team-invites` | Super Admin Team: invitations through Cognito (`team-invite.service.ts`, `team-invitation.ts`) | Waits on R0's #981 (R56 is fixing its test). Then merge `main`, rerun the admin-team e2e (4 tests wait on the grant), open the PR |
| `rasel/R60-begin-online` | Begin Online audit at 1440 px | Audit done (`R60-begin-online-audit.md`); fixes not started |

Merged on Oct 21: #975 Staff Management, #976 Team messages, #982 dashboard links, #983
Communications, #987 Workflow & Automations, #969 intake-forms settings.

## Blocking CI (report to Rasel; not R60's file)

`apps/api/test/e2e/bookkeeping.e2e.test.ts:623` ("lists with tab counts and filters") fails on
every PR that runs the API tests from Oct 21 to Nov 10. It filters `reportDueFrom=day(30)` to
`reportDueTo=day(50)` and expects only Davis, but the custom 2-month client from "a custom
cadence needs its months" gets the computed due date Dec 10 (`nextReportDue`, period Oct 1 to
Nov 30, close day 10), which is inside that window until Nov 10. A web-only PR skips the API
tests, so it passes. Fix (test only): put Davis far out, `nextReportDueOn: day(400)`, and query
`day(390)` to `day(410)`; computed dues are never more than about 15 months out. Owner: R55
(Bookkeeping Terms, #857) or whoever Rasel names.

## Remaining work

### 1. Security: the sign-in rules (ask Rasel first)

The page now says the rules and marks what is not in force. Enforcement needs auth and infra
changes; none were made. Map (file, now, required, owner):

| Rule | Where | Now | Required | Owner |
| --- | --- | --- | --- | --- |
| 15-character minimum, no forced mix | `infra/src/stacks/auth-stack.ts:110-117` (`passwordPolicy`, three pools) | 12, upper, lower, digit | `minLength: 15`, the `require*` false | R1 |
| Same rule in the contract and screens | `packages/types/src/auth/schemas.ts:41-53` (`PASSWORD_RULES`), `docs/api/auth.yaml:85,502`, `docs/AUTH-DESIGN.md:25` | 12 + mix | 15, no mix, keep the edge-space rule | R2 |
| Lockout: 5 failures in 15 min locks 15 min | `apps/api/src/auth/sign-in.service.ts:67-80` (`SIGN_IN_LIMIT`), `auth-errors.ts:35` | 10 per email per network in 15 min, then 429 | Per-account lock at the 5th failure, `retryAt` in the 429 for a countdown | R2 |
| 8-hour maximum | `auth-stack.ts:67` (refresh 7 days), `apps/api/src/auth/site.ts:92-96`, `session.service.ts:80` | 7 days | `Duration.hours(8)` and the cookie lifetimes | R1 + R2 |
| 15 min idle, warning at 13 | none; `apps/web/src/lib/session.ts:40` refreshes on any 401 | none | Server-side last activity checked in `SessionService.refresh`, polling not counted, web idle timer with the warning | R2 (+R0 if a column) |
| Reset ends every session | `cognito-identity.provider.ts:338` | Refresh revoked; access tokens live up to 15 min | Reject tokens issued before the reset | R2 |
| Deactivation ends every session | `staff-actions.service.ts:147-169`, `staff.common.ts:106`, `session.service.ts:171` | Firm access ends at once (`tenant.guard.ts:116`); tokens live up to 7 days | Refuse refresh without an active membership, or revoke | R2 |
| MFA change only by owner or security admin, fresh sign-in, audited | `auth-stack.ts:67` (`Mfa.REQUIRED`) | Always required; no setting; no security-admin role | Only if a firm may ever change it: policy table, role, re-auth, audit | R0 + R2 |
| Real MFA enrolment on the card | `apps/api/src/staff/staff-read.service.ts:58-63` (`mfaOf` placeholder) | "Not recorded yet" | Ask Cognito (`AdminGetUser` MFA settings) or record setup in `sign-in.service.ts` | R2 (+R0) |

Decisions for Rasel: spaces (Cognito refuses a leading or trailing space, so "spaces allowed" is
partly true); lockout scope (his Oct 8 q20 counts per email and network so a stranger cannot lock
someone out; Octavia's guide counts per account); "security admin" is not one of the eight roles.
Remove each "Not in force yet" note in `settings/security/_components/security-screen.tsx` as its
change lands. Also seen: Security Alerts show "Unknown account" because staff sign-in failures go
to the platform audit log, not the firm's; `GET /business/settings/overview` has no route, so the
Settings alerts badge stays hidden.

### 2. Preferences: language

Language is saved but not applied. Written items already with Rasel: columns
`company_language_enabled`, `employee_language_choice`, `client_language_choice`;
`memberships.language`, `client_accounts.language`; the Spanish plan (next-intl, phases,
estimates); invoices are always USD; a `number_format` column. Build nothing until R0's columns
land and Rasel picks the phase.

### 3. 100 MB per file and the 24h/48h secure links (Rasel: build both)

R1 does the schema (100 MB limits on the document paths: `documents_size_10_mb`,
`document_settings_ranges`, `lead_uploads_size_10_mb` and the rest; the link and code tables; the
two `document_settings` switches `client_link_code_required`, `internal_link_code_required`) and
multipart upload. After R1's schema merges, R60 builds the 100 MB limit and the link-switch
screens in Settings > Forms & Documents. Until then the page shows the real 10 MB limit and no
link toggles.

### 4. Documents with no retention years: deletable by the firm

Rasel's decision: a document kept for good (its category has no retention years) may be deleted
by an Owner or Admin, audited, never under legal hold. This is item 7 of R1's schema batch:

Database (one migration):

1. `documents_delete` (last defined in `20261009150000_r0_intake_engine/migration.sql:318-325`)
   gains one branch; the role check sits in the database too, so a bug in the API alone cannot
   let a client or a Staff member delete:

   ```sql
   DROP POLICY documents_delete ON documents;
   CREATE POLICY documents_delete ON documents FOR DELETE
     USING (business_id = app_current_business_id()
            AND NOT legal_hold
            AND (retention_until < current_date
                 OR (direction = 'CLIENT_TO_FIRM'
                     AND EXISTS (SELECT 1 FROM engagements e
                                 WHERE e.id = documents.engagement_id AND e.status = 'ACTIVE'))
                 -- Kept for good (no retention years): only an active Owner or Admin of the firm.
                 OR (retention_until IS NULL
                     AND EXISTS (SELECT 1 FROM memberships m
                                 WHERE m.business_id = documents.business_id
                                   AND m.user_id = app_current_actor_id()
                                   AND m.role IN ('OWNER', 'ADMIN') AND m.status = 'ACTIVE'))));
   ```

2. `documents_intake_rules()` (same migration, line 297): the delete branch reads
   `OLD.intake_id IS NOT NULL AND NOT coalesce(OLD.retention_until < current_date, false)`, so a
   kept-for-good file of a submitted intake still cannot be deleted. Either leave it (recommended:
   the API answers 409 `DOCUMENT_IN_INTAKE` and the intake keeps its file) or change it to
   `OLD.intake_id IS NOT NULL AND NOT (OLD.retention_until IS NULL OR OLD.retention_until < current_date)`.
   Rasel to pick.
3. `documents_rules()` (last defined in `20261010050000_r0_esign/migration.sql:1324`, the check
   at 1391-1395) refuses NULL to a date, but lets a date become NULL (`NEW < OLD` is NULL there).
   With branch 1 that is a way past retention: clear the date, then delete. Refuse it too:

   ```sql
   IF (OLD.retention_until IS NULL) <> (NEW.retention_until IS NULL)
      OR NEW.retention_until < OLD.retention_until THEN
     RAISE EXCEPTION 'documents: retention_until can only move later, and never to or from kept for good'
       USING ERRCODE = 'check_violation';
   END IF;
   ```

   No API code sets `retention_until` after upload today, so nothing breaks. A later change to a
   category's years then changes neither which old documents are deletable nor which are kept.

Notes for the API (R60 or the Documents owner, after the migration):

- `app_current_actor_id()` is set only by `withScope({ kind: 'business', businessId,
  actorUserId })` (as `payments/offline/offline-payments.service.ts:98` does); `TenantPrisma.db`
  (`forBusiness`) leaves it empty, so the delete must run in that scope.
- Route: `DELETE /api/v1/business/documents/:id`, `@Roles('OWNER', 'ADMIN')`; 404 for another
  firm's id; 409 `LEGAL_HOLD`; 409 `RETENTION_ACTIVE` when `retention_until` is a future date.
- Links block the delete: these foreign keys to `documents` are `ON DELETE RESTRICT`:
  `engagement_reports`, `message_attachments`, `tax_returns`, `esign_requests` (final and
  certificate, so Firm Sign's filed copies, which start with no retention, stay), `document_shares`,
  `invoice_attachments`, `tax_return_approvals`, `tax_return_authorizations`,
  `tax_return_documents`, `bookkeeping_reconciliations`, `bookkeeping_transactions`,
  `bookkeeping_report_versions`, `bookkeeping_terms` (two). `task_attachments`,
  `compliance_deadline_documents` and `tax_plan_documents` cascade. The API checks first and
  answers 409 `DOCUMENT_IN_USE` with where it is used, rather than surfacing a foreign-key error.
- Versions: `replaces_id` has no foreign key; delete the whole version chain together, or refuse
  while a newer version exists. Rasel to pick.
- No category also means `retention_until` NULL. Rasel to confirm those are deletable too.
- In one transaction: the delete and `AuditService.log('document.deleted', 'Document', { name,
  categoryId })` (no content). Then remove the S3 object and its old versions (the bucket keeps
  noncurrent versions 30 days, 35 once R1 raises it).
- Tests: e2e for the route (Owner, Admin, Staff refused, legal hold, retention date, in use) and
  a tenant-isolation test (firm B cannot delete firm A's document by id).
- Screen: a Delete action in the firm document library for these documents only, with a confirm
  dialog.

### 5. Begin Online fixes

The full audit is `R60-begin-online-audit.md` (26 screens at 1440 px against
`docs/mockups/begin-online/`, 14 to 24 differences each, each tagged [fix], [R56],
[contract/API] or [decide]). Branch `rasel/R60-begin-online` (no commits yet). Mine is `begin/`
except R56's three files (`_blocks/form-blocks.tsx`, `_blocks/intake-grid.tsx`, the control rules
in `intake-scale.module.css`).

Suggested order (one PR each, 2 open at most):

1. Shared [fix] items, in `_blocks/` and `intake-scale.module.css`:
   - S1 page width: 1240 against about 1380 px.
   - S2 type size: 75 to 85% of the mockup. The control height derives from the same variable,
     so agree the change with R56.
   - S4 heading colour: needs a navy token in `packages/ui`.
   - S5 required stars blue: the label's no-break space misses the kit's `" *"` rule,
     `intake-fields.tsx:24-26` against `packages/ui/src/label-text.tsx:6`.
   - S7 lucide icons: replace with solid Phosphor.
   - S12 the title hides under the sticky header after each step (`intake-flow.tsx:603-606`).
   - S13 phones shown raw.
   - S22 step header block.
   - S24 to S26 the counter, empty repeating groups, and the "Add Another" colour.
2. The reviews (S20) and upload zones (S23).
3. Per-screen items, flow by flow.
4. `apps/web/e2e/mock/r22-begin-online.spec.ts:28`: expect 3 "Schedule an Appointment" links at
   1024 px (the header link added in #457), or count inside `main` only.

Hand to others, do not build:

- **R56:** control heights, input look, stepper, Edit buttons, "Not provided", grid cells and tints.
- **R17 or R1:** when the API is unreachable, the portal layout replaces the whole page with one
  card (`portal/[firmSlug]/layout.tsx:27-38`, against design-match rule 2). Also, the error text
  says "Firmivra" to a visitor on the firm's page (`lib/errors.ts:41`).
- **[contract/API] items:** firm marketing content and photos; footer contact details; a drawn
  signature; a quarter tag on uploads; review-only fields.
- **Seed:** `packages/db/prisma/seed-helpers.ts:187-192` seeds the real forms only for the demo
  firm, so locally (and on dev if seeded with `pnpm db:seed`) five forms are a 3-step stub.
  Shoot those flows with `NEXT_PUBLIC_API_MOCK=beginOnline,publicAgreements` until R0 changes it.

The [decide] list goes to Rasel first: header and footer variants, taglines, 44 px controls
against the mockup's 35 px, mockup colours that fail contrast (input border 1.47:1, white on
orange 3.06:1), conditional follow-ups always drawn, "with a copy of your submission" on
Success (CLAUDE.md rule 4), masking, the start card that no mockup has.

### 6. Team invites

Branch `rasel/R60-team-invites` waits on #981. After it merges: switch the Team screens adapter
(`apps/web/src/app/admin/(console)/team/_components/team-api.ts`) `createMember` and
`resendInvitation` to the real API, and show name and phone saving (after R0's #954).

### Data & Backups (after Oct 22, Rasel)

Kept honest on the page ("Not recorded yet"). Waiting: R1 raises `config.db.backupDays` to 35
(`infra/src/config.ts:110`) and document old versions to 35 days (`data-stack.ts:118`); an AWS
Backup plan; a monthly restore test with alarms and a recorder; an export worker; restore
tooling; a cancellation deletion scheduler. R0 tables: `platform_backup_events` (with a
SECURITY DEFINER `platform_backup_status()`), `firm_export_jobs`, `firm_restore_jobs`,
`firm_deletion_schedules`, `firm_deletion_notices`; read-only access during the 90 days,
reactivating CLOSED firms, deletion that respects legal holds. Then the API routes (backup
status, exports, restore) and the two rows show real dates.

### Other open notes

- Appointment Types, several meeting methods: needs `meeting_methods LocationKind[]` filled from
  `location_kind` (R0), then API and screen.
- Automations page: "Rules are not available" with no failing call, and a duplicate React key
  `actions`.
- Staff API contract gaps reported in #975: sort order, department count, `addedThisMonth`,
  search not covering role.
