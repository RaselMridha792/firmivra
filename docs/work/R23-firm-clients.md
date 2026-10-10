# R23: Firm clients screens

Cloud thread "Firm clients screens", started Oct 9 night on Rasel's card ("Thread for clients"). Builds the firm workspace's Clients list, the client record (header, tabs, Overview) and Sign-ups at `app.firmivra.com`, for Octavia's Sunday review. Brief: `/mnt/project-files/plans/briefs/R23-firm-clients-oct10.md` (project files). The spec is ticket F06 in `docs/tasks/FAHAD.md`. Cutoff: merged by Sat Oct 10, 14:00 UTC.

## Read first

- `CLAUDE.md`, `docs/work/README.md`, `docs/junior/PAGE-MAP.md` (firm rows), `docs/tasks/FAHAD.md` (F06)
- Contracts: `packages/types/src/clients` (`api.clients`, R10) and `packages/types/src/client-auth` (`api.clientSignUps`, R3)
- Reference screens: `firm/(workspace)/audit-log/`, `team/`, `settings/tax-statuses/`

## Paths owned

- `apps/web/src/app/firm/(workspace)/clients/page.tsx`, `clients/_components/`
- `clients/[id]/layout.tsx`, `clients/[id]/page.tsx`, `clients/[id]/_components/`
- `apps/web/src/app/firm/(workspace)/sign-ups/`
- `apps/web/e2e/mock/r23-*`
- This file

Not mine: the Documents, Messages, Invoices and Signatures tabs' pages, `components/app-shell`, `packages/ui`, `lib/`, `mocks/`, `firm-sign/`, `apps/api`, `packages/db`, `packages/types`.

## Steps

- [x] 1. `/clients`: list with search, Active/Archived/All and cursor paging; mock spec (api.clients has no mock, the spec answers the API)
- [x] 2. `/clients/[id]`: header and tabs in the layout; Overview with profile (SSN and EIN last 4 only), contact and portal logins; archive and restore (Owner and Admin)
- [ ] 3. `/sign-ups`: pending and declined sign-ups, approve (or link to an existing record) and decline with a reason; Staff see the no-permission state
- [ ] 4. Profile and contact edit on the Overview

## Progress log

- Oct 9: step 1 (#372).
- Oct 9: step 2.

## Needs from others

- None yet.
