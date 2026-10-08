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

- [x] 1. Publish docs/api/documents.yaml by Oct 9 (Arfan I05 and Nahid N05 build on it)
- [ ] 2. Presigned PUT for upload with content type and size limits; keys under tenant/{businessId}/... (the `documents.s3_key` CHECK and the API's IAM policy require this prefix)
- [ ] 3. Confirm upload: check size and type server side, store the document record (Oct 8: Excel and Word must be a real Office Open XML package without macros or a password; the yaml's "Excel and Word (confirm)")
- [ ] 4. Presigned GET for download, short expiry, only after the firm-scope check
- [ ] 5. KMS encryption on every object; per-business key context
- [ ] 6. Audit uploads, downloads and deletes (no delete routes at launch, Oct 8); e2e test that firm B can't fetch firm A's file
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

## Decisions (Rasel, Oct 8)

File types (answer 2):
- Excel (.xlsx) and Word (.docx) join PDF, JPG and PNG, for clients and staff, with the same 10 MB limit (`UPLOAD_LIMITS`).
- Macro-free only: .xls, .xlsm, .doc, .docm and .csv stay refused. Confirm checks on the server that the file really is an Office Open XML package without macros (409 `FILE_HAS_MACROS`).
- A password-protected .xlsx or .docx is not a ZIP: confirm refuses it with a clear "remove the password and upload again" error (409 `FILE_PASSWORD_PROTECTED`), not a generic `UPLOAD_MISMATCH`.
- The browser's `file.type` can be empty for .xlsx, so the web upload helper falls back to the file name (`uploadContentTypeFor`).
- `UPLOAD_LIMITS`, the contract text and the mocks change before Oct 10 (Nahid's N05 and Fahad's F07 show the list).
- Every download stays an attachment.

R5 defaults (answer 4, all accepted):
- A replacement is a new upload for the same request; the old file stays; no version link.
- `FAILED` is final for users (they upload again). Only a real "can't scan this file" result becomes `FAILED`. When the scan breaks on our side, the file stays `PENDING`, an alarm fires, and we rescan with GuardDuty's on-demand scan, never rewriting the object.
- Clients see a failed file as "couldn't be checked, please upload it again", not "failed the malware scan" (portal `BLOCKED` and its `FILE_BLOCKED` for the client's own upload: "This file couldn't be checked. Please upload it again."; a file the firm shared: see Open). The firm keeps the exact `scanStatus`.
- No delete routes at launch. Uploads to ACTIVE engagements only.
- Rasel's AWS list gets GuardDuty Malware Protection for S3, its result event, the alarm, and `kms:Decrypt` for its role on the documents key and each per-firm key (see "Infra needs"). Until that is deployed, new uploads on dev stay "checking".

## Open (Rasel)

- From the #75 review (the lead asked Rasel): how SPOUSE and AUTHORIZED portal logins use the document routes (and what "MINE" means for a household). The other questions (file types, replacements, a rescan path for FAILED scans, deletes, uploads to PENDING engagements) were answered on Oct 8, above.
- From the Oct 8 review of `rasel/R5-file-types-contract`, written into the contract as defaults until Rasel says otherwise:
  - A request whose newest file comes back `INFECTED` or `FAILED` goes back to `REQUESTED`, so the client can "upload again" for that request (answer 4); the firm accepts only a `CLEAN` newest file (409 `SCAN_PENDING` while it is being checked). The other way would be to let clients upload to a `SUBMITTED` request. Note: until GuardDuty is on dev, every new file stays `PENDING`, so on dev the firm can neither download nor accept.
  - A `BLOCKED` file the firm shared (source `FIRM`) shows "This file couldn't be checked. Ask your firm to share it again." (`PORTAL_BLOCKED_TEXT.FIRM`): the client can't upload it again.
- Open questions from the same review (until answered, the yaml says what launch does):
  - Active content without macros: should confirm also refuse links to outside templates or objects (`TargetMode="External"` relationships other than hyperlinks; a remote template can bring macros back), embedded OLE objects and ActiveX controls? It means reading the `.rels` parts too, and it refuses some normal files (a .docx made from a company template links that template; workbooks link other workbooks). Launch checks macros only.
  - PDFs that need a password to open: neither confirm nor the malware scan sees inside them, and GuardDuty may answer `PASSWORD_PROTECTED` (then the file is `FAILED`, and the client would upload the same file again and again). Refuse them at confirm with `FILE_PASSWORD_PROTECTED` (a PDF with only an owner password opens without one and stays), or accept them as a known risk? Payroll W-2 PDFs often come with a password. Launch checks a PDF's magic bytes only.

## For the API steps (#75 review, Oct 7)

The rules are in docs/api/documents.yaml, "Rules for the API":
- a sealed, bound `uploadToken` (5 minutes);
- signed `Content-Type`, `Content-Length`, checksum and SSE headers, with a unit test of the presigned URL, since s3mock doesn't check signatures;
- confirm re-reads the object and deletes a mismatch;
- the unique `s3_key` makes confirm single use;
- downloads pin the confirmed version or re-check the checksum;
- presigned GET as an attachment with an RFC 5987 name and the stored type, every link audited;
- views audited;
- the per-firm KMS key is pending (one bucket key today);
- a lifecycle rule for unconfirmed objects;
- (Oct 8) confirm's Excel and Word checks, in order: an OLE2/CFB file with an `EncryptedPackage` stream is `FILE_PASSWORD_PROTECTED` (a bounded directory walk); the ZIP central directory read in memory with caps (names without case, no duplicates, methods 0 and 8 only); `[Content_Types].xml` inflated with the cap counted on the output and parsed without DTDs; macros first (`vbaProject` or `vbaData` parts, macro-enabled content types, so a renamed .xlsm is `FILE_HAS_MACROS`), then the declared type's main part; never unpack to disk; every refusal deletes the object;
- (Oct 8) GuardDuty's results come only through EventBridge and an SQS queue the API reads (no public route), matched by S3 key: `NO_THREATS_FOUND` is CLEAN, `THREATS_FOUND` INFECTED, `UNSUPPORTED` for a reason in the file itself FAILED (the reason audited); `UNSUPPORTED_STORAGE_CLASS`, `ACCESS_DENIED` or `FAILED` (our side) leaves it PENDING for the alarm and an on-demand rescan (`SendObjectMalwareScan` on the confirmed version); a request whose newest file ends INFECTED or FAILED is REQUESTED again.

Infra for these needs Rasel's yes first.

## Infra needs (Rasel's AWS list, each with his yes first)

- GuardDuty Malware Protection for S3 on the documents bucket (Oct 8).
- Its scan-result event: an EventBridge rule to an SQS queue the API reads with its IAM role (never a public route), which sets the document's `scan_status` (Oct 8).
- The alarm for a scan that breaks on our side; the rescan is GuardDuty's on-demand scan (`SendObjectMalwareScan`), never a rewrite of the object (Oct 8).
- `kms:Decrypt` for GuardDuty's role on the documents key and each per-firm key (Oct 8). AWS's role template also has `kms:GenerateDataKey` (both through S3, `kms:ViaService`) and `s3:PutObject` on `malware-protection-resource-validation-object`, for the test object it puts in an SSE-KMS bucket; without them the plan stays in WARNING (`INSUFFICIENT_TEST_OBJECT_PERMISSIONS`).
- KMS access for the API on the firms' own keys (tag conditioned), `s3:GetObjectVersion` if downloads pin versions, the lifecycle rule for unconfirmed objects, and a bucket policy that refuses a PutObject without `aws:kms` (Oct 7). That policy must let GuardDuty's validation object through.
- Until GuardDuty is deployed, new uploads on dev stay "checking" (`PENDING`).

## Needs from others

- R0: `documents.s3_version_id` if downloads pin the confirmed version (see the yaml).
- R0 (a schema request with the `schema` label): the `documents_rules` trigger still lets a client's upload (`CLIENT_TO_FIRM`) into a PENDING engagement; uploads are for ACTIVE engagements only (Oct 8), so the second wall should say ACTIVE too.

- R0 or T02: default document categories for a new firm (Tax Documents, Business Documents, Identification), unless the setup wizard creates them.
- R4: uploads for a firm application before any account exists (later; `documents` is empty on applications until then).
- R11: Begin Online draft uploads (later, step 7).
- Lead (or Nahid): N05 in docs/tasks/NAHID.md still says "PDF/JPG/PNG up to 10 MB". The pop-up shows `UPLOAD_LIMITS.typeNames` and builds the picker's `accept` from `UPLOAD_LIMITS.types` (Oct 8).
- Lead (or Nahid and Fahad): N05 and F07 show this module's errors with `errorMessage(error, DOCUMENT_ERRORS)` from `@firmivra/types`, not `errorMessage(error)` alone, which shows "Something went wrong" for `FILE_PASSWORD_PROTECTED`, `FILE_HAS_MACROS` and `FILE_BLOCKED`. My Documents shows a `BLOCKED` row, and its `FILE_BLOCKED`, as `PORTAL_BLOCKED_TEXT[source]`. NAHID.md, FAHAD.md and docs/junior/GUIDE.md say only `errorMessage(error)` (Oct 8).

## Progress log

(newest last: date, step, what changed, commit)
- 2026-10-07, contract (steps 1 and part of 7): `packages/types/src/documents/` with `api.documents` (firm: list, get, upload ticket and confirm, download, categories, requests and their accept, reject, cancel) and `api.myDocuments(slug)` (portal: list MINE or FIRM, get, upload targets, upload, download, categories, requests, "I don't have this"). Error codes `NO_OPEN_SERVICE`, `REQUEST_CLOSED`, `NOTHING_SUBMITTED`, `CATEGORY_ARCHIVED`, `UPLOAD_EXPIRED`, `UPLOAD_MISMATCH`, `UPLOAD_FAILED`, `SCAN_PENDING`, `FILE_BLOCKED`. `docs/api/documents.yaml`. `uploadFile()` filled in (type and size checks, SHA-256, PUT with progress, confirm). Mock `apps/web/src/mocks/documents.ts` on R10's mock client and services (fixtures built on first use; the portal mock kept per firm). The enums stay module-local until #52's shared enums land. Branch `rasel/R5-documents-contract`.
- 2026-10-07, #75 review fixes:
  - file names refuse control and invisible formatting characters (\p{Cc}, \p{Cf}), line separators, `/` and `\`, and the ending must fit the type (tests: bidi override, zero-width, `../`, backslash, `CON`, `evil.html`, `x.pdf.exe`, `.pdf`);
  - request lists capped at 200;
  - `uploadFile()`: `Object.hasOwn` for the type, abort checked between steps and its listener removed, a 10-minute PUT timeout, the `mock:` skip only outside production;
  - the mock answers every 404 before any 409;
  - the yaml has "Rules for the API", the household and KMS notes, and the missing 404s.
- 2026-10-08, Rasel's answers 2 and 4 (contract only, branch `rasel/R5-file-types-contract`; also `packages/types/test/documents/`, the mock and `apps/web/src/lib/upload.ts`, R1's kit helper, as in #75):
  - `UPLOAD_LIMITS` adds Excel (.xlsx) and Word (.docx), still 10 MB, with `typeNames` for the picker's hint and the messages ("Upload a PDF, JPG, PNG, Excel (.xlsx) or Word (.docx) file");
  - `fileNameFitsType()` and `uploadContentTypeFor()` (the browser's type when it is ours; for '' or application/octet-stream, the type of the name's ending; else null); `uploadFile()` uses both, so "Budget.xlsx" with no type uploads;
  - error codes `FILE_PASSWORD_PROTECTED` and `FILE_HAS_MACROS` (confirm, 409); `UPLOAD_MISMATCH` stays for bytes that are not their type; portal `BLOCKED` and its `FILE_BLOCKED` say "This file couldn't be checked. Please upload it again.";
  - the yaml: Limits, the Oct 8 rules, "Excel and Word (confirm)", the GuardDuty result mapping and the AWS list; it parses again (a quoted `summary` and a stray `404` line had broken it; that 404 belongs to "not-available");
  - mock: `Rental_Income_2025.xlsx` (CLEAN) and `Office_Lease.docx` (FAILED); confirm answers `FILE_PASSWORD_PROTECTED` or `FILE_HAS_MACROS` for an .xlsx or .docx named with "password" or "macro";
  - tests: the types, the helpers, both codes through both clients; the web mock and `uploadFile()` were also run once in Node against the zod schemas (scratch, not committed: apps/web has no unit test runner).
- 2026-10-08, review fixes on the same branch:
  - requests: a request whose newest file comes back INFECTED or FAILED is REQUESTED again, and accept needs a CLEAN newest file (409 `SCAN_PENDING`); both are in Open as defaults; in the mock, request 2 is REQUESTED again (`1099-INT_2025.pdf`, FAILED), request 5's accept answers `SCAN_PENDING` (`1099-NEC_2025.pdf` is still being checked), and `Tax_Organizer_2025.pdf` is a FAILED file the firm shared;
  - error words: `DOCUMENT_ERRORS` (every code) and `PORTAL_BLOCKED_TEXT` (by source; a file the firm shared says "Ask your firm to share it again.") in `@firmivra/types`; `uploadFile()` refuses with `FILE_TYPE_NOT_ALLOWED`, `FILE_EMPTY` or `FILE_TOO_LARGE` instead of `VALIDATION_FAILED`, and its doc says to use `errorMessage(error, DOCUMENT_ERRORS)`;
  - the yaml: the Excel and Word checks in order (macros before the main part, so a renamed .xlsm is `FILE_HAS_MACROS`), the inflate cap counted on the output, methods 0 and 8, names without case and no duplicates, no DTDs, a bounded CFB walk; GuardDuty's `statusReasons` (`UNSUPPORTED_STORAGE_CLASS` is our side), results only through EventBridge and SQS, the rescan with `SendObjectMalwareScan`; the role as in AWS's template and the validation object; active content and password PDFs in Open; three response descriptions quoted (an unquoted comma had made a stray key);
  - Needs from others: R0's trigger to ACTIVE for client uploads, and the error words for N05 and F07.
