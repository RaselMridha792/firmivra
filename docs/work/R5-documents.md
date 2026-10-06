# R5: Secure documents (Oct 11)

**Goal:** Clients and staff upload and download files safely, only within their own firm.

**Owned paths (change only these):**
- `apps/api/src/storage/**`
- `packages/types/src/documents/**`
- `docs/api/documents.yaml`

**Read first (nothing else):** CLAUDE.md, docs/work/README.md, this file, and:
- infra data stack outputs (bucket, KMS key)
- Local s3mock settings in .env.example

## Steps

- [ ] 1. Publish docs/api/documents.yaml by Oct 9 (Ibrahim I05 and Nahid N05 build on it)
- [ ] 2. Presigned PUT for upload with content type and size limits; keys under tenant/{businessId}/... (the `documents.s3_key` CHECK and the API's IAM policy require this prefix)
- [ ] 3. Confirm upload: check size and type server side, store the document record
- [ ] 4. Presigned GET for download, short expiry, only after the firm-scope check
- [ ] 5. KMS encryption on every object; per-business key context
- [ ] 6. Audit uploads, downloads and deletes; e2e test that firm B can't fetch firm A's file
- [ ] 7. Plus I05 (Oct 6): document categories and document requests (Requested, Received, Accepted, Missing with a reason); the browser upload helper `uploadFile()` in apps/web/src/lib; Begin Online draft uploads with R11. Contract by Oct 9 (Nahid N05, Fahad F07)
- The field-encryption helper for SSN and date of birth (assigned to R5 on Oct 5) moved to R10 on Oct 6.

## Done when

Upload and download work on dev from the portal and the firm workspace.

## Rules

- Contract first for every module (Rasel, Oct 6): the module's first PR is its zod schemas and client functions in `packages/types`, registered on `api` in `apps/web/src/lib/api.ts`, plus typed mock fixtures in `apps/web/src/mocks/<module>.ts`. The developers build the screen against it the same day.
- Never edit screens: in apps/web change only `src/mocks/<module>.ts` and your lines in `src/lib/api.ts`.

## Needs from others

(none yet)

## Progress log

(newest last: date, step, what changed, commit)
