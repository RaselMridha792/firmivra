# OpenCode guide: the short version (read this, not the whole repo)

For Arfan, Tumit, Fahad and Nahid using OpenCode during the fix phase (Nov 21–30, 2026). It is written to save tokens: read only what this page points to.

## 1. Rules (the full list is in CLAUDE.md "Hard rules"; don't reread it every task)
1. Fix ONLY the rows in your task. Match the client's exact words.
2. Where her text says confirm, clarify, agree or decide, don't decide it: stop and write the question in your task issue.
3. Never edit `packages/db`, `infra/` or `.github/` without Rasel's written yes.
4. Every DB access goes through the tenant-scoped client; `businessId` comes from server context, never from the request.
5. New route or new id in a request body: add a tenant-isolation case (`apps/api/test/isolation/cases/<module>.ts`, with `bodyIds`).
6. UI uses `packages/ui` components and tokens only.
7. No secrets, no `.env`, no real client data (names, emails, review text) in code, tests, commits or AI prompts. Refer to rows by ID ("Appointments 8/P8").
8. Never push to `main`, never rebase, never force-push. No `Co-Authored-By` or "Generated with" lines.

## 2. Setup (once per laptop)
1. Install Node **22.22+**, Git, Docker Desktop and the GitHub CLI (`gh auth login`). Then `corepack enable` (the repo uses pnpm 10.32).
2. Clone the repo and install:
   ```bash
   git clone https://github.com/RaselMridha792/firmivra.git && cd firmivra
   pnpm install
   cp .env.example .env              # local placeholders are fine; never commit .env
   ```
3. Start **Docker Desktop** first, then the local services:
   ```bash
   docker compose up -d              # Postgres (localhost:5433), s3mock (:9090), Mailpit (:8025 web, :1025 smtp)
   docker compose ps                 # all three must say "healthy"
   pnpm db:migrate && pnpm db:seed   # schema + test data (Super Admin, LVP, Test Firm B)
   pnpm dev                          # web http://app.localhost:3000, portal http://portal.localhost:3000/lvp, API :4000/api/v1
   ```
   Local sign-in shows quick buttons for the seeded users (`AUTH_MODE=local`). Emails land in Mailpit at http://localhost:8025.
4. Open the `firmivra` folder in OpenCode. It reads `AGENTS.md` by itself, and no extra skills are needed.

**If something breaks:**
- `ECONNREFUSED 5433`: Docker Desktop isn't running. Start it, then run `docker compose up -d`.
- Prisma errors after a pull: run `pnpm install`, then `pnpm --filter @firmivra/db exec prisma generate`, then `pnpm db:migrate`.
- Local data is messed up: `docker compose down -v`, then run `up -d`, `db:migrate` and `db:seed` again. This wipes YOUR local database only.
- Out of memory: close other apps, and run one test command at a time.

## 3. One task = one fresh OpenCode session
1. Start a **new session** for each task, then paste this:
   ```text
   Fix-phase task in the Firmivra repo. Read ONLY: AGENTS.md, docs/junior/OPENCODE.md, then the files I name.
   Task: <paste the GitHub issue text: rows + her words, no client names or emails>
   Files to start from: <paths from section 4 for this tab>
   First give me a short plan (files to change, tests to add). Wait for my "go".
   ```
2. After the plan, say "go". Review every diff before it's applied.
3. When the context gets long, use `/compact` (or start a new session with a 5-line summary of where you are).

## 4. Where each tab's code lives (search here first, don't scan the repo)
| Tab | Web (firm) | Web (client portal) | API module |
|---|---|---|---|
| Appointments | `apps/web/src/app/firm/(workspace)/calendar/` | `portal/[firmSlug]/(client)/(tabs)/appointments/`, public booking `portal/[firmSlug]/(public)/book/` | `apps/api/src/appointments/` |
| Tax Returns | `.../(workspace)/tax-returns/` | `(tabs)/requests`, `(tabs)/signatures` | `tax-returns/` |
| Tax Planning | `.../(workspace)/tax-planning/` | `(tabs)/tax-plans/` | `tax-planning/` |
| Intake Forms | `.../(workspace)/intake-forms/` | intake pages | `intake/`, `intake-workspace/`, `intake-link/` |
| Bookkeeping / Payroll | `.../bookkeeping/`, `.../payroll/` | `(tabs)/requests` | `bookkeeping/`, `payroll/` |
| Leads | `.../leads/` | — | `leads/` |
| Dashboard | `.../page.tsx` + `_components/` | — | `dashboard/` |
| Audit Log | `.../audit-log/` | — | `audit-viewer/`, `audit/` |
| Clients | `.../clients/` | — | `clients/` |
| Staff / Team | `.../team/` | — | `staff/`, `team/`, `roles/` |
| Invoices | `.../invoices/` | `(tabs)/invoices/` | `payments/` |
| Templates / Communications | `.../templates/`, `.../communications/`, `.../messages/` | — | `templates/`, `communications/`, `messages/` |
| Super Admin | `apps/web/src/app/admin/` | — | `admin-*/`, `firm-applications/` |

