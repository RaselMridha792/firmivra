# R4: Firm application and activation (Oct 10)

**Goal:** A firm applies, Super Admin approves, requests info or declines, and the owner activates the workspace.

**From Oct 9:** steps 2 to 6 are built by R16 (a cloud thread, Rasel's Oct 8 decision), which logs its work below.

**Owned paths (change only these):**

- `apps/api/src/firm-applications/**`
- `packages/types/src/firm-applications/**`

**Read first (nothing else):** CLAUDE.md, docs/work/README.md, this file, and:

- docs/specs (Super Admin Phase 1 scope)
- docs/work/R2-staff-auth.md (invites)

## Steps

- [x] 1. Public application submit (rate limited, no account needed)
- [ ] 2. Super Admin actions: approve, request info (message to applicant), decline with reason; status history
- [x] 3. Approve creates the business with a unique slug and invites the owner (R2 invite flow)
- [x] 4. Owner activation ends at first-time setup; business status active
- [x] 5. Emails through NotifyService (log until R6 merges)
- [x] 6. Audit every action; e2e test of the whole path
- [x] 7. Plus T05 (Oct 6): applications list with filters and paging, detail and status history (Super Admin through `forAdmin()`), dashboard counts, firms list (Active, Pending Setup, Inactive). Contract by Oct 8 (Tumit F04b, N04)

## Done when

Nahid's N04 form and Fahad's F04 screens complete the flow on dev.

## Rules

- Contract first for every module (Rasel, Oct 6): the module's first PR is its zod schemas and client functions in `packages/types`, registered on `api` in `apps/web/src/lib/api.ts`, plus typed mock fixtures in `apps/web/src/mocks/<module>.ts`. The developers build the screen against it the same day.
- Never edit screens: in apps/web change only `src/mocks/<module>.ts` and your lines in `src/lib/api.ts`.

## Decisions (Rasel, Oct 7)

- Choice lists (practice types, entity types, services, plans; also client volumes and credential types): one exported list each in `packages/types/src/firm-applications/schemas.ts`, so a change is one line. Octavia confirms them. `REQUIRED_CREDENTIALS` maps each practice type to the credentials it needs; empty until Octavia answers.
- Request Information: email only in Phase 1. The application stays `PENDING_REVIEW`; the message reaches the applicant through R6's email; the applicant replies to Firmivra support; the Super Admin records the answer in the internal notes. Each request is a history entry. No edit link. (The database's `INFO_REQUESTED` status is not used.)
- EIN: an application never stores the full EIN (field encryption is R10 step 2 with each firm's own key, which an applicant doesn't have). It keeps the last 4 and a keyed hash (HMAC, server-side secret) for the duplicate check. The owner enters the full EIN in setup step 2. Nothing waits on R5.
- Step 3: creating the business also creates the firm's KMS key (R10 step 2) and needs a one-time step for LVP. Those change AWS permissions: bring them to Rasel before pushing.

## Decisions (Rasel, Oct 7 evening)

- Verification after the beta: no email or SMS codes and no disposable-email check on the application. The Super Admin reviews every application, `EMAIL_DOMAIN` already flags free mail, and the owner's activation email after approval proves the address.
- EIN: real columns, not `data`. R0 adds `ein_last4` and an indexed `ein_hash` in a small PR right after #52, with R4's other needs. If they aren't on main when step 2 (submit) comes up, do step 3 first. The hash secret is an AWS change: show Rasel the cdk diff before deploying it.
- Bots: the `honeypot` field (contract), plus the limits below (per IP, per email, and the "received" email throttled per address). No captcha unless spam shows up.
- The decline email includes the reason. The screen labels the field "Reason (sent to the applicant)"; internal remarks go in the notes.
- Order: step 1 (the read side) as soon as #52 merges, then submit, request information / decline / notes, then approve.

## Decisions (Rasel, Oct 8)

- Submit (`POST /firm-applications`) comes now, stacked on #80 the way approve is stacked on #81: dev has no applications and no seed runs there.
  - The EIN hash gets a secret of its own. The cdk diff goes to Rasel; nothing deploys before his yes.
  - The stored form is written through `StoredApplication.parse`.
  - The honeypot, the per-IP and per-email limits, the throttled "received" email, and an audit row without the body.
- Phones (q1): only SMS phone fields are US-only. R3 splits `Phone` into a US-only `SmsPhone` and an international `Phone`. R4's application phones (business, primary admin, alternate) take the international one once R3's change lands.
- From R0's #80:
  - The owner invite on approval is inserted in platform scope and read only through the token-free `platform_owner_invites` copy.
  - Approve copies the entity type, services, team size and description into the new firm's `business_settings` in a business-scope transaction, never the EIN.
  - `data` may hold no key starting with "ein".

## Decisions (R16, Oct 9, where the docs are silent)

- Step 3: the settings copy is entity type, services and team size. The application has no firm description (`additionalInfo` is a note to Firmivra), so `description` stays empty. A firm that already has settings keeps them.
- Step 3: the owner invite uses R2's `InvitesService` class through a second instance in this module (`OWNER_INVITES`) whose activation mailer sends `firm-application.approved` through NotifyService, so the owner gets the approval email with the link. Everything else (login, membership, token, limits) is R2's.
- Step 3: the KMS key job (`FirmKeyJob`) starts after approve's commits without being awaited, and a sweep every 5 minutes (KMS_MODE=kms only, under `pg_try_advisory_xact_lock`) retries firms in setup or active without a key. The firm stays `PENDING_SETUP` until setup Finish; until its key is stored, saving the EIN answers 503 ENCRYPTION_UNAVAILABLE (the settings API's existing answer).
- Step 3: Resend owner invite is a platform audit event `firm_application.owner_invite_resent` (ids only); R2's invite writes `membership.invited` in the firm.

