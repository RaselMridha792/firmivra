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
- [x] 4b. Unique `users (pool, email)` for sign-in (R2): partial, STAFF and ADMIN only, because a client has one user per firm (AUTH-DESIGN)
- [x] 5. Documents, document categories, document requests
- [x] 5a. Review fixes for PR #22 (lead, changes requested): see the Oct 6 entry in the Progress log
- [x] 6. Intake form definitions and submissions (6 Begin Online services), leads
- [x] 7. Notifications (per user, read/unread, link to record), notification preferences
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
- I02 (Ibrahim, client profile API): `client_profiles.dob_enc` and `ssn_enc` hold encrypted values only, never plain SSN or date of birth. Write them only through the KMS-backed encrypt helper (Rasel assigns that helper to R5); keep only `ssn_last4` in plain text.
- R5 (secure documents):
  - Store objects at `tenant/<business_id>/...` (a CHECK on `documents.s3_key` enforces the firm prefix; it matches the IAM policy `tenant/*`).
  - The key is fixed once the row exists (the database refuses a change). Record the scan result on the row and never move objects; if R5 ever needs to move objects, it asks R0 first.
  - Create the row as `PENDING`; the scanner sets `scan_status` and `scanned_at` once.
  - A hard delete of a `documents` row must also remove the object's old versions, because the documents bucket is versioned. The alternative is a lifecycle rule that expires noncurrent versions.
  - Begin Online uploads (`lead_uploads`) follow the same rules: `tenant/<business_id>/...` (e.g. `tenant/<id>/leads/<uuid>`), start `PENDING`, scan result set once, key fixed. At lead conversion the API inserts a `documents` row with `lead_upload_id` and the same key, file and scan result; the object stays where it is.
- R6 (email and SMS sender): `notification_deliveries` is the outbox.
  - Process each firm's QUEUED rows in that firm's business scope; there is no cross-firm scope for firm data.
  - Look up the address or number at send time; the table stores neither, nor any content.
  - Mark SENT with `sent_at` and the provider message id, or FAILED with a short error code and `attempts + 1`, then back to QUEUED to retry. Mark SKIPPED when the person's preference is off or there is no address or number.
  - ACCOUNT notices ignore preferences.

## Progress log

(newest last: date, step, what changed, commit)

