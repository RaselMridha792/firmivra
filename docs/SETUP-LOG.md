# Sprint 0 setup log

Running checklist for the initial setup, following `SETUP-GUIDE.md` (Steps 1 to 10). Updated at the end of every phase.

## Status

| Step | What | Status |
| --- | --- | --- |
| 1 | Tools | Done (Oct 4) |
| 2 | GitHub repo, rules, labels, environments, board | Done (Oct 4), 2 items left for Rasel |
| 3 | Clone | Not needed: the existing clone at `F:\Business-full-stack-project` is the repo |
| 4 | Docs and repo conventions | Done (Oct 4, PR #1) |
| 5 | AWS foundation (one account: CLI, budget, Route 53, SES, SNS, Stripe) | In progress: CLI, budget and hosted zone done; GoDaddy NS record, root MFA, Stripe and SNS SMS open |
| 6 | Monorepo, Docker, database, API, web | 6.1 and 6.2 in progress on `rasel/setup-skeleton`; 6.3 to 6.5 next |
| 7 | CDK infrastructure, deploy to dev | To do |
| 8 | CI/CD | To do |
| 9 | Developer branches, task docs, Sprint 0 and 1 issues | Branches and task docs done (Oct 4); issues to do |
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
| Oct 4 | AWS accounts | One existing account `778127141557`; no new dev and prod accounts. Only `firmivra-dev-*` stacks for now; prod stacks later, decided with Octavia | Separate dev and prod accounts under AWS Organizations |
| Oct 5 | Budget alerts | proniizam@gmail.com and octaviakholder@gmail.com | — |
| Oct 5 | Root MFA, Stripe, SNS SMS | Postponed; tracked under "Left for Rasel" | Done in Step 5 |

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

## Step 4: docs and conventions (done, PR #1)

- `docs/SCRUM-PLAN.md` (copy), `docs/SYSTEM-DESIGN.md` (text from the HTML, diagrams written as lists), `docs/PROJECT-DRAFT-v2.md` (text from the PDF).
- `docs/mockups/`: begin-online (26), client-portal (18), super-admin (5). Original file names kept; one leading space removed (`Business Startup Guide Dashboard.png`).
- `docs/specs/`: client-portal (8), super-admin (2), platform-guide (1) `.docx` files.
- `CLAUDE.md`, `.github/CODEOWNERS`, PR template, issue templates (feature, bug, schema-or-infra-request), `.editorconfig`, `.nvmrc`, `.gitattributes`, `.gitignore`, `README.md`. Removed the empty `index.html`.

## Step 5: AWS foundation, one account (in progress)

- Account `778127141557` ("Firmivra"), region us-east-1 for everything we build. It is the management account of organization `o-i2ha640j3z` (the only member), which IAM Identity Center needs. No new accounts.
- CLI: profile `firmivra-dev` in `~/.aws/config` through IAM Identity Center (portal `https://d-9a675f50bd.awsapps.com/start`, Identity Center region **us-east-2**), permission set `AdministratorAccess`. Sign in with `aws sso login --profile firmivra-dev`. The Identity Center user is "Nizam".
- Account state on Oct 4: no stacks, no CDK bootstrap, only default VPCs (us-east-1 and eu-north-1). No IAM users, no root access keys, **root MFA off**. SES in sandbox (200 emails a day). No Route 53 hosted zones; firmivra.com is not registered in this account.
- Budget (done, Oct 5): `firmivra-monthly-cost`, $150 a month, email alerts at 50%, 80% and 100% of actual cost to proniizam@gmail.com and octaviakholder@gmail.com (each address confirms an AWS subscription email). "My Zero-Spend Budget" deleted.
- Route 53 (done, Oct 5): public hosted zone `dev.firmivra.com`, id `Z09182951RY8TUAZ5WCXR` ($0.50 a month). Name servers: `ns-1114.awsdns-11.org`, `ns-705.awsdns-24.net`, `ns-168.awsdns-21.com`, `ns-1942.awsdns-50.co.uk`.
- firmivra.com DNS is at **GoDaddy** (`ns05.domaincontrol.com`, `ns06.domaincontrol.com`). `dev.firmivra.com` is not delegated yet.
- SES domain identity and DKIM records come from CDK in Step 7; production access is requested after the domain is verified.

## Step 9: developer branches (done, Oct 4)

`fahad/FIR-0-onboarding`, `nahid/FIR-0-onboarding`, `tumit/FIR-0-onboarding`, `ibrahim/FIR-0-onboarding`, each with `docs/tasks/<NAME>.md` (a short repo note on top, then the original task doc). Sprint 0 and Sprint 1 issues on the board are still to do.

## Left for Rasel

- [ ] Board: switch "View 1" to Board layout and save (the API cannot change the layout).
- [ ] Nahid and Ibrahim: accept their repo invitations.
- [ ] Confirm with Octavia that her mockups and specs can be public.
- [ ] Step 8: add `ci` as a required status check in `protect-main` after the first CI run.
- [ ] Root user MFA on account `778127141557` (sign in as root → Security credentials → Assign MFA device); root password in Octavia's password manager.
- [ ] Stripe: create the Firmivra account in test mode; the test keys go into GitHub environment secrets in Step 8.
- [ ] SNS SMS: exit the SMS sandbox, raise the spend limit, request a US toll-free number and submit its registration (clicks under "SNS SMS steps" below). Needs Octavia's legal company name and address, and a live firmivra.com page, first. **Target: submit by Oct 16** so it is approved before Sprint 2 (Nov 2).
- [ ] GoDaddy (whoever owns firmivra.com): **My Products → firmivra.com → DNS → Add New Record**, type **NS**, name **dev**, value one name server, TTL 1 hour. Repeat for all 4: `ns-1114.awsdns-11.org`, `ns-705.awsdns-24.net`, `ns-168.awsdns-21.com`, `ns-1942.awsdns-50.co.uk`. Check: `Resolve-DnsName dev.firmivra.com -Type NS` lists the four.

## SNS SMS steps (console, region us-east-1)

1. **Amazon SNS → Text messaging (SMS) → Exit SMS sandbox.** This opens a support case. Region US East (N. Virginia). Ask to exit the SMS sandbox and, in the same case, for an account spend threshold of $50 a month (default $1). Use case: verification codes and account notifications for Firmivra client-portal users who enter their phone at sign-up; no marketing.
2. **AWS End User Messaging SMS → Configurations → Phone numbers → Request originator.** Country United States, use case Transactional, type Toll-free.
3. **Registrations → Create registration → US toll-free number registration**, for the new number. Company name, address and contact (from Octavia), website firmivra.com (must be live), use case one-time passcodes and account notifications, opt-in "user enters their phone at sign-up and verifies it" (screenshot: `docs/mockups/client-portal/Verify phone.png`), sample message `Firmivra: your verification code is 123456. It expires in 10 minutes. Reply STOP to opt out.`, volume under 1,000 a month. Review takes about 2 to 3 weeks; the number cannot send until approved.

Console menu names change from time to time; pick the closest match.

## Still open from the plan

- Who has the GoDaddy login for firmivra.com (Octavia?)
- LVP's own Terms and Privacy, approved calculators and formulas, mockups for appointments, My Services, notification center and service workspaces.
