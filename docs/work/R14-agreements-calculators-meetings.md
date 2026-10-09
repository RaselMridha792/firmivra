# R14: Intake agreements, calculators and meeting links (Oct 9-18)

**Goal:** every intake (Begin Online and the portal) is signed against the firm's versioned agreements, with the evidence pinned (Rasel's decision 3, Oct 8); the calculators get their real definitions and pages; appointments carry a meeting link. A cloud thread (no AWS, no Docker).

**Owned paths (change only these):**
- `packages/types/src/agreements/**` and `packages/types/test/agreements/**`
- `apps/api/src/agreements/**` and its unit and e2e tests
- `apps/api/src/esign/core/**` and `packages/types/src/esign/capture.ts`: signature capture and evidence, shared with R13 (R13 owns them once its PRs merge)
- `apps/web/src/mocks/agreements.ts` and the `agreements`, `publicAgreements` and `myIntakeAgreements` lines in `apps/web/src/lib/api.ts`
- `docs/api/agreements.yaml`
- `packages/types/src/calculators/**`, `apps/web/src/mocks/calculators.ts` and the calculator pages (R14 creates its own, CLAUDE.md "Junior developers")
- the meeting-link parts of appointments: `meetingUrl` in `packages/types/src/appointments`, `apps/api/src/appointments` and `apps/web/src/mocks/appointments.ts`
- `packages/ui`: the `<Markdown>` component only
- registration lines in `apps/api/src/app.module.ts` and `packages/types/src/index.ts`

**Not mine:** R11's intake and Begin Online submit (contract B, R15), R13's Firm Sign, `packages/db`, infra and `.github`.

**Read first:** CLAUDE.md, docs/work/README.md, this file, apps/api/README.md, docs/AUTH-DESIGN.md, #155's migration (`intake_agreements`, `intake_agreement_versions`, `intake_signatures` and their checks), `packages/types/src/intake/definition.ts` (IntakeFormKey) and `packages/types/src/documents/schemas.ts` (the upload pattern).

## Steps

- [x] 1. Agreements contract: schemas, clients, mock, `docs/api/agreements.yaml` (#259, with the Scrum pre-review fixes).
- [ ] 2. Agreements API on `rasel/R14-agreements-api`: firm routes, the PDF upload, the Begin Online block by form, the portal block by intake, signing inside R11's submit transaction.
- [ ] 3. `<Markdown>` in packages/ui on `rasel/R14-markdown`: raw HTML off, images off, links only to `https:` and `mailto:`, never `dangerouslySetInnerHTML`; R17 renders agreements, Terms and Privacy with it.
- [ ] 4. Calculators: the real definitions and pages (figures from Octavia).
- [ ] 5. Meeting links on appointments, after R0's `meeting_url` migration.

## Rules

- CLAUDE.md's hard rules. Every API PR carries a cross-firm 404 and, for portal routes, a cross-client 404.
- Contract PRs one at a time from fresh `main`; at most 2 open non-contract PRs. Merge `main`, never rebase or force-push. Titles `<type>: <what> (R14)`.

## Decisions (contract, #259 review)

- The Begin Online block is keyed by `?form=<IntakeFormKey>` (B's forms carry only the form key): the API resolves the firm's unarchived Begin Online service of that kind; an unknown form or no such service answers 404. The portal intake reads `GET /portal/{slug}/me/intakes/{intakeId}/agreements`, resolved from the intake's form (another client's intake: 404).
- `PDF_REQUIRED` is a firm-side publish code only; a submit never answers it (the API pins the version's `pdf_sha256`).
- Submit-time codes and texts live in `INTAKE_SIGNING_ERRORS`; `AGREEMENT_ERRORS` keeps the firm-side codes.
- At most 9 unarchived service agreements per service (409 `SERVICE_AGREEMENT_LIMIT`), so a signature holds at most 10.
- `legal` is null unless both Terms and Privacy are published; `acceptLegal` is required on Begin Online when `legal` is set and refused on a portal submit.
- Service agreements list by sort order, then creation, then id (no reorder call yet).
- Later: a route to download the PDF a signature pinned, keyed by the signature (review nit 9); the public PDF route serves the current version only.
- PR size: #259 stays one PR (about 1,300 lines with tests, mock and yaml; review nit 11, accepted by the Scrum thread).

## Needs from others

- R15 (contract B, #257): drop `PDF_REQUIRED` from `AGREEMENT_CODES` (a submit never answers it); spread `INTAKE_SIGNING_ERRORS` into `INTAKE_ERRORS` and `BEGIN_ONLINE_ERRORS` in place of `INTAKE_AGREEMENT_ERRORS`, spreading first so B's own `TERMS_OUTDATED` (same code) can follow it without TS2783; swap `IntakeAgreementOutdatedDetails` for `AgreementOutdatedDetails` (the current block); the review step reads `api.publicAgreements(slug).block({ form })` on Begin Online and `api.myIntakeAgreements(slug).block(intakeId)` in the portal.
- R11 or whoever owns `ApiRequestError`: keep the error's `details`, so AGREEMENT_OUTDATED can show the new block without a reload.
- R0: `services.begin_online` (#261). Until it lands, the Begin Online block takes the firm's first unarchived service of the form's kind, which is ambiguous where #257 sends two forms (Personal Tax and Business Tax) to `ANNUAL_TAX`; `beginOnlineService()` in `agreements.service.ts` filters on the flag once it is on main.
- R12: calculators and meeting links moved from R12 to R14 (Rasel's Oct 8 plan); R12's file is its owner's to update.
- R0: the `meeting_url` migration for appointments and the follow-ups from #155 (pending Rasel).

## Progress log

- Oct 9: #259 merged. Agreements API opened as #285 with the #259 follow-ups: `FirmAgreementList.services` (the firm's unarchived services, so the editor can create a service agreement), the resolution and outdated rules written down in `docs/api/agreements.yaml`, the table names fixed.

- Oct 9: #155 (R0's intake agreements and signature evidence tables) merged. Contract #259 opened on `claude/r14-agreements-calculators-2i2erk`; Scrum pre-review fixes applied (block keyed by form plus the portal route, text rules, version bounds, upload facts, error maps, mock fixes). Shared `FileName` rule now exported from `documents/schemas.ts` and reused for agreement PDFs.
- Oct 9: agreements API on the revised contract (`rasel/R14-agreements-api`): the Begin Online block by `?form=` (the firm's unarchived service of that kind; until R0's `begin_online` column lands, the first by sort order, creation, id), the portal block by intake, `legal` only with both Terms and Privacy, 409 `SERVICE_AGREEMENT_LIMIT` under the firm's create lock.
