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
- [x] 2. Presigned PUT for upload with content type and size limits; keys under tenant/{businessId}/... (the `documents.s3_key` CHECK and the API's IAM policy require this prefix) (API part 1)
- [x] 3. Confirm upload: check size and type server side, store the document record (Oct 8: Excel and Word must be a real Office Open XML package without macros or a password; the yaml's "Excel and Word (confirm)") (API part 1; the portal's confirm in part 2)
- [ ] 4. Presigned GET for download, short expiry, only after the firm-scope check (firm side done in API part 1; portal in part 2)
- [ ] 5. KMS encryption on every object; per-business key context (today: the bucket's default SSE-KMS with the documents key; per-firm keys need their own IAM statement, see "Infra needs")
- [ ] 6. Audit uploads, downloads and deletes (no delete routes at launch, Oct 8); e2e test that firm B can't fetch firm A's file
- [ ] 7. Plus I05 (Oct 6): document categories and document requests (Requested, Received, Accepted, Missing with a reason); the browser upload helper `uploadFile()` in apps/web/src/lib; Begin Online draft uploads with R11. Contract by Oct 9 (Nahid N05, Fahad F07) (categories, requests and `uploadFile()` done in parts 1 and 2; Begin Online with R11 left)
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

## Decisions (Oct 8, API part 1)

- Household logins (Rasel, q12): PRIMARY and SPOUSE logins have the same access. AUTHORIZED sees only MINE (its own uploads); source FIRM is empty for it; it may upload only for an open request (403 without a `requestId`), never sees INTERNAL, and never answers "I don't have this" (403). Uploads record the login (`uploaded_by_user_id`, and the client account in the sealed token and the audit); portal items carry the uploader's name (`MyDocument.uploadedBy`, a contract change that ships with part 2).
- Scan (the lead's idea): `SCAN_MODE=local` marks a confirmed file CLEAN at once and is refused by the settings check unless `NODE_ENV` is development or test (like `AUTH_MODE=local`), or (Oct 8, agreed with the lead in the #118 review) `NODE_ENV` is production and `APP_ENV` is exactly `dev`; `SCAN_MODE=guardduty` leaves it PENDING for GuardDuty's result event (its consumer comes with the infra). The default is `guardduty` everywhere, so a missing value never skips the scan; local development sets `SCAN_MODE=local` in `.env` (`.env.example` has it).
- Encryption: objects take the bucket's default SSE-KMS (the documents key); the presigned PUT signs only Content-Type, Content-Length and the SHA-256 checksum. Per-firm keys for S3 need their own IAM statement first: S3's encryption context is `aws:s3:arn`, not the firm, so the statement has to tie each firm's key to its `tenant/{businessId}/` prefix (see "Infra needs").
- Confirm reads the whole object (at most 10 MB, in memory), computes its SHA-256 itself and runs the yaml's checks in order; every refusal deletes the object and is audited (`document.upload_refused`, ids and the code only), the transaction's refusals after the ticket too (404, `NO_OPEN_SERVICE`, `CATEGORY_ARCHIVED`). One confirm of a key at a time (a transaction advisory lock on the key; a second one finds the document, 410, or the refusal, 409 `UPLOAD_MISMATCH`), so a refusal never deletes a saved document's file. A storage failure (a 403 from KMS on the read, an S3 503, a timeout) is a 503 `SERVICE_UNAVAILABLE` with Retry-After and deletes nothing (#118 review). Downloads re-check the stored size, S3's checksum and that no Content-Encoding is set before signing the GET (no version id yet).
- Uploads lock the client row FOR SHARE first (the #108 review's order: client, then engagement; then the request in part 2), so a reassignment or an archive waits for the upload or is seen by it. An archived client has no open service: 409 `NO_OPEN_SERVICE` on the ticket and on confirm (a default; see "Open").
- The upload token is a sealed JWE (15 minutes: a slow 10 MB PUT that starts near the end of its 4-minute URL can run until the browser's 10-minute timeout; confirm looks back 30 minutes for an earlier refusal) bound to the firm, the uploader (user, side, client account), the client, service, category, direction, key, size and SHA-256 (the request comes with part 2); the unique `s3_key` makes confirm single use (410 `UPLOAD_EXPIRED`).
- Error messages are the contract's `DOCUMENT_ERRORS` words.
- Contract fixes (small, for the API): `DocumentCategoryList` gets its type; `UploadTicket` says Content-Length is also signed and what `expiresAt` means.

## Decisions (Oct 8, the #118 review)

- Storage failures are 503 `SERVICE_UNAVAILABLE` with `retryAfter: 5` (the global filter sends Retry-After), as R4's submit answers 503: every S3 call in `UploadsService` goes through one wrapper that turns any error that is not ours (S3 503 SlowDown, a timeout, a 403 from KMS) into it and logs only the operation, the error's name and its HTTP status. "No such object" stays a 409 (confirm) or `FILE_BLOCKED` (download). Nothing is deleted on a 503.
- Checksum mode only for downloads: confirm's HEAD asks for the size and Content-Encoding only (it hashes the bytes itself), so a missing kms:Decrypt can't make a good upload look missing. A download's HEAD asks for S3's checksum; a 403 then is checked with a plain HEAD: no object is `FILE_BLOCKED`, an object we can't decrypt is 503.
- Content-Encoding: the presigned PUT signs no Content-Encoding, so a repeated PUT could add one and change what a browser saves. `head()` returns it; confirm refuses a set one (409 `UPLOAD_MISMATCH`, deleted, audited) and a download answers 409 `FILE_BLOCKED`. The presigned GET also signs `response-content-encoding=identity` and `response-cache-control=private, no-store`, so an encoding stored after the download's HEAD never reaches the browser (second pass).
- Refusals and the lock: every refusal (the byte checks and the transaction's 404 and 409s) goes through `refuse`: a short transaction takes the key's advisory lock, finds no document with the key (else 410 and nothing deleted or audited), writes `document.upload_refused` and commits; only then is the object deleted, outside any lock. Confirm's transaction, under the same lock, looks for that audit row (within 15 minutes; tickets live 5) and refuses with 409 `UPLOAD_MISMATCH` (audited too). So no S3 call runs inside a transaction: the HEAD and the read are before it, the delete after it. The audit row is the only mark the schema allows today; a column on an upload table would be R0's.
- At most 4 confirms check a file at once in a process (`CHECKS_AT_ONCE`; each holds up to 10 MB, the task has 512 MiB); one more is 503 at once (no queue) and deletes nothing. Streaming the SHA-256 and ranged reads would lower the memory, but the Office checks read the central directory anywhere in the file; kept for later.
- Timeouts like notify's `AWS_CLIENT` (#113): 3 s to connect, 5 s for the headers, `throwOnRequestTimeout`, 2 attempts (`S3_TIMEOUTS`). The SDK's `requestTimeout` stops when the headers arrive, so a longer one would not cover a 10 MB body: a GET has its own 30 s deadline that also stops its body.
- The category is read FOR SHARE in `findTarget` (lock order: client, engagement, category), so an archive waits for an upload or is seen by it. `document.uploaded` is written in the confirm's transaction (`audit.logIn`).
- Office files: `vbaProject` and `vbaData` part names are checked right after the central directory, before `[Content_Types].xml`, so a macro file is always `FILE_HAS_MACROS`. The ZIP read also refuses entry names with NUL or control characters, a ZIP64 locator or end record that disagrees with the ZIP64 record, an end record whose comment does not finish at the end of the file, and NUL or an encoding other than UTF-8 or UTF-16 in `[Content_Types].xml`. A file with no end record at all is `UPLOAD_MISMATCH` (never read from offset -1, whose fields would be the uploader's first local header).
- Search terms (both list queries) and file names refuse control characters and lone surrogates (400 `VALIDATION_FAILED`; Postgres refuses NUL). R2 will move every search filter to one shared rule later.
- SCAN_MODE on the dev environment: `SCAN_MODE=local` is allowed in production only with `APP_ENV` exactly `dev` (not `DEV`, not empty, not unset; prod and staging refused). Rasel (Oct 9): no `SCAN_MODE=local` on dev. Dev uploads stay PENDING ("checking") until GuardDuty is live there (R1's step 19).

## API part 2 (built Oct 8; opened Oct 9 as three stacked PRs: the request routes, the portal routes, the scan results)

- The portal routes (`my-documents.controller.ts`, `my-documents.service.ts`): list (MINE and FIRM, newest first or by name, cursor pages, the source's years), get, download (only CLEAN; `FILE_BLOCKED` in `PORTAL_BLOCKED_TEXT[source]` words, with the firm side's size, checksum and Content-Encoding checks), categories (active), upload-targets (ACTIVE services with their open requests; empty is the STOP state, also for an archived or unlinked client), uploads and confirm (part 1's flow, the token bound to the client account), with the household rules (q12). `MyDocument.uploadedBy` in the contract and the mock (its own commit, for the contract PR).
- The request routes (`document-requests.service.ts`): the firm's list (per client), create (with the `document.requested` email), accept, reject and cancel; the portal's list and "I don't have this".
- The request path of confirm: `requestId` in the sealed claim, the request locked FOR UPDATE after the client, the engagement and the category, `REQUEST_CLOSED` in `findTarget`, the request SUBMITTED in confirm's transaction with `document_request.submitted`.
- `ScanResultsService.recordScanResult` (`scan-results.service.ts`) for the future GuardDuty handler: q22 (newest file INFECTED or FAILED puts a SUBMITTED request back to REQUESTED) and q24 (a password-protected PDF accepted unscanned).
- What part 2 leaves: the GuardDuty result handler itself (the SQS consumer, with the infra); the "not scanned" field on the firm's document (needs an R0 column, see "Needs from others"); the bell for a new request (R6's in-app notifications); Begin Online uploads (R11); a request's upload does not take the request's category unless the client names one (as the mock does).

## Decisions (Rasel, Oct 8 evening: q22 to q24)

- q22: keep both #91 defaults. A request whose newest file comes back `INFECTED` or `FAILED` goes back to `REQUESTED`, so the client uploads again for it, and the firm accepts only a `CLEAN` newest file (409 `SCAN_PENDING` while it is being checked). A `BLOCKED` file the firm shared shows "This file couldn't be checked. Ask your firm to share it again." (`PORTAL_BLOCKED_TEXT.FIRM`).
- q23: Word and Excel files with active content other than macros are accepted: links to outside templates, objects or pictures, embedded OLE objects, ActiveX controls, altChunk imports and DDE fields. Only macro files stay refused (409 `FILE_HAS_MACROS`). The code already does this.
- q24: password-protected PDFs are accepted unscanned: the firm can still download them and accept their requests. Confirm already stores them (it checks a PDF's magic bytes only). When the GuardDuty result handler is built, `UNSUPPORTED` with `PASSWORD_PROTECTED` on a PDF is not `FAILED`: the file becomes downloadable, the reason is audited, and the firm's document shows it was not scanned (a contract field added with the handler).

## Decisions (Oct 8, API part 2; defaults until Rasel says otherwise)

- `MyDocument.uploadedBy` is `{ name }` of the household login on a MINE file and null on the firm's files (no staff names in the portal) or a file without a known uploader.
- An AUTHORIZED login's `upload-targets` lists only services with an open request (it may upload only for one), and its request list only open requests.
- "Request a document" emails every ACTIVE portal login of the client, AUTHORIZED ones too (they may answer it); the email has the title, the due date and a link only.
- A new answer clears the old `statusNote` (SUBMITTED, ACCEPTED, and REQUESTED again after a blocked file); a cancel keeps it.
- "I don't have this" takes any open request, also one of a service that is no longer open (an answer needs no upload), but not from an archived client (409 `NO_OPEN_SERVICE`, as its uploads; the part 2 review). It leaves `resolvedAt` empty, as the mock does.
- A portal upload's tax year defaults to its service's (the mock does the same); the firm's stays as given.
- Scan results: a result on a document that is no longer PENDING, or a key that isn't `tenant/{uuid}/documents/{uuid}`, is ignored (`IGNORED`: delete the message); a documents key with no document yet is `UNKNOWN` (logged with the upload id; the confirm can come up to 15 minutes after the PUT): the handler keeps the message for redelivery, then dead-letters it to the alarm; UNSUPPORTED counts as FAILED only for the file reasons in the yaml, and as "accepted unscanned" only when a PDF's only file reason is PASSWORD_PROTECTED.

## Decisions (Rasel, Oct 9)

- Part 2 opens as three stacked PRs, in this order: the request routes, then the portal routes with the household rules, then the scan results. No waiting for merge windows: the backend is finished today.
- No `SCAN_MODE=local` bypass on dev: dev uploads stay "checking" until GuardDuty is live (R1's step 19, live by Oct 11 20:00).
- From Oct 9 the Scrum thread merges every PR that passes its pre-review and CI; infra, `.github` and AWS stay with Rasel.

## Open (Rasel)

- From the part 1 review (Oct 8), a default until Rasel says otherwise: an archived client takes no uploads (409 `NO_OPEN_SERVICE`; the documents contract has no `CLIENT_ARCHIVED`); its documents still list and download.
- Answered since: the household logins (q12, Oct 8), the #91 defaults (q22), active content without macros (q23) and password-protected PDFs (q24); see the Decisions above.

## For the API steps (#75 review, Oct 7)

The rules are in docs/api/documents.yaml, "Rules for the API":
- a sealed, bound `uploadToken` (15 minutes);
- signed `Content-Type`, `Content-Length`, checksum and SSE headers, with a unit test of the presigned URL, since s3mock doesn't check signatures;
- confirm re-reads the object and deletes a mismatch;
- the unique `s3_key` makes confirm single use;
- downloads pin the confirmed version or re-check the checksum;
- presigned GET as an attachment with an RFC 5987 name and the stored type, every link audited;
- views audited;
- the per-firm KMS key is pending (one bucket key today);
- a lifecycle rule for unconfirmed objects;
- (Oct 8) confirm's Excel and Word checks, in order: an OLE2/CFB file with an `EncryptedPackage` stream is `FILE_PASSWORD_PROTECTED` (a bounded directory walk); the ZIP central directory read in memory with caps (names without case, no duplicates, methods 0 and 8 only); `[Content_Types].xml` inflated with the cap counted on the output and parsed without DTDs; macros first (`vbaProject` or `vbaData` parts, macro-enabled content types, so a renamed .xlsm is `FILE_HAS_MACROS`), then the declared type's main part; never unpack to disk; every refusal deletes the object;
- (Oct 8) GuardDuty's results come only through EventBridge and an SQS queue the API reads (no public route), matched by S3 key: `NO_THREATS_FOUND` is CLEAN, `THREATS_FOUND` INFECTED, `UNSUPPORTED` for a reason in the file itself FAILED (the reason audited), except `PASSWORD_PROTECTED` on a PDF, which is accepted unscanned (q24); `UNSUPPORTED_STORAGE_CLASS`, `ACCESS_DENIED` or `FAILED` (our side) leaves it PENDING for the alarm and an on-demand rescan (`SendObjectMalwareScan` on the confirmed version); a request whose newest file ends INFECTED or FAILED is REQUESTED again.

Infra for these needs Rasel's yes first.

## Infra needs (Rasel's AWS list, each with his yes first)

- GuardDuty Malware Protection for S3 on the documents bucket (Oct 8).
- Its scan-result event: an EventBridge rule to an SQS queue the API reads with its IAM role (never a public route), which sets the document's `scan_status` (Oct 8).
- The alarm for a scan that breaks on our side; the rescan is GuardDuty's on-demand scan (`SendObjectMalwareScan`), never a rewrite of the object (Oct 8).
- `kms:Decrypt` for GuardDuty's role on the documents key and each per-firm key (Oct 8). AWS's role template also has `kms:GenerateDataKey` (both through S3, `kms:ViaService`) and `s3:PutObject` on `malware-protection-resource-validation-object`, for the test object it puts in an SSE-KMS bucket; without them the plan stays in WARNING (`INSUFFICIENT_TEST_OBJECT_PERMISSIONS`).
- KMS access for the API on the firms' own keys (tag conditioned), `s3:GetObjectVersion` if downloads pin versions, expiry for unconfirmed uploads (see "Needs from others"), and a bucket policy that refuses a PutObject without `aws:kms` (Oct 7). That policy must let GuardDuty's validation object through.
- Until GuardDuty is deployed, new uploads on dev stay "checking" (`PENDING`).

## Needs from others

- R0 (a schema request with the `schema` label): a column that marks a document accepted unscanned (q24), for example `documents.scan_note` or `unscanned boolean`, so the firm's document can show "not scanned" (a `FirmDocument` field then). Today the mark is only in the `document.scanned` audit entry (`unscanned: true`).
- R6: the bell (in-app notification) for a new document request, once R6's notifications land; the email is sent today.
- Infra and R5: the GuardDuty result handler (EventBridge to SQS, read with the API role) that calls `ScanResultsService.recordScanResult`. It deletes the message on every outcome but `UNKNOWN` (no document yet), which stays for redelivery: a visibility timeout and max receive count that cover 30 minutes, then a dead-letter queue with an alarm.

- R0 or R4 (approve): a new firm gets the default document categories (Tax Documents, Business Documents, Identification). Today only `packages/db/prisma/seed.ts` creates them, so a firm made by approve, and LVP on dev, have none and every upload goes without a category (Rasel to choose who; a one-off for LVP on dev). From the cloud review of #118.

- R0 (CI, `.github/workflows/ci.yml`): an s3mock service like docker-compose.yml's, so `test/unit/documents.test.ts`'s S3 round trip runs in CI too (it is skipped when s3mock is not running; the e2e tests use an in-memory storage).
- Infra (Rasel's AWS list): expiry for uploads that are PUT but never confirmed (a closed tab between the PUT and the confirm). Confirmed and unconfirmed files share `tenant/{businessId}/documents/` and no lifecycle rule can tell them apart, so today such a file stays for good, with no document row, audit entry or retention date. Proposal: the API role gets `s3:PutObjectTagging` and `s3:DeleteObjectTagging` on `tenant/*`, and a lifecycle rule filtered on the tag `state=unconfirmed` expires current objects after 1 day; then R5 signs `x-amz-tagging: state=unconfirmed` on the PUT and confirm removes the tag (s3mock first). Noncurrent versions already expire after 30 days (data stack), so the API's deletes need nothing more. Per-firm KMS keys for S3 need an IAM statement that ties each key to its firm's prefix (S3's encryption context is `aws:s3:arn`).
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
- 2026-10-08, API part 1 (steps 2 to 4 for the firm; branch `rasel/R5-documents-api`), in `apps/api/src/storage/`:
  - the S3 adapter (`document-storage.ts`): s3mock locally (S3_ENDPOINT, path-style) and the task role in AWS; presigned PUT signing Content-Type, Content-Length and the checksum, 4 minutes; HEAD with the checksum; GetObject; delete; presigned GET as an attachment with an RFC 5987 name and the stored type, 5 minutes;
  - settings (`config.ts`): the bucket, s3mock settings refused in production, `SCAN_MODE`;
  - confirm's checks (`file-checks.ts`): magic bytes for PDF, JPG and PNG; for Excel and Word the bounded CFB walk (`FILE_PASSWORD_PROTECTED`), the central directory under caps, `[Content_Types].xml` inflated with the 1 MB cap on the output and no DTDs or other entities, macros before the main part;
  - the firm's routes: list (service, category, tax year, direction, search, cursor), get, upload ticket and confirm, download (only CLEAN; 409 `SCAN_PENDING` or `FILE_BLOCKED`), categories; Staff only their assigned clients (404);
  - audit: `document.upload_started`, `document.uploaded`, `document.upload_refused`, `documents.listed`, `document.viewed`, `document.download_link_issued`, ids only;
  - tests: `test/unit/documents.test.ts` (settings, the presigned URLs, the file checks with generated files, an s3mock round trip), `test/e2e/documents.e2e.test.ts` (every firm route, the refusals deleting the object, the token's single use and binding, SCAN_MODE, Staff, firm B never sees or downloads firm A's file); generated files in `test/office-files.ts`;
  - moved to part 2 to keep the PR near size: the portal side and the requests (see "API part 2").
- 2026-10-08, API part 1, review fixes:
  - `[Content_Types].xml` is read by a small quote-aware tokenizer instead of regexes: comments, processing instructions and CDATA skipped in document order, attribute values quoted (a `>` inside one ends no tag), XML that is not well-formed refused; macros are checked on every declaration, then a `Default` or `Override` with a prefix or another attribute is `UPLOAD_MISMATCH`. Unit tests with both of the reviewer's probes (`FILE_HAS_MACROS` now) and the malformed cases;
  - confirm deletes and audits the transaction's refusals too, under a per-key advisory lock (no file left without a document, and no refusal deleting a saved document's file); e2e: the service closed, the client reassigned or archived between the ticket and the confirm, two confirms at once;
  - `read()` maps only 404 to "no object"; a 403 after the HEAD (KMS) throws, so confirm answers 500 and deletes nothing (unit and e2e tests);
  - uploads lock the client FOR SHARE (assignment and archive read from the locked row); an archived client is `NO_OPEN_SERVICE`;
  - the request path of confirm moved to part 2 (see "API part 2");
  - docs: the yaml's "Leftovers" and the infra need now name the real gap (unconfirmed uploads) instead of noncurrent versions, which the data stack already expires.
- 2026-10-08, the lead's review of #118 (REQUEST CHANGES at 17f5836), on the same branch after merging main (2cbd51e); see "Decisions (Oct 8, the #118 review)":
  - storage failures are 503 `SERVICE_UNAVAILABLE` with Retry-After 5 and delete nothing (S3 503 on HEAD, 403 on the read, a KMS 403 on a download's checksum HEAD); e2e;
  - confirm's HEAD never asks for S3's checksum; downloads do, and a 403 there is 503 unless a plain HEAD finds no object; unit tests with a fake S3 client;
  - refusals take the key's lock, find no document, audit and commit, then delete; confirm finds an earlier refusal under the lock; e2e for both races (a confirm that saw no object while another saved; a confirm that checked the file while another refused it), with hooks in the in-memory storage;
  - at most 4 file checks at once, one more is 503 (e2e); S3 timeouts and a 30 s GET deadline (unit tests against a local server that never answers, or stops in the body);
  - Content-Encoding refused at confirm (409, deleted, audited) and at download (409 `FILE_BLOCKED`); e2e;
  - search with NUL or a control character is 400 (e2e) and lone surrogates in a search or a file name are 400 (contract tests);
  - nits: the owner clients use `TEST_CLIENT_OPTIONS`; `document.uploaded` in the transaction (e2e: the same `xmin` as the document); macro part names before the XML; the ZIP and XML hardening (unit tests with generated files); the category FOR SHARE (e2e: a confirm waits for an uncommitted archive and then refuses);
  - `SCAN_MODE=local` in production only with `APP_ENV=dev` (unit tests: prod, staging, empty, unset, DEV refused; dev allowed; development allowed); `.env.example` gets `SCAN_MODE=local` (the lead's yes, this push only);
  - docs: the yaml (503s, Content-Encoding, the ZIP rules, the lock, scan mode, the list 400s) and this file.
- 2026-10-08, two reviewers on the fix delta, on the same branch after merging main again (#122 left documents' search to this PR):
  - a file with no end record was read from offset -1 (the first local header's bytes 9 to 20, the uploader's): the `eocd < 0` guard is back; unit test with a generated file whose first bytes read as an end record;
  - the presigned GET signs `response-content-encoding=identity` and `response-cache-control=private, no-store` (unit test on the URL);
  - a race test where confirm #2 holds the key lock with its insert not committed (stopped on the client's row lock) while #1 refuses: #1 waits, then 410, the file stays; it fails with the lock removed from `refuse` or from confirm's transaction.
- 2026-10-08, #118 after the lead's review and the cloud Scrum thread's review (`7777573`, `a16f237`, and this push): every item of the lead's review with a proving test (search terms refuse `\p{Cc}` and lone surrogates; storage failures are 503 with Retry-After; HEAD asks for the checksum only for downloads; refusals take the key lock; at most 4 file checks at once; S3 timeouts and no S3 call inside a transaction; Content-Encoding refused at confirm and pinned to identity on downloads; `\p{Cs}` in file names; the nits; zip hardening); `SCAN_MODE=local` in production only when `APP_ENV=dev`; `.env.example` has `SCAN_MODE=local`. The cloud review: the upload token now lives 15 minutes (a slow PUT that starts near the URL's end no longer ends in 410 and an orphaned object), confirm looks back 30 minutes for refusals, and no S3 call runs inside the confirm transaction (so its 15-second limit holds). Rasel's q22 to q24 are written into the Decisions and the yaml.
- 2026-10-08, API part 2 (branch `rasel/R5-documents-api-part2`, stacked on #118's `rasel/R5-documents-api`; reused the WIP portal service and the saved requests service, adapted to today's part 1):
  - contract commit first (`MyDocument.uploadedBy`, its tests, the mock with a spouse's upload), for its own contract PR from main;
  - `apps/api/src/storage/`: the portal routes with the household rules, the firm's and the portal's request routes, the request path of confirm (`requestId` sealed, the request locked FOR UPDATE last, `REQUEST_CLOSED`, SUBMITTED and its audit in confirm's transaction), `lockClient` shared by both sides, `ScanResultsService.recordScanResult` (q22 reopen, q24 unscanned PDFs, our-side results left PENDING), audit of every list, view, link, upload and request change (ids and codes only);
  - tests: `test/e2e/documents-portal.e2e.test.ts` (every portal and request route; PRIMARY, SPOUSE and AUTHORIZED; the token bound to the login and the role re-checked at confirm; each request transition and 409; the reopen rule and an older file that must not reopen; q24; client A never sees or downloads client B's files or requests, firm B never firm A's, Staff never an unassigned client's, AUTHORIZED never another login's uploads; `document_request.submitted` in the document's transaction, by `xmin`);
  - the yaml: household logins, request emails, "Requests (API)" with the lock order, the built scan-result method, the portal 403s;
  - size: about 2,300 changed lines with the tests; it could split into (1) the portal routes and the request path of confirm and (2) the request routes and the scan results.
- 2026-10-08, two reviewers on part 2 (`fix: review findings (R5)`):
  - "I don't have this" from an archived client is 409 `NO_OPEN_SERVICE` after the 404s (e2e, nothing changed or audited);
  - `recordScanResult` answers `UNKNOWN` (logged with the upload id) for a documents key with no document yet, so the handler keeps a result that comes before the confirm; `IGNORED` only for a result already set or a key outside `tenant/{uuid}/documents/{uuid}` (e2e: a result before the confirm, then the redelivered one makes the file CLEAN and the request acceptable);
  - e2e: a cancelled, a marked-missing and an "I don't have this" request keep their status and note when their newest file comes back INFECTED (fails with the SUBMITTED guard removed);
  - e2e races on the request lock (another session holds the request's row until both calls wait, then lets them go): two logins confirm for one request (one 200, one 409 `REQUEST_CLOSED`, its object deleted, one `submitted` entry) and a cancel with a confirm (consistent either way); both fail with `FOR UPDATE` removed from `lockRequest`.
- 2026-10-08, contract for API part 2 (q12, household logins): `MyDocument.uploadedBy`, the household login's name on a `MINE` file; null on the firm's files (no staff names reach the portal) and on a file with no known uploader. A spouse upload in the mocks, a schema test, and the sentence in `docs/api/documents.yaml`. Split out of part 2 as its own contract PR, so the portal's My Documents can show it before the routes land.
- 2026-10-08, #118's follow-up (web kit): `ApiRequestError.retryAfter` carries a response's `Retry-After` in whole seconds (`createRequest`), and `retryWhenUnavailable(call, { signal })` calls again after each 503's wait (5 seconds without one, at most 30), up to 3 times; any other error rejects at once, and a cancel ends the wait. `uploadFile()` uses it for confirm, with the same token. Unit tests in `packages/types/test/client.test.ts` (the header forms, the waits, the cap, giving up, other errors, cancel).
- 2026-10-09, part 2 as three stacked PRs (Rasel), main merged in again. This PR (1 of 3): the firm's request routes (`document-requests.service.ts` firm side: list, create with the `document.requested` email, accept, mark missing, cancel; `lockRequest` and `toFirmRequest` in `document-records.ts`; the routes in `documents.controller.ts`), e2e for each route (a new one for the refusals before anything is submitted, then cancel and every change refused), and #118's follow-up (`uploadFile()` confirms again after a 503). The portal routes (2 of 3) and the scan results (3 of 3) follow, stacked; accept's success path is tested in 3 of 3, where a client's file and a scan result exist.