## For the API steps (lead's #61 review, Oct 7)

- History is #52's `firm_application_status_history`, written by the trigger on `firm_applications`, not `audit_logs`.
- Request Information keeps `PENDING_REVIEW` and sets `decision_reason` to the message, so the trigger writes the history row. The same message as the last request changes nothing, so the trigger writes no row; the API then sends no email and the mock adds no entry.
- Declining with the same text as the last information request breaks #52's "new message" rule (`check_violation`). The API answers 400 `VALIDATION_FAILED`, as the mock does.
- Approve leaves the last request's message in `decision_reason`: return `decision.reason` only when `DECLINED`.
- Approve sets the firm's `pack` (#52's `IndustryPack`) from the practice type; only `TAX_ACCOUNTING` exists.
- Slugs: `NewFirmSlug` and `RESERVED_FIRM_SLUGS` in the contract match `businesses_slug_format`; the API checks the same before the insert.
- Agreement: store the version of Firmivra's terms in force with the application (the form sends only the two ticks).
- Abuse controls on submit:
  - limit per IP and per email;
  - the `honeypot` field: a filled one is answered `{ received: true }` and dropped (no row, no email), audited without the body;
  - throttle the "received" email per address;
  - keep `ein` (and the whole body) out of logs and audit metadata.
- From the lead's #79 review (Oct 8), not in that PR:
  - When submit lands, never log the `honeypot` value.
  - `AuditService` writes the admin's events through `forPlatform`. Writing them through `forAdmin` would let #52's `audit_logs_admin_insert` policy pin the actor in the database.
