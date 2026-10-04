> **Repo notes (Oct 4, 2026).** Read `CLAUDE.md` first; it wins where this doc differs.
> - Mockups: `docs/mockups/begin-online/`, `client-portal/`, `super-admin/` (same file names as Octavia's Drive folders). Specs: `docs/specs/client-portal/`, `super-admin/`, `platform-guide/`.
> - LVP's portal slug is `lvp`: `portal.localhost:3000/lvp` locally, `portal.dev.firmivra.com/lvp` on dev.
> - Route group and folder names in `apps/web` follow the README once the app is scaffolded (Step 6.5).

# Tumit: Backend task document

Firmivra Phase 1 (beta) · Prepared by Rasel Mridha (Technical Project Manager) · Oct 4, 2026
Beta launch: Jan 8, 2027 · Keep this file at `docs/tasks/TUMIT.md` on your branch.

## 1. Your role

You are a backend developer. You own the NestJS API modules for **identity and access**: Cognito integration and roles, firm applications and approval, businesses and their activation, users and team invites, client self sign-up with firm approval, portal password reset, per-firm legal documents, Super Admin support access, the audit log, the notification center and notification service (SES email, SNS SMS), lead-to-client conversion, external links configuration, and appointments.

- **Frontend pair:** Fahad (firm workspace). Agree the API contract with Fahad on day 1 of each sprint and put it in `packages/types` and the OpenAPI spec before you code.
- **Also consumed by:** Nahid (Super Admin screens, portal sign-up and sign-in, booking).
- **Pre-reviewer:** Ibrahim reads your PRs before Rasel. You pre-review Ibrahim's PRs.
- **Final review and merge:** Rasel only. Rasel also owns the database schema, migrations and AWS.

## 2. Rules that apply to you

**Branches and PRs**

- Create every branch from the latest `main`: `git checkout main && git pull && git checkout -b tumit/FIR-<ticket>-short-name`. Example: `tumit/FIR-31-firm-application-api`.
- Placeholder ids in this file (like `FIR-S1-T2`) become real GitHub issue numbers when Rasel creates the issues.
- Open a pull request from your branch into `main`. Never push to `main`. Only Rasel merges (squash merge).
- CI must be green: lint, type check, unit tests, build (and e2e tests where the pipeline runs them).
- Keep PRs under ~400 changed lines. Split a module into: DTOs and contract, service and tests, controller and e2e test.
- Ask Ibrahim for a pre-review before you request Rasel.

**Database and infrastructure**

- **Never edit** `packages/db/prisma/schema.prisma`, anything in `packages/db/migrations`, `infra/`, or AWS resources.
- Need a table, column, index or RLS policy? Open a GitHub issue labelled `schema` with the fields, types, relations and why. Need a queue, bucket, SES template, SNS setting or env var? Open an issue labelled `infra`.
- File schema and infra requests **one sprint ahead** so Rasel can plan them. Until a migration lands, code against the agreed types and mock the repository in tests.

**Tenant isolation (most important rule)**

- Every query on business data is scoped to the current business. Use the tenant guard and the request's `businessId` from the token; never take `businessId` from the request body or query string.
- PostgreSQL row-level security is on. Use the repo's Prisma helper that sets the tenant for the transaction. Never bypass it with raw SQL or a superuser connection.
- Super Admin endpoints live under `/api/v1/admin/...` and have their own guard. They read business data only through an active support grant (your Sprint 3 ticket).
- Every new endpoint that touches business data gets a **tenant isolation e2e test**: a user of business A cannot read, list, update or delete anything of business B, and gets 404 (not 403) so the record's existence does not leak.
- Write an **audit log** entry for every action on client data (create, update, delete, download, approve, decline, access by support).

**Security**

- Nobody gets AWS access. Run locally with Docker (PostgreSQL, LocalStack for S3, SES and SNS) and the Cognito local setup in the README.
- Never log passwords, codes, tokens, SSNs or EINs. Use the logger's redaction.
- Rate-limit public endpoints (applications, sign-up, codes, password reset, public intake).
- Responses never reveal whether an email or account exists.

## 3. Repo map (expected layout; follow the README if it differs)

| Path | What it is | Your access |
| --- | --- | --- |
| `apps/api/src/modules/auth` | Cognito integration, guards, role and tenant guards | Yours (Rasel built the base in Sprint 0) |
| `apps/api/src/modules/firm-applications` | Public application, Super Admin review | Yours |
| `apps/api/src/modules/businesses` | Business status, activation, legal documents | Yours (settings are Ibrahim's) |
| `apps/api/src/modules/users`, `team` | Users, roles, invites | Yours |
| `apps/api/src/modules/client-signups` | Portal sign-up, verification, approval | Yours |
| `apps/api/src/modules/support-access` | Owner-approved Super Admin access | Yours |
| `apps/api/src/modules/audit` | Audit log write helper and viewer API | Yours |
| `apps/api/src/modules/notifications` | Notification center and SES/SNS service | Yours |
| `apps/api/src/modules/appointments` | Appointments and availability | Yours |
| `apps/api/src/modules/leads` (convert only) | Lead to client conversion | Yours; lead data is Ibrahim's |
| `apps/api/src/modules/...` others | Clients, documents, intake, messages, invoices | Ibrahim's |
| `packages/types` | Shared DTO types and API contracts | Shared with your pair |
| `apps/web` | Next.js frontend | Fahad and Nahid |
| `packages/db` | Prisma schema and migrations | Rasel only |
| `infra/` | AWS CDK | Rasel only |

## 4. Tickets by sprint

Ticket ids are placeholders: `FIR-S<sprint>-T<number>`. All endpoints are **proposed, agree with your pair** (Fahad, or Nahid for the portal and Super Admin screens). Base path `/api/v1`.

### Summary

| Sprint | Dates | Your tickets |
| --- | --- | --- |
| 0 | Oct 5 to Oct 16 | S0-T1 field lists for schema, S0-T2 role and permission matrix, S0-T3 OpenAPI spec |
| 1 | Oct 19 to Oct 30 | S1-T1 Cognito pools and role claims, S1-T2 firm application API, S1-T3 approve and activate flow, S1-T4 invite emails |
| 2 | Nov 2 to Nov 13 | S2-T1 role-based access on every endpoint, S2-T2 team invite API, S2-T3 client self sign-up with firm approval, S2-T4 portal password reset, S2-T5 legal documents setting |
| 3 | Nov 16 to Nov 27 | S3-T1 audit log API and viewer, S3-T2 support access, S3-T3 notification center API |
| 4 | Nov 30 to Dec 11 | S4-T1 lead to client conversion, S4-T2 notification service (SES, SNS), S4-T3 external links configuration |
| 5 | Dec 14 to Dec 25 | S5-T1 appointments API with double-booking lock, S5-T2 availability, S5-T3 reminders and change notifications, S5-T4 notification preferences |
| 6 | Dec 28 to Jan 8 | S6-T1 tenant isolation suite, S6-T2 security review fixes, S6-T3 acceptance fixes and launch support |

### Sprint 0: setup and foundations (Oct 5 to Oct 16)

No running app yet. Deliver documents to Rasel by **Oct 9** so the schema is ready for Sprint 1.

**Local setup notes**

- Use Node.js 22 (see `.nvmrc`) and pnpm.
- In Windows PowerShell, use `npm.cmd` or `pnpm.cmd` if the script execution policy blocks the `.ps1` launcher.
- Run `pnpm install`, `pnpm test` and `pnpm dev` once the Sprint 0 scaffold adds `package.json` and the workspace files.

**FIR-S0-T1 Field lists for the schema**
- For each feature, list the fields, types, required flags, relations and indexes, and send them to Rasel (issue labelled `schema`):
  - Firm application (practice type, legal name, DBA, entity type, EIN, contact, website, address, primary admin, credentials and uploads, services, team size, client volume, referral source, requested start date, agreement accepted at, status, internal notes, history).
  - Business (status: pending setup, active, suspended, inactive; slug; setup completed at), user, membership with role, invite (token hash, expires, used at).
  - Client portal account (sign-up status: pending, approved, declined, deactivated; account type Individual or Business; verified email and phone at).
  - Legal documents per business (type, URL or file, version, effective date).
  - Support access grant (requested by, approved by owner, reason, starts, ends, revoked).
  - Audit event (actor, role, business, action, target type and id, IP, user agent, time, metadata).
  - Notification (recipient, type, title, body, link, read at), notification preference (channel, category, enabled).
  - Appointment, appointment type, working hours, blocked time, appointment history.
- Acceptance: Rasel confirms the list is complete; RLS needs are noted per table.

**FIR-S0-T2 Role and permission matrix**
- Roles: super_admin, firm owner, firm admin, staff, client. Columns: every module and action (view, create, edit, delete, approve, export).
- Include the special rules: staff never create firms; clients never create businesses; Individual clients are blocked from business-only areas; Super Admin sees firm data only with a support grant.
- Acceptance: committed to `docs/` and reviewed by Rasel and Fahad.

**FIR-S0-T3 OpenAPI spec for your endpoints**
- Write the spec (paths, DTOs, error codes) for everything in Sprints 1 and 2 below; later sprints in outline.
- Acceptance: the spec validates; Fahad and Nahid confirm it covers their screens.

### Sprint 1: sign-in and firm approval (Oct 19 to Oct 30)

Goal: a firm applies, Super Admin approves it, the firm owner activates and logs in.

**FIR-S1-T1 Cognito pools and role claims**
- Build: integration with the user pools Rasel creates (super admin pool; firm and client pool or app clients as Rasel's design says). Pre-token-generation logic or API lookup that puts `role` and `businessId` in the claims. `GET /api/v1/me`.
- Acceptance: a token without a business cannot call tenant endpoints; role from the token matches the membership in the database; a suspended firm's users get 403 with a clear code.
- Dependencies: Cognito pools from Rasel (`infra`), users and membership tables (`schema`).

**FIR-S1-T2 Firm application API**
- Endpoints: `POST /api/v1/public/firm-applications`, `POST /api/v1/public/firm-applications/upload-url`, `GET /api/v1/admin/firm-applications?status=`, `GET /api/v1/admin/firm-applications/{id}`, `POST /api/v1/admin/firm-applications/{id}/notes`, `GET /api/v1/admin/dashboard/summary`.
- Acceptance: submission without agreement fails with 422; EIN validated; uploads go to the quarantine prefix with type and size checks; public endpoint is rate-limited; status starts as Pending Review; every change is added to the application history.
- Consumed by: Nahid (S1-N1, S1-N3).

**FIR-S1-T3 Approve, request information, decline, activate**
- Endpoints: `POST /api/v1/admin/firm-applications/{id}/approve`, `.../request-info`, `.../decline`; `GET /api/v1/invites/{token}`, `POST /api/v1/auth/activate`.
- Approve in one transaction: application Approved, business created with slug and status Active (pending setup), primary admin user created as owner, invite created, firm appears in the firms list. Seed tax statuses through Ibrahim's service if agreed.
- Acceptance: approve is idempotent (second call returns the same result); request-info and decline need a message and send an email; the activation link expires (proposed 7 days) and works once; audit entries for each action.
- Consumed by: Nahid (S1-N4), Fahad (S1-F2).

**FIR-S1-T4 Invite emails through SES**
- Build: email templates (owner activation, staff invite, request info, decline) sent through SES (LocalStack locally). Templates use Firmivra branding.
- Acceptance: emails are sent after the transaction commits; failures are retried and logged; no token appears in logs.
- Dependencies: SES setup and verified domain from Rasel (`infra`).

### Sprint 2: firm workspace and client sign-up (Nov 2 to Nov 13)

**FIR-S2-T1 Role-based access on every endpoint**
- Build: `@Roles()` decorator and guard applied to every controller, including Ibrahim's (agree with Ibrahim). Default deny.
- Acceptance: an e2e test per module proves staff cannot call admin-only actions and clients cannot call firm endpoints; a lint rule or test fails if a controller has no role metadata.

**FIR-S2-T2 Team invite API**
- Endpoints: `GET /api/v1/team/members`, `POST /api/v1/team/invites`, `POST /api/v1/team/invites/{id}/resend`, `PATCH /api/v1/team/members/{id}` (role, status), `DELETE /api/v1/team/invites/{id}`.
- Acceptance: only owner and admin can invite; the last owner cannot be demoted or deactivated; deactivated users lose access at the next request (not only at token expiry); invite to an email already in the firm returns a clear error.
- Consumed by: Fahad (S2-F1, S2-F2).

**FIR-S2-T3 Client self sign-up with firm approval**
- Endpoints: `GET /api/v1/public/firms/{slug}`, `POST /api/v1/portal/{slug}/sign-up`, `POST /api/v1/portal/{slug}/verify-email`, `POST /api/v1/portal/{slug}/verify-phone`, `POST /api/v1/portal/{slug}/resend-code`; firm side `GET /api/v1/client-signups?status=pending`, `POST /api/v1/client-signups/{id}/approve` (optional `clientId` to link an existing client), `POST /api/v1/client-signups/{id}/decline`.
- Rules: 6-digit codes, expire in 10 minutes, max 5 attempts, resend after 45 s. Phone code by SNS. A pending account can sign in only to see "waiting for approval". Approval creates or links the client record (Ibrahim's service) and sends a welcome email.
- Acceptance: sign-up with an email that already exists gives the same response as a new one (send a "you already have an account" email instead); duplicates by email or phone flagged for the firm; all actions audited.
- Consumed by: Nahid (S2-N1, S2-N2), Fahad (S2-F4).

**FIR-S2-T4 Firm-scoped password reset**
- Endpoints: `POST /api/v1/portal/{slug}/password/forgot`, `POST /api/v1/portal/{slug}/password/reset` (or the Cognito flow wrapped so it stays inside the firm's portal).
- Acceptance: the response is identical whether or not the account exists; reset works only for accounts in that firm; rate-limited per IP and per email; a security event is logged; existing sessions are revoked after reset.
- Consumed by: Nahid (S2-N3).

**FIR-S2-T5 Per-firm legal documents setting**
- Endpoints: `GET /api/v1/business/legal-documents`, `PUT /api/v1/business/legal-documents` (Terms of Service and Privacy Policy as URL or uploaded file, version, effective date); public links included in `GET /api/v1/public/firms/{slug}`.
- Acceptance: only owner and admin can change; each change creates a new version; sign-up stores which version the client accepted; fallback to Firmivra's documents if the firm has none.
- Consumed by: Fahad (setup wizard), Nahid (footer, sign-up).

### Sprint 3: audit, support access, notification center (Nov 16 to Nov 27)

**FIR-S3-T1 Audit log API and viewer**
- Build: a single `AuditService.record()` helper every module uses (agree the action names with Ibrahim), and `GET /api/v1/audit-events?actor=&action=&targetType=&targetId=&from=&to=`.
- Acceptance: the log is append-only (no update or delete endpoint); owner and admin can view their firm's log; Super Admin can view platform events; export to CSV; pagination.

**FIR-S3-T2 Super Admin support access with owner approval**
- Endpoints: `POST /api/v1/admin/firms/{id}/support-access-requests` (reason, duration), `GET /api/v1/support-access-requests` (owner), `POST /api/v1/support-access-requests/{id}/approve`, `.../deny`, `.../revoke`; `GET /api/v1/admin/firms`, `GET /api/v1/admin/firms/{id}`.
- Rules: access only while the grant is active (proposed max 24 hours), read-only unless the owner allows more, every request made under a grant is audited with the grant id. "Open Firm Workspace" in the Super Admin UI uses this.
- Acceptance: without a grant, admin calls to firm data return 403; after expiry or revoke, access stops immediately; the owner gets an email and a notification for each request.

**FIR-S3-T3 Notification center API**
- Endpoints: `GET /api/v1/notifications?unread=`, `GET /api/v1/notifications/unread-count`, `POST /api/v1/notifications/{id}/read`, `POST /api/v1/notifications/{id}/unread`, `POST /api/v1/notifications/read-all`. Same endpoints work for portal users (scoped to the client).
- Internal: `NotificationsService.notify({ recipients, type, title, body, link, businessId })` used by every module (Ibrahim calls it for uploads, messages, invoices, intake).
- Acceptance: a user only sees their own notifications; links point to records the user is allowed to open; unread count is correct after each action.
- Consumed by: Fahad (S3-F3), Nahid (portal bell).

### Sprint 4: lead conversion, notification service, external links (Nov 30 to Dec 11)

**FIR-S4-T1 Lead to client conversion API**
- Endpoint: `POST /api/v1/leads/{id}/convert` with either `existingClientId` or new client data. `GET /api/v1/leads/{id}/matches` returns possible duplicates (email, phone, EIN).
- In one transaction: create or link the client (Ibrahim's service), move the lead's documents and signed agreement to the client, create the engagement, create a portal invite and send it.
- Acceptance: converting twice is blocked; documents keep their S3 keys and stay in the same business; audit entry with lead and client ids.
- Dependencies: lead and intake data from Ibrahim (S4-I1).

**FIR-S4-T2 Notification service (email via SES, SMS via SNS)**
- Build: channel layer behind `NotificationsService`: templates per event, per-firm branding for client emails, queue and retry (SQS if Rasel provides it), delivery status stored.
- Events: sign-up approved, document requested, document uploaded, message received, intake submitted or needs correction, invoice sent or paid, return released, appointment booked, changed or reminder.
- Acceptance: respects notification preferences (S5-T4) and critical notices are always sent; SMS only to verified numbers with consent; no client data beyond the minimum in SMS text.
- Dependencies: SNS SMS sending for US numbers and SES production access (Rasel, `infra`).

**FIR-S4-T3 External links configuration API**
- Endpoints: `GET /api/v1/resources/external-links`, `PUT /api/v1/resources/external-links` (sections, title, URL, description, visible), `GET /api/v1/portal/resources`, `POST /api/v1/portal/resources/{id}/open` (click tracking).
- Acceptance: only `https` URLs; per-firm visibility; seed with the links from `Client Portal /External links .png` and `FirmVora_External_Links_Directions.docx`; opens are audited.
- Consumed by: Fahad (S4-F5).

### Sprint 5: appointments (Dec 14 to Dec 25)

Heaviest sprint and includes Dec 25. Request the schema for appointments in Sprint 3.

**FIR-S5-T1 Appointments API with double-booking lock**
- Endpoints (firm): `GET /api/v1/appointments?staffId=&from=&to=`, `POST /api/v1/appointments`, `PATCH /api/v1/appointments/{id}`, `POST /api/v1/appointments/{id}/cancel`. Portal: `GET /api/v1/portal/appointments`, `POST /api/v1/portal/appointments`, `POST /api/v1/portal/appointments/{id}/reschedule`, `POST /api/v1/portal/appointments/{id}/cancel`.
- Rules: reschedule updates the same record and keeps history; double booking prevented in the database (exclusion constraint or row lock; ask Rasel for the constraint) not only in code; store times in UTC with the firm's time zone.
- Acceptance: two concurrent bookings for the same slot: exactly one succeeds (e2e test with parallel requests); clients see only their own appointments; meeting link or location stored.
- Consumed by: Fahad (S5-F1), Nahid (S5-N1).

**FIR-S5-T2 Availability**
- Endpoints: `PUT /api/v1/staff/{id}/working-hours`, `POST /api/v1/staff/{id}/blocked-times`, `DELETE /api/v1/staff/{id}/blocked-times/{blockId}`, `GET /api/v1/availability?serviceType=&staffId=&from=&to=`, portal `GET /api/v1/portal/availability`.
- Acceptance: slots exclude existing appointments, blocked time and outside working hours; respects appointment length and buffer; DST changes handled (test it).

**FIR-S5-T3 Reminder and change notifications**
- Build: scheduled job (EventBridge or cron as Rasel provides) that sends reminders (proposed 24 h and 1 h before) and notifications when an appointment is booked, rescheduled or cancelled, to client and staff.
- Acceptance: no duplicate reminders if the job runs twice; cancelled appointments get no reminder.

**FIR-S5-T4 Notification preferences**
- Endpoints: `GET /api/v1/me/notification-preferences`, `PUT /api/v1/me/notification-preferences` (category by channel: in-app, email, SMS).
- Acceptance: only channels the firm supports are returned; critical categories cannot be turned off; SMS opt-out (STOP) respected.

### Sprint 6: beta hardening and launch (Dec 28 to Jan 8)

No new features.

- **FIR-S6-T1 Tenant isolation suite:** with Ibrahim, an e2e suite that seeds two businesses and calls every endpoint as each role of business A against business B's ids. Runs in CI.
- **FIR-S6-T2 Security review fixes:** auth flows, rate limits, session revocation, support-access expiry, log redaction.
- **FIR-S6-T3 Acceptance fixes and launch support:** fix what Octavia raises; help Rasel set up the LVP account and invite the first real clients.

## 5. Working with Claude Code

Open the repo in VS Code and start Claude Code from the repo root. Paste one of these and edit the ticket details.

**New API module**

```
Read CLAUDE.md and docs/tasks/TUMIT.md. Ticket FIR-S2-T2 (team invite API).
Add the endpoints in apps/api following the existing module structure (controller, service, DTOs with validation).
Put request and response types in packages/types. Use the role guard and the tenant guard; take businessId only from the token.
Do not edit packages/db/prisma/schema.prisma, migrations or infra/. If a field is missing, stop and draft a `schema` issue for Rasel instead.
Write unit tests for the service and an e2e test including a tenant isolation case (business A cannot see business B). Record audit events.
```

**Auth flow that must not leak**

```
Read CLAUDE.md and docs/tasks/TUMIT.md. Ticket FIR-S2-T4 (portal password reset).
Implement forgot and reset so the response is identical whether or not the account exists, scoped to the firm slug.
Add rate limiting and log a security event without logging the email code or token. Write e2e tests for: unknown email, wrong firm, expired code, success.
```

**Concurrency**

```
Read CLAUDE.md and docs/tasks/TUMIT.md. Ticket FIR-S5-T1.
Implement booking so double booking is impossible under concurrent requests, using the database constraint Rasel added.
Map the constraint error to a 409 with a clear code. Add an e2e test that sends two parallel bookings for the same slot.
Do not change the schema; if the constraint is missing, tell me and draft the `schema` issue.
```

**Draft a schema request**

```
Read docs/tasks/TUMIT.md. Draft a GitHub issue labelled `schema` for the appointments feature:
tables, columns with types, relations, indexes, the double-booking constraint and RLS policy. Do not write the Prisma change itself.
```

**Before you open a PR**

```
Run lint, type check, unit tests, e2e tests and build the way CI does. Fix failures.
Write a PR description: ticket id, endpoints added, how to test locally with Docker, and the isolation and audit tests included.
```

## 6. Definition of Done

- [ ] Code merged to `main` by Rasel with CI green
- [ ] UI matches the mockup on desktop and mobile widths (for your work: the frontend that uses your endpoint is unblocked and the contract matches `packages/types`)
- [ ] Every query is scoped to the current business (tenant isolation test included for new data)
- [ ] Unit tests for business logic; API endpoint covered by an e2e test
- [ ] Audit log entry for any action on client data
- [ ] Works on dev.firmivra.com and Rasel has accepted it

Post-beta (not in your tickets): Payroll operations, Advisory workspace, Google and Outlook calendar sync.
