# R13-web: Firm Sign screens

Cloud thread "Firm Sign screens". Builds every Firm Sign screen on R13-api's contract and mocks, behind the per-firm module `esign`. Brief: `/mnt/project-files/plans/briefs/R13-web.md` (project files); area plan `plans/areas/firmsign.md`.

## Read first

- `CLAUDE.md`, `docs/work/README.md`, `docs/junior/PAGE-MAP.md`, `docs/junior/GUIDE.md`
- Octavia's spec `FirmSign_Esign_Developer_Spec.pdf` and `FirmSign_Dashboard_Mockup.png` (project files, `client-info/2026-10-08-octavia/`)
- `packages/types/src/esign` as R13-api lands it

## Paths owned

- `apps/web/src/components/esign/**`
- `apps/web/src/app/firm/(workspace)/firm-sign/**`
- `apps/web/src/app/firm/(kiosk)/**`
- `apps/web/src/app/firm/(workspace)/clients/[id]/signatures/**`
- `apps/web/src/app/portal/[firmSlug]/(signing)/**`
- `apps/web/src/app/portal/[firmSlug]/(client)/signatures/**`
- `apps/web/e2e/mock/esign-*.spec.ts`, `apps/web/e2e/esign-*.spec.ts`
- `pdfjs-dist` in `apps/web/package.json`

Not mine: menu lines (Fahad, Nahid), PAGE-MAP rows (R1), `apps/api`, `packages/types` (R13-api), `packages/db`, `packages/ui` (Fahad), infra, `.github`.

## Steps

- [x] 1. pdf.js spike (Oct 8)
- [x] 2. Routes: placeholders with titles for every Firm Sign page (Oct 8, early)
- [ ] 3. PdfPages viewer and SignaturePad; FieldOverlay
- [ ] 4. Signer flow 1 and 2; dashboard
- [ ] 5. All requests; request detail; wizard steps 1-2
- [ ] 6. Wizard steps 3-4; field editor 1
- [ ] 7. Field editor 2; Signature center, client tab, settings, templates; switch to the API; mock specs
- [ ] 8. Extras (kiosk, bulk send, reports, template versions, approvals) until the Oct 14 20:00 freeze

## pdf.js spike verdict (Oct 8)

Verdict: GO with the worker. `pdfjs-dist` 6.3.289 (exact pin), legacy build, in a module worker bundled by turbopack.

- Loader: `apps/web/src/components/esign/load-pdfjs.ts`. It imports `pdfjs-dist/legacy/build/pdf.mjs` and starts `new Worker(new URL('./pdf-worker.ts', import.meta.url), { type: 'module' })`; `pdf-worker.ts` only imports the legacy worker. Turbopack emits the worker as its own chunk, loaded only on pages that open a PDF.
- Tested in Chromium with synthetic PDFs built in the browser, in `next dev` (turbopack) and in `next build` + `next start`:
  - dev, worker: 3 pages 0.4 s, 100 pages 4.5 s;
  - production, worker: 3 pages 0.8 s, 100 pages 3.3 s;
  - production, no worker (fallback): 100 pages 2.0 s.
- Legacy build, not the modern one: the modern 6.x build calls `Map.prototype.getOrInsertComputed`, which Chromium 141 does not have, so it fails in browsers people still use. The legacy build carries the polyfills.
- `isEvalSupported: false`: the option no longer exists in pdf.js 6. The eval path behind CVE-2024-4367 was removed; neither the main build nor the worker contains `eval(` or `new Function`. The version is far above 4.2.67.
- Fallback, kept in the loader: if the worker cannot start, pdf.js runs on the main thread (importing the worker module sets `globalThis.pdfjsWorker`). Fine for documents up to 100 pages.
- Later: when R8 adds a Content-Security-Policy, it needs `worker-src 'self'`.
- `pdfjs-dist` pulls the optional `@napi-rs/canvas` (Node only) into the lockfile; the browser never loads it.

## Needs from others

- R13-api: `packages/types/src/esign` contract and mocks (`api.esign`, `api.signing(slug)`, `api.mySignatures(slug)`).
- Fahad: "Firm Sign" in the firm menu; the Send for Signature button and Signatures tab link on the client record (F06).
- Nahid: "Signatures" in the portal menu.
- R1: PAGE-MAP rows for the Firm Sign pages.
- Rasel: OK from Octavia before `FirmSign_Dashboard_Mockup.png` goes into the public repo.

## Progress log

- 2026-10-08: pdf.js spike done, verdict above (loader on branch `rasel/R13-web-pdf-spike`, goes in with the PdfPages viewer PR).
- 2026-10-08: routes PR: 14 placeholder pages with tab titles, the kiosk layout (signed in, no menu), the signer layout (firm name, no account), noindex on signer and kiosk pages, `e2e/mock/esign-routes.spec.ts` (15 tests green locally).
