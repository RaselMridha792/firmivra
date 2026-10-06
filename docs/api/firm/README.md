# T01: firm-side API contracts

Entry point: [firm.yaml](../firm.yaml). Schema request: [tumit-fields.md](../../schema-requests/tumit-fields.md).
**Status: implemented and tested on separate T02–T08 branches; frontend agreement and reviews pending.** Contracts cover Tumit's revised
15-day plan on `tumit/FIR-0-onboarding`, compared with main `a0bee59` on Oct 6.
The combined synthetic local preview verifies the routes together. They are not merged/deployed;
production migrations and Rasel's service adapters remain dependencies. Do not tick tickets Done
before required handoff/agreement/reviews. See each branch's module implementation note.

## Review sections

| Ticket | Contract                                   | Operations | Dependency / decision                                                                          |
| ------ | ------------------------------------------ | ---------- | ---------------------------------------------------------------------------------------------- |
| T02    | [settings.yaml](settings.yaml)             | 9          | Existing settings/legal tables; portal content fields requested; logo uses R5 storage.         |
| T03    | [team.yaml](team.yaml)                     | 4          | Existing Membership/Invite; R2 invite resend interface; confirm admin/owner escalation policy. |
| T04    | [tax-statuses.yaml](tax-statuses.yaml)     | 5          | Existing TaxStatus; ordering transaction and name conflict behavior.                           |
| T05    | [applications.yaml](applications.yaml)     | 3          | R4 allowlisted form DTO and status history table; GET only.                                    |
| T06    | [notifications.yaml](notifications.yaml)   | 10         | Notification/preference tables, R6 NotifyService, consent and mandatory-notice policy.         |
| T07    | [appointments.yaml](appointments.yaml)     | 26         | New tables, DB overlap constraint/provider lock, durable reminders, scheduling policies.       |
| T08    | [audit.yaml](audit.yaml)                   | 2          | Existing AuditLog; Rasel's support-grant adapter required for Super Admin firm reads.          |
| T08    | [external-links.yaml](external-links.yaml) | 4          | ExternalLink table and approved destination-domain source.                                     |

The modules are independently valid OpenAPI 3.0.3 documents; `common.yaml` contains shared fragments.
Rasel's existing [auth.yaml](../auth.yaml) remains the auth contract and is not modified here.
No sign-in, MFA, invite acceptance, client signup/reset, firm approval action, file upload,
email/SMS sending or Stripe endpoint is reimplemented by Tumit.

## Scope and payload rules

- Firm workspace routes use the existing STAFF identity and `fv_access` cookie.
  `x-business-id` is an optional selector, verified by TenantGuard against an active membership.
  Body/query cannot set businessId. Use `TenantPrisma.db`, not owner Prisma or platform bypass.
- Portal uses the existing CLIENT identity and firm cookie on `/portal/{slug}`; slug is resolved
  by TenantGuard, client identity by ClientAccount. The portal cannot supply clientId/recipientUserId.
  Individual clients cannot enter business-only resources/modules.
- `/admin/*` accepts `fv_admin_access` from the ADMIN pool with an active PlatformAdmin.
  The application data routes query platform tables only. Firm audit access additionally requires
  Rasel's owner-approved, unexpired, unrevoked support grant and trusted firm context.
- `x-roles` documents the required Nest `@Roles` values; it is descriptive and does not enforce access.
  Every implemented endpoint needs the real guards and `AuditService.log`.
- Error envelope matches the API: `{ error: { code, message, requestId?, details? } }`.
  404 for an unlinked firm/foreign record, 403 for a linked firm with the wrong role; never leak details.
- PATCH requests reject unknown fields/empty objects. ISO timestamps represent UTC instants;
  timezone strings must be valid IANA zones. Lengths/numeric bounds are proposed validation limits.
- Cursor pages use descending `(createdAt,id)` and `nextCursor=null` at the end. Bind cursors to
  firm/user/filters; reject mismatched or malformed cursors rather than changing scope.
  Configuration collections use sortOrder/id with bounded size. Lists never expose invite hashes or tokens.
