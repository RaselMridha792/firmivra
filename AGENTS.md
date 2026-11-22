# Instructions for AI coding tools

**Fix phase (Nov 21-30, 2026): read `docs/junior/OPENCODE.md` first.** It is short. It holds the rules, setup, where each tab's code lives and the test commands, so you don't need to scan the repo. `docs/junior/FIX-PHASE.md` overrides the web-only limits in `docs/junior/AI-RULES.md` for this phase.

Read `CLAUDE.md` only when OPENCODE.md points you there. Its "Hard rules" always apply.

---

## Quick start for Fahad (Sefat-Ullah-Fahad)

### Your current tasks (from `firmivra-team` OPENCODE.md)

| Task                                          | PR / Branch                          | Ledger rows | What to fix                                                                                                                                 |
| --------------------------------------------- | ------------------------------------ | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| **T2** Portal confirm message survives reload | #1679 `rasel/R60-portal-confirm`     | **8 / P8**  | "Your appointment is confirmed." message disappears on list reload in client portal                                                         |
| **T3** Notice history + Settings saved        | #1677 `rasel/R56-appointments-swarm` | **B8, D4**  | B8: sent reminder doesn't appear in notice history after reload. D4: "Settings saved." message sometimes doesn't appear (flaky 20s timeout) |

### Your assigned pages (from `docs/junior/PAGE-MAP.md`)

**Firm workspace** (`apps/web/src/app/firm/(workspace)/`):

- `/sign-in`, `/forgot-password`, `/reset-password`, `/activate` (F02)
- Shell menu & `/` dashboard (F03)
- `/clients`, `/clients/[id]`, `/clients/[id]/documents`, `/clients/[id]/invoices`, `/sign-ups` (F06–F07)
- `/invoices`, `/workspaces`, `/workspaces/[engagementId]` (F10–F11)

**Client portal** (`apps/web/src/app/portal/[firmSlug]/`):

- Appointments tabs (for T2 confirm message fix)

**Super Admin** (`apps/web/src/app/admin/`):

- `/sign-in`, `/forgot-password`, `/reset-password` (F02)

**Services & Pricing** (5 pages):

- `/services-pricing/inactive`, `/services-pricing/new`, `/services-pricing/[id]`, `/services-pricing/[id]/edit`, `/services-pricing/packages/new`

**Packages you own**: `packages/ui` (design system tokens & components)

---

## Commands you'll run daily

```bash
# Morning sync (MERGE, never rebase)
git fetch origin && git merge origin/main

# Start local stack
docker compose up -d
pnpm dev                          # web on :3000, API on :4000/api/v1

# Checks before PR
pnpm lint && pnpm typecheck && pnpm test

# Run YOUR API e2e test file (Docker must be up)
pnpm --filter @firmivra/api exec vitest run test/e2e/<your-module>.e2e.test.ts

# Run isolation tests (if you added a route or body id)
pnpm --filter @firmivra/api exec vitest run test/isolation

# Run YOUR mock Playwright spec (CI does NOT run these)
pnpm --filter @firmivra/web exec playwright test -c playwright.mock.config.ts e2e/mock/<your-spec>.spec.ts

# Build web only
pnpm --filter @firmivra/web build
```

---

## Key rules (from CLAUDE.md "Hard rules")

1. **Never edit** `packages/db/prisma`, `infra/`, or `.github/workflows/` — open a "Schema or infra request" issue instead
2. **All DB access** goes through tenant-scoped client: `forBusiness(businessId)` or request-scoped `TenantPrisma`; `businessId` comes from server context, never request body
3. **No secrets, no .env, no real client data** in code, tests, commits, or AI prompts — refer to rows by ID only (e.g., "Appointments 8/P8")
4. **UI only from `@firmivra/ui`** — no hard-coded colours, font sizes, spacing; use token classes (`bg-surface`, `text-muted`, `border-border`)
5. **Every new route or body id** needs a tenant-isolation case in `apps/api/test/isolation/cases/<module>.ts` with `bodyIds` — CI fails without it
6. **Mock first** — build against typed mocks (`NEXT_PUBLIC_API_MOCK=<module>` in `apps/web/.env.local`); remove when API reaches `main`
7. **Git**: branch `<name>/T<issue#>-short-name` from `main`; merge `origin/main` before every push; never force-push; conventional commit messages (`fix:`, `feat:`, etc.); no `Co-Authored-By` lines

---

## Test requirements for your PR

