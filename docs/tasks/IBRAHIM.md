> **Repo notes (Oct 4, 2026).** Read `CLAUDE.md` first; it wins where this doc differs.
> - Mockups: `docs/mockups/begin-online/`, `client-portal/`, `super-admin/` (same file names as Octavia's Drive folders). Specs: `docs/specs/client-portal/`, `super-admin/`, `platform-guide/`.
> - LVP's portal slug is `lvp`: `portal.localhost:3000/lvp` locally, `portal.dev.firmivra.com/lvp` on dev.
> - Route group and folder names in `apps/web` follow the README once the app is scaffolded (Step 6.5).

# Ibrahim: Backend task document

Firmivra Phase 1 (beta) · Prepared by Rasel Mridha (Technical Project Manager) · Oct 4, 2026
Beta launch: Jan 8, 2027 · Keep this file at `docs/tasks/IBRAHIM.md` on your branch.

## 1. Your role

You are a backend developer. You own the NestJS API modules for **client work**: business settings, clients and client profiles, firm-defined tax statuses, documents (pre-signed S3 uploads, per-business KMS keys, categories, requests), services and engagements, intake form definitions and submissions (Begin Online and portal), leads data, tax returns, service workspaces (Bookkeeping, Tax Planning), messages and notes, invoices with Stripe payments and webhooks, and the calculator formulas. Your modules send notification events through Tumit's notification service.

- **Frontend pair:** Nahid (client portal, Begin Online). Agree the API contract with Nahid on day 1 of each sprint and put it in `packages/types` and the OpenAPI spec before you code.
- **Also consumed by:** Fahad (clients, documents, leads, intake review, workspaces, firm messages, invoices).
- **Pre-reviewer:** Tumit reads your PRs before Rasel. You pre-review Tumit's PRs.
- **Final review and merge:** Rasel only. Rasel also owns the database schema, migrations and AWS.

## 2. Rules that apply to you

**Branches and PRs**

- Create every branch from the latest `main`: `git checkout main && git pull && git checkout -b ibrahim/FIR-<ticket>-short-name`. Example: `ibrahim/FIR-48-presigned-uploads`.
- Placeholder ids in this file (like `FIR-S3-I1`) become real GitHub issue numbers when Rasel creates the issues.
- Open a pull request from your branch into `main`. Never push to `main`. Only Rasel merges (squash merge).
- CI must be green: lint, type check, unit tests, build (and e2e tests where the pipeline runs them).
- Keep PRs under ~400 changed lines. Split a module into: DTOs and contract, service and tests, controller and e2e test.
- Ask Tumit for a pre-review before you request Rasel.

**Database and infrastructure**

- **Never edit** `packages/db/prisma/schema.prisma`, anything in `packages/db/migrations`, `infra/`, or AWS resources (S3 buckets, KMS keys, Stripe webhook config in AWS, queues).
- Need a table, column, index or RLS policy? Open a GitHub issue labelled `schema`. Need a bucket policy, KMS key, queue, secret or env var? Open an issue labelled `infra`.
- File requests **one sprint ahead**. Until a migration lands, code against the agreed types and mock the repository in tests.

**Tenant isolation (most important rule)**

- Every query on business data is scoped to the current business. Use the tenant guard and the `businessId` from the token; never trust a `businessId` from the body or query.
- Portal endpoints (`/api/v1/portal/...`) are scoped to the business **and** the signed-in client. A client never reads another client's data, even in the same firm.
- Row-level security is on. Use the repo's Prisma helper that sets the tenant for the transaction. No raw SQL that bypasses it.
- Every new endpoint gets a **tenant isolation e2e test** (business A cannot read, list, change or download anything of business B; client X cannot reach client Y). Return 404 so existence does not leak.
- Write an **audit log** entry (`AuditService.log(action, entity, metadata)`) for every action on client data: create, update, upload, download, share, status change, submit, payment.
- Things clients must never see: internal staff notes, reviewer comments, internal tasks, unshared documents.

**Security**

- Nobody gets AWS access. Run locally with Docker (PostgreSQL, s3mock for S3, Mailpit for email, a local key from `.env` instead of KMS) and Stripe test mode with the Stripe CLI for webhooks.
- Files: S3 key prefixes per business; encrypt with the business's KMS key; short-lived pre-signed URLs; never public or guessable URLs.
- Never log SSNs, EINs, bank or card data, or intake answers. Store sensitive intake fields encrypted.
- Money: integer cents, never floats. Paid status changes only from a verified Stripe webhook.

## 3. Repo map (expected layout; follow the README if it differs)

| Path | What it is | Your access |
| --- | --- | --- |
| `apps/api/src/modules/business-settings` | Branding, details, portal settings, upload limits | Yours |
| `apps/api/src/modules/clients` | Clients, profiles, tax status tracking | Yours |
| `apps/api/src/modules/tax-statuses`, `tax-returns` | Firm-defined statuses, returns | Yours |
| `apps/api/src/modules/documents` | Uploads, categories, requests, sharing | Yours |
| `apps/api/src/modules/services` | Engagements and My Services | Yours |
| `apps/api/src/modules/intake`, `leads` | Form definitions, submissions, leads data | Yours (lead conversion is Tumit's) |
| `apps/api/src/modules/workspaces` | Service workspaces | Yours |
| `apps/api/src/modules/messages` | Messages, client notes, staff notes | Yours |
| `apps/api/src/modules/invoices`, `payments` | Invoices, Stripe, webhooks | Yours |
| `apps/api/src/modules/calculators` | Calculator formulas | Yours |
| `apps/api/src/modules/auth`, `audit`, `notifications`, `appointments` | Identity, audit, notifications, appointments | Tumit's (you call their services) |
| `packages/types` | Shared DTO types and API contracts | Shared with your pair |
| `apps/web` | Next.js frontend | Fahad and Nahid |
| `packages/db`, `infra/` | Prisma schema, CDK | Rasel only |

## 4. Tickets by sprint

Ticket ids are placeholders: `FIR-S<sprint>-I<number>`. All endpoints are **proposed, agree with your pair** (Nahid, or Fahad for firm screens). Base path `/api/v1`.

### Summary

| Sprint | Dates | Your tickets |
| --- | --- | --- |
| 0 | Oct 5 to Oct 16 | S0-I1 field lists for schema, S0-I2 OpenAPI spec |
| 1 | Oct 19 to Oct 30 | S1-I1 business settings API, S1-I2 tax statuses API, S1-I3 client record CRUD |
| 2 | Nov 2 to Nov 13 | S2-I1 client profile API, S2-I2 tax status tracking per client, S2-I3 firm-side status update |
| 3 | Nov 16 to Nov 27 | S3-I1 pre-signed uploads and KMS, S3-I2 file checks, categories, requests, S3-I3 services and engagements |
| 4 | Nov 30 to Dec 11 | S4-I1 intake definitions and submissions, S4-I2 tax returns API, S4-I3 service workspace API |
| 5 | Dec 14 to Dec 25 | S5-I1 messages API, S5-I2 invoices API, S5-I3 Stripe payments and webhooks, S5-I4 calculator formulas |
| 6 | Dec 28 to Jan 8 | S6-I1 tenant isolation suite, S6-I2 security and file-access review, S6-I3 acceptance fixes |

### Sprint 0: setup and foundations (Oct 5 to Oct 16)

No running app yet. Deliver documents to Rasel by **Oct 9** so the schema is ready for Sprint 1.

**FIR-S0-I1 Field lists for the schema**
- For each feature, list fields, types, required flags, relations and indexes, and send them to Rasel (issue labelled `schema`):
  - Business settings (display name, logo key, colours, header style, portal feature toggles, welcome message, allowed file types and max size, Important Info texts, tax tip, self-service intake per form).
  - Client (type Individual or Business, name, DOB locked, contact, address, preferred contact method, referral source, status), related persons (spouse, dependents), business entities (legal name, DBA, EIN, structure, owners and %).
  - Tax status (firm-defined list, order, colour, is final) and client tax status history.
  - Document (business, client, service, category, year or period, uploader, source mine or firm, shared at, status, S3 key, size, MIME, checksum, version of), document request.
  - Service / engagement (type, period, package, status: active, recurring, completed, cancelled; billing option; assigned staff).
  - Intake form definition (service, version, JSON schema), submission (status state machine, answers encrypted, version, locked versions, correction requests), signature and consent records, lead.
  - Tax return (year, filing type, status, filed date, document).
  - Workspace task, internal note, report, reconciliation item, tax planning projection.
  - Message thread, message, read state, client private note with reminder, staff note.
  - Invoice, line item, payment, Stripe ids, webhook event (for idempotency).
- Notifications: list which events your modules emit, so Tumit's notification tables cover them.
- Acceptance: Rasel confirms the list; sensitive fields and RLS needs are marked.

**FIR-S0-I2 OpenAPI spec for your endpoints**
- Spec for Sprints 1 and 2 in full, later sprints in outline. Agree the Begin Online form definition format with Nahid (Nahid's S0-N2).
- Acceptance: spec validates; Nahid and Fahad confirm it covers their screens.

### Sprint 1: settings, tax statuses, clients (Oct 19 to Oct 30)

**FIR-S1-I1 Business settings API**
- Endpoints: `GET /api/v1/business/settings`, `PUT /api/v1/business/settings`, `POST /api/v1/business/logo-upload-url`, `POST /api/v1/business/setup/complete`; public branding fields exposed to Tumit's `GET /api/v1/public/firms/{slug}`.
- Acceptance: legal name cannot be changed through this API; HEX colours validated; only owner and admin can write; setup completed flag set once; audited.
- Consumed by: Fahad (setup wizard S2-F1).

**FIR-S1-I2 Firm-defined tax statuses API**
- Endpoints: `GET /api/v1/tax-statuses`, `POST /api/v1/tax-statuses`, `PATCH /api/v1/tax-statuses/{id}`, `POST /api/v1/tax-statuses/reorder`, `DELETE /api/v1/tax-statuses/{id}` (only if unused, else archive).
- Acceptance: new businesses get a default list (In Preparation, Ready for Review, Awaiting Signature, Filed/Completed); a status in use cannot be deleted; per business only.

**FIR-S1-I3 Client record CRUD API**
- Endpoints: `GET /api/v1/clients?search=&type=&status=&taxStatus=&page=`, `POST /api/v1/clients`, `GET /api/v1/clients/{id}`, `PATCH /api/v1/clients/{id}`, `POST /api/v1/clients/{id}/archive`.
- Acceptance: SSN and EIN stored encrypted and returned masked; search does not search encrypted fields; duplicate email in the same firm returns 409; archive instead of delete; isolation e2e test.
- Consumed by: Fahad (S2-F3), Tumit (sign-up approval and lead conversion use your `ClientsService`).

### Sprint 2: client profile and tax status (Nov 2 to Nov 13)

**FIR-S2-I1 Client profile API (portal)**
- Endpoints: `GET /api/v1/portal/me/profile`, `PATCH /api/v1/portal/me/profile`, `POST /api/v1/portal/me/name-change-requests`, `POST /api/v1/portal/me/deactivate`; firm side `GET /api/v1/name-change-requests`, `POST /api/v1/name-change-requests/{id}/approve`, `.../decline`.
- Acceptance: name and DOB cannot be changed by the client (422); one open name-change request at a time; email or phone change triggers re-verification through Tumit's auth service; deactivate keeps all records; audited.
- Consumed by: Nahid (S3-N4).

**FIR-S2-I2 Tax status tracking per client**
- Endpoints: `GET /api/v1/clients/{id}/tax-status`, `GET /api/v1/clients/{id}/tax-status/history`.
- Acceptance: history shows status, who, when, note; per tax year.

**FIR-S2-I3 Firm-side status update API**
- Endpoint: `PUT /api/v1/clients/{id}/tax-status` (year, statusId, note, notifyClient).
- Acceptance: only firm roles; payment never changes status; status change emits a notification event when `notifyClient` is true; audited.

### Sprint 3: documents and services (Nov 16 to Nov 27)

**FIR-S3-I1 Pre-signed S3 uploads and per-business KMS keys**
- Endpoints: `POST /api/v1/documents/upload-url` (firm), `POST /api/v1/portal/documents/upload-url` (client), `POST /api/v1/documents/{id}/complete`, `GET /api/v1/documents/{id}/download-url`, portal `GET /api/v1/portal/documents/{id}/download-url`.
- Flow: create a pending document row, return a pre-signed PUT URL (short expiry, proposed 5 minutes) to the quarantine prefix with the business's KMS key; on complete, verify size and checksum, run checks, move to the vault prefix, mark available.
- Acceptance: a document is never shown as uploaded before complete succeeds; download URLs expire (proposed 60 seconds); keys are prefixed by business; uploads and downloads audited.
- Dependencies: buckets, KMS keys per business and malware scan hook from Rasel (`infra`).

**FIR-S3-I2 File checks, categories, requests, sharing**
- Endpoints: `GET /api/v1/document-categories`, `GET /api/v1/documents?clientId=&category=&service=&year=&status=&source=`, `PATCH /api/v1/documents/{id}` (status, category, shared), `POST /api/v1/document-requests` (one or many clients), `GET /api/v1/document-requests?clientId=`, portal `GET /api/v1/portal/documents?source=mine|firm`, `GET /api/v1/portal/upload-eligibility`, `GET /api/v1/portal/action-items`, `GET /api/v1/portal/next-steps`.
- Upload gate: a client can upload tax documents only with an active tax service and business documents only with an active business service; otherwise 403 with code `NO_OPEN_SERVICE`.
- Acceptance: extension and MIME both checked against the firm's allowed list and size; duplicate warning by checksum; replacing keeps the previous version; clients cannot delete; bulk requests return per-client success or failure; requests appear in action items and next steps and clear when fulfilled.
- Consumed by: Nahid (S3-N2, S3-N3), Fahad (S3-F1, S3-F2, S4-F4).

**FIR-S3-I3 Services and engagement API**
- Endpoints: `GET /api/v1/engagements?clientId=&status=`, `POST /api/v1/engagements`, `PATCH /api/v1/engagements/{id}` (status, assigned staff), portal `GET /api/v1/portal/services`.
- Acceptance: statuses active, recurring, completed, cancelled; progress percentage returned only when a calculation is defined, otherwise null; clients see only their own services.
- Consumed by: Nahid (S3-N5), Fahad.

### Sprint 4: intake, tax returns, workspaces (Nov 30 to Dec 11)

**FIR-S4-I1 Intake form definitions and submissions API**
- Definitions: `GET /api/v1/intake-forms`, `PUT /api/v1/intake-forms/{id}` (versioned JSON schema per firm and service, self-service toggle). Seed the 6 Begin Online flows and 7 portal forms.
- Public (Begin Online, no login): `GET /api/v1/public/{slug}/intake-forms`, `POST /api/v1/public/{slug}/intake-submissions` (draft), `PATCH .../{id}` (with resume token), `POST .../{id}/upload-url`, `POST .../{id}/resume-link`, `POST .../{id}/submit`.
- Portal: `GET /api/v1/portal/intake-forms`, `POST /api/v1/portal/intake-submissions`, `PATCH /api/v1/portal/intake-submissions/{id}`, `POST .../{id}/submit`.
- Firm: `GET /api/v1/leads`, `GET /api/v1/leads/{id}`, `GET /api/v1/clients/{id}/intake-submissions`, `POST /api/v1/intake-submissions/{id}/request-correction`, `POST /api/v1/intake-submissions/{id}/accept`.
- Rules: server validates answers against the schema version used; submit creates a locked version; Begin Online submit creates a lead (no account) and sends a confirmation email with a copy; signature stores name, typed or drawn image, agreement version and text hash, IP, user agent, time; Annual Tax stores the payment choice.
- Acceptance: public endpoints rate-limited and need a CAPTCHA token; resume token is single-purpose and expires; correction keeps the original; Completed only after the firm accepts; state machine transitions tested (Sent, In Progress, Submitted, Needs Correction, Under Review, Completed, Expired, Archived).
- Consumed by: Nahid (S4-N1 to S4-N4), Fahad (S4-F1, S4-F2), Tumit (S4-T1 conversion).

**FIR-S4-I2 Tax returns API**
- Endpoints: `GET /api/v1/clients/{id}/tax-returns`, `POST /api/v1/clients/{id}/tax-returns`, `PATCH /api/v1/tax-returns/{id}`, `POST /api/v1/tax-returns/{id}/release`; portal `GET /api/v1/portal/tax-returns`, `GET /api/v1/portal/tax-returns/{id}/download-url`.
- Acceptance: clients see a return only after release; filing types quarterly, annual personal, annual business; balance due links to the invoice; release emits a notification; download audited.
- Consumed by: Nahid (S4-N5).

**FIR-S4-I3 Service workspace API (Bookkeeping, Tax Planning)**
- Endpoints: `GET /api/v1/workspaces/{engagementId}`, `GET/POST/PATCH /api/v1/workspaces/{engagementId}/tasks`, `GET/POST .../notes` (internal), `GET/POST .../reports`, Bookkeeping `GET/POST/PATCH .../reconciliations` (account, period, status, difference), Tax Planning `GET/POST/PATCH .../projections` (scenario, year, income, deductions, estimated tax).
- Acceptance: generic template so Advisory can reuse it after beta; internal notes never in portal responses; reports shared to the client become documents; workspace status drives My Services status.
- Consumed by: Fahad (S4-F3).

### Sprint 5: messages, invoices, payments, calculator (Dec 14 to Dec 25)

Heaviest sprint and includes Dec 25. If Sprint 2 velocity is behind, the calculator moves after beta first.

**FIR-S5-I1 Messages API**
- Firm: `GET /api/v1/message-threads?clientId=&unread=`, `GET /api/v1/message-threads/{id}`, `POST /api/v1/message-threads`, `POST /api/v1/message-threads/{id}/messages`, `POST /api/v1/messages/bulk`, `GET/POST /api/v1/clients/{id}/staff-notes`.
- Portal: `GET /api/v1/portal/messages?filter=all|from-firm|sent&search=`, `GET /api/v1/portal/messages/unread-count`, `POST /api/v1/portal/messages`, `POST /api/v1/portal/messages/{id}/read`, `POST .../{id}/unread`, `GET/PUT /api/v1/portal/notes` (private note with reminder).
- Acceptance: no delete; unread count counts inbound only; attachments go through the documents module; bulk send creates one record per client and reports per-client results; client notes are never returned to firm endpoints; message events notify the other side.
- Consumed by: Nahid (S5-N2), Fahad (S5-F3).

**FIR-S5-I2 Invoices API**
- Firm: `GET /api/v1/invoices?status=&clientId=`, `POST /api/v1/invoices`, `GET /api/v1/invoices/{id}`, `PATCH /api/v1/invoices/{id}` (draft only), `POST /api/v1/invoices/{id}/send`, `POST /api/v1/invoices/{id}/cancel`.
- Portal: `GET /api/v1/portal/invoices?type=due|paid|upcoming|canceled&status=&search=`, `GET /api/v1/portal/invoices/{id}/pdf-url`.
- Acceptance: amounts in cents; client statuses mapped to Pending, Due Soon, Paid, Upcoming, Canceled; sent invoices cannot be edited; PDF download audited.
- Consumed by: Fahad (S5-F4), Nahid (S5-N3).

**FIR-S5-I3 Stripe payments and webhooks**
- Endpoints: `POST /api/v1/portal/invoices/{id}/checkout-session`, `POST /api/v1/webhooks/stripe` (public, signature verified).
- Rules: one Stripe account for beta (Stripe Connect per firm is a later decision; ask Rasel); store Stripe ids only, never card or bank data; idempotency keys on create; webhook events stored and processed once; ACH stays pending until `succeeded`.
- Acceptance: invoice becomes Paid only from a verified webhook; replayed webhooks do not double-pay; a failed payment allows a safe retry; receipt available after payment; e2e test with Stripe CLI fixtures; payment events notify client and firm.
- Dependencies: Stripe test keys and webhook secret from Rasel (`infra`).

**FIR-S5-I4 Calculator formulas and validation**
- Endpoints: `GET /api/v1/calculators`, `POST /api/v1/calculators/{key}/compute`.
- Build: a pure function per calculator with input validation, tax-year parameters in config, and a disclaimer string in the response. Start with the Tax Return Calculator.
- Acceptance: unit tests with known inputs and outputs; invalid inputs return 422 with field errors.
- Blocked on: the list of approved calculators and formulas from Octavia. Build with placeholder formulas behind a clear flag; launch is blocked, development is not.

### Sprint 6: beta hardening and launch (Dec 28 to Jan 8)

No new features.

- **FIR-S6-I1 Tenant isolation suite:** with Tumit, an e2e suite that seeds two businesses and two clients and calls every endpoint across tenants and clients. Runs in CI.
- **FIR-S6-I2 Security and file-access review:** pre-signed URL expiry, KMS usage, MIME checks, webhook signature, encrypted fields, log redaction. Help Rasel with the backup and restore test.
- **FIR-S6-I3 Acceptance fixes:** fix what Octavia raises; help seed LVP's real settings, tax statuses and forms on production.

## 5. Working with Claude Code

Open the repo in VS Code and start Claude Code from the repo root. Paste one of these and edit the ticket details.

**New API module**

```
Read CLAUDE.md and docs/tasks/IBRAHIM.md. Ticket FIR-S1-I3 (client record CRUD).
Add the endpoints in apps/api following the existing module structure (controller, service, DTOs with validation).
Put request and response types in packages/types. Use the role guard and tenant guard; take businessId only from the token.
Do not edit packages/db/prisma/schema.prisma, migrations or infra/. If a field is missing, stop and draft a `schema` issue for Rasel.
Write unit tests and an e2e test with a tenant isolation case. Record audit events with AuditService.
```

**File uploads**

```
Read CLAUDE.md and docs/tasks/IBRAHIM.md. Ticket FIR-S3-I1.
Implement pre-signed upload and download with the S3 client pointed at s3mock locally (`S3_ENDPOINT`, path-style) and the encryption adapter using the local key from `.env` instead of KMS.
Use the business's key prefix and KMS key; never return a public URL. Enforce the upload gate (NO_OPEN_SERVICE).
Add tests: wrong MIME, too large, other business's document id, expired URL, and a successful upload.
```

**Stripe webhook**

```
Read CLAUDE.md and docs/tasks/IBRAHIM.md. Ticket FIR-S5-I3.
Implement POST /api/v1/webhooks/stripe with signature verification and idempotent processing (store the event id).
Mark the invoice Paid only on a succeeded payment event. Use integer cents. Add tests using Stripe fixture events,
including a replayed event and a failed payment. Do not change infra or the schema.
```

**Intake engine validation**

```
Read CLAUDE.md and docs/tasks/IBRAHIM.md. Ticket FIR-S4-I1.
Validate submitted answers on the server against the stored form schema version, including conditional required fields
and repeating groups. Never log answers. Add unit tests for each state transition of the submission state machine.
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
