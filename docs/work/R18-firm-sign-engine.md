# R18: Firm Sign engine (Oct 9)

**Goal:** Firm Sign's signing engine as library code with unit tests: PDF inspect, compose, stamp, flatten and certificate pages; the esign store; signer security (signature PNG checks, link tokens, code HMAC, sealed signer cookie); the pure readiness, routing and timing rules; and the events recorder. A cloud thread split off R13-api (its step 5 and the pure rules of its step 7) so both chains run at the same time. R13-api calls the engine through `engine.types.ts` and imports `EsignEngineModule` into its `EsignModule`.

**Owned paths (change only these):**
- `apps/api/src/esign/engine/**`, including a Noto Sans TTF (OFL) and its license under `esign/engine/fonts/`
- `apps/api/test/unit/esign-engine-*.test.ts`
- `docs/work/R18-firm-sign-engine.md`
- my dependency lines in `apps/api/package.json` and `pnpm-lock.yaml`: pdf-lib 1.17.1 and @pdf-lib/fontkit

**Not mine:** the rest of `apps/api/src/esign/**` and `packages/types/src/esign/**` (R13-api), `apps/api/src/app.module.ts`, storage, auth, audit and notify (imported, never edited), `nest-cli.json` and the Dockerfile, apps/web, packages/ui, packages/db, infra and `.github`.

**Read first:** CLAUDE.md, docs/work/README.md, apps/api/README.md, `docs/work/R13-esign-api.md` (step 5, "Decisions in contract 1"), contract 1 in `packages/types/src/esign/`, the Firm Sign area plan and spec sections 4, 11, 15 and 16 (project files).

## Steps

- [x] 1. Take over the engine from R13-api; ask which step 7 rules it keeps.
- [ ] 2. Interfaces: `engine.types.ts` (PDF engine, store, PNG check, link tokens, code HMAC, signer cookie, events, rules, injection tokens).
- [ ] 3. PDF 1: pdf-lib and fontkit; inspect (refuse encrypted, unreadable, XFA, over 100 pages); compose by page plan with rotation; JPG and PNG to pages.
- [ ] 4. Store and module: esign-store on `createS3Client`, keys only under `tenant/<businessId>/esign/`, an in-memory fake, `EsignEngineModule`.
- [ ] 5. Signer security: PNG checks, link tokens, code HMAC (fv-esign-code-v1), sealed `fv_sign_{slug}` cookie.
- [ ] 6. PDF 2: stamp at field fractions in every rotation, flatten AcroForm, automatic signature pages, Noto Sans.
- [ ] 7. Rules: readiness, routing, timing.
- [ ] 8. Certificate and audit-trail pages, byte-stable.
- [ ] 9. events.service on the esign_events model (after r0_esign).

## Needs from others

- Scrum thread: the `nest-cli.json` assets entry that ships `esign/engine/fonts/*.ttf` in `dist/` (step 6).
- R13-api: `r0_esign` (esign_events) on a branch or on main, for step 9.

## Progress log

- Oct 9: started in the cloud from main (rasel/R13-api-engine was not on origin). Step 1 messages sent to R13-api and the Scrum thread. Step 2 on `rasel/R18-engine-interfaces`.
