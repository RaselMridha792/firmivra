# Firmivra Scrum Plan

Oct 4, 2026 · Rasel Mridha (Technical Project Manager)

Live version: https://claude.ai/code/artifact/529efdc5-49d1-4878-93b7-cbafed601439

## Overview

Five people build Firmivra Phase 1 (beta) in 2-week sprints: a Sprint 0 where Rasel sets up AWS, the repo, foundations and CI/CD, then 6 feature sprints that deliver the firm workspace, the client portal and the minimal Super Admin for the first beta firm, LVP Accounting & Taxes. Delivery: Oct 18, 2026.

- **Product:** a multi-tenant platform. Super Admin approves businesses, each business works in its own firm workspace, and its clients log in to a branded client portal. Every business sees only its own data.
- **Apps:** admin.firmivra.com (Super Admin), app.firmivra.com (firm workspace), portal.firmivra.com/{firm} (client portal). Dev runs on dev.firmivra.com.
- **Stack:** Next.js, NestJS + Prisma, AWS Cognito, RDS PostgreSQL with per-business row isolation, S3 + KMS, ECS Fargate, Route 53, SES (email), SNS (SMS), Stripe (payments).
- **Priority (from Octavia):** firm workspace and client portal first. Super Admin Phase 1 is only apply, approve or decline, activate.
- **UI rule:** screens must match Octavia's mockups. We build a design system from the mockups first, then real components on top of it.

## Team and roles

| Person | Role | Owns | Pairs with |
| --- | --- | --- | --- |
| Rasel | Technical Project Manager, System Architect | Backlog, sprint planning, architecture, database (Prisma schema and migrations), server and AWS infrastructure, CI/CD, review and merge of every PR into `main`, talking to Octavia | Everyone |
| Fahad | Frontend Developer | Design system and shared UI kit, firm workspace (app.firmivra.com) | Tumit |
| Nahid | Frontend Developer | Client portal (portal.firmivra.com), Begin Online intake, Super Admin screens | Arfan |
| Tumit | Backend Developer | API modules for auth and roles, businesses, users, invites, sign-up approval, support access, appointments, notifications (center and email/SMS), audit log | Fahad |
| Arfan | Backend Developer | API modules for clients, documents, intake, services, service workspaces, messages, invoices and Stripe, tax statuses, calculator | Nahid |

**Who reviews whom:** developers only write code and push it to their own branches. Before Rasel looks at a PR, the developer on the same side gives it a quick pre-review (Fahad and Nahid, Tumit and Arfan). Rasel then reviews, tests and merges every PR into `main`. Backend developers never change the database schema or AWS resources themselves; they ask Rasel through a ticket labelled `schema` or `infra`.

**Pairs:** each frontend developer is paired with one backend developer. The pair agrees the API contract for a feature at the start of the sprint, so both sides build in parallel against the same spec.

## Work process

Every sprint runs the same 2-week loop: plan on day 1, build with a daily stand-up, demo to Octavia and run a retro on the last day.

### Sprint calendar

| When | Meeting | Length | Who | Output |
| --- | --- | --- | --- | --- |
| Day 1 (Monday) | Sprint planning | 2 h | All | Sprint goal, committed tickets, API contracts per pair |
| Every working day | Daily stand-up | 15 min | All | Yesterday, today, blockers |
| Mid sprint (day 5 or 6) | Backlog refinement | 1 h | All | Next sprint's tickets estimated and Ready |
| Day 10 (Friday) | Sprint review / demo | 1 h | All + Octavia | Working features on dev.firmivra.com, Octavia's feedback |
| Day 10 (Friday) | Retrospective | 45 min | All | 1 to 3 process changes for the next sprint |

### How a ticket moves

1. **Backlog:** Rasel writes the story from Project Draft v2 and links the mockup screen.
2. **Ready:** it meets the Definition of Ready below and has a story-point estimate.
3. **In progress:** the developer creates a branch from the latest `main`, named `<name>/FIR-123-short-name` (for example `fahad/FIR-42-login-screen`), and pushes to it as often as they like.
4. **Pull request:** small PR (aim under 400 changed lines) from that branch into `main`. CI must pass: lint, type check, unit tests, build.
5. **Pre-review:** the other developer on the same side reads it and leaves comments.
6. **Review and merge:** Rasel reviews, runs it locally if needed, and squash-merges into `main`. Only Rasel can merge.
7. **Deploy:** the merge to `main` deploys to dev.firmivra.com automatically through CI/CD.
8. **Done:** it meets the Definition of Done and Rasel accepts it on dev.

