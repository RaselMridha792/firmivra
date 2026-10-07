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

- [x] 1. Publish docs/api/documents.yaml by Oct 9 (Ibrahim I05 and Nahid N05 build on it)
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

## Decisions and rules (Oct 7)

- Portal routes serve only what the client may see: never `INTERNAL`, never another client's (404). The list shows the client's own upload while it is being checked; download only for `CLEAN` files (409 `SCAN_PENDING` or `FILE_BLOCKED`). R12's portal reports link through these routes (lead, #71 review).
- Uploads only for an open service (ACTIVE engagement), however the upload is reached (409 `NO_OPEN_SERVICE`); the pop-up's STOP state is an empty `upload-targets` list.
- Upload in three calls (ticket, PUT to storage, confirm); the API never streams files. `uploadFile()` in `apps/web/src/lib/upload.ts` runs all three.

## Open (Rasel)

- File types: PDF, JPG and PNG (N05, SYSTEM-DESIGN "Uploads"). The My Docs mockup also shows an `.xlsx`; the spec says "firm-configured types". Add spreadsheets now, or later per firm?
- Replacement uploads: the spec wants versions kept. The schema has no version chain, so for now a replacement is a new upload for the same request and the old file stays.

## Needs from others

- R0 or T02: default document categories for a new firm (Tax Documents, Business Documents, Identification), unless the setup wizard creates them.
- R4: uploads for a firm application before any account exists (later; `documents` is empty on applications until then).
- R11: Begin Online draft uploads (later, step 7).

## Progress log

(newest last: date, step, what changed, commit)
- 2026-10-07, contract (steps 1 and part of 7): `packages/types/src/documents/` with `api.documents` (firm: list, get, upload ticket and confirm, download, categories, requests and their accept, reject, cancel) and `api.myDocuments(slug)` (portal: list MINE or FIRM, get, upload targets, upload, download, categories, requests, "I don't have this"). Error codes `NO_OPEN_SERVICE`, `REQUEST_CLOSED`, `NOTHING_SUBMITTED`, `CATEGORY_ARCHIVED`, `UPLOAD_EXPIRED`, `UPLOAD_MISMATCH`, `UPLOAD_FAILED`, `SCAN_PENDING`, `FILE_BLOCKED`. `docs/api/documents.yaml`. `uploadFile()` filled in (type and size checks, SHA-256, PUT with progress, confirm). Mock `apps/web/src/mocks/documents.ts` on R10's mock client and services (fixtures built on first use; the portal mock kept per firm). The enums stay module-local until #52's shared enums land. Branch `rasel/R5-documents-contract`.
