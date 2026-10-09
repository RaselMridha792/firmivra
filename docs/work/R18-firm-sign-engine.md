# R18: Firm Sign engine (Oct 9)

**Goal:** Firm Sign's signing engine as library code with unit tests: PDF inspect, compose, stamp, flatten and certificate pages; the esign store; signer security (signature PNG checks, link tokens, code HMAC, sealed signer cookie); the pure readiness, routing and timing rules; and the events recorder. A cloud thread split off R13-api (its step 5 and the pure rules of its step 7) so both chains run at the same time. R13-api calls the engine through `engine.types.ts` and imports `EsignEngineModule` into its `EsignModule`.

**Owned paths (change only these):**
- `apps/api/src/esign/engine/**`, including a Noto Sans TTF (OFL) and its license under `esign/engine/fonts/`
- `apps/api/test/unit/esign-engine-*.test.ts` and their synthetic files in `esign-engine-fixtures.ts`
- `docs/work/R18-firm-sign-engine.md`
- my dependency lines in `apps/api/package.json` and `pnpm-lock.yaml`: pdf-lib 1.17.1 and @pdf-lib/fontkit

**Not mine:** the rest of `apps/api/src/esign/**` and `packages/types/src/esign/**` (R13-api), `apps/api/src/app.module.ts`, storage, auth, audit and notify (imported, never edited), `nest-cli.json` and the Dockerfile, apps/web, packages/ui, packages/db, infra and `.github`.

**Read first:** CLAUDE.md, docs/work/README.md, apps/api/README.md, `docs/work/R13-esign-api.md` (step 5, "Decisions in contract 1"), contract 1 in `packages/types/src/esign/`, the Firm Sign area plan and spec sections 4, 11, 15 and 16 (project files).

## Steps

- [x] 1. Take over the engine from R13-api; ask which step 7 rules it keeps.
- [x] 2. Interfaces: `engine.types.ts` (PDF engine, store, PNG check, link tokens, code HMAC, signer cookie, events, rules, injection tokens).
- [x] 3. PDF 1: pdf-lib and fontkit; inspect (refuse encrypted, unreadable, XFA, over 100 pages); compose by page plan with rotation; JPG and PNG to pages.
- [x] 4. Store and module: esign-store on `createS3Client`, keys only under `tenant/<businessId>/esign/`, an in-memory fake, `EsignEngineModule`.
- [x] 5. Signer security: PNG checks, link tokens, code HMAC (fv-esign-code-v1), sealed `fv_sign_{slug}` cookie.
- [x] 6. PDF 2: stamp at field fractions in every rotation, flatten AcroForm, automatic signature pages, Noto Sans.
- [x] 7. Rules: readiness, routing, timing.
- [x] 8. Certificate and audit-trail pages, byte-stable.
- [ ] 9. events.service on the esign_events model (after r0_esign).

## Needs from others

- R13-api: `r0_esign` (esign_events) on a branch or on main, for step 9.

## Progress log

- Oct 9: started in the cloud from main (rasel/R13-api-engine was not on origin). Step 1 messages sent to R13-api and the Scrum thread. Step 2 on `rasel/R18-engine-interfaces`.
- Oct 9: #161 interfaces. Step 3 (pdf-lib 1.17.1, fontkit; `pdf-compose.ts` inspect and compose) on `rasel/R18-pdf-inspect-compose`, stacked on #161. Page sizes are as shown with the page's own /Rotate (what the viewer shows at plan rotation 0); an image page fits US Letter.
- Oct 9: #163 PDF 1. Step 4 (`esign-store.ts`: S3 store reusing `S3DocumentStorage`, `MemoryEsignStore`, key checks; `engine.module.ts`) on `rasel/R18-store-module`, stacked on #163. The module grows a provider per step.
- Oct 9: #166 store and module. Step 5 (`signer-security.ts`: PNG check, link tokens, code HMAC with LOCAL code 000000 under AUTH_MODE=local, sealed signer cookie with HKDF label fv-esign-signer-v1) on `rasel/R18-signer-security`, stacked on #166.
- Oct 9: #167 signer security. Step 6 (`pdf-finalize.ts`: flatten, stamp in every rotation and offset MediaBox, signature pages) on `rasel/R18-pdf-finalize`, stacked on #167. Font: Noto Sans Regular from notofonts/latin-greek-cyrillic release NotoSans-v2.015 (unhinted/ttf), SHA-256 f3961a9cde016d41a4879aecda1474d3a36d6bf54fa0e4643de029cc2248b0e8; OFL.txt SHA-256 cee9892f9f0cc8fe882c9e9537ee6a89621d86ee7ceaf70b02e2b2b1c25c061a. Embedded whole: pdf-lib 1.17's subsetter drops Noto glyphs (seen in a render). Covers Latin, Greek and Cyrillic, not Bengali or CJK. `PDF_ENGINE` is provided with the certificate (step 8).
- Oct 9: #178 PDF 2. Step 7 (`esign-rules.ts`, provided as `ESIGN_RULES`) on `rasel/R18-rules`, stacked on #178. All three rule groups built; R13-api had not said which it keeps, so it may drop any. currentTurn covers signers only (approvers act before sending).
- Oct 9: #179 rules. Step 8 (`certificate.ts`, `pdf-engine.ts` with `PDF_ENGINE` and `sha256Hex`) on `rasel/R18-certificate`, stacked on #179. Certificate metadata dates are `completedAt`, so the same input gives the same bytes.
- Oct 9: #188 certificate. #161 merged. Scrum review fixes on #161 (signature image reasons, SameSite=Strict, signer session with purpose and steps passed). Ported R13-api's hardening: image header limits, 10 MB cap and 200k objects (#163), EXIF orientation, repeated page gets its own contents; `nest-cli.json` font assets entry (allowed by the Scrum thread) and active-content stripping (#178). main merged into the stack; full API suite 1050 passed. Next: step 9 once `rasel/R0-esign` exists.
- Oct 9: second Scrum pre-review fixed: full PNG check (parsePng), page-tree walk, visible box, left-out pages cut from the packet (#163); request-folder keys, presignUpload and a richer head for R13-api (#166); code kinds in the HMAC (#167); flatten loop cap, appearance and fallback fixes, Hidden/NoView, /Next chains, '?' for missing glyphs (#178); every required field kind, IN_PERSON, no status going backwards (#179). #163-#179 merged. Next: APPROVER_MISSING after #199, step 9 after `rasel/R0-esign`.
- Oct 9 19:45 UTC: paused for the night (Rasel's card). #188 and #286 (typed signature pages, APPROVER_MISSING) merged; no open R18 PRs. Next step tomorrow: step 9, events.service on rasel/R0-esign once R13-api pushes it (ESIGN_EVENTS provider, record() in the caller's tx + AuditService.logIn with ids only, isolation test, cases file only if routes are added).