### Branches and environments

- `main` is the only long-lived branch. It is protected: no direct pushes, PR and green CI required, only Rasel can merge.
- Every merge to `main` deploys to **dev** (dev.firmivra.com).
- **Production** is deployed from a release tag on `main` (for example `v0.3.0`) after a manual approval in GitHub Actions. Octavia reviews on dev before each release.
- Developers run the app locally with Docker (PostgreSQL, s3mock for S3, Mailpit for email; SMS goes to the API log) and need no AWS access.

### Definition of Ready

- [ ] User story with clear acceptance criteria (taken from Project Draft v2's acceptance tests)
- [ ] Linked mockup screen, or a note that none exists
- [ ] API endpoint and request/response shape agreed by the pair
- [ ] Estimated in story points (1, 2, 3, 5, 8; anything bigger is split)

### Definition of Done

- [ ] Code merged to `main` by Rasel with CI green
- [ ] UI matches the mockup on desktop and mobile widths
- [ ] Every query is scoped to the current business (tenant isolation test included for new data)
- [ ] Unit tests for business logic; API endpoint covered by an e2e test
- [ ] Audit log entry for any action on client data
- [ ] Works on dev.firmivra.com and Rasel has accepted it

### Estimation and capacity

We estimate in story points with planning poker. Sprint 1 commits to about 20 points per developer; from Sprint 2 the team uses its measured velocity from the previous sprint.

## Sprint 0: setup and foundations (Oct 5 to Oct 16)

Rasel builds the base everyone else codes on; the four developers spend Sprint 0 on work that needs no running app, so nobody waits.

### Rasel

- [ ] **AWS region:** us-east-1 (N. Virginia). Move off Europe (Stockholm) before creating any resource.
- [ ] **AWS accounts:** one Firmivra-owned setup hosts every firm, isolated per firm in the database and with per-firm KMS keys. Separate dev and prod accounts, a budget alert, MFA for everyone.
- [ ] **Infrastructure as code:** AWS CDK (TypeScript) for VPC, RDS PostgreSQL, S3 + KMS, Cognito user pools, ECS Fargate, CloudFront, SES (email), SNS (SMS), Route 53 records for dev.firmivra.com.
- [ ] **Repository:** one monorepo (Turborepo + pnpm): `apps/web` (Next.js, serves admin, app and portal by host name), `apps/api` (NestJS), `packages/ui` (design system), `packages/db` (Prisma schema), `packages/types` (shared types and API contracts), `infra/` (CDK).
- [ ] **Foundations:** tenant model (`business_id` on every row + PostgreSQL row-level security), Cognito login with roles in token claims, API auth guard and tenant guard, audit log table, error handling, logging, environment config, seed data for LVP.
- [ ] **CI/CD:** GitHub Actions running lint, type check, tests and build on every PR; auto deploy `main` to dev; prod deploys from a release tag with manual approval.
- [ ] **Accounts to open:** Stripe (test mode first), SES production access request, SNS SMS sending for US numbers.
- [ ] **Ask Octavia:** LVP's own Terms and Privacy, the list of approved calculators with their formulas, and mockups for appointments, My Services, the notification center and service workspaces (or we design them from Octavia's design system).
- [ ] **Team setup:** GitHub access, branch protection, PR template, GitHub Projects board, README with local setup, `.env.example`.

### Developers in parallel

| Person | Sprint 0 work |
| --- | --- |
| Fahad | Extract the design system from Octavia's mockups: colours, type scale, spacing, buttons, inputs, cards, tables, modals, sidebar layout. Build them in `packages/ui` with Storybook once the repo exists. Add the firm-side routes for calendar, service workspaces and pending sign-ups. |
| Nahid | Map every client portal and Begin Online mockup to a route and list the components each screen needs, including sign-in, password reset, My Services, appointments, notifications and calculator; flag screens that don't match the written instructions or have no mockup. |
| Tumit | For auth, roles, invites, sign-up approval, support access, legal documents and appointments: list the fields each feature needs and send them to Rasel for the schema; write the role and permission matrix and the OpenAPI spec for these endpoints. |
| Arfan | For clients, documents, intake, services, service workspaces, notifications, messages, invoices and Stripe, tax statuses: list the fields each feature needs and send them to Rasel for the schema; write the OpenAPI spec for these endpoints. |

