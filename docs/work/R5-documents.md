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
- [ ] 2. Presigned PUT for upload with content type and size limits; keys under businesses/{businessId}/...
- [ ] 3. Confirm upload: check size and type server side, store the document record
- [ ] 4. Presigned GET for download, short expiry, only after the firm-scope check
- [ ] 5. KMS encryption on every object; per-business key context
- [ ] 6. Audit uploads, downloads and deletes; e2e test that firm B can't fetch firm A's file

## Done when

Upload and download work on dev from the portal and the firm workspace.

## Needs from others

(none yet)

## Progress log

(newest last: date, step, what changed, commit)
