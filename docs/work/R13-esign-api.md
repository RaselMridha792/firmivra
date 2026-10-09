# R13-api: Firm Sign API (Oct 8-18)

**Goal:** Firm Sign, our built-in e-signature module, to the full spec (Octavia's "Firm Sign Developer Specification", 28 sections), behind the per-firm module `esign`. Core first, then the extras. A cloud thread (no AWS, no Stripe, no Docker); Rasel decided the full spec on Oct 8. Go/no-go: Oct 15 at 12:00 Dhaka.

**Owned paths (change only these):**
- `apps/api/src/esign/**` (and `esign/core/` once R14's PR merges)
- `apps/api/src/common/modules/**`: the shared `@RequiresModule()` guard (R14 uses it too)
- `packages/types/src/esign/**` (and `esign/capture.ts` once R14's PR merges)
- `apps/web/src/mocks/esign.ts`, `esign-common.ts`, `esign-signing.ts` and `esign-extras.ts`, and the `esign`, `mySignatures` and `signing` lines in `apps/web/src/lib/api.ts`
- `docs/api/esign.yaml`
- `apps/api/test/unit/esign-*`, `apps/api/test/e2e/esign-*` and `apps/api/test/isolation/cases/esign.ts` (the esign cases of R21's isolation suite)
- the 9 e-sign templates in `apps/api/src/notify`
- the e-sign parts of `docs/SYSTEM-DESIGN.md`, `docs/PROJECT-DRAFT-v2.md` and `docs/AUTH-DESIGN.md`
- registration lines in `apps/api/src/app.module.ts` and `packages/types/src/index.ts`
- dependencies: pdf-lib 1.17.1, @pdf-lib/fontkit, a Noto Sans OFL TTF with its license file
- one schema draft on `rasel/R0-esign`: the esign models, the migration, `packages/db/test/esign.test.ts`, the seed additions and `packages/db/scripts/set-module.mjs` (R0 reviews)

**Not mine:** screens (R13-web), `packages/ui`, the R11, R14, R5, R7 and R16 paths, infra and `.github`.

**Read first:** CLAUDE.md, docs/work/README.md, apps/api/README.md, docs/AUTH-DESIGN.md, the spec and mockup (in the project files), the Firm Sign area plan, and in `schema.prisma` documents, document categories, engagements, clients, client accounts, memberships, verification codes and business settings.

## Steps

Target merge windows in brackets (Dhaka).

- [ ] 1. Contract 1, firm side [Oct 9 13:00]: `packages/types/src/esign/{enums,errors,schemas,client}.ts`, `api.esign` with `GET /esign/status`, `api.mySignatures(slug).status()`, `docs/api/esign.yaml`, `apps/web/src/mocks/esign.ts` (the mockup's rows and counters, a generated 2-page sample PDF).
- [ ] 2. Contract 2, core [Oct 9 21:00]: signer routes (`api.signing(slug)`), the portal Signature center (`api.mySignatures(slug)`), settings and consent versions, templates (save as, use); a mock for every signer step; `SignatureMethod` from db-enums and `SignatureCaptureInput` from `esign/capture.ts`. Contract 3, extras [Oct 10 21:00]: in-person, approvals and roles, template versions, bulk send, reports, remaining field types.
- [ ] 3. Schema request issue, then the `r0_esign` draft on `rasel/R0-esign` with Rasel's changes and the module switch (`app_set_business_module`, `set-module.mjs`, runbook text for R0). Opens after `r0_intake_engine` merges [Oct 10 13:00]. Later schema fixes go to R0 as one list by Oct 12 20:00.
- [ ] 4. Docs PR [Oct 10 13:00]: SYSTEM-DESIGN and PROJECT-DRAFT-v2 move to the built-in Firm Sign (no `POST /webhooks/esign`), the scan exception and the module switch; AUTH-DESIGN gets the `fv_sign_{slug}` cookie, the copy link and the kiosk password check.
- [ ] 5. Moved to R18 (Firm Sign engine) on Oct 9; I wire `EsignEngineModule` in. Was: engine 1 [Oct 10 13:00]: `esign/engine/pdf.service` (inspect, compose by page plan with rotation, images to pages, stamp, flatten). Engine 2 [Oct 10 21:00]: PNG checks, link tokens, code HMAC, sealed signer cookie, events service, esign-store with an in-memory fake, certificate and audit-trail pages, `EsignEngineModule`.
- [ ] 6. Requests API [Oct 11]: 1 [09:00] the `@RequiresModule('esign')` guard, status, drafts, files, page plan, recipients; 2 [17:00] fields, merge values, readiness; 3 [21:00] list, counters, detail, events, access rules; the esign scan handler with R1's router.
- [ ] 7. Oct 12: emails [09:00]; send [13:00]; signer routes 1 [21:00].
- [ ] 8. Oct 13: signer routes 2 [09:00]; completion and filing [17:00]; lifecycle [21:00].
- [ ] 9. Oct 14: settings, consent versions and the job runner [09:00]; Signature center API and templates [17:00].
- [ ] 10. Extras after core, in reverse cut order (approvals and roles, template versions, in-person, bulk send, reports). Oct 14 20:00 freeze; Oct 15 go/no-go list for Rasel; Oct 15-18 fixes.

## Rules

- CLAUDE.md's hard rules. Every API PR carries a cross-firm 404, a cross-client 404 and, for signer routes, wrong-slug, expired and used token tests.
- PRs from fresh `main` or stacked on my one open PR; under 400 changed lines of code (contracts exempt, one at a time); at most 2 open non-contract PRs; `/code-review high` first. Merge `main`, never rebase or force-push. Branches `rasel/R13-api-<name>`, titles `<type>: <what> (R13)`.

## Decisions in contract 1

- Firm routes live at `/api/v1/esign/...`; `GET /esign/status` never answers MODULE_OFF. The portal's `GET /portal/{slug}/me/signatures/status` lets Nahid show 'Signatures' before contract 2.
- `myEsignRole` is OWNER, ADMIN, MANAGER, STAFF or VIEWER (null when off). MANAGER and VIEWER arrive with the roles contract.
- The 17 merge keys are the spec's 15 plus Staff Email and Staff Phone (spec section 5 lists them for the sender).
- The page viewer reads a file's bytes from `GET .../documents/{documentId}/content` on the same site, so no bucket CORS is needed. CLEAN files only.
- Delivered folds into Sent: the counters' SENT includes DELIVERED, and `ESIGN_STATUS_LABELS` shows "Sent".
- Quick filters: Expiring Soon is 3 days, Recently Completed 30 days.
- Files: PDF, JPG and PNG only; Word files are saved as PDF first (the mockup's tile says "PDF, Word, and more"; Rasel and Octavia to note).
- Off is never an error on the status routes: `GET /esign/status` and `GET /portal/{slug}/me/signatures/status` answer `enabled: false`; the mock shows it with `NEXT_PUBLIC_API_MOCK_ESIGN=off`.
- From-vault may pick any of the client's documents the caller can see, INTERNAL ones too.
- Merge values give the client's values only while the caller may still see the client; otherwise they are null and flagged missing.
- Rows carry `allowedActions` for the Actions menu; events carry `authMethod`.

## Decisions in contract 2

- Signers: one `SignerState` with a `step` (VERIFY_EMAIL, VERIFY_ACCESS_CODE, CONSENT, SIGN, WAITING, DONE, DECLINED, CLOSED, COPY); a call out of order answers 409 WRONG_STEP. The packet comes from `GET .../sign/packet` (same-site, read with the cookie).
- Signatures: TYPED is R14's `SignatureCaptureInput` (the typed signature matches the printed name); DRAWN and UPLOADED add a base64 PNG (at most 200 KB; the API checks 1600x600). Initials are typed (1 to 10 characters) or an image.
- Signature center rows are keyed by the recipient (the client's login on that request), at `/portal/{slug}/me/signatures`.
- Templates (contract 2): save as template, use, list, get, rename, archive; FIRM or PRIVATE. Roles CLIENT, SPOUSE (when the client has that login) and PREPARER fill themselves on use; the others need `roles[].who` (409 TEMPLATE_ROLES_UNFILLED). Versions and duplicate come in contract 3.
- Settings: Owner and Admin change the defaults and publish consent versions; any member sets their own job title (`PUT /esign/me/profile`).

## Decisions in contract 3

- Approvers: a STAFF recipient who is an Owner, Admin or Manager and not the sender (409 APPROVER_NOT_ALLOWED). If the last approval's send fails, the approvals stand and the request stays a DRAFT; any edit to a DRAFT clears its approvals.
- Approvals: `submitForApproval` moves a DRAFT whose only readiness problem is APPROVAL_PENDING to NEEDS_APPROVAL; each APPROVER recipient decides with `decideApproval`. The last approval sends it at once in the sender's name; a rejection (a note is required) puts it back to DRAFT and clears the approvals. Notes are staff only. Signing Settings' `requireApproval` adds the readiness problem APPROVER_MISSING.
- Roles: Owner and Admin keep their access; a Staff member can be made MANAGER (sees what Staff sees, approves, manages every FIRM template) or VIEWER (reads only) by an Owner or Admin (`PUT /esign/roles/{userId}`).
- Template versions: using a template copies its newest version and records `template: {id, version}` on the request; `save-as-version` and `restore` add a version, nothing is overwritten. Duplicate starts again at version 1, with the source's visibility unless given.
- In person: a signer with delivery IN_PERSON signs on the staff member's device. `inPerson.start` gives a fresh one-time portal link (15 minutes to start) and locks the staff session (every other firm route answers 403 KIOSK_LOCKED) until `inPerson.exit` with the staff password; 5 wrong passwords sign the staff member out, and so do ESIGN_KIOSK_IDLE_MINUTES (15) idle. `signingUrl` is absolute on the portal site; the mock link is MOCK_SIGNING_TOKENS.inPerson. KIOSK_LOCKED also has words in apps/web/src/lib/errors.ts. Events record IN_PERSON_STARTED and IN_PERSON_ENDED; the signer's auth method is IN_PERSON.
- Bulk send: from a template, one separate request per client (at most 200), sent by the job runner; a client whose request can't be sent stays a DRAFT and the batch row names the problem.
- Reports: by the day sent, at most a year, with totals and activity by sender; Managers, Staff and Viewers count only the requests they may open.
- Bulk rows name their problem as a readiness or error code; ESIGN_READINESS_TEXT gives words for every readiness code. The client checks BULK_LIMIT before sending.
- Storage the r0_esign draft needs for contract 3 (kiosk lock per staff session, approval notes, template versions, bulk batches) is listed on issue #156.

## Needs from others

- R13-web: builds on `api.esign` and `mocks/esign.ts` (`NEXT_PUBLIC_API_MOCK=esign,mySignatures,signing`).
- Fahad and Nahid: menu lines read `api.esign.status()` and `api.mySignatures(slug).status()`.
- R18: `EsignStore` has no presigned PUT (`presignUpload`) and its `head` gives no Content-Encoding, which the upload ticket and confirm (parts 1d and 1e) need; until then those parts presign with R5's `S3DocumentStorage`. `EsignEngineModule` (R18, #166) is on main: `EsignModule` imports it for `CODE_HASHER` and `ESIGN_STORE` from part 1b on.
- R0 (r0_esign): the module switch is `business_settings.enabled_modules`, which is already on main (SYSTEM-DESIGN, "Module switch"); `PrismaBusinessModules` reads it, so no new column is needed. r0_esign only adds the lock (`app_set_business_module`). No firm lists 'esign' yet, so Firm Sign stays off.
- Everyone: nobody sets `enabled_modules` to include 'esign' by hand before r0_esign lands. Today the app role can still UPDATE it, and switched on now, the draft routes (part 1b) answer 500 from the not-migrated repository. Once r0_esign's trigger lands, the e2e setups (`esign-status.e2e.test.ts` and `esign-requests.e2e.test.ts`, where they switch the module on) must call `app_set_business_module` instead.

## Progress log

- Oct 8: started in the cloud. Contract 1 on `rasel/R13-api-contract-firm` (#135); Scrum pre-review fixes applied the same evening.
- Oct 9: docs PR (step 4) on rasel/R13-api-docs (#157, merged). Contract 2 is #185 (stacked on R14's #155). The engine moved to R18 (Rasel's card, 09:15 UTC); my engine 1 branch went to them. Contract 3 on rasel/R13-api-contract-extras, stacked on #185.
- Oct 9: requests API 1 on rasel/R13-api-requests-1 (stacked on contract 3, R18's engine interfaces merged in): `@RequiresModule()` and `ModuleGuard` in common/modules (reading `business_settings.enabled_modules`) and `GET /esign/status`, with an AppModule e2e test. Drafts (part 1b), page plan and recipients (part 1c) and files (parts 1d and 1e) follow, behind the `EsignRepository` and `EsignDirectory` ports.
- Oct 9: requests API 1b on rasel/R13-api-requests-1b (#224): drafts (`POST/GET/PATCH/DELETE /esign/requests[/:id]`) behind `@RequiresModule('esign')`, `EsignRepository` and `EsignDirectory` with in-memory fakes, approvers read only, the draft routes as module-off isolation cases. Pre-review round 2: a failed discard audit no longer answers 500 or orphans files.
- Oct 9: requests API 1c on rasel/R13-api-requests-1c (#225): `PUT .../page-plan` and `PUT .../recipients` (optimistic on `lastActivityAt`). Pre-review round 2: page plan and recipients writes return the record as written, a kept recipient id keeps its access code only for the same member or login (compared by type and id), and the repository doc says each write moves `lastActivityAt` strictly forward. With #248 on main, `POST /esign/requests` (its body names clientId and engagementId) joins the module-off isolation cases.