**Sprint 0 exit:** a developer can clone the repo, run it locally, open a PR, see CI pass, and after Rasel merges, see the change on dev.firmivra.com with a working login.

## Sprint roadmap

Six feature sprints take Firmivra from login to the LVP launch. Superseded on Oct 6: the work follows the 15-day plan in `docs/work/README.md`. Delivery: Oct 18, 2026. Beta also covers Octavia's missing requirements: appointments, My Services, the notification center, portal sign-in and password reset, the calculator, per-firm Terms and Privacy, and the Bookkeeping and Tax Planning workspaces. Payroll operations, the Advisory workspace and Google/Outlook calendar sync start right after beta.

| Sprint | Dates | Theme |
| --- | --- | --- |
| 0 | Oct 5 to Oct 16 | Setup and CI/CD |
| 1 | after Sprint 0 | Sign-in, firm approval |
| 2 | after Sprint 1 | Workspace, client sign-up |
| 3 | after Sprint 2 | Documents, services, notifications |
| 4 | after Sprint 3 | Intake, taxes, service workspaces |
| 5 | after Sprint 4 | Appointments, messages, billing, calculator |
| 6 | after Sprint 5 | Hardening, Octavia's acceptance, LVP launch |

### Sprint 1: sign-in and firm approval

**Goal:** a firm can apply, Super Admin approves it, and the firm owner activates the account and logs in.

| Person | Tickets |
| --- | --- |
| Fahad | Login and /activate screens, app shell (sidebar, header, routing by role), empty firm dashboard |
| Nahid | Public firm application form, Super Admin login, applications list, application detail with approve, request info, decline |
| Tumit | Cognito pools and role claims, firm application API, approve and activate flow, invite emails through SES |
| Arfan | Business settings API, firm-defined tax statuses API, client record CRUD API |

### Sprint 2: firm workspace and client sign-up

**Goal:** a firm sets itself up with its own Terms and Privacy, a client signs up on the firm's portal, and the firm approves the account.

