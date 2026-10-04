# Sprint 0 setup log

Running checklist for the initial setup, following `SETUP-GUIDE.md` (Steps 1 to 10). Updated at the end of every phase.

## Status

| Step | What | Status |
| --- | --- | --- |
| 1 | Tools | Done (Oct 4) |
| 2 | GitHub repo, rules, labels, environments, board | Done (Oct 4), 2 items left for Rasel |
| 3 | Clone | Not needed: the existing clone at `F:\Business-full-stack-project` is the repo |
| 4 | Docs and repo conventions | In review on `rasel/setup` |
| 5 | AWS foundation (accounts, Identity Center, budgets, Route 53, Stripe, SES, SNS) | To do |
| 6 | Monorepo, Docker, database, API, web | To do |
| 7 | CDK infrastructure, deploy to dev | To do |
| 8 | CI/CD | To do |
| 9 | Developer branches, task docs, Sprint 0 and 1 issues | To do (branches right after Step 4 merges) |
| 10 | Sprint 0 done checklist | To do |

## Decisions from Rasel

| Date | Topic | Decision | Guide default it replaces |
| --- | --- | --- | --- |
| Oct 4 | Dev machine | Native Windows 11 (PowerShell and Git Bash), no WSL | WSL2 Ubuntu |
| Oct 4 | GitHub owner | Personal repo `RaselMridha792/firmivra`; no organization or teams | Organization `firmivra` |
| Oct 4 | Visibility | Public | Private |
| Oct 4 | Client docs in the repo | Commit all of them (option B): design, draft, mockups, specs. To confirm with Octavia | — |
| Oct 4 | Collaborators | Added by Rasel with Write; Claude only creates the developer branches | Org invites and teams |
| Oct 4 | Commits | Authored as RaselMridha792 only, no AI co-author lines | — |

Team on GitHub: Fahad `Sefat-Ullah-Fahad`, Tumit `tumit-h-r-75`, Ibrahim `BFIbrahim`, Nahid `asratulhasannahid`. Octavia is not a collaborator.

## Step 1: tools (done)

git 2.55.0, node 22.23.2, pnpm 10.32.1, Docker 29.8.0, gh 2.101.0 (scopes include `admin:org`, `project`), aws-cli 2.37.9, cdk 2.1144.0.

## Step 2: GitHub (done)

- Merging: squash only, PR title and body as the commit, branches deleted after merge.
- Labels: frontend, backend, schema, infra, bug, blocked, sprint-0 to sprint-6.
- Ruleset `protect-main` (default branch): no deletion, no force push, linear history, restrict updates (only Rasel can merge), PR with 1 approval from a code owner, stale approvals dismissed, squash only. Bypass: repository admin (Rasel).
- Ruleset `protect-release-tags` (`refs/tags/v*`): only Rasel can create, move or delete release tags.
- Environment `dev`: deployable only from `main`. Environment `prod`: required reviewer Rasel, deployable only from `v*` tags.
- Public-repo hardening: approval needed before CI runs on PRs from outside contributors; workflow token read-only by default; secret scanning, push protection, Dependabot alerts and security updates on.
- Board: https://github.com/users/RaselMridha792/projects/3 with Status (Backlog, Ready, In progress, In review, Done), Points, and Sprint (2-week iterations, Sprint 0 from Oct 5 to Sprint 6 from Dec 28). Linked to the repo; Assignees is the owner field.

## Step 4: docs and conventions (in review)

- `docs/SCRUM-PLAN.md` (copy), `docs/SYSTEM-DESIGN.md` (text from the HTML, diagrams written as lists), `docs/PROJECT-DRAFT-v2.md` (text from the PDF).
- `docs/mockups/`: begin-online (26), client-portal (18), super-admin (5). Original file names kept; one leading space removed (`Business Startup Guide Dashboard.png`).
- `docs/specs/`: client-portal (8), super-admin (2), platform-guide (1) `.docx` files.
- `CLAUDE.md`, `.github/CODEOWNERS`, PR template, issue templates (feature, bug, schema-or-infra-request), `.editorconfig`, `.nvmrc`, `.gitattributes`, `.gitignore`, `README.md`. Removed the empty `index.html`.

## Left for Rasel

- [ ] Board: switch "View 1" to Board layout and save (the API cannot change the layout).
- [ ] Nahid and Ibrahim: accept their repo invitations.
- [ ] Confirm with Octavia that her mockups and specs can be public.
- [ ] Step 8: add `ci` as a required status check in `protect-main` after the first CI run.

## Still open from the plan

- Does Octavia own firmivra.com, and who controls its DNS (needed in Step 5.4)?
- LVP's own Terms and Privacy, approved calculators and formulas, mockups for appointments, My Services, notification center and service workspaces.
