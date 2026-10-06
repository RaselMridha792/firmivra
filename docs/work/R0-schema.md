# R0: Full Phase 1 schema (Oct 6-8)

**Goal:** Every table Phase 1 needs exists with row-level security, so developers never wait for a table.

**Owned paths (change only these):**
- `packages/db/**`

**Read first (nothing else):** CLAUDE.md, docs/work/README.md, this file, and:
- docs/AUTH-DESIGN.md (data section)
- Developers' field lists (T01, I01 issues or messages, due Oct 6)
- Existing schema and the RLS coverage test in packages/db

## Steps

- [x] 1. Read the current schema and RLS helpers; list the tables that already exist in the Progress log
- [x] 2. Business settings, firm legal documents (Terms, Privacy per firm), tax statuses (firm-defined), team invites
- [x] 3. Clients and client profiles, client account status (pending, approved, declined), client tax status history
- [x] 4. Services and engagements (active, recurring, completed, cancelled), service workspaces (Bookkeeping, Tax Planning: tasks, notes, reports)
- [x] 4a. Fix: the 72-hour support-grant rule judges time by the database clock only, so a slightly fast API clock never fails an approval (ship with the step 4 PR)
- [ ] 5. Documents, document categories, document requests
- [ ] 6. Intake form definitions and submissions (6 Begin Online services), leads
- [ ] 7. Notifications (per user, read/unread, link to record), notification preferences
- [ ] 8. Appointments, staff availability, working hours, blocked time (unique constraint that blocks double booking)
- [ ] 9. Message threads, messages, firm notes
- [ ] 10. Invoices, invoice lines, payments (Stripe ids), external links, calculator definitions
- [ ] 11. Firm applications (if not already there) and support access grants (already there: check)
- [ ] 12. RLS policy + grant for every new table; the coverage test passes; LVP seed data covers every table
- [ ] 13. Generate Prisma client and export types in packages/types; PR per two or three groups so developers get tables early (first PR by Oct 7 morning: business settings, team, tax statuses, clients)

## Done when

All tables merged on main by Oct 8, RLS coverage test green, seed loads.

## Needs from others

- FYI from R1 (step 13, Rasel's go Oct 6): `packages/db/src/link-users.ts`, `packages/db/scripts/link-dev-users.mjs` and `packages/db/test/link-users.test.ts` use `createPrismaClient` and `runInScope`, and write `businesses`, `business_settings`, `users`, `platform_admins`, `memberships` and `audit_logs`. `packages/db/Dockerfile` now builds `@firmivra/db` and ships `dist`. If you move or rename those helpers, or change those tables, tell R1.
- apps/api (owner of `apps/api/test/global-setup.ts`): create a `Client` and pass `clientId` when creating client accounts, so `client_accounts.client_id` can become NOT NULL (R0 step 12).
- R2: invites are ready for the activation flow: create the user and an INVITED membership, then an `invites` row with the token's SHA-256; the signed-out accept step reads it with `db.forInvite(tokenHash)`, then works in business scope.
- I02 (Ibrahim, client profile API): `client_profiles.dob_enc` and `ssn_enc` hold encrypted values only, never plain SSN or date of birth. Write them only through the KMS-backed encrypt helper (Rasel assigns that helper to R5); keep only `ssn_last4` in plain text.

## Progress log

(newest last: date, step, what changed, commit)

- Oct 5, step 1: existing tables: `businesses` (has `terms_url`, `privacy_url`), `users`, `memberships`, `client_accounts`, `platform_admins`, `support_access_grants`, `audit_logs`, `firm_applications` (so step 11 is mostly there). RLS helpers: `app_scope()`, `app_current_business_id()`, `app_current_user_id()`; triggers `businesses_protected_columns`, `users_identity_columns`, `support_access_grants_rules`. `test/rls-coverage.test.ts` needs every table forced RLS + a policy + app SELECT/INSERT. New tables must also go into the TRUNCATE list in `src/testing.ts`. T01/I01 field lists not received yet (no issues on GitHub). Local DB `firmivra_r0` up to date. Paths match the expected layout.
- Oct 5, step 2: migration `r0_settings_team`: `business_settings`, `firm_legal_documents` (insert-only versions, markdown), `tax_statuses`, `invites` (token SHA-256, for an INVITED membership or a client account, 7 days, lifecycle trigger, no DELETE). New `invite` scope (`db.forInvite(tokenHash)`). Same-firm composite FKs `(business_id, id)` added to `memberships` and `client_accounts`. Seed: settings, Terms and Privacy v1 and tax statuses for both firms, invited LVP staff member with an unusable invite. Field names follow docs/SYSTEM-DESIGN.md (Rasel's go, T01/I01 lists not in yet). Commit "feat: business settings, legal documents, tax statuses and invites tables (R0)".
- Oct 5, step 3: migration `r0_clients`: `clients` (firm's record, archived not deleted, assignee must be a member of the same firm), `client_profiles` (1:1, `dob_enc`/`ssn_enc` ciphertext, `ssn_last4`, `custom_fields` for the I01 gaps), `client_tax_statuses` (one per client and year) and `client_tax_status_history` (written by trigger, app read-only). `client_accounts`: `client_id` (nullable until apps/api test setup links a client), `portal_role` (primary, spouse, authorized), decline fields; status `INVITED` added. Seed: a client record and profile per firm linked to the seeded login, LVP 2025 "In preparation". Commit "feat: clients, client profiles and client tax status tables (R0)".
- Oct 5, step 4a: migration `r0_support_grant_db_clock`: the approval trigger trims an expiry up to 1 minute past `now() + 72 hours` (fast API clock) to exactly `now() + 72 hours` and still refuses anything later; test checks against the database's `now()`. Noted for I02/R5 that `dob_enc`/`ssn_enc` hold encrypted values only. Work continues on local branch `rasel/R0-services` (stacked on PR #9, not pushed until #9 merges). Commit "fix: judge the 72-hour support grant limit by the database clock (R0)".
- Oct 5, step 4: migration `r0_services`: `services` (firm catalog: kind, billing interval, packages, workflow stages), `engagements` (status = lifecycle, stage = one of the service's stages; trigger keeps client and service fixed, 90-day reactivation, writes `engagement_status_history`; never deleted), `tasks` and `notes` (per client, optional engagement of the same client via a three-column FK; also cover step 9's firm notes), `engagement_reports` (report, reconciliation, estimate, projection; figures in `data`; only drafts deletable). Seed: LVP's six Begin Online services, a 2025 tax engagement with a task and note, a bookkeeping engagement with a published reconciliation; Firm B one engagement. Commit "feat: services, engagements and service workspace tables (R0)".
