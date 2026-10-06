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

- [ ] 1. Contract first, by Oct 8 morning: zod schemas and client functions in packages/types, registered on `api`, plus typed mock fixtures in apps/web/src/mocks; one small PR, so Fahad (F06) and Nahid (N05, N06) build their screens in mock mode
- [ ] 2. Field-encryption helper (KMS in AWS, `LOCAL_KMS_KEY` locally) for SSN and date of birth; R5 reuses it
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

(none yet)

## Progress log

(newest last: date, step, what changed, commit)