| Person | Tickets |
| --- | --- |
| Fahad | First-time setup wizard (including the firm's Terms and Privacy), team page, clients list and client detail, pending sign-ups queue with approve and decline |
| Nahid | Branded portal landing page, client sign-up, verify email, verify phone, account confirmation, portal sign-in, forgot and reset password, firm legal links in sign-up, login and footer |
| Tumit | Role-based access on every endpoint (owner, admin, staff), team invite API, client self sign-up with firm approval, firm-scoped Cognito password reset that never reveals whether an account exists, per-firm legal documents setting |
| Arfan | Client profile API, tax status tracking per client, firm-side status update API |

### Sprint 3: documents, services, notifications

**Goal:** clients upload documents securely, see their services, and both sides get an in-app notification center.

| Person | Tickets |
| --- | --- |
| Fahad | Client documents view, request a document, document status on the firm side, notification bell and center in the shared UI kit (read and unread, history, link to the record) |
| Nahid | My Docs tab, upload popup, My Profile tab, My Services page (active, recurring, completed, cancelled) |
| Tumit | Audit log API and viewer, Super Admin support access only with the firm owner's time-limited, logged approval, notification center API |
| Arfan | Pre-signed S3 uploads, per-business KMS keys, file type and size checks, document categories, services and engagement API |

### Sprint 4: intake, taxes, service workspaces

**Goal:** a visitor completes Begin Online, the firm turns the lead into a client, clients see their tax status, and staff work Bookkeeping and Tax Planning jobs in a service workspace.

| Person | Tickets |
| --- | --- |
| Fahad | Leads inbox, review lead, convert lead to client, intake review on the client record, service workspace template (status, tasks, documents, notes, reports) for Bookkeeping and Tax Planning, portal Business tab, External links, resource dashboards |
| Nahid | Begin Online flows for the 6 services, review and submit, success pages, Intake form tab, Taxes tab |
| Tumit | Lead to client conversion API, notification service (email through SES, SMS through SNS), external links configuration API |
| Arfan | Intake form definitions and submissions API, tax returns API, service workspace API (Bookkeeping reconciliation and reports, Tax Planning projections) |

### Sprint 5: appointments, messages, billing, calculator

**Goal:** clients book appointments, message the firm, pay invoices with Stripe and use the tax calculator.

| Person | Tickets |
| --- | --- |
| Fahad | Firm calendar, staff availability, working hours and blocked time, firm messages and notes, create and send invoice |
| Nahid | Client booking, reschedule and cancel, portal Messages, Invoices tab with Stripe checkout, Tax Return Calculator and the other approved calculators with disclaimer |
| Tumit | Appointments API with double-booking lock, reminder and change notifications, notification preferences |
| Arfan | Messages API, invoices API, Stripe payments and webhooks, calculator formulas and validation |

This is the heaviest sprint. If Sprint 2's velocity shows we are behind, the calculator and the resource dashboards move after beta first.

### Sprint 6: hardening and LVP launch

**Goal:** LVP goes live on production.

- [ ] Tenant isolation test suite: one business can never read another's data, through any endpoint
- [ ] Security review: auth, file access, rate limits, backups and restore test
- [ ] Pixel check of every screen against Octavia's mockups
- [ ] Octavia's acceptance testing on dev, fixes
- [ ] Production deploy, LVP account set up, first real clients invited

### Right after the LVP launch

- Payroll operations: employees, payroll runs, approvals, filings, W-2/W-3/1099, once the payroll provider is chosen
- Advisory workspace (goals and deliverables) on the same workspace template
- Google and Outlook calendar sync

## Tools, risks and decisions

### Tools

| Need | Tool |
| --- | --- |
| Board, tickets, sprints | GitHub Projects |
| Code, PRs, CI/CD | GitHub + GitHub Actions |
| Coding assistant | Claude Code in VS Code |
| Design reference | Octavia's mockups; Figma if Octavia shares source files |
| Component library | Storybook for `packages/ui` |
| Chat and stand-ups | Slack or Google Meet, one channel per area (frontend, backend, deploys) |
| Docs | This plan, the system design page and Project Draft v2 |

### Risks

| Risk | Impact | What we do |
| --- | --- | --- |
| Data leaks between businesses | Critical | Row-level security in PostgreSQL, tenant guard in the API, isolation tests in CI from Sprint 1 |
| Rasel is the only reviewer and the only owner of database and infra | High | Peer pre-review before Rasel, PRs under 400 lines, two fixed review slots a day, schema and infra requests filed a sprint ahead |
| Scope grew but the date stayed fixed | High | Track velocity from Sprint 1; if behind after Sprint 2, move the calculator and resource dashboards after beta first |
| Screens drift from Octavia's mockups | High | Design system first; frontend PRs include a screenshot next to the mockup |
| New screens have no mockups yet | High | Ask Octavia in Sprint 0; otherwise Fahad designs them from the design system and Octavia approves in the sprint demo |
| Calculator formulas or LVP legal documents arrive late | Medium | Build the screens with placeholders; they block launch, not development |
| Payroll scope unclear | Medium | Kept out of beta; decide the provider before the post-beta sprint |
| Holiday weeks in Sprints 5 and 6 | Medium | Sprint 6 takes no new features; Sprint 5 cuts follow the order above |

### Decisions made (Rasel, Oct 4, 2026)

| Topic | Decision |
| --- | --- |
| Delivery date and scope | Delivery: Oct 18, 2026. Payroll operations, Advisory and calendar sync come right after beta; all other missing requirements are in beta |
| AWS region | us-east-1 (N. Virginia) |
| AWS setup | One Firmivra setup for all firms, isolated per firm |
| Client accounts | Clients sign up on the firm's portal; the firm approves the account afterwards |
| Super Admin access to a firm | Only with the firm owner's time-limited, logged approval |
| Payments | Stripe |
| Payroll provider | Decided after beta |
| Email and SMS | AWS SES and SNS |
| Who touches database and infra | Rasel only; developers write application code on their own branches |
| Who merges | Rasel only, into `main`; CI/CD deploys from `main` |

### Still open

- [ ] LVP's own Terms of Service and Privacy Policy (from Octavia)
- [ ] List of approved calculators and their formulas (from Octavia)
- [ ] Mockups for appointments, My Services, notification center and service workspaces, or approval to design them ourselves
- [ ] Video meeting tool for appointments
- [ ] Does Octavia own firmivra.com and can it be delegated to Route 53
