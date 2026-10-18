# Ibrahim: tasks

Firmivra Phase 1 · added Oct 17, 2026 by Rasel.
Read `docs/junior/GUIDE.md`, `docs/junior/AI-RULES.md`, `docs/junior/PAGE-MAP.md` and `docs/design-match.md` first. Your page files already exist as placeholders: PAGE-MAP.md lists them under "Ibrahim's four modules".

## Your role

You build firm-workspace screens, mock first, against the API contract: Integrations, Reports, Tax Planning & Strategy and Business Advisory & Development. Rasel's Claude Code sessions build every API. Build each page on the typed mocks first (`docs/junior/GUIDE.md`, "Mock first"), so nothing waits for the backend.

Review every page in three states before you open the PR: with data, empty, and API unreachable. Every widget's frame shows in each; one error panel never replaces a page (`docs/design-match.md`, rule 2).

Pace: 5 pages a day. A page here is one design frame with its tabs or steps; the routes of a frame go in one PR unless the PR gets too big.

- Pre-review pair: Tumit and Arfan (one of them reviews each PR first)
- Final review and merge: Rasel

## Tickets

| Ticket | Day | Title | Contract |
| --- | --- | --- | --- |
| I01 | Day 1 | Integrations (4 pages) | `packages/types/src/integrations` (R55) |
| I02 | Day 2 | Reports (3 pages) | `packages/types/src/reports` (R55) |
| I03 | Day 2-3 | Tax Planning & Strategy (3 pages) | `packages/types/src/tax-planning` (R55) |
| I04 | Day 3-4 | Business Advisory & Development (3 pages) | `packages/types/src/business-advisory` (R55) |

**Contract:** R55 is writing these contracts. Until a contract is merged, wait for it, or start with the page frame (the layout, the cards and tables with their headers and empty states) and fill in the data when it lands. Never invent a field the contract does not have: ask Rasel.

## Ticket cards

All folders are inside `apps/web/src/app/firm/(workspace)/`; all designs and docx are under `docs/mockups/firm-workspace/`. Every route is in PAGE-MAP.md with its design file and docx section. A modal, a drawer or a menu gets no route: it opens from its page.

### I01 · Day 1 · Integrations (4 pages)

- **Pages:**
  1. Integrations list: `/integrations`. The four tabs (All, Connected, Available, Needs Attention) filter one list, so they have no routes.
  2. Add integration (marketplace): `/integrations/marketplace`. "Request an integration not listed" is a modal on this page.
  3. Connect and configure (Microsoft 365 as the example): the wizard `/integrations/[integrationId]/connect`, then `connect/configure`, `connect/permissions` and `connect/complete`.
  4. Manage integration (QuickBooks Online as the example): `/integrations/[integrationId]` (Overview), then `sync-settings`, `data-mapping`, `permissions`, `sync-history` and `troubleshooting`.
- **Mockups:** `integrations/source/intigrations.jpg`, `add-integration-marketplace.jpg`, `connect-configure-integration-u2013-microsoft-365.jpg` and `manage-integration-u2013-quickbooks-online.jpg`; docx `integrations/source/integrations-developer-instructions.docx` §2 to §9.
- **Contract:** `packages/types/src/integrations` (R55).

### I02 · Day 2 · Reports (3 pages)

- **Pages:**
  1. Reports dashboard: `/reports`.
  2. Report detail: `/reports/[reportId]`. Schedule Report and the filter panel open on this page.
  3. Custom report builder: `/reports/builder`.
- **Mockups:** `reports/source/reports-page.jpg`, `report-detail-view-report.jpg` and `custom-report-builder-1.jpg`; docx `reports/source/firmvra-reports-developer-guide-final-v2.docx` §1 to §7 and §13.
- **Contract:** `packages/types/src/reports` (R55).

### I03 · Day 2-3 · Tax Planning & Strategy (3 pages)

- **Pages:**
  1. Overview with its tabs: `/tax-planning` (Overview), `clients`, `opportunities`, `strategies`, `calendar`, `resources` and `reports`. Strategies & Recommendations has no frame: build it from docx §15 in the neighbouring style, and say so in the PR.
  2. Create and edit a planning plan, a 5-step wizard: `/tax-planning/plans/new` (step 1, saves a draft), then `/tax-planning/plans/[planId]/edit`, `edit/financials`, `edit/goals`, `edit/implementation` and `edit/review`.
  3. Planning opportunity and strategy review: `/tax-planning/opportunities/[opportunityId]`.
- **Mockups:** `tax-planning/source/tax-planning.jpg`, `create-edit-planning-plan.jpg` and `planning-opportunity-strategy-review.jpg`; docx `tax-planning/source/firmvra-tax-planning-strategy-developer-guide-fresh-copy.docx` §1 to §15.
- **Contract:** `packages/types/src/tax-planning` (R55).

### I04 · Day 3-4 · Business Advisory & Development (3 pages)