The same name pattern holds everywhere:
- types: `packages/types/src/<module>/`
- web API client: `apps/web/src/lib/api.ts`
- browser mocks: `apps/web/src/mocks/<module>.ts`
- API e2e: `apps/api/test/e2e/<module>*.e2e.test.ts`
- mock specs: `apps/web/e2e/mock/*<tab>*.spec.ts`

Never read: `node_modules/`, `.next/`, `dist/`, `pnpm-lock.yaml`, the whole `packages/db/prisma/migrations/` folder, or generated files (`packages/types/src/db-enums.ts`). To find something, use grep with a specific word.

## 5. Tests: run only what you touched
```bash
pnpm --filter @firmivra/web typecheck            # or @firmivra/api
pnpm --filter @firmivra/api exec vitest run test/e2e/appointments.e2e.test.ts   # one API e2e file (Docker must be up)
pnpm --filter @firmivra/api exec vitest run test/isolation                      # if you added a route or body id
pnpm --filter @firmivra/web exec playwright test -c playwright.mock.config.ts e2e/mock/<spec>.spec.ts
```
CI runs lint, typecheck, unit and API tests on your PR, but **not** the mock Playwright specs. Put your mock spec pass counts in the PR body.

## 5b. Check every row by hand in the browser (required)
Before a PR is "ready", open the site with `pnpm dev` and click through every row yourself, following the client's steps:
1. Do exactly what she did and read every message on the screen.
2. Reload the page and check the change stayed.
3. Press Back and check the page still holds its place.

Then check the corners:
- as a Staff user, not just the Owner;
- with empty data, a long name and a wrong value;
- at phone width (390 px in browser devtools): no sideways scroll;
- the emails in Mailpit at http://localhost:8025.

Add a **Manual check** section to the PR: the steps you clicked for each row, what you saw, and screenshots or a short recording. After the merge, look at the same steps on the dev site too.

## 6. Picking a model (to save free-tier limits)
- **Plan, backend (API, permissions, isolation), multi-file fixes:** use the strongest model you have.
- **Small UI text or styling, test updates, renames:** a fast "flash" model is enough.
- If a model is rate-limited or keeps making the same mistake, switch to another one and paste your 5-line summary.
- Only use providers that don't train on your prompts (in OpenRouter, turn off providers that train on data). Even then, never paste client names, emails or full review text.

## 7. Git: pull from main, push to your task branch
Your task issue says which branch to use. The full steps are in the team repo's GIT-WORKFLOW.md. In short:
```bash
git fetch origin && git merge origin/main     # every morning and before every push (MERGE, never rebase)
git push                                      # to your task branch only; the PR into main updates by itself
```

## 8. Guards (Rasel, Nov 23): the tools now stop the common mistakes

Activate the git hooks once per clone, then check:

```bash
pnpm exec husky
git config core.hooksPath   # must print .husky/_
```

| When | What blocks you | What to do |
|---|---|---|
| `git commit` | an empty commit; text with broken encoding (a dash or "..." turned into 2-3 odd characters); `AGENTS.md`, `CLAUDE.md` or `apps/web/e2e/live/`; `packages/db`, `infra/`, `.github/` without approval; a `.env` file | Fix the files. Write files only with the editor tool or node, never PowerShell `Set-Content`/`Out-File`. Approved db task: `FIRMIVRA_APPROVED=1 git commit ...` |
| `git commit` | a subject that isn't `fix: ...` / `feat: ...` / `test: ...`; "Co-Authored-By" or "Generated with" lines | Fix the message |
| `git push` | a package you changed doesn't typecheck | Fix the errors, commit, push again |
| PR (CI "PR shape") | no code or test files changed; no `Rows:` line; no `Tests:` line with counts; no `Manual check` section | Push code, or edit the PR body |

- Never use `--no-verify`.
- Never edit `apps/web/e2e/live/`. The lead runs the live checks on dev. You fix product code, with unit tests, API e2e tests and mock specs.
- 30-minute rule: stuck on setup, a test harness or the environment for 30 minutes? Write `BLOCKED-ENV` and the exact error on your issue, and go to the next row.
- A row that already works is not a PR. Post the check (steps and a screenshot) as a comment on the issue.
