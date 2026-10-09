# R22: Begin Online screens

Cloud thread "Begin Online screens", started Oct 9 on Rasel's ask ("build every intake form and the Schedule online page"). Builds the public intake at `portal.firmivra.com/{firmSlug}/begin` from Octavia's 26 mockups, starting from Arfan's #138. Brief: `/mnt/project-files/plans/briefs/R22-begin-online-screens.md` (project files). Cutoff for what Octavia sees on Sunday: merged by Sat Oct 10, 14:00 UTC.

## Read first

- `CLAUDE.md`, `docs/work/README.md`, `docs/junior/PAGE-MAP.md` (rows 111-120), `docs/junior/GUIDE.md`, `docs/junior/AI-RULES.md`
- `docs/specs/NOTES-begin-online.md` and the mockups in `docs/mockups/begin-online/`
- Contract B (#257): `packages/types/src/begin-online`, `packages/types/src/intake`, `apps/web/src/mocks/begin-online.ts`; the form definitions in `packages/types/src/intake/forms`
- R14's agreements and signature block (#259)

## Paths owned

- `apps/web/src/app/portal/[firmSlug]/(public)/begin/**` (the 9 pages, `_blocks/`, `_components/`)
- `apps/web/e2e/mock/r22-*.spec.ts`, `apps/web/e2e/r22-*.spec.ts` (Arfan's two begin specs now live here as `r22-begin-online` and `r22-annual-tax`)
- This file, and the owner cells of PAGE-MAP rows 111-120

Not mine: `(public)/layout.tsx` and the portal header and footer (R17), `packages/ui` (Fahad), `packages/types` and `apps/web/src/mocks` (R15 for intake and Begin Online, R14 for agreements), `apps/web/src/lib` and `components/page-state` (R1), `apps/api`, `packages/db`, `infra/`, `.github/`.

## Steps

- [x] 1. This file; Arfan's #138 merged with main (titles 'Begin online' and 'Annual tax preparation' kept), `-m-6` replaced by PageContainer, his specs moved to `r22-*` (the second mock firm no longer exists)
- [x] 2. One intake engine in `_blocks/` that renders any form from its definition (contract B): stepper, numbered panels, every field type, grids with totals, repeating groups, uploads, review with Edit, Back/Next, save-and-continue-later
- [x] 3. The five other forms on the engine (quarterly tax, bookkeeping, payroll, tax planning, business development), each with a mock spec: every step, required errors, Back and Next, review, submit, success page, 375 px and keyboard
- [x] 4. Annual tax moved onto the engine and contract B's client
- [x] 5. Resume and done pages (both success pages)
- [ ] 6. Real API as R15's endpoints land (dev runs a production build, where mocks are compiled out)
- [x] 7. "Schedule an Appointment" on the entry and success pages links to `/{firm}/appointments` (Tumit's N08; a signed-out visitor goes through sign-in). There is no public booking API.

## Needs from others

- R15: contract B (#257) on main, then the Begin Online API PRs; their order.
- R14: the agreements and signature block (#259) for the review step.

## Progress log

- 2026-10-09: step 1 (Arfan's #138 brought up to date, his commits kept): PR #266.
- 2026-10-09: steps 2-3: the engine in `begin/_blocks/intake-*` renders a form from its definition (contract B, stacked on #257); checks use `checkIntakeAnswers` (the API's own check) instead of zodResolver, since the fields come from the definition. Quarterly tax, bookkeeping, payroll, tax planning and business development pages use it; `r22-intake-forms.spec.ts` runs each end to end. The agreement panel is a frame until R14's #259 (no signature in the submit yet). Submit's 503 (agreements not signable yet, R15) shows its own message.
- 2026-10-09: steps 4, 5, 7: annual tax on the engine (Arfan's hand-built annual form, `quarterly-grid` and `upload-tile` removed; his spec replaced by the engine's), the resume page (`#token=` read, posted, cleared) and both success pages, each with Schedule an Appointment to `/{firm}/appointments`.