- **Pages:**
  1. Overview with its tabs: `/business-advisory` (Overview), `clients`, `plans`, `goals`, `financial-analysis`, `action-plans`, `resources` and `reports`.
  2. Create and edit a business plan, a 5-step wizard: `/business-advisory/plans/new` (step 1, saves a draft), then `/business-advisory/plans/[planId]/edit`, `edit/assessment`, `edit/goals`, `edit/action-plan` and `edit/review`.
  3. Client advisory detail and growth plan, with its tabs: `/business-advisory/clients/[clientId]` (Overview), then `plan`, `financials`, `goals`, `recommendations`, `tasks`, `meetings`, `documents`, `notes`, `portal` and `activity`.
- **Mockups:** `business-advisory/source/business-advisory-and-development.jpg`, `create-edit-business-plan.jpg` and `client-advisory-detail-growth-plan.jpg`; docx `business-advisory/source/firmvra-business-advisory-development-developer-guide-final.docx` §1 to §8.
- **Contract:** `packages/types/src/business-advisory` (R55).

## Checklist for every page (copy it into the PR, from `docs/design-match.md`)

- [ ] Every part of the design was cropped and enlarged, and its elements listed and counted (rule 1)
- [ ] Every element is built; no widget was dropped (rule 2)
- [ ] Where there is no data, the widget shows its frame with a quiet empty state: no invented numbers, no "Coming soon" inside a widget (rule 2)
- [ ] The page was checked in three states (with data, empty, API unreachable) and every widget's frame shows in each (rule 2)
- [ ] Icons are solid Phosphor icons; every icon that is not exact is listed in the PR (rule 3)
- [ ] Colours and sizes were measured from the image and come from `packages/ui` tokens; a new token only where the design colour has none (rule 4)
- [ ] The page was rendered at 1440 px and compared region by region, and the fixes repeated until no difference is visible (rule 5)
- [ ] The PR shows screenshots next to the design and lists every difference that could not be removed, and why (rule 6)
- [ ] Components come from `docs/ui-kit.md`; a kit addition was requested only for a design element the kit lacks
- [ ] Works at 375 px with no sideways scroll

## I01 progress: Integrations List (18 Oct 2026)

Scope: only `/integrations` (Frame 1). Marketplace, connection setup and Manage Integration are separate pages and remain untouched.

Design inventory (`integrations/source/intigrations.jpg`, developer instructions section 2):
- Banner: title, subtitle, shield and credential-masking notice.
- Four summary cards: Connected, Needs Attention, Available, Last System Check.
- Four status tabs, provider search, category select and two environment choices.
- Catalog-driven provider cards: logo fallback, name, status, purpose, last sync, direction/mode, overflow menu and contextual actions. The reference frame has four top cards and eight lower cards; production counts come from the API.
- Add Integration panel: three checklist items, marketplace button and link.
- Three lower panels: Integration Health (four metrics and View Health), Data Mapping (mapped scopes and Manage Mapping), Recent Activity (events, View All and View Audit Log).

Implementation uses `api.integrations` and existing UI tokens/components. Synthetic fixtures in `src/mocks/integrations.ts` are used by browser request interception; they are not production fallback data. The shared API client registration remains unchanged.

Validation:
- Web TypeScript check: passed.
- Changed-file ESLint: passed.
- Production web build: passed.
- Four focused Playwright tests: passed (data/filtering/dialogs/mobile, empty, API unreachable, forbidden).
- Screenshots: `apps/web/test-results/ibrahim-integrations-list--ac2ed-ies-mode-and-insight-panels-chromium/integrations-data-desktop.png` and `integrations-data-mobile.png`; empty/offline/forbidden screenshots are in the corresponding test-result folders. These are ignored local test artifacts, not committed images.

Known differences / handoff:
- Provider logo assets are not supplied by the shared kit. Neutral initial tiles are used, as allowed by the contract's unknown-logo fallback. Real brand logos still need approved assets.
- The shared shell's menu density, global New button and header differ from the source frame. Those files belong to other owners and were not edited.
- No decorative banner image is supplied by the kit; the banner uses the existing navigation token.
- The reference image's sample counts/dates are not copied into the page. All displayed metrics come from the contract; test fixtures are synthetic and internally consistent.
- The four-module ticket uses I01 in this document; a numeric GitHub issue for the list page has not been identified. Working branch: `ibrahim/FIR-I01-integrations-list`.
- Local `pnpm dev` hit the API compiler's default 4 GB heap limit. Web and API were restarted separately, with `NODE_OPTIONS=--max-old-space-size=8192` for the API process only; no shared configuration was changed.

Review evidence is also saved under the page-owned `_components/review/` folder so a draft PR can show the mockup beside desktop/mobile screenshots without changing another owner's paths. The screenshots use synthetic mock data only.

Repository-wide lint/typecheck were attempted but did not complete: the API lint process exited with a process-out-of-memory error while checks ran concurrently. No unrelated lint rules or source files were changed. A real-API sign-in smoke test initially found P2022 (local database behind latest main); existing repository migrations are being applied before retesting. This is not recorded as a passing real-API test.

Follow-up: the pending `20261017180000_r0_platform_audit_security` migration was applied locally. The real-API smoke test now passes: seeded owner quick sign-in, catalog HTTP 200, provider cards and all three insight panels. Total focused browser tests: 5 passed (4 contract-fixture scenarios plus 1 real-API smoke test).