- Oct 5, step 1: existing tables: `businesses` (has `terms_url`, `privacy_url`), `users`, `memberships`, `client_accounts`, `platform_admins`, `support_access_grants`, `audit_logs`, `firm_applications` (so step 11 is mostly there). RLS helpers: `app_scope()`, `app_current_business_id()`, `app_current_user_id()`; triggers `businesses_protected_columns`, `users_identity_columns`, `support_access_grants_rules`. `test/rls-coverage.test.ts` needs every table forced RLS + a policy + app SELECT/INSERT. New tables must also go into the TRUNCATE list in `src/testing.ts`. T01/I01 field lists not received yet (no issues on GitHub). Local DB `firmivra_r0` up to date. Paths match the expected layout.
- Oct 5, step 2: migration `r0_settings_team`: `business_settings`, `firm_legal_documents` (insert-only versions, markdown), `tax_statuses`, `invites` (token SHA-256, for an INVITED membership or a client account, 7 days, lifecycle trigger, no DELETE). New `invite` scope (`db.forInvite(tokenHash)`). Same-firm composite FKs `(business_id, id)` added to `memberships` and `client_accounts`. Seed: settings, Terms and Privacy v1 and tax statuses for both firms, invited LVP staff member with an unusable invite. Field names follow docs/SYSTEM-DESIGN.md (Rasel's go, T01/I01 lists not in yet). Commit "feat: business settings, legal documents, tax statuses and invites tables (R0)".
- Oct 5, step 3: migration `r0_clients`: `clients` (firm's record, archived not deleted, assignee must be a member of the same firm), `client_profiles` (1:1, `dob_enc`/`ssn_enc` ciphertext, `ssn_last4`, `custom_fields` for the I01 gaps), `client_tax_statuses` (one per client and year) and `client_tax_status_history` (written by trigger, app read-only). `client_accounts`: `client_id` (nullable until apps/api test setup links a client), `portal_role` (primary, spouse, authorized), decline fields; status `INVITED` added. Seed: a client record and profile per firm linked to the seeded login, LVP 2025 "In preparation". Commit "feat: clients, client profiles and client tax status tables (R0)".
- Oct 5, step 4a: migration `r0_support_grant_db_clock`: the approval trigger trims an expiry up to 1 minute past `now() + 72 hours` (fast API clock) to exactly `now() + 72 hours` and still refuses anything later; test checks against the database's `now()`. Noted for I02/R5 that `dob_enc`/`ssn_enc` hold encrypted values only. Work continues on local branch `rasel/R0-services` (stacked on PR #9, not pushed until #9 merges). Commit "fix: judge the 72-hour support grant limit by the database clock (R0)".
- Oct 5, step 4: migration `r0_services`: `services` (firm catalog: kind, billing interval, packages, workflow stages), `engagements` (status = lifecycle, stage = one of the service's stages; trigger keeps client and service fixed, 90-day reactivation, writes `engagement_status_history`; never deleted), `tasks` and `notes` (per client, optional engagement of the same client via a three-column FK; also cover step 9's firm notes), `engagement_reports` (report, reconciliation, estimate, projection; figures in `data`; only drafts deletable). Seed: LVP's six Begin Online services, a 2025 tax engagement with a task and note, a bookkeeping engagement with a published reconciliation; Firm B one engagement. Commit "feat: services, engagements and service workspace tables (R0)".
- Oct 5: PR #9 (steps 2, 3) merged; PR #17 opened for steps 4 and 4a. Work continues on local branch `rasel/R0-documents`, stacked on #17.
- Oct 5, step 4b: migration `r0_users_pool_email`: partial unique index `users (pool, email) WHERE pool <> 'CLIENT'` for R2 sign-in. CLIENT is left out because the same email has one client user per firm; clients stay unique by `client_accounts (business_id, email)`. SQL only (Prisma cannot express partial indexes; its diff ignores it). Commit "feat: unique staff and admin email per pool (R0)".
- Oct 5, step 5: migration `r0_documents`: `document_categories` (firm-defined, retention years, null = keep for good), `documents` (always in an engagement; firm S3 prefix CHECK, 10 MB, SHA-256; start PENDING, scan result set once; client uploads only to open engagements; delete only without legal hold and after retention or a client upload while open; file, engagement and uploader fixed), `document_requests` (requested, submitted, accepted, rejected, not available, cancelled; reason required; never deleted); `engagement_reports.document_id` (same engagement). Seed: LVP categories, two requests and one clean client upload. Added R5 items to Needs from others (key layout, scan, versioned bucket deletes). Commit "feat: documents, document categories and document requests tables (R0)".
- Oct 5, step 4b check: email uniqueness is case-insensitive because `users`, `client_accounts`, `clients` and `business_settings` store emails lower-case only (CHECK `email = lower(email)`, since the Oct 4 RLS migration). No schema change; added a test that mixed-case emails are refused for users and client accounts, and a README line that the API lower-cases before writing. Commit "test: email uniqueness is case-insensitive (R0)".
- Oct 5: PR #17 (steps 4, 4a) merged. Merged main into `rasel/R0-documents` and opened the PR for steps 4b and 5.
- Oct 6, NEXT (first job, step 5a): PR #22 changes requested by the lead. Fix in the same PR, on `rasel/R0-documents`, with a test for each item. Push to the same branch; the lead merges when CI is green.
  1. Prefix: `starts_with(s3_key, 'tenant/' || business_id::text || '/')`, matching docs/SYSTEM-DESIGN.md and the deployed IAM policy (`tenant/*`). Also fix the R5 note in Needs from others and the db README (they say `<business_id>/`), and the seed key.
  2. `s3_key` and the uploader columns are immutable after insert. R5 keeps the key fixed and records the scan result on the row; if R5 ever needs to move objects, it asks R0.
  3. `retention_until` may only move later, and NULL (keep forever) never becomes a date. Clearing `legal_hold` stays allowed (the API limits it to managers and audits it); with this rule it can no longer unlock an early delete.
  4. From #17: a report that was ever published can never be deleted. Unpublishing stays allowed, but keep a record (e.g. `first_published_at`, which can't be cleared) and refuse DELETE when it is set.
- Oct 6, step 5a: migration `r0_documents_review` (a new migration in #22, because the local DBs had already applied `r0_documents`): (1) prefix CHECK `tenant/<business_id>/`; (2) `s3_key` and `content_type` join the immutable upload columns; (3) `retention_until` only moves later, NULL never becomes a date; (4) `engagement_reports.first_published_at`, set by trigger on first publication and never changed or cleared, and DELETE only when it is NULL; backfill for reports already published runs per firm with business scope (checked as `firmivra_app` without RLS bypass). A test for each. Seed key and R5 note updated. Locally: deleted the one seeded document with the old key and truncated the test database's documents so the new CHECK could apply (the seed recreates it). Commit "fix: review fixes for documents and reports (R0)".
- Oct 6, step 6: migration `r0_intake` (branch `rasel/R0-intake`, stacked on #22): `intake_forms` (versioned per service; published never changes, only retired; drafts deletable), `intakes` (engagement or lead; published form of that service; lead fixed, engagement set once from the converted lead), `intake_submissions` (one draft at a time, versions in order, locked on submit, signature name/time/IP/browser), `leads` (Begin Online in business scope; resume token SHA-256, 30 days by DB clock; conversion sets client and an engagement of the lead's service once, final), `lead_uploads` (document file rules, only while the lead is a draft), `documents.lead_upload_id` (carried-over upload keeps key, file and scan result). Decisions (Rasel): lead first and convert at review, draft plus locked versions, lead_uploads then documents, 30-day resume link. Seed: forms for LVP's six services, a portal intake draft, a submitted Begin Online lead with a clean upload. Smart App Control off: root lint, typecheck and test pass again locally (API tests too). Commit "feat: intake forms, submissions and Begin Online leads tables (R0)".
- Oct 6, step 7: migration `r0_notifications` (branch `rasel/R0-notifications`, stacked on step 6): `notifications` (firm staff and clients only, checked by `app_is_firm_user`; record link required; dotted type key; payload a flat object of at most 2 KB; only `read_at` changes; no DELETE), `notification_deliveries` (email and SMS outbox for R6: QUEUED, SENT, FAILED, SKIPPED; SENT and SKIPPED final; attempts only up; no address or content stored), `notification_preferences` (per person, firm and category; email on and SMS off by default; never ACCOUNT). Decisions (Rasel): firm users only, deliveries table now, preferences per category. Seed: a client W-2 notification (email sent, SMS skipped), a staff lead notification (email queued), one client preference. Commit "feat: notifications, deliveries and notification preferences tables (R0)".
