# R17: Client portal screens

Cloud thread "Client portal screens", Rasel's own. Builds Nahid's N02-N10 client portal screens (portal.firmivra.com/{firmSlug}) from Octavia's mockups, on the API sessions' contracts and mocks. Brief: `/mnt/project-files/plans/briefs/R17-client-portal.md` (project files). Started Oct 9.

## Read first

- `CLAUDE.md`, `docs/work/README.md`, `docs/junior/PAGE-MAP.md`, `docs/tasks/NAHID.md`
- `docs/junior/GUIDE.md`, `docs/junior/AI-RULES.md`
- `docs/specs/NOTES-client-portal.md` and the screen's spec in `docs/specs/client-portal/`
- Reference screen `apps/web/src/app/firm/(workspace)/settings/tax-statuses/` and `apps/web/e2e/mock/tax-statuses.spec.ts`

## Paths owned

- `apps/web/src/app/portal/[firmSlug]/layout.tsx`
- `apps/web/src/app/portal/[firmSlug]/(public)/**`, except `begin/` (Arfan) and `calculators/` (R14)
- `apps/web/src/app/portal/[firmSlug]/(client)/**`, except `appointments/` (Tumit), `home/` (R1), `calculator/` (R14) and `signatures/` (R13-web)
- `apps/web/e2e/nahid-*.spec.ts`, `apps/web/e2e/mock/nahid-*.spec.ts`, `apps/web/e2e/r17-*.spec.ts`, `apps/web/e2e/mock/r17-*.spec.ts`
- This file, the owner cells of the portal rows in `docs/junior/PAGE-MAP.md`, and the pointer line in `docs/tasks/NAHID.md`

Not mine: `apps/api`, `packages/types`, `apps/web/src/mocks` (API sessions), `apps/web/src/lib` and `components/page-state` (R1), `components/app-shell` (Tumit), `components/auth`, `sign-in-panel.tsx` and `packages/ui` (Fahad), `(public)/begin/**` (Arfan, import only), `packages/db`, `infra/`, `.github/`.

## Steps

- [x] 1. Docs: PAGE-MAP owners, this file, the NAHID.md pointer
- [ ] 2. Sign-up (N02): the form; then verify-email, verify-phone and done
- [ ] 3. Sign-in (N03) with MFA code and MFA setup
- [ ] 4. Forgot and reset password (N03)
- [ ] 5. Client shell (N01 follow-ups): full-width header with the firm logo and footer, drawer at 375 px, Signatures and Tax Calculators menu lines
- [ ] 6. My Docs (N05): list with filters and search; then the upload popup and document requests
- [ ] 7. My Profile (N05)
- [ ] 8. Taxes tab; My Services (N06)
- [ ] 9. Intake tab (N06): cards and frame now, finished when contract B, the sign block and R14's agreements land
- [ ] 10. Messages and notes (N09), on R15's contract D
- [ ] 11. Invoices (N09)
- [ ] 12. Business tab (N09)
- [ ] 13. Resources (N10) and External links (N09)
- [ ] 14. Notifications (N10)
- [ ] 15. Switch each screen off the mock as its API merges; Oct 16 pixel check, Oct 17 review fixes, Oct 18 production smoke test

## Needs from others

- `apps/web/src/lib/api.ts` has no mock line for `myProfile` or `myTaxReturns` (their mock factories exist). Asked the Scrum thread who adds them.
- Contracts and APIs: contract B and contract D (R15; R0 may own contract B), R14 agreements and `<Markdown>`, Arfan's sign block, R1 documents part 2, R10 step 7 tax returns (R21), invoices (R19), notifications (R16, #160), messages API (R20), signatures status (R13-api).
- Nahid's next work and his "Your files" path guard under `.github/`: the Scrum thread and Rasel.

## Progress log

- 2026-10-09: step 1, docs PR: portal rows in PAGE-MAP now owned by R17 (Rasel), this file, pointer line in NAHID.md.
