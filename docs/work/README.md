# Parallel Claude Code sessions (Rasel's workstreams)

Firmivra Phase 1 ships in 15 days: Oct 4 to Oct 18, 2026. Rasel builds the complex parts with several Claude Code sessions running at the same time, one per workstream. This folder is how those sessions stay out of each other's way and keep their context small.

## Files

| File | What it is | Who edits it |
| --- | --- | --- |
| `README.md` | These rules | Rasel |
| `BOARD.md` | Status of every workstream, DB lock, handoffs. Git-ignored: it lives only in the main checkout (`../Business-full-stack-project/docs/work/BOARD.md` from a worktree) | Only the lead session |
| `R0-schema.md` ... `R12-calendar-content.md` | One workstream each: scope, owned paths, steps, progress log | Only that workstream's session |

## How a workstream session runs

1. Each workstream has its own git worktree and branch, created from fresh `origin/main`:
   `git worktree add ../firmivra-R2 -b rasel/R2-staff-auth origin/main`
   Open a separate Claude Code session in that folder. Never run two sessions in the same folder.
2. First message to the session (copy it, change the number):
   `You are workstream R2. Read CLAUDE.md, docs/work/README.md and docs/work/R2-staff-auth.md only. Continue from the first unchecked step. Ask before anything that creates, deletes or deploys.`
3. The session reads ONLY: `CLAUDE.md`, this README, its own `Rn-*.md`, and the files its `Rn` file links. It does not explore the whole repo.
4. After each step: tick the step in its `Rn` file, add one line to its Progress log (date, what was done, commit), commit. This keeps context small: when the context gets big, run `/clear` and send the same first message again; the session resumes from the log.
5. One PR per finished step or pair of steps, titled as a Conventional Commit with the stream at the end: `<type>: <what> (R2)`, for example `feat: staff sign-in with MFA (R2)`. The squash commit on `main` takes the PR title. PRs stay under ~600 changed lines where possible.
6. Before opening a PR: `git fetch origin && git merge origin/main`, then `pnpm lint && pnpm typecheck && pnpm test`. Merge, never rebase: `main` takes squash merges only, so a rebase would replay commits that are already merged and then need a force-push. Never force-push. After a PR is squash-merged, merge `origin/main` into the branch the same way and continue.

## Limits

- At most **3 workstream sessions active at once**, plus the lead session. Rasel reviews every diff.
- **Paths:** the owned paths in each `Rn` file are the expected layout. If the repo differs, the session maps them once and notes the real paths in its Progress log.
- **Owned paths:** a session changes only the paths its `Rn` file owns. If it needs a change elsewhere, it writes a note under "Needs from others" in its own file and stops that step. One exception: it may add the lines that register its own code: its module import in `apps/api/src/app.module.ts`, its export in `packages/types/src/index.ts`, and its own dependencies in `apps/api/package.json` and `pnpm-lock.yaml` (`pnpm --filter @firmivra/api add <package>`). On a `pnpm-lock.yaml` conflict, take `main`'s version and run `pnpm install`.
- **Database lock:** only the session holding the DB lock (see `../Business-full-stack-project/docs/work/BOARD.md`) changes `packages/db` (schema or migrations). Ask the lead session to hand over the lock. R0 holds it by default.
- **Migrations:** create with `pnpm --filter @firmivra/db prisma migrate dev --name rN-short-name`. If `main` got a newer migration before you merge, merge `origin/main`, delete your migration folder, and generate it again.
- **Local database per session:** each worktree uses its own database in the shared Docker Postgres (port 5433) so tests don't collide. In the worktree's `.env` set the database name to `firmivra_rN` (e.g. `firmivra_r2`) and run the migrate + seed commands from the README once.
- **Local ports per session:** web `33N0`, API `43N0` (R2 = 3320 / 4320). Main checkout keeps 3300 / 4300, so R0 uses 3390 / 4390 instead (slot 9 is free: R9 runs in the main checkout).
- **Never:** commit `.env` or secrets (the repo is public), push to `main`, deploy to prod, run `cdk deploy` or any AWS create/delete without showing the command and getting Rasel's yes.

## The lead session (main checkout `Business-full-stack-project/`)

- Keeps `BOARD.md` current, hands the DB lock, reviews and merges PRs (Rasel's own setup PRs via squash merge with admin bypass; developers' PRs through normal review and approve).
- Creates worktrees for the next workstreams and removes finished ones: `git worktree remove ../firmivra-R2`.
- Answers "what's next" from `BOARD.md` and the 15-day table below.

## 15-day calendar

| Day | Date | Rasel's workstreams | Gate |
| --- | --- | --- | --- |
| 3 | Oct 6 | R1 CI/CD, R0 schema, R2 auth contract | merge to main deploys to dev |
| 4-5 | Oct 7-8 | R2 staff and admin auth, R0 rest of schema | |
| 5-6 | Oct 8-9 | R3 client accounts | sign-in works on all three dev sites |
| 7 | Oct 10 | R4 firm application and activation | |
| 8 | Oct 11 | R5 secure documents | |
| 9 | Oct 12 | R6 email and SMS sender | firm applies, approved, activates, invites a client who uploads a document |
| 10-11 | Oct 13-14 | R7 Stripe | |
| 12-13 | Oct 15-16 | R8 support access, hardening, prod stacks | every screen on dev, isolation suite green |
| 14-15 | Oct 17-18 | R9 review fixes and release | production live for LVP |
