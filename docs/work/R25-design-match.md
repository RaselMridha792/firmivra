# R25: Design match

Cloud thread "Design match", Rasel's own. Makes the screens that are real on `main` match Octavia's mockups for the Sunday Oct 11 first draft. Brief: `/mnt/project-files/plans/briefs/R25-design-match.md` (project files); audit with every finding: `/mnt/project-files/screens/2026-10-09-design-audit/findings-raw.txt`. Started Oct 9. Cutoff: everything merged by Sat Oct 10, 14:00 UTC.

## Read first

- `CLAUDE.md`, `docs/work/README.md`, this file
- The mockups in `docs/mockups/super-admin/` and `/mnt/project-files/client-info/2026-10-08-octavia/Mockup_CC2406D8.png` (portal Appointments)

## Paths owned (design fixes only)

- `packages/ui/src/styles.css`: the font token lines and new tokens, each with a one-line note (Fahad's file)
- `apps/web/src/app/layout.tsx`: font loading
- `apps/web/src/app/portal/[firmSlug]/(client)/appointments/**` and `apps/web/e2e/mock/tumit-*appointment*.spec.ts` (Tumit's N08, assertions only where the mockup wording changed)
- The Super Admin screens under `apps/web/src/app/admin/` (dashboard, applications, application detail, firms, sign-in) and their specs
- BrandLockup on `/apply`, `/apply/done`, `/welcome`; Select and Checkbox in `packages/ui`

Not mine: the portal public landing and the signed-in portal shell (R17), Begin Online (R22), Firm Sign screens (R13-web), `apps/api`, `packages/db`, `infra/`, `.github/`.

## Steps

- [x] 1. Type: Nunito Sans and Playfair Display through `next/font/google`, `--font-sans` and `--font-display` point at them
- [ ] 2. Portal Appointments to `Mockup_CC2406D8.png`
- [ ] 3. Super Admin dashboard
- [ ] 4. Application detail, pending and approved
- [ ] 5. Applications list and Firms list
- [ ] 6. Super Admin sign-in
- [ ] 7. Small shared fixes: BrandLockup, Select and Checkbox

## Progress log

- 2026-10-09: step 1, fonts (Nunito Sans for text, Playfair Display for headings), chosen by rendering Inter, Nunito Sans, Plus Jakarta Sans, Playfair Display, Source Serif 4 and DM Serif Display next to the mockups.

## Needs from others

- R17: the portal shell and landing items from the audit (header search, sidebar logo and tagline, nav icons and unread badge, footer), sent through the coordinator.
