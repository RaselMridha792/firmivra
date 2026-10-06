# R10: Client records API (Oct 7-9)

**Goal:** The firm manages its clients, and each client sees their own profile, tax status, services and tax returns in the portal. Former developer tickets I02, I03, I04 and I08 (Ibrahim), moved here on Oct 6 because the developers now build only screens.

**Owned paths (change only these):**
- `apps/api/src/clients/**`, `apps/api/src/engagements/**`, `apps/api/src/tax-returns/**` (map them to the real layout once and note it in the Progress log)
- the field-encryption helper's folder (moved here from R5 step 2)
- `packages/types/src/clients/**`, `packages/types/src/engagements/**`, `packages/types/src/tax-returns/**`
- `apps/web/src/mocks/clients.ts`, `engagements.ts`, `tax-returns.ts`, and your registration lines in `apps/web/src/lib/api.ts`

**Read first (nothing else):** CLAUDE.md, docs/work/README.md, this file, and:
- the R0 tables for clients, client profiles, client tax statuses (with history), services, engagements and tax returns
- apps/api/README.md (guards, TenantPrisma, AuditService)
- docs/junior/GUIDE.md (what the screens expect: `api.<module>.<fn>()` and mock fixtures)

## Steps

- [x] 1. Contract first, by Oct 8 morning: zod schemas and client functions in packages/types, registered on `api`, plus typed mock fixtures in apps/web/src/mocks; one small PR, so Fahad (F06) and Nahid (N05, N06) build their screens in mock mode
- [x] 2. Field-encryption helper (KMS in AWS, `LOCAL_KMS_KEY` locally) for SSN and date of birth; R5 reuses it
- [ ] 3. Clients: list with search and paging, get, create, update, archive (archive: Owner and Admin); client record overview
- [ ] 4. Client profile: the firm's view and the client's own view in the portal; name and date of birth locked for the client ("Request Name Change" creates a task for staff); SSN and DOB stored only through the helper and returned masked (last 4)
- [ ] 5. Client tax status per year with the firm's statuses (T04): firm updates, history, the client reads their own
- [ ] 6. Services and engagements: Active, Recurring, Completed, Cancelled; the client's My Services
- [ ] 7. Tax returns per client and year with a client-facing status and linked documents
- [ ] 8. Audit every write and every read of client data; e2e per endpoint, including firm B gets 404 on firm A's records and a client can't read another client

## Done when

Fahad's clients screens and Nahid's My Profile, My Services and Taxes tabs work on dev.

## Rules

- Contract first for every module (step 1). Never edit screens: in apps/web change only `src/mocks/<module>.ts` and your lines in `src/lib/api.ts`.

## Needs from others

- R5 (documents): the portal Taxes tab's View and Download use `document.id` from `api.myTaxReturns(slug).list()`; R10 needs the documents API's view or download call for a client's own FIRM_TO_CLIENT document.
- R1 (infra): the API task role may use the firms' KMS keys (`kms:GenerateDataKey`, `kms:Decrypt`), limited by a tag condition on the keys (for example `aws:ResourceTag/firmivra:purpose = firm-data`), not every key in the account. The helper sends the firm's id as encryption context and pins the key id on decrypt.
- R4 (firm activation): activation creates the firm's KMS key (with that tag) and saves its ARN on the firm (`businesses.kms_key_id`, from R0's steps 11–13 PR), plus a one-time step for firms that already exist. LVP on dev was created by the link task, not by activation, so without that step it never gets a key and no SSN can be saved there (AWS mode answers `KEY_NOT_PROVISIONED`, never a fallback key).
- R3 (client accounts): on My Profile, the login email, the password change and "Cancel My Client Portal Account" are account changes, not profile edits. `api.myProfile(slug)` returns the email read-only and does not change it.

## Progress log

(newest last: date, step, what changed, commit)

- Oct 7, step 1: contract on branch `rasel/R10-client-records` (this session continues from R0 in the `firmivra-R0` worktree). Rasel's decisions after the Taxes tab and My Profile mockups: a `tax_returns` table; three `client_profiles` columns for My Profile's additional information; SSN only as its last 4, date of birth in full to the firm's staff and the client themself; the tables in R0's PR #32.
  - Modules in `packages/types/src/`: `clients/` (`api.clients`, `api.myProfile(slug)`: list with search and cursor paging, record, create, update, archive and restore, profile, tax status per year with history; portal profile, name change request, tax years), `engagements/` (`api.engagements`, `api.myServices(slug)`: per client, lifecycle, history; My Services and cancellation requests), `tax-returns/` (`api.taxReturns`, `api.myTaxReturns(slug)`).
  - Routes: firm `/business/clients`, `/business/engagements`, `/business/tax-returns` (like T04's `/business/tax-statuses`); portal `/portal/{firmSlug}/me/profile`, `/me/tax-years`, `/me/services`, `/me/tax-returns` (the client from the session, like R3's portal routes).
  - Mocks: `apps/web/src/mocks/clients.ts`, `engagements.ts`, `tax-returns.ts` (fixtures match the Taxes tab mockup). Tests: `packages/types/test/clients/` and `test/engagements/` (my mapping of the owned test paths).
  - Enum names `EngagementStatus`, `BillingInterval`, `ServiceKind`, `ContactMethod`, `TaxFilingType`, `TaxReturnStatus` match the database. When R0's `db-enums.ts` reaches main (steps 11–13 PR), these modules re-export from it instead of defining them, so the names don't clash.
- Oct 7, step 2: `apps/api/src/field-encryption/` (`FieldEncryptionModule`, `FieldEncryption.encrypt(ctx, value)` and `decrypt(ctx, blob)`), branch `rasel/R10-field-encryption` (stacked on step 1). Envelope encryption: a new AES-256 data key per value from the firm's KMS key (encryption context: the firm's id; key id pinned on decrypt), the value sealed with AES-256-GCM and bound to firm, record and field. Blob: version, mode, wrapped key, iv, tag, ciphertext, for the `*_enc` bytea columns. `KMS_MODE=local` wraps data keys with `LOCAL_KMS_KEY` (refused in production; checked by the module's own settings, since `apps/api/src/config` is not R10's). Adds `@aws-sdk/client-kms` to the API. Tests: `apps/api/test/unit/field-encryption.test.ts` (fake KMS for AWS mode). The module is registered by the first feature that imports it (step 4). R5 reuses it for other sensitive fields.