| Type             | When to run               | Command                                                                                                 |
| ---------------- | ------------------------- | ------------------------------------------------------------------------------------------------------- |
| `pnpm lint`      | Every PR                  | `pnpm lint`                                                                                             |
| `pnpm typecheck` | Every PR                  | `pnpm typecheck`                                                                                        |
| Unit tests       | If you changed logic      | `pnpm test`                                                                                             |
| API e2e          | If you touched API        | `pnpm --filter @firmivra/api exec vitest run test/e2e/<module>.e2e.test.ts`                             |
| Isolation        | New route or body id      | `pnpm --filter @firmivra/api exec vitest run test/isolation`                                            |
| Mock Playwright  | Every UI page you changed | `pnpm --filter @firmivra/web exec playwright test -c playwright.mock.config.ts e2e/mock/<spec>.spec.ts` |

**CI runs lint, typecheck, unit, API e2e — NOT mock Playwright specs.** Put mock spec pass counts in PR body.

---

## Manual browser check (REQUIRED before "ready for review")

1. Run `pnpm dev`, sign in at `http://app.localhost:3000` (use quick sign-in buttons)
2. For **each ledger row**, follow **Octavia's exact steps** from `reviews/`:
   - Do exactly what she did, read every message on screen
   - Reload page — change must persist
   - Press Back — page must hold its place
3. Check corners:
   - As **Staff** user (not just Owner)
   - Empty data, long name, wrong value
   - Phone width (390 px): no horizontal scroll
   - Emails in Mailpit at `http://localhost:8025`
4. Add **Manual check** section to PR: steps clicked, what you saw, screenshots/recording

---

## Where code lives for your tabs (from `docs/junior/OPENCODE.md` section 4)

| Tab                | Web (firm)                                                    | Web (client portal)                                                                   | API module                       |
| ------------------ | ------------------------------------------------------------- | ------------------------------------------------------------------------------------- | -------------------------------- |
| Appointments       | `apps/web/src/app/firm/(workspace)/calendar/`                 | `portal/[firmSlug]/(client)/(tabs)/appointments/`, `portal/[firmSlug]/(public)/book/` | `apps/api/src/appointments/`     |
| Clients            | `apps/web/src/app/firm/(workspace)/clients/`                  | —                                                                                     | `apps/api/src/clients/`          |
| Invoices           | `apps/web/src/app/firm/(workspace)/invoices/`                 | `portal/[firmSlug]/(tabs)/invoices/`                                                  | `apps/api/src/payments/`         |
| Services & Pricing | `apps/web/src/app/firm/(workspace)/services-pricing/`         | —                                                                                     | `apps/api/src/services-pricing/` |
| Dashboard          | `apps/web/src/app/firm/(workspace)/page.tsx` + `_components/` | —                                                                                     | `apps/api/src/dashboard/`        |

**Shared patterns:**

- Types: `packages/types/src/<module>/`
- Web API client: `apps/web/src/lib/api.ts`
- Browser mocks: `apps/web/src/mocks/<module>.ts`
- API e2e: `apps/api/test/e2e/<module>*.e2e.test.ts`
- Mock specs: `apps/web/e2e/mock/*<tab>*.spec.ts`

**Never read:** `node_modules/`, `.next/`, `dist/`, `pnpm-lock.yaml`, `packages/db/prisma/migrations/`, generated files (`packages/types/src/db-enums.ts`)

---

## Your PR template (from `DEVELOPERS.md` section 4)

**Title:** `fix: Appointments 8/P8 confirm message stays (Fahad)`

**Body:**

- Ledger row IDs covered (e.g., `8, P8, B8, D4`)
- One line per row: "Her words → what it does now"
- Tests run with counts:
  - Unit: X passed
  - API e2e: X passed (file name)
  - Isolation: X passed
  - Mock Playwright: X passed (spec name)
- Screenshots for UI changes
- **Manual check** section with steps and evidence

---

## When stuck (>30 min)

Post in your task issue: ticket ID, screenshot, exact error text, what you tried. Don't let AI "fix" it by changing files outside your folders.

---

## Key files to reference

- `CLAUDE.md` — hard rules, architecture, commands
- `docs/junior/OPENCODE.md` — setup, tab code locations, test commands
- `docs/junior/FIX-PHASE.md` — fix phase overrides (full stack, not web-only)
- `docs/junior/AI-RULES.md` — what AI tools get wrong in this repo
- `docs/junior/GUIDE.md` — how to build a screen, mock-first workflow
- `docs/junior/PAGE-MAP.md` — your exact files and mockups
- `docs/design-match.md` — 6 rules + checklist for matching designs
- `docs/ui-kit.md` — available `@firmivra/ui` components
- `firmivra-team/DEVELOPERS.md` — daily cycle, PR process, manual check
- `firmivra-team/GIT-WORKFLOW.md` — exact git commands
- `firmivra-team/OPENCODE.md` — your current task assignments
