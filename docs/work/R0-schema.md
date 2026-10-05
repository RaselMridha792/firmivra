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
- [ ] 4. Services and engagements (active, recurring, completed, cancelled), service workspaces (Bookkeeping, Tax Planning: tasks, notes, reports)
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

- apps/api (owner of `apps/api/test/global-setup.ts`): create a `Client` and pass `clientId` when creating client accounts, so `client_accounts.client_id` can become NOT NULL (R0 step 12).
- R2: invites are ready for the activation flow: create the user and an INVITED membership, then an `invites` row with the token's SHA-256; the signed-out accept step reads it with `db.forInvite(tokenHash)`, then works in business scope.

## Progress log

(newest last: date, step, what changed, commit)

- Oct 5, step 1: existing tables: `businesses` (has `terms_url`, `privacy_url`), `users`, `memberships`, `client_accounts`, `platform_admins`, `support_access_grants`, `audit_logs`, `firm_applications` (so step 11 is mostly there). RLS helpers: `app_scope()`, `app_current_business_id()`, `app_current_user_id()`; triggers `businesses_protected_columns`, `users_identity_columns`, `support_access_grants_rules`. `test/rls-coverage.test.ts` needs every table forced RLS + a policy + app SELECT/INSERT. New tables must also go into the TRUNCATE list in `src/testing.ts`. T01/I01 field lists not received yet (no issues on GitHub). Local DB `firmivra_r0` up to date. Paths match the expected layout.
- Oct 5, step 2: migration `r0_settings_team`: `business_settings`, `firm_legal_documents` (insert-only versions, markdown), `tax_statuses`, `invites` (token SHA-256, for an INVITED membership or a client account, 7 days, lifecycle trigger, no DELETE). New `invite` scope (`db.forInvite(tokenHash)`). Same-firm composite FKs `(business_id, id)` added to `memberships` and `client_accounts`. Seed: settings, Terms and Privacy v1 and tax statuses for both firms, invited LVP staff member with an unusable invite. Field names follow docs/SYSTEM-DESIGN.md (Rasel's go, T01/I01 lists not in yet). Commit "feat: business settings, legal documents, tax statuses and invites tables (R0)".
- Oct 5, step 3: migration `r0_clients`: `clients` (firm's record, archived not deleted, assignee must be a member of the same firm), `client_profiles` (1:1, `dob_enc`/`ssn_enc` ciphertext, `ssn_last4`, `custom_fields` for the I01 gaps), `client_tax_statuses` (one per client and year) and `client_tax_status_history` (written by trigger, app read-only). `client_accounts`: `client_id` (nullable until apps/api test setup links a client), `portal_role` (primary, spouse, authorized), decline fields; status `INVITED` added. Seed: a client record and profile per firm linked to the seeded login, LVP 2025 "In preparation". Commit "feat: clients, client profiles and client tax status tables (R0)".
