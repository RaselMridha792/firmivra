# 04. Database Schemas, Multi-Tenancy & Migrations

## 1. Relational Database Architecture
Firmivra utilizes **PostgreSQL 16** managed via **Amazon RDS (Multi-AZ)** as its primary relational store. Database definitions, relations, constraints, and indexes are defined declaratively in `packages/db/prisma/schema.prisma`.

---

## 2. Multi-Tenant Data Scoping Architecture

### 2.1 The Four-Wall Isolation Model
1. **Wall 1: API Level (`TenantGuard`)**:
   Every incoming HTTP request resolves the active tenant `businessId` from the hostname, subdomain, or authenticated session before touching domain services. Requests with mismatched or foreign tenant IDs are blocked with `404 NOT_FOUND`.
2. **Wall 2: Database Client Scoping (`Database.withScope()`)**:
   All database access is mediated through scoped clients:
   ```ts
   database.withScope({ kind: 'business', businessId }, async (tx) => {
     // Every query executed within this transaction is automatically constrained
     // to `where: { businessId }`.
   });
   ```
3. **Wall 3: Platform Scope Separation**:
   Platform tables (`businesses`, `platform_admins`, `firm_applications`, `platform_audit_log`) exist in a dedicated platform scope. No tenant workspace session can execute queries against platform administration models.
4. **Wall 4: Ephemeral Support Access (`app_enter_support_scope`)**:
   Super Admin access to a firm's records for customer support requires an active, unrevoked, unexpired grant approved by the firm's Owner. Support transactions execute read-only queries with mandatory audit logging.

---

## 3. Core Domain Entity Map

```
[Business (Tenant)]
  ├── Membership ── User (Staff / Owner / Admin)
  ├── ClientAccount (Portal Identity)
  ├── Client ── Contact
  │     ├── Document
  │     ├── Invoice ── Payment ── PaymentEvent
  │     ├── TaxReturn
  │     └── TaxPlan
  ├── Appointment ── AppointmentAttendee
  ├── EsignRequest ── EsignRecipient ── EsignField
  ├── Task ── Checklist
  ├── Lead ── LeadFollowUp
  ├── CommunicationCampaign ── Message
  └── AuditLogEntry (Immutable event stream)
```

### 3.1 Primary Domain Model Clusters
- **Tenant Management**: `Business`, `FirmApplication`, `BusinessModules`, `Location`.
- **Identity & Authorization**: `User`, `Membership`, `Role`, `PermissionGrant`, `ClientAccount`.
- **Client Management & CRM**: `Client`, `Contact`, `Lead`, `LeadFollowUp`, `ClientTag`.
- **Scheduling & Calendar**: `Appointment`, `AppointmentType`, `AppointmentResource`, `WaitlistEntry`.
- **Document Vault & E-Sign**: `Document`, `DocumentCategory`, `EsignRequest`, `EsignRecipient`, `EsignField`.
- **Invoicing & Payments**: `Invoice`, `InvoiceLineItem`, `Payment`, `PaymentEvent`, `StripeAccount`.
- **Tax & Accounting Services**: `TaxReturn`, `TaxPlan`, `BookkeepingPeriod`, `PayrollRun`.
- **Communications & Templates**: `Template`, `TemplateVersion`, `Message`, `CommunicationCampaign`.
- **Audit Logging**: `AuditLogEntry`, `PlatformAuditLog` (append-only ledger).

---

## 4. Migration Management Protocol

### 4.1 Migration Directory & Versioning
Migrations are stored in `packages/db/prisma/migrations/` as sequenced SQL scripts with cryptographic lock tracking:
```
packages/db/prisma/migrations/
├── 20261001000000_init/
│   └── migration.sql
├── 20261015000000_esign_engine/
│   └── migration.sql
├── 20261101000000_audit_hardening/
│   └── migration.sql
└── migration_lock.toml
```

### 4.2 Production Migration Execution
In production, migrations are executed automatically during CI/CD container deployment prior to task traffic shifting:
```bash
# Executed by deploy pipeline
pnpm --filter @firmivra/db exec prisma migrate deploy
```

### 4.3 Zero-Downtime Migration Guidelines
All database modifications must follow backward-compatible, expand-and-contract patterns:
1. **Adding Columns**: Always add columns as optional (`nullable`) or with a static `DEFAULT`. Never add a non-null column without a default in a single migration.
2. **Renaming Columns**: Add the new column, dual-write in application code, backfill data, and drop the legacy column in a subsequent release.
3. **Table Alterations**: Avoid exclusive table locks. Create indexes with `CONCURRENTLY` where applicable.
4. **Data Migrations**: Execute heavy backfills asynchronously through background jobs rather than long-running synchronous DDL migration scripts.
