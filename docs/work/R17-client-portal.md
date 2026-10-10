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
- [x] 2. Sign-up (N02): the form; then verify-email, verify-phone and done
- [x] 3. Sign-in (N03) with MFA code and MFA setup
- [x] 4. Forgot and reset password (N03)
- [x] 5. Client shell (N01 follow-ups): full-width header with the firm logo and footer, drawer at 375 px, Signatures and Tax Calculators menu lines
- [x] 6. My Docs (N05): list with filters and search; then the upload popup and document requests
- [x] 7. My Profile (N05)
- [x] 8. Taxes tab; My Services (N06)
- [ ] 9. Intake tab (N06): cards and frame done; the form when contract B, the sign block and R14's agreements land
- [x] 10. Messages and notes (N09), on R20's messages contract
- [x] 11. Invoices (N09)
- [x] 12. Business tab (N09)
- [x] 13. Resources (N10) and External links (N09)
- [x] 14. Notifications (N10)
- [ ] 15. Switch each screen off the mock as its API merges; Oct 16 pixel check, Oct 17 review fixes, Oct 18 production smoke test

## Needs from others

- Contracts and APIs: contract B and the leads (R15), R14 agreements and `<Markdown>` (#155 first), Arfan's form blocks (#138) and sign block, R1 documents part 2, tax returns (R21), invoices (R19), notifications (R16, #160 merged), messages and notes API (R20), signatures status (R13-api).
- The portal header bell: built in the portal shell through a new optional `bell` prop on the shared Header (Scrum thread yes, Oct 9).
- The firm motto: a contract-only PR adds an optional `branding.tagline` to PortalInfo (with its mock line), and the API and LVP seed serve "Plan | Prepare | Prosper". The shell reads it when present and hides it otherwise. Its letter spacing uses R25's `tracking-brand` until Fahad adds a motto token.
- The shared Header's `hideRole` (the role stays for screen readers) and greeting `<div>`: Tumit's file, through the Scrum thread's #347 review.
- Nahid's next work and the "Your files" > Nahid path guard under `.github/`: the Scrum thread and Rasel.

## Progress log

- 2026-10-09: step 1, docs PR: portal rows in PAGE-MAP now owned by R17 (Rasel), this file, pointer line in NAHID.md.
- 2026-10-09: steps 2-14 built as stacked branches rasel/R17-* (backed up on rasel/r17-client-portal-5vb4kh), each with a mock e2e at desktop and 375 px; waiting on Rasel's branch card to open the PRs. Step 9 has the cards and frame only. The mock lines for `myProfile` and `myTaxReturns` in `lib/api.ts` were added here with the Scrum thread's yes (those two lines only). Recent Activity reads the client's notifications.
- 2026-10-09: R25's design audit hand-over (portal landing, signed-in shell) on rasel/R17-shell-design: landing copy, icons, hero art, header buttons (Begin Online, Book an Appointment); shell greeting and sub-line, bigger menu, divider, firm motto, footer Privacy | Terms | Contact Us. Needs from others: the firm motto is an optional `branding.tagline` in PortalInfo; the API and the LVP seed must serve "Plan | Prepare | Prosper" before it shows on dev. Kept the greeting (not a search box) and the firm's own accent colour, as in most of Octavia's portal mockups. Shared `PortalPageHeader` band (gradient, drawn leaves in place of the plant photo, script line) on the six tabs, My Services and My Profile, for Appointments too (Scrum, after R25's review).
- 2026-10-09: Scrum review of #334-#347. #335: My Docs switches to the firm's shared documents (`?source=firm`), and "View Firm Documents" links there. #347: the tagline contract line and the motto token are out (see Needs from others); the role is sr-only so sites.spec.ts still finds it, and the portal-session.spec.ts edit (R1's file) is reverted to /Client/; header buttons only on the landing page, "Clients: Book an Appointment". Should-fixes (paging past 100, checkout refetch, mark unread) go in one follow-up PR.
