# 06. Architecture & Data Flow Pipelines

## 1. End-to-End System Component Interactions

```
┌────────────────┐     HTTPS      ┌─────────────────────┐
│  Client / User │ ─────────────> │ AWS CloudFront CDN  │
└────────────────┘                └──────────┬──────────┘
                                             │
                                             ▼
                                  ┌─────────────────────┐
                                  │ ALB (Load Balancer) │
                                  └──────────┬──────────┘
                         ┌───────────────────┴───────────────────┐
                         ▼                                       ▼
               ┌───────────────────┐                   ┌───────────────────┐
               │  Next.js Frontend │                   │   NestJS Backend  │
               │   (Port 3000)     │                   │    (Port 4000)    │
               └───────────────────┘                   └─────────┬─────────┘
                                                                 │
                   ┌──────────────────────┬──────────────────────┼──────────────────────┐
                   ▼                      ▼                      ▼                      ▼
         ┌───────────────────┐  ┌───────────────────┐  ┌───────────────────┐  ┌───────────────────┐
         │ PostgreSQL (RDS)  │  │  Amazon S3 (KMS)  │  │    AWS Cognito    │  │    Stripe API     │
         │  (Port 5432)      │  │ (Bucket Storage)  │  │  (Auth Pools)     │  │    (Payments)     │
         └───────────────────┘  └───────────────────┘  └───────────────────┘  └───────────────────┘
```

---

## 2. Request Authentication & Tenant Resolution Pipeline
Every HTTP request to the API undergoes a rigorous, layered guard pipeline before invoking business logic:

```
[Incoming Request]
        │
        ▼
[1. RequestContextMiddleware] ── Extract Host header, IP address, user-agent, correlation ID
        │
        ▼
[2. AuthGuard] ── Parse HttpOnly session cookies (`fv_access`, `fv_admin_access`)
        │         Verify cryptographic signature using aws-jwt-verify against Cognito JWKS
        │         Extract authenticated user sub and claims
        ▼
[3. TenantGuard] ── Match domain / subdomain / path context to Tenant `businessId`
        │           Verify caller's `Membership` or `ClientAccount` within this firm
        │           Attach `{ kind: 'business', businessId }` or `{ kind: 'platform' }` to context
        ▼
[4. RolesGuard / EsignRoute] ── Evaluate caller's role against route permissions (Owner, Admin, Manager, etc.)
        │
        ▼
[5. ZodValidationPipe] ── Parse and validate request body against strict contracts
        │
        ▼
[6. Service Layer Execution] ── Run business logic within `Database.withScope()`
        │
        ▼
[7. AuditService Logging] ── Append immutable action event to audit ledger
```

---

## 3. Asynchronous File Upload & Malware Scan Pipeline
Direct file uploads are protected against server denial-of-service and malicious payload execution:

```
[Client]                         [Firmivra API]                    [Amazon S3]               [Scanner Worker]
   │                                    │                               │                            │
   │ 1. POST /uploads (file metadata)  │                               │                            │
   │───────────────────────────────────>│                               │                            │
   │                                    │ 2. Issue presigned PUT ticket │                            │
   │<───────────────────────────────────│                               │                            │
   │                                                                    │                            │
   │ 3. Direct HTTP PUT upload (encrypted at rest with KMS)             │                            │
   │───────────────────────────────────────────────────────────────────>│                            │
   │                                                                    │                            │
   │ 4. POST /uploads/confirm (uploadToken)                             │                            │
   │───────────────────────────────────>│                               │                            │
   │                                    │ 5. Register PENDING document  │                            │
   │                                    │    (File blocked for use)     │                            │
   │                                                                    │ 6. ObjectCreated Event     │
   │                                                                    │───────────────────────────>│
   │                                                                    │                            │
   │                                                                    │ 7. Scan payload for virus  │
   │                                    │ 8. Update scanStatus: 'CLEAN' │<───────────────────────────│
   │                                    │    (File unblocked for use)   │                            │
```

---

## 4. E-Signature Packet Composition & Audit Trail Flow
1. **Draft Preparation**: Staff uploads documents (PDF/Word), specifies signing recipients, and positions fields. Word documents are converted to multi-page PDFs with text preserved (`docxToPdf` via `mammoth` and `pdf-lib`).
2. **Packet Assembly**: When sent, `send.service.ts` composes all source pages and orientations into an immutable master packet, calculating its cryptographic SHA-256 digest (`originalSha256`).
3. **Recipient Signing**:
   - Recipient accesses session via authenticated portal login, secure email link, or access code.
   - Recipient accepts affirmative Electronic Signing Disclosure.
   - Recipient completes assigned fields and adopts signature (typed with style preview, drawn, or uploaded).
4. **Finalization & Audit Certificate**:
   - `completion.service.ts` flattens field marks and stamps signatures at exact normalized coordinates.
   - Generates an immutable **Completion Certificate** recording:
     - Document Name and Unique Identifier.
     - SHA-256 Digest of the original packet and final signed document.
     - Complete chronological timeline of events (Sent, Viewed, Consented, Signed).
     - Signer names, verified email addresses, IP addresses, and authentication methods.
5. **Delivery**: Final signed PDF and certificate are vaulted; secure tokenized download links are dispatched to all parties.

---

## 5. Stripe Webhook & Payment Reconciliation Pipeline
```
[Stripe Gateway]                  [StripeWebhookController]              [InvoicesService / Database]
       │                                     │                                         │
       │ 1. POST /api/v1/webhooks/stripe    │                                         │
       │    (stripe-signature header)        │                                         │
       │────────────────────────────────────>│                                         │
       │                                     │ 2. Verify HMAC-SHA256 signature         │
       │                                     │    using raw request body & secret      │
       │                                     │                                         │
       │                                     │ 3. Check processorEventId idempotency   │
       │                                     │────────────────────────────────────────>│
       │                                     │                                         │
       │                                     │ 4. If new, match account to businessId  │
       │                                     │    Mark invoice status: 'PAID'          │
       │                                     │    Insert PaymentEvent audit entry      │
       │                                     │────────────────────────────────────────>│
       │ 5. 200 OK Response                  │                                         │
       │<────────────────────────────────────│                                         │
```