- From the review of the #79 fixes (Oct 8), for step 3: approve works on an application whose form can't be read (`formReadable` false), since its review page shows the actions as usual. The firm's name comes from `legal_name`, the owner invite goes to `contact_name` and `contact_email`, and the pack is `TAX_ACCOUNTING` (the only pack) when the practice type is unknown.
- For step 3, approve (Oct 8, from the reviews of #101, #107, #81 and the cloud review of the lead's #92):
  - The firm's KMS key is made outside the HTTP request. On a brand-new key, `ensureKey` can take up to 5 minutes before `CreateAlias` passes (#101's tag condition), so approve doesn't wait for it inside a request or a transaction. Plan: a job, with the firm shown as "setting up" until its key is stored.
  - The owner invite runs before the application turns `APPROVED`, or in the same transaction, so a refused invite never leaves an approved firm without one. A stored owner name over 120 characters (rows from before #107 could hold up to 200) answers a clear 409, `OWNER_NAME_TOO_LONG`, for the Super Admin to correct. E2e with a 121-character stored name.
  - The firm's `business_settings` get the application's entity type, services, team size and description, never the EIN. The settings API (#93) drops codes outside `ENTITY_TYPES` and `FIRM_SERVICES`.
  - Default document categories for the new firm, if Rasel places them here (see R1's "Needs from others").
  - Save Note: one `admin.transaction` with `AuditService.logIn` (#81's follow-ups; submit's are done in #107 and #112).
  - E2e owner clients pass `TEST_CLIENT_OPTIONS` (15 s maxWait).
  - Don't add a second admin-scope provider: after approve merges, R2's plan moves `AdminPrisma` into the database module.
- From the second pass on #79 (Oct 8), for step 2: submit writes the EIN's last 4 and its keyed hash to their columns (`ein_last4`, `ein_hash`, R0's #80), never into `data`: #80 refuses any key starting with "ein" there (any case, any depth). Once #80 is on main, the record's `business.einLast4` reads the column and DUPLICATE_EIN compares `ein_hash`.

## Needs from others

- R0 (schema): on `firm_applications`, an `ein_last4` column and an indexed `ein_hash` column (keyed hash, for the duplicate check), in R0's small PR right after #52 (Rasel, Oct 7). Done in #80 (Oct 8); the record reads `ein_last4` since #79.
- R0: a platform-readable record when a firm becomes `ACTIVE` (setup Finish runs in firm scope, which admin scope can't read), for the history's `FIRM_ACTIVATED` and the firms list. The same goes for the owner's invite status (`ownerInvite`, `OWNER_INVITED`), unless admin scope may read that firm's owner invite. Done in #80 (Oct 8): `businesses.activated_at` and the token-free `platform_owner_invites`; R4 uses them in a later PR.
- R0: dashboard `totalUsers` and `newUsersThisWeek` count member and client rows that `forAdmin()` can't read: a platform count or an aggregate R0 provides. Until then the API answers `null` for both (contract changed to nullable). Done in #80 (Oct 8): `platform_user_signups`; R4 uses it in a later PR.
- R0 (seed): LVP's seeded firm application has `data: { businessType }`, not the stored form (`StoredApplication` in `apps/api/src/firm-applications/firm-applications.service.ts`: the review page's business, primaryAdmin, account and credentials groups). Since the #79 fixes the API answers it from the table's own columns (`formReadable` false) instead of 500, and the contract now takes its hand-written id (next note), so the pages list and open it. The seed should still write the stored shape (synthetic values), so local review pages show a full form. Dev has no applications, so it is not affected.
- R0 (seed): the seed's fixed ids should be RFC 9562 UUIDs (the contracts check ids with `z.uuid()`). Done in #89 (Oct 8); `FirmApplicationId` is `z.uuid()` again since #79.
- R0: admin scope reads only the signed-in admin's own user row, so another Super Admin's name in a decision or the history shows as "Firmivra admin". Let admin scope read platform admins' names (users of `platform_admins`). Done in #80 (Oct 8): `users_admin_platform_admins`; R4 uses it in a later PR.
- R1/Rasel (infra): the server-side secret for the EIN hash (dev and prod), before step 1's API. Done for dev in R1 step 14 (#101, Oct 8): `firmivra/dev/firm-applications/ein-hash-key` as `EIN_HASH_KEY`; submit answers 503 on dev until #101 deploys; prod with R8.
- Lead: an `EIN_HASH_KEY` placeholder in `.env.example` (dev-only value, 64 hex characters). Done (the lead's yes, Oct 8): `.env.example` has a dev-only key, and production refuses that exact value.
- R8: alarm on the warnings "Firm application <id>: the <template> email could not be sent" (received, info-requested, declined; the id only) and "Firm application submit refused: EIN_HASH_KEY ..." (the key is missing or malformed: no application can be received). Optionally also "Firm application submits for one email (key <first 12 of the keyed hash>) reached <n> in a day" (one email named by many networks; once a day per email, never a block).
- Firmivra's own terms version: submit can't store "the version of Firmivra's terms in force" (For the API steps) until one exists; the application keeps only the two ticks the contract requires.
- R5: uploads for an application before any account exists (the spec's "credentials and uploads"). Until then `documents` is always empty.
- R6: four emails: application received (applicant), information requested (the message; reply-to support), approved (the owner's activation link, through R2's activation mailer), declined (with the reason, Rasel Oct 7).
- R3: export `tryLock` (the advisory try-lock in `apps/api/src/client-auth/sign-up.service.ts`) from a shared place, for example `client-auth/network.ts` or a small `common/advisory-lock.ts`. R4's submit limits keep a copy in `submit.service.ts` until then, and switch to the import once it lands (review of `rasel/R4-api-submit`, Oct 8).
- R2: an owner invite created by a Super Admin (no inviting member) through `InvitesService`, checked at step 3.
- Tumit (F04b, application detail): show Approve also when the application is APPROVED and `firm` is null (an approval whose picked address was taken before the firm was created). Approving again finishes it; the page now hides the button (`canDecide`). Rare, and only with a picked address.
- R2 (InvitesService, `apps/api/src/auth/invites.service.ts`; R16, Oct 9): the owner's link must be inserted in platform scope with no inviter, so the database marks it `sent_by_platform` and keeps the token-free copy in `platform_owner_invites` (R0's #80 design). `InvitesService` writes every invite in the firm's business scope, and platform scope may insert invites but not memberships, so R4 can't do it from its own paths. Needed: for `invitedBy: null` and role OWNER, the `invites` row inserted in platform scope (the membership stays in business scope, in the same lock order), for example an option on `createInvite` / `resendInvite`. R16 makes it (Oct 9, the thread's go: R2's session is closed) on its own small branch `rasel/R16-owner-invite-platform`, so it can be reviewed or dropped alone; approve and resend switch to it in a later commit once it is in. Until then approve and Resend owner invite work (business-scope invite, email through NotifyService), but the review page's `ownerInvite` stays null and the history has no OWNER_INVITED. R4's read side (`platform_owner_invites`) is in and tested with a platform-scope invite. Done: `fromPlatform` on `createInvite` and `resendInvite` (#194, `rasel/R16-owner-invite-platform`); approve and resend use it since `rasel/R16-onboarding-e2e`.
- Not in the contract (Phase 1 is the approval path only): the "Edit" links on the review cards, "Add Firm Manually", "Add Firm", "Edit Firm Details", "Deactivate Firm" and "Open Firm Workspace" (the last needs the support-access design). The screens leave them out or mark them "Soon".

## Progress log

(newest last: date, step, what changed, commit)

- 2026-10-07, contract (steps 1, 2 and 7): `packages/types/src/firm-applications/` with the public `submit`, and the Super Admin's `list`, `counts`, `get`, `approve`, `requestInfo`, `decline`, `saveNotes`, `resendOwnerInvite`, `listFirms`, `firmCounts`, `getFirm` and `dashboard`. Error codes `APPLICATION_DECIDED`, `SLUG_TAKEN`, `INVITE_NOT_NEEDED`. Mock `apps/web/src/mocks/firm-applications.ts` (fixtures built on first use: three pending, two approved, one declined, plus LVP and a suspended firm), registered as `api.firmApplications`. Tests `packages/types/test/firm-applications/client.test.ts`. Branch `rasel/R4-contract`, on top of #45 (it needs the kit's mock switch).
- 2026-10-07, #61 review fixes:
  - `NewFirmSlug` (the database's slug format, at most 63 characters, not reserved) and the exported `RESERVED_FIRM_SLUGS`;
  - `teamSize` is a JSON number (no coercion);
  - the list's `from` must come before `to`;
  - `decision.reason` only for DECLINED;
  - the status enum is renamed `FirmApplicationReviewStatus`, so it doesn't clash with #52's `FirmApplicationStatus`;
  - test EINs start with 00;
  - the mock follows #52's rules (same request message: no entry; a decline reason must differ from the last request), cuts slugs before trimming hyphens, and uses Example/Sample firm names.
- 2026-10-07, contract tweak (Rasel's answers): `honeypot` on `SubmitFirmApplicationRequest` (sent as it is; a filled one is answered `received` and dropped, the mock too), the decline reason documented as sent to the applicant, and the evening decisions above. Branch `rasel/R4-contract-honeypot`.
- 2026-10-08, step 7 (T05, the read side), on #52's admin scope:
  - `GET /admin/firm-applications` (status, search, from/to, order, pages; an information request reads as pending), `/counts` ("this month" in US Eastern time), `/{id}` (the review page: the stored form, history from `firm_application_status_history` newest first, decision with the reason only when declined, checks for duplicate name and email and the email domain, the suggested portal address);
  - `GET /admin/firms`, `/counts`, `/{id}` (owner: the active owner's contact, else the application's primary administrator);
  - `GET /admin/dashboard` (pending applications, active firms; user counts null until R0).
  - `AdminPrisma` (`forAdmin` as the signed-in admin) lives in the module. Opening an application or a firm is audited as a platform event (ids only).
  - Not yet: the EIN check (needs R0's ein columns), `ownerInvite` (recorded by approve, step 3), `FIRM_ACTIVATED` (needs R0's platform record).
  - Contract: the dashboard user counts are nullable, and the honeypot has no length limit of its own (the lead's nit).
  - Tests: `apps/api/test/e2e/firm-applications.e2e.test.ts` (15, including that every answer parses with the contract's schemas), `apps/api/test/unit/firm-applications.test.ts`. Branch `rasel/R4-api-read`.
- 2026-10-08, step 2 (part): `POST /admin/firm-applications/{id}/request-info` (email to the applicant, stays pending; the same message again changes nothing and sends nothing), `POST .../decline` (the reason is emailed; the same text as the last request is 400 `VALIDATION_FAILED`, as the database refuses it), `PUT .../notes` (also after a decision; `''` clears). 409 `APPLICATION_DECIDED` for a decided application, checked before and in the update (a decision made in between is 409 too). Every action audited as the acting admin (ids only). Emails go through `NotifyService` (R6; log-only until its step 2). Approve comes with step 3. Tests: `apps/api/test/e2e/firm-application-review.e2e.test.ts` (NotifyService replaced by a recorder). Branch `rasel/R4-api-review`, on #79.
- 2026-10-08, #79 review fixes (the lead's request for changes):
  - A stored form that can't be read no longer fails a page. `data` is plain JSON the database doesn't check (LVP's seeded row is `{ businessType }`), and one such row made the list, the review page and its firm's page answer 500. Each row is now parsed on its own. One that fails is logged as a warning with its id only, and comes back from the table's own columns with `formReadable` false. Its checks still run from the columns (DUPLICATE_NAME, DUPLICATE_EMAIL; EMAIL_DOMAIN from the contact email). The firms list and firm page leave out the owner fallback and the plan for it. The review actions on `rasel/R4-api-review` return the same record, so they work on such a row too.
  - Contract (Tumit's F04b builds on it): `FirmApplicationListItem` has `formReadable`; `practiceType`, `entityType`, `requestedPlan` and `contactPhone` are nullable, and `services` is empty when unknown. `contactPhone` was not in the agreed list, but a row without the form or a phone column (like LVP's) has none. `FirmApplicationRecord` has the columns at the top level (`legalName`, `dbaName`, `contactName`, `contactEmail`, `contactPhone`) and `formReadable`; when that is false, `business`, `primaryAdmin` and `account` are null and `credentials` is empty. The schema comments say what the screens show then.
  - EMAIL_DOMAIN: a free email address (`FREE_MAIL_DOMAINS` in the service) is a WARN whatever the website. No website, or one that isn't a valid address after the same `https://` prefix as the contract's Website field (`URL.canParse`), is SKIPPED (a stored website that wasn't a URL used to throw: a 500).
  - Mock: the new fields, one pending fixture whose form could not be read (no phone either), the API's EMAIL_DOMAIN rules, and the dashboard user counts null like the API's.
  - Left as it is: the firms list is filtered and paged in memory, which is fine at beta scale.
  - Tests: e2e with four more rows (data `{}`; LVP's `{ businessType }`, approved, with a firm; a website that isn't an address; a free email address); unit tests `apps/api/test/unit/firm-applications-checks.test.ts`; contract tests for the unreadable record, list row and firm. Branch `rasel/R4-api-read`.
- 2026-10-08, review of the #79 fixes (two reviewers; six findings, two of them the same, all real):
  - LVP's seeded application still broke the pages, through its id. `00000000-0000-4000-5000-000000000001` has a variant digit (5) that `z.uuid()` refuses: the API answered 200, then the web client threw on the whole list and on LVP's firm page, and refused to open it. `FirmApplicationId`, also the id of the list row and the record, is now `z.guid()`: any id the uuid column holds. The types don't change. The e2e's LVP-like row has such an id. R0 note: RFC 9562 ids in the seed, which break other modules the same way.
  - EMAIL_DOMAIN: `URL.canParse` took `N/A`, `ftp://…` or `javascript:` (a host like `n` or `ftp`), so they came back WARN "doesn't match". `websiteHost` in the contract reads a stored website as the Website field does (the same `https://` prefix, and a domain name for the host); the API and the mock use it, so those are SKIPPED.
  - A unit test that an unreadable form is logged with its id only, on the list, the review page, the firms list and the firm page.
  - Mock: an approved application whose form can't be read, with a hand-written id like the seed's, and its firm in setup (no owner, no plan, an expired activation link).
  - Step 3: approve works on an unreadable form (under "For the API steps").
  - Tests: e2e (the seed-like id lists and opens, and so does its firm; the website note), unit `apps/api/test/unit/firm-applications-unreadable.test.ts` and more SKIPPED websites, contract (`websiteHost`, the seed-like id). Branch `rasel/R4-api-read`.
- 2026-10-08, second pass on #79 (the lead's review):
  - A test for the 403: an admins-pool login without a `platform_admins` row (made in the e2e's own setup) gets 403 FORBIDDEN on every admin application, firm and dashboard route, and nothing is audited as opened.
  - Search: `%`, `_` and `\` in a search term are plain characters (`likeEscape` in the service, the approach of R10's clients search: Prisma's `contains` doesn't escape them). The duplicate checks had the same fault, since Prisma's insensitive `equals` is ILIKE too: a `_` in a name or email matched any character (a false "Same email" for `j_smith@…` against `j.smith@…`). They escape the same way. The firms search filters in memory and was already literal; a test now says so.
  - EIN: R0's #80 (open) refuses any key starting with "ein" in `firm_applications.data` and adds the `ein_last4` column. `StoredApplication.business` has no `einLast4` any more (an older row's is dropped when read), nothing reads it, and the record's `business.einLast4` is null until #80 is on main. The contract and the mock say the last 4 come from a column of their own, never from the stored form.
  - Tests: e2e (the 403; `%` and `_` on the applications search and `%` on the firms search, each matching only rows that contain it; the duplicate checks against a lookalike name and email; `einLast4` null, and the stored forms no longer hold it), unit (`likeEscape`; an older form with `einLast4` reads without it, and its record shows null). Branch `rasel/R4-api-read`.
- 2026-10-08, #81 on #79's fixes, and Rasel's Oct 8 answers (Decisions above):
  - Merged `rasel/R4-api-read` (#79's fixes and main) into `rasel/R4-api-review`: the review actions return #79's record, so they work on a form that can't be read. The unit test's service takes the NotifyService too, and the review e2e's stored forms no longer hold `einLast4`.
  - The information request's email has `replyTo` Firmivra support: `FIRMIVRA_SUPPORT_EMAIL` (`admin@firmivra.com`) in the service, which must stay the same as `supportEmail` in `apps/web/src/lib/company.ts` (apps/api cannot import apps/web).
  - Request Information and Decline write the decision and its audit row in one admin-scope transaction (`AdminPrisma.transaction`, the Database's `withScope`), so they land or fail together. The email goes only after the commit. `auditIn` in the service writes the row with the columns `AuditService.log` sets (no firm, the acting admin, ids only, the request's IP, user agent and request id); in admin scope #52's `audit_logs_admin_insert` now pins its actor. Switch to `AuditService.logIn(tx, ...)` when R3's #70 merges. Saving notes is unchanged: its update and its audit row are still two writes.
  - The application's row is locked first, so a second review at the same time waits and reads the first one's result: the same message twice at once (a double click) sends one email.
  - A send that fails after the commit doesn't fail the request: a warning with the application's id only, and 200. A retry of the same message sends nothing (nothing changes); a request whose transaction failed changed nothing, so its retry sends the email.
  - Tests (`apps/api/test/e2e/firm-application-review.e2e.test.ts`): `replyTo` on the info-requested email; with a NotifyService whose send rejects, request-info and decline answer 200, both decisions and their audit rows are stored (with the request's id, user agent and IP), and the warnings hold the id only; the same message twice at once sends one email and writes one audit row; an audit row that fails (a NUL character in the user agent, which PostgreSQL refuses) leaves the application as submitted and sends nothing, and the retry declines and sends.
  - #80 merged to main (`62909ed`) after `rasel/R4-api-read`'s last merge of main, so neither branch has it yet. Branch `rasel/R4-api-review`.
- 2026-10-08, #79 after #80 and #89 (the lead's Oct 8 messages): main merged (#80's EIN columns and platform reads, #89's RFC 9562 seed ids).
  - The record's `business.einLast4` comes from the `ein_last4` column, never from the stored form; null when the application has no EIN.
  - `FirmApplicationId` (also the list row's and the record's id) is `z.uuid()` again: the seed's ids are RFC 9562 since #89 (LVP's application is `00000000-0000-4005-8000-000000000001`). The mock's unreadable approved application and the e2e's LVP-like row use such ids.
  - Tests: e2e (`einLast4` from the column on one application, null on one without), unit (an older form's last 4 never shown, the column's are), contract (the seed's id accepted, its old variant-5 id refused).
  - Local database: a fresh one, migrated and seeded with #89's ids (the old rows would collide).
- 2026-10-08, step 1 (submit, Rasel's Oct 8 answer 1), branch `rasel/R4-api-submit`:
  - `POST /firm-applications` (public, `@Public()`, 200 `{ received: true }` for every outcome but the errors below). The API's cross-site guard takes it only as JSON from the firm site's origin, like every public POST. Written in platform scope (the Database's `withScope`), the form through `StoredApplication.parse`, with the primary administrator in the contact columns.
  - EIN: never in `data`. `ein_last4` and `ein_hash` (HMAC-SHA256 of the 9 digits with `EIN_HASH_KEY`, 32 bytes) together. The key is read by R4's own loader (`ein-hash.ts`: 64 hex characters, not one repeated byte), not the API's config: missing or malformed, submit answers 503 `SERVICE_UNAVAILABLE` with a warning naming the setting (never a value), and nothing else in the API changes.
  - Limits, R3's mechanism (audit rows counted in one platform transaction under advisory try-locks, so every API task shares them; a busy lock is refused, never waited for), and R3's 429 `RATE_LIMITED`: 5 submits per IP an hour, 3 per primary administrator email in 24 hours, plus R3's in-memory 10 a minute per IP. The rows (`firm_application.submit_attempt`) hold the canonical IP and a keyed hash of the email (a key derived from `EIN_HASH_KEY`), never the email. `SUBMIT_LIMITS` in `submit.service.ts`.
  - Honeypot: a filled one is counted by the limits and answered exactly like a real submit, but stores no application and sends nothing; one warning without the form or the trap's value.
  - "Received" email (`firm-application.received`) after the commit, at most one per address in 24 hours (an earlier application from the address in the window, checked under the email's lock); a failed send still answers success, with a warning holding the application's id only.
  - Audit: `firm_application.submitted` (entity `firm_application` and its id), no firm, no actor, no metadata, in the insert's transaction (`AuditService.logIn`).
  - DUPLICATE_EIN compares `ein_hash` with other applications (firms keep their EIN encrypted with their own key): WARN "Same EIN as …", PASS, or SKIPPED "No EIN given". The mock's PASS note matches.
  - Contract: `primaryAdmin.fullName` at most 120 characters on one line (#52's `invites_name`), so approve never fails on the owner invite. The other names and texts already use the shared text rules. The application's phones already take the international `Phone` (R3's split is on main).
  - #81 follow-ups: Request Information and Decline write their audit row with `AuditService.logIn(tx, ...)` (the module's `auditIn` is gone); Save Note writes the notes and its audit row in one admin transaction.
  - Tests: `apps/api/test/e2e/firm-application-submit.e2e.test.ts` (the columns and a `data` without any ein key; the record's `einLast4`; DUPLICATE_EIN WARN, PASS and SKIPPED; the honeypot; both limits and a counted honeypot; the email throttle and the send after commit; a failing send; the audit row; 400s; other origins; 503 without the key), a notes rollback in the review e2e, unit `apps/api/test/unit/firm-application-ein-hash.test.ts`, contract cases for the name rule.
- 2026-10-08, review of `rasel/R4-api-submit` (same branch):
  - The per-email limit counts per email and network (R3's `perEmailNetworkPerDay`): 3 a day from one /24 or /48, so a stranger elsewhere can't block a real applicant and the 429 says nothing about anyone else's submits. The day's total for an email from every network (20) only logs a warning, once a day (`firm_application.submit_alert` row), never a block.
  - A network limit like R3's: 20 submits an hour per /24 (IPv4) or /48 (IPv6), next to the 5 per IP; the try-lock is the network's (it covers its IPs), then the email's. The attempt rows hold `{ ip, net, emailKey }`.
  - The "received" email is started after the commit and never awaited, so every answer takes the same time whether or not an email goes out (a dropped honeypot, an address that applied in the window). A failed send still logs the id-only warning.
  - `tryLock` stays a copy of R3's (not exported, R3's path); Needs from others.
  - Tests: per-network limit with a new IPv6 address per request, per-email-and-network (a stranger's network is blocked, the applicant's isn't) and the once-a-day warning, an answer that doesn't wait for a held send; the e2e's viewers are random ULA /48s.
- 2026-10-08, the lead's #107 follow-ups (branch `rasel/R4-submit-followups`):
  - `.env.example` has `EIN_HASH_KEY` with a dev-only 64-hex value (the lead's yes for that file), so a local submit works. `loadEinHashKey` refuses that exact value when `NODE_ENV` is production ("EIN_HASH_KEY is the .env.example value"), so a deploy that copied `.env.example` never hashes EINs with a public key; a unit test keeps the constant and `.env.example` the same.
  - Submit is wrapped in R3's `atLeast`: in AWS (`AUTH_MODE=cognito`) every answer, a 429 or 503 included, takes at least `SUBMIT_MIN_RESPONSE_MS` (1 s), so a dropped honeypot and a real submit can't be told apart by time. Local and test runs don't wait.
  - Tests: unit (the production refusal, `.env.example` in step, the minimum time for a honeypot and a 503 in AWS, none locally).
- 2026-10-08, from R1 step 14 (branch `rasel/R1-kms-secret-ses`):
  - `firm-keys.ts` exists: `FirmKeys`, `AwsFirmKeys`, `LocalFirmKeys`, `loadFirmKeysConfig`, `createFirmKeys`, `FIRM_KEYS`, `firmKeyAlias`, `FirmKeyError`. Keys are tagged `firmivra:env`, `firmivra:businessId` (the lower-case id) and `firmivra:purpose=firm-data`, named `alias/firmivra/<env>/business/<id>`, and made with KMS's default key policy (none sent). A repeat finds the key by its alias; a race uses the key named first; either way the adapter adopts the key only if it is exactly one it makes (enabled customer key of this account, KMS key material, one Region, symmetric, exactly the firm's three tags, KMS's default key policy, no grants), else `FirmKeyError` and nothing is stored; naming a new key is retried for up to five minutes (tags take that long to reach authorization).
  - The one-off `create-firm-key` command (`create-firm-key.ts`, `create-firm-key.cli.ts`) gives LVP its key on dev, in platform scope, with a `business.kms_key_set` platform audit row; `--check` proves the encryption-context rule on the real key.
  - Approve (step 3) reuses them, as the plan for step 3 says (#124, "For the API steps"): `CreateAlias` can wait up to 5 minutes on a new key, so the key is made outside the request, and a naming failure logs the unused key (`FirmKeyError` names it). Add approve to the source-scan test in `test/unit/firm-keys.test.ts`.
  - EIN-hash key: `firmivra/<env>/firm-applications/ein-hash-key`, 64 lower-case hex characters (32 bytes), injected as `EIN_HASH_KEY`. Submit reads it with its own settings loader (check `^[0-9a-f]{64}$`, decode, HMAC-SHA256 into `ein_hash`) and never rotates it. Locally, `.env` takes the dev-only `.env.example` value (#107, above).
- 2026-10-09, step 2 (approve), R16, branch `rasel/R16-approve`:
  - `POST /admin/firm-applications/{id}/approve` (`slug` optional; default the suggested address). Two transactions, since the database takes each half only in its own scope: the decision in admin scope (APPROVED as the acting admin, `firm_application.approved` audited in it), then the firm in platform scope (`PENDING_SETUP`, named after the legal name, `business_type` from the practice type or null, pack `TAX_ACCOUNTING`), linked to the application in the same transaction, with `business.created` audited (platform event, the acting admin, `{ applicationId }`).
  - 409 `OWNER_NAME_TOO_LONG` (new contract code, also in the mock: a contact name the owner invite would refuse by R0's `invites_name`, over 120 characters, blank or with control characters; only rows from before #107) and a picked address another firm has (`SLUG_TAKEN`) are checked before the decision.
  - With no picked address, one taken in between moves on to the next free one (insert with ON CONFLICT DO NOTHING, then the next). Only a picked address taken between the two halves leaves the application APPROVED with no firm: the record keeps `suggestedSlug`, and approving again finishes it without a second decision.
  - Firms approved before step 3 merges get their settings, key and owner link from step 3's paths (settings are created on first save, the key job takes any firm without one, Resend owner invite sends a first link).
  - Two approvals at once: the second waits on the row lock and creates nothing more (one firm, one decision).
  - Not yet (step 3): business_settings from the application, the KMS key, the owner invite after commit and `resendOwnerInvite`, `ownerInvite` on the record. Approve sends no email until then.
  - Tests: `apps/api/test/e2e/firm-application-approve.e2e.test.ts` (default and picked address, the audit rows, 409s before the decision, finishing an approved application without a firm, a double click, an unreadable form, 400/401/404).
- 2026-10-09, step 3, R16, branch `rasel/R16-firm-setup` (on `rasel/R16-approve`): after approve's commits, each on its own (a failure warns with ids only and the approval stands):
  - the firm's `business_settings` from the application (entity type, services, team size; never the EIN) in the firm's business scope, audited `settings.copied_from_application` in the firm;
  - the firm's KMS key through `FirmKeys` (#101's `firm-keys.ts`; the job is in its source-scan test, and a `FirmKeyError` naming an unused key is logged as is), made by `FirmKeyJob` outside the request, stored on `businesses.kms_key_id` in platform scope, audited `business.key_created` (no ARN);
  - the owner invite through R2's `InvitesService` (`invitedBy` null), emailed as `firm-application.approved` through NotifyService.
  - `POST /admin/firm-applications/{id}/owner-invite` (contract's `resendOwnerInvite`, already in the contract and mock): a new link (R2's resend) or a first one; 409 INVITE_NOT_NEEDED before the firm exists, for a suspended or closed firm, or once the owner is active.
  - The record's `ownerInvite` and OWNER_INVITED history come from `platform_owner_invites` (R2 need above).
  - Tests: `apps/api/test/e2e/firm-setup.e2e.test.ts` (settings without the EIN and isolation, key stored, invite and email, email and key failures then resend and retry, 409s, ownerInvite from the copy, 401/403), `firm-application-approve.e2e.test.ts` updated, unit `firm-key-job.test.ts`, `firm-keys.test.ts`.
- 2026-10-09, steps 4 and 5, R16, branch `rasel/R16-firm-activation` (on `rasel/R16-firm-setup`):
  - Activation ends at first-time setup with what is on main: the owner's link (R2's `/auth/activate`) joins the firm in setup, the setup wizard's Finish (`POST /business/setup/complete`, the settings API) makes it ACTIVE (`businesses.activated_at` set by the database). No change outside R4 was needed.
  - The review page's history has FIRM_ACTIVATED at `activated_at` (by null), and the firm summary stays the four contract fields.
  - Step 5: every firm-application email already goes through NotifyService (received, information requested, declined since step 2; approved with the owner's link since step 3); there are no log-only calls left in the module. There is no separate "firm activated" email template; none is sent.
  - Tests: `apps/api/test/e2e/firm-activation.e2e.test.ts` (approve, the link from the approval email, activation with a password, setup in PENDING_SETUP, resend 409 once joined, the four steps and Finish, FIRM_ACTIVATED, the firms list ACTIVE).
- 2026-10-09, step 6, R16, branch `rasel/R16-onboarding-e2e` (on `rasel/R16-firm-activation`, with #194 merged in):
  - Approve and Resend owner invite send the owner's link with `fromPlatform` (#194): the database marks it `sent_by_platform`, so the review page's `ownerInvite` and OWNER_INVITED come from `platform_owner_invites` in the real flow.
  - Audit: every action writes its row; each is asserted in a test. `firm-onboarding.e2e.test.ts` checks, on one walk, `firm_application.submitted`, `firm_application.viewed`, `firm_application.info_requested`, `firm_application.notes_saved`, `firm_application.approved`, `business.created`, `business.viewed_by_admin` (platform), and `settings.copied_from_application`, `membership.invited`, `membership.activated`, `setup.step_completed`, `setup.finished` (the firm); no EIN, note, message, password or activation token in any row. The others are checked elsewhere: `firm_application.declined` in `firm-application-review.e2e.test.ts`; `business.key_created` and `firm_application.owner_invite_resent` in `firm-setup.e2e.test.ts`; `business.key_needs_person` in the unit `firm-key-job.test.ts`.
  - Tests: `apps/api/test/e2e/firm-onboarding.e2e.test.ts` (the public form, list, open, information request, notes, approve, activation from the approval email, setup and Finish, ACTIVE with FIRM_ACTIVATED and ACCEPTED, the three emails, the audit rows in the platform's log and the firm's, and firm B: reads none of the new firm's rows, and each side's people get 404 in the other firm); `firm-setup.e2e.test.ts` reads `ownerInvite` and OWNER_INVITED from approve and resend.
- 2026-10-09, #164 pre-review fixes (branch `rasel/R16-firm-setup`):
  - The key sweep's timer catches a failed sweep (a warning; the next one runs), so a database error can't stop the API task.
  - A `FirmKeyError` (a key made but not named, or an alias naming a key the adapter won't adopt) is recorded once as the platform event `business.key_needs_person` and logged once; the sweep never retries that firm, so no more unused keys are made. A person runs `create-firm-key`, which stores the key.
  - The sweep leaves firms created in the last 10 minutes to approve's own call (its try-lock ends with the list, and naming a new key can take 5 minutes).
  - Resend owner invite also copies settings an approval could not copy (idempotent; a firm with settings keeps them).
  - A revoked newest owner link reads EXPIRED, not SENT.
  - Tests: unit (sweep age and held firms, the error recorded once, a failing sweep), e2e (settings copied on resend, once).
- 2026-10-09, #183 pre-review fixes (branch `rasel/R16-firm-activation`): the activation e2e signs the owner in with the password the link set (sign-in, then the authenticator step with the local code) and runs setup with that session's cookies, not a dev token; it checks the audit rows of activation, the four steps and Finish (by the owner); the firm summary is built with `satisfies`, not `as`.
- 2026-10-09, #203 pre-review fixes (branch `rasel/R16-onboarding-e2e`): the onboarding e2e signs the owner in through `POST /auth/sign-in` with the password the link set (a wrong one is 401 INVALID_CREDENTIALS) and runs setup with that session's cookies, not a dev token; it opens the firm's admin page (`business.viewed_by_admin`) and checks no audit row holds the activation token; the step 6 log line now names which test checks each audit row.
- 2026-10-09, R4 follow-ups (Scrum review of #194 and the flaky counts), branch `rasel/R16-r4-followups` (on #203, main merged):
  - Resend owner invite always calls `createInvite` with the applicant's typed name and email (`fromPlatform`), never `resendInvite`: after a platform step that failed there is no invite row, and `resendInvite` would fall back to the user row's name (another firm's, for an existing login).
  - `InvitesService` (#194's option): the platform step passes `OUTSIDE_CALL_LIMITS` (it can wait on the per-person lock of a 15 s invite transaction); a non-owner `fromPlatform` call is refused before any login is made (create) or link (resend); the platform revoke names the firm too. `apps/api/README.md` describes `fromPlatform` and its two steps.
  - `GET /admin/firms/counts` is one `groupBy` on status (the total is the sum), so it can't read a firm added between two counts (the flaky "total 58 vs 57").
  - Tests: `firm-setup.e2e.test.ts` (the platform step fails once on approve; the resend sends the typed name, not the existing login's), `owner-invite-platform.e2e.test.ts` (another firm's membership: 404 and no link or copy; a non-owner refused before a login and on resend; the 15 s limits), unit `firm-counts.test.ts`.
- 2026-10-09, #234 review fixes (branch `rasel/R16-r4-followups`):
  - Resend owner invite answers 409 INVITE_NOT_NEEDED whenever the firm's first owner membership is anything but INVITED: an owner the firm deactivated is never re-invited from the Super Admin site (it still sends when there is no owner membership, or an open or broken invite).
  - `GET /admin/firm-applications/counts` is one statement (grouped by status, with the month's decisions as a filtered count): `all` is the sum of the parts.
  - `InvitesService`: the platform step counts the per-person cap again under the lock (two sends at once could pass the first count); `resendInvite` no longer takes `fromPlatform` (no caller: R4 resends through `createInvite`); the 15 s comment says it outlives the module's default.
  - Tests: `firm-setup.e2e.test.ts` (a deactivated owner: 409, still DEACTIVATED, nothing sent; fails on the old guard), `owner-invite-platform.e2e.test.ts` (a link landing between the counts is counted: 429 and nothing added; a firm-B person invited as owner here leaves firm B untouched; the re-send through `createInvite`), unit `firm-counts.test.ts` (application counts).
