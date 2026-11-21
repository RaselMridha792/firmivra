# Fix phase: Nov 21–30, 2026

From Nov 21, Arfan, Tumit, Fahad and Nahid fix the client's review rows across the whole stack, not only web pages. The lead assigns each task in the team's private coordination repo. Each task names the exact rows to fix. For this phase, this file overrides the "web pages only" limits in `docs/junior/AI-RULES.md` and `docs/junior/PAGE-MAP.md`. Every other rule in `CLAUDE.md` still applies.

## What you may change
- `apps/web`, `apps/api` and `packages/types`, but only for the rows in your task.
- Tests: unit, API e2e (`apps/api/test/e2e`), tenant isolation (`apps/api/test/isolation/cases/<module>.ts`) and mock Playwright specs (`apps/web/e2e/mock`).

## What still needs Rasel's written yes first
- `packages/db` (schema, migrations, seeds, db tests), `infra/` and `.github/`. Stop and tell the lead what you need.

## The rules that matter most
1. **Match the client's exact words.** Read the row text before coding. Where the text says confirm, clarify, agree or decide, don't decide it: tell the lead, who records it as a question for the client.
2. **Every new route, or new id in a request body, needs a tenant-isolation case** (with `bodyIds`). CI fails without one.
3. **CI does not run Playwright mock specs.** Run the specs for every page you touched and put the pass counts in the PR body:
   `pnpm --filter @firmivra/web exec playwright test -c playwright.mock.config.ts <spec>`
4. **Merge, never rebase:** `git fetch origin && git merge origin/main` before opening the PR and whenever it conflicts.
5. **Describe rows by their ID only** (e.g. "Appointments 8/P8") in commits, PRs and code comments. This repo is public: no client names, emails, review text or other client data.
6. No secrets, no `.env`, and no `Co-Authored-By` or "Generated with" lines.

## Branch and PR
- Branch: `<name>/T<task#>-short-name`, from the latest `main`. If the task names an existing WIP branch, continue on that branch.
- PR title: a Conventional Commit plus your name, e.g. `fix: Appointments 8/P8 confirm message stays (Fahad)`.
- PR body:
  - the row IDs it covers;
  - one line per row on what it does now;
  - the tests run, with counts;
  - screenshots for UI changes.
- The lead reviews it, merges it (merging to `main` deploys dev) and checks it on dev.
