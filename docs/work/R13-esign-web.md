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
- [ ] 3. PdfPages viewer and SignaturePad (merged in #146, Oct 9); scanned pages (PR open); FieldOverlay
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
- The Content-Security-Policy (R21) needs `worker-src 'self'` and `'wasm-unsafe-eval'` in `script-src`: without the second, the scanned-page decoders cannot compile (the viewer then warns that scanned pages may be blank).
- `pdfjs-dist` pulls the optional `@napi-rs/canvas` (Node only) into the lockfile; the browser never loads it.

## Open design points

- No questions go to Octavia (Rasel, Oct 8): build from her spec and mockups, pick defaults here and note them below; anything that looks missing is checked in `client-info/OCTAVIA-PROVIDED.md`, then with the Scrum thread. Her dashboard mockup stays in the project files, not in the public repo.

- Kiosk: the staff session stays signed in while the signer holds the device, so hiding the menu is not enough. The kiosk step needs a signer-only session from R13-api's in-person API and a way back to the workspace that asks the staff member again (for example a PIN or the password). To settle with R13-api before step 8.

## Needs from others

- R13-api: `packages/types/src/esign` contract and mocks (`api.esign`, `api.signing(slug)`, `api.mySignatures(slug)`).
- R13-api: the largest adopted signature image the signing API takes. The pad refuses data URLs over 90,000 characters (`MAX_SIGNATURE_CHARS` in `signature-pad.tsx`, under Nest's 100 KB JSON limit); the constant moves to `packages/types/src/esign` with the signing contract.
- Fahad: "Firm Sign" in the firm menu; the Send for Signature button and the "Signatures" entry in the client record's tabs (`clients/[id]/layout.tsx`, F06).
- Nahid: "Signatures" in the portal menu.
- R1: PAGE-MAP rows for the Firm Sign pages.
- Fahad: an `accent` tone on `Badge` (Partially Signed uses the accent tokens in `status-badge.tsx` until then), and a `Table` option to hide its pager (the dashboard's Recent Documents shows Page 1 / Previous / Next, which the mockup doesn't have).
- Fahad (optional): a handwriting font token for typed signatures; until then they use `--font-display` italic.
- Fahad (optional): eight recipient colour tokens `--color-recipient-0` to `-7` in packages/ui. `recipient-colors.ts` uses them when they exist and mixes the existing tokens until then.
- Fahad (packages/ui): a link styled as a Button (for example an exported `buttonClass(variant)`); request detail copies the primary Button's classes for its two links until then.
- R13-api: a mock request waiting on the Owner's approval (for example Terms of Service, NEEDS_APPROVAL, sent by Sam Staff, with Mock User as a STAFF approver) and a ready DRAFT with an approver, so the approvals screens get a mock spec.

## Progress log

- 2026-10-08: pdf.js spike done, verdict above (loader on branch `rasel/R13-web-pdf-spike`, goes in with the PdfPages viewer PR).
- 2026-10-08: routes PR: 14 placeholder pages with tab titles, the kiosk layout (signed in, no menu), the signer layout (firm name, no account), noindex on the signer and kiosk layouts, the kiosk runs the same firm checks as the workspace, the signer frame shows the firm logo and the portal footer, `e2e/mock/esign-routes.spec.ts` (15 tests green locally).
- 2026-10-08: viewer PR: `pdfjs-dist` 6.3.289 and the loader (worker with a ready check, else the main thread; a failed load retries), `PdfPages` (pages draw as they scroll near and free their canvas when far, sized to the container, an overlay slot per page for FieldOverlay), a synthetic sample PDF shown on `/{firm}/sign` until the signing API lands, `e2e/mock/esign-pdf-pages.spec.ts` (incl. the no-worker fallback).
- 2026-10-08: signature pad PR, stacked on the viewer: `SignaturePad` (type, draw, upload; always a PNG; each tab keeps its own value; ink and font from the pad's theme tokens), on `/{firm}/sign`, `e2e/mock/esign-signature-pad.spec.ts` (draw at 375 px).
- 2026-10-09: #146 pre-review fix 1: one shared `PDFWorker` passed to every `getDocument`, so closing a document no longer destroys the worker the next one needs; the sign preview gets a Next document button and a spec that switches documents after the first draws (fails without the fix). Fix 2 (wasm, standard fonts and cMaps for scanned pages, plus a CCITT spec) goes in the next viewer PR, before any real document is shown; it needs a `/pdfjs/` exception in the proxy matcher from R1 or assets resolved with `import.meta.url`.
- 2026-10-09: #147 pre-review fixes: an uploaded photo becomes ink on transparent paper (pixels lighter than 75% are paper, a fade down to 55% keeps smooth edges, strokes take the theme ink), so a phone photo of a signature adopts in a few KB; a picture that still comes out over the cap is refused with "This picture is too detailed. Try a closer photo on plain white paper."; the open tab is read from a ref when a panel reports (no stale tab after a quick switch); very long typed names are squeezed to fit the box.
- 2026-10-09: #146 merged (viewer and signature pad together; #147 was merged into its branch). Scanned pages PR: pdf.js gets a `BinaryDataFactory` (`pdf-assets.ts`) that maps the files it asks for (the JBIG2 and JPEG 2000 wasm decoders, the Symbol and Dingbats fonts) to hashed files bundled by turbopack with `new URL(..., import.meta.url)`, fetched once per page load. No `/pdfjs/` folder or proxy exception is needed (checked in `next build`: the files land in `_next/static/media`). Not covered, because pdf.js loads them from a folder URL: CMaps (CJK text only), ICC profiles, the no-wasm decoders and the Liberation fallback for unembedded Helvetica/Times (the device's fonts are used). Without WebAssembly (iOS Lockdown Mode) the viewer warns the signer that scanned pages may be blank. Known limit: with one shared worker, pdf.js routes its first decoder fetch through the latest document, so request detail shows one document's pages at a time. A synthetic JPEG 2000 "scan" on `/{firm}/sign`; a spec reads the drawn pixels (fails without the factory).
- 2026-10-09: FieldOverlay PR #193 (#172 merged): fields drawn on each page from their fractions, in the recipient's colour (`recipient-colors.ts`, eight colours by `colorIndex`; sender fields in a neutral ninth) with the field's label and the recipient's name (name hidden when the box is narrow; colour and aria-label always say it), a sender's prefilled value shown as text, dashed until filled, kept inside the page, other signers' fields faded for a signer, a button when the editor passes `onSelect`. Sample fields on `/{firm}/sign`; spec checks placement, colours and fading.
- 2026-10-09: #172 merged. #172 follow-ups in #193: the viewer test-compiles an empty wasm module (catches a CSP without `'wasm-unsafe-eval'` as well as missing WebAssembly), the warning says "on another device" (every iOS browser is Safari underneath) with "before you sign" only for `purpose="sign"`, a CCITT fax page in the scanned sample (decoded by jbig2.wasm) with a pixel spec, and no extra copy of decoder bytes (pdf.js copies them itself).
- 2026-10-09: All requests PR (stacked on #199): `RequestsTable` (search, status, client and last-activity filters, API cursor pages; shared by Recent Documents, All requests and a client's Signatures tab), `StatusBadge` (the mockup's colours; Delivered reads Sent), `/firm-sign/requests` with the five quick filters and their counts, `?status=` from a dashboard counter.
- 2026-10-09: request detail PR (stacked on All requests): `/firm-sign/requests/{id}` with the title, status and what it waits on, the recipients in signing order (status, when they viewed, signed or declined, reminders, decline reason), the timeline newest first (who, for whom, reason, how the signer was verified), the details panel and the staff-only internal note; links to continue a draft and to sign in person. `e2e/mock/esign-request-detail.spec.ts`. The actions (remind, void, correct, replace, resend a copy, approve, download) and the void/replace notices follow in the next PR.
- 2026-10-09: request actions PR (stacked on request detail): Remind now and per-signer Remind, Correct details (name, email, phone of someone outside the firm who hasn't finished), Correct and resend (voids with a reason and opens the new linked draft), Void (reason required), Resend signed copy, downloads (signed document, certificate, document as sent), and the void, replace, expiry and approval notices. Each button shows only when `allowedActions` has it (a Viewer gets only the downloads). In-person signers get no Remind.