- Audit reads and mutations using entity ids/action/changed field names; never copy contact values,
  legal bodies, notification messages, private reasons, credentials or financial/tax data into metadata.
- Portal responses must be projected DTOs, not Prisma rows. Settings expose a storage-signed logo URL;
  external links an icon URL; no internal keys or signed tokens in notification targets.

## Internal service handoffs

Notification creation is not a public recipient-selecting endpoint. Other modules pass their trusted
firm context plus recipientUserId, category, eventKey, generic title/message and optional typed entity target
to Tumit's scoped notification service. Validate membership/client attachment, deduplicate eventKey and
persist the bell item. The target is reauthorized before the frontend opens the canonical module record.
Mandatory notices, supported sending channels, delivery/consent and safe templates belong to R6.

Appointment booking/rescheduling/cancellation use one canonical record. An Idempotency-Key protects
creation; expectedVersion protects updates. Server computes end/buffer instants; PostgreSQL prevents
overlapping live bookings. All availability-changing operations share the firm/provider DB lock.
Reminders are durable rows, claimed with a lease and rechecked against current version/status before delivery;
cancel/reschedule invalidates stale jobs. R6 must supply durable dedupe/outbox and consent guarantees,
and recheck the appointment version/recipient at actual delivery. QUEUED records R6 acceptance only.
No promises of exactly-once sending or an in-memory lock replacing the DB constraint.

## Decisions to agree with Fahad and Rasel

1. Portal name/header/welcome fields; public signup needs legal/branding bootstrap through R3/R4,
   while the protected portal endpoints here serve signed-in clients. Do not duplicate their bootstrap.
2. OWNER-only audit viewer (latest T08) versus older OWNER/ADMIN matrix; admin role escalation and last owner.
3. R4 application form property mapping/history source. Proposed contact/address DTO excludes raw `data`;
   any other approved screen fields need an explicit DTO/redaction decision from R4.
4. Notification categories/defaults, supported channels, marketing consent and mandatory categories.
5. Active providers, type eligibility, client reschedule/cancel cutoff, who staff can see, appointment state changes,
   and configurable reminder offsets. Provider-to-type relation may need another schema request.
6. External approved domains and business-only versus general-resource audience. The documented portal
   business directory blocks Individual clients; `ALL` is reserved for an agreed general-resource route.
7. Final endpoint names, cursor/filter UX, conflict/empty/error states. Publish agreed Zod DTOs in
   `packages/types` on the corresponding implementation ticket before frontend consumption.

Unresolved owner-service policy is represented by explicit integration ports; unavailable dependencies
fail closed with 503. T02–T09 have separate fresh-main branches and endpoint/firm-isolation tests.
Notification links to appointments/resources recheck actual recipient permissions; unresolved document,
invoice and engagement links stay hidden pending their owning modules. Octavia review and production
smoke require the reviewed/deployed integrated application.

## Validation and review

Validated with `@apidevtools/swagger-parser` **13.1.0**, including external references and structural schemas.
The committed validator also checks unique operation ids, declared roles, site cookies, scope errors,
read-only application routes, and forbidden identity/context request fields.

Run from the repo root with Node 22.22.1 or newer (dependencies stay in the ignored helper folder):

```sh
mkdir -p .local-analysis/contracts
printf '{"private":true}' > .local-analysis/contracts/package.json
pnpm --dir .local-analysis/contracts --ignore-workspace add @apidevtools/swagger-parser@13.1.0
node docs/api/firm/validate.mjs
```

PowerShell equivalent for the first two commands: `New-Item -ItemType Directory -Force .local-analysis/contracts`
and `Set-Content .local-analysis/contracts/package.json '{"private":true}'` (use UTF-8 without BOM).
Do not commit that helper package, lockfile or node_modules. Pass an alternate helper package.json path
as the first validator argument if desired.

This document set is larger than the repository's 400-line PR limit. Keep module commits independent;
agree a ticket/review split with Rasel before opening a combined PR. Git push alone does not deliver the
required schema-labelled issue, obtain pair confirmation, pass CI or mark the Team Board Done.
