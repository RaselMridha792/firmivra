# 10. Platform Administration & Routine Maintenance Guide

## 1. Super Admin Operations (`admin.firmivra.com`)

### 1.1 Firm Application Lifecycle & Onboarding
1. **Application Review**: Prospective accounting firms apply through the public onboarding flow. Applications arrive under `/admin/firm-applications`.
2. **Approval Automation**:
   When a Super Admin clicks **Approve**:
   - Creates the tenant `Business` record with unique firm slug.
   - Provisions default `BusinessModules` (Appointments, Invoices, Documents, etc.).
   - Generates a dedicated AWS KMS Customer Master Key (CMK) for tenant-scoped file encryption.
   - Generates initial Owner user in AWS Cognito and dispatches welcome activation email.
   - Appends an immutable record to the `platform_audit_log`.
3. **Suspension & Reactivation**:
   - Super Admins can suspend a tenant firm in case of non-payment or security investigation.
   - Suspension immediately locks all staff and client sessions, returning a polite suspension notice on workspaces and portal routes.

---

## 2. Ephemeral Support Access Protocol

```
[Super Admin]                     [Firm Owner]                          [PostgreSQL Definier]
     │                                 │                                          │
     │ 1. Request access               │                                          │
     │    (Reason, max 72 hrs)         │                                          │
     │────────────────────────────────>│                                          │
     │                                 │ 2. Owner inspects request under          │
     │                                 │    Settings > Support Access             │
     │                                 │    Clicks "Approve" (Grant ACTIVE)       │
     │                                 │─────────────────────────────────────────>│
     │                                                                            │
     │ 3. Super Admin enters support session                                      │
     │    (Invokes `app_enter_support_scope()`)                                    │
     │───────────────────────────────────────────────────────────────────────────>│
     │                                                                            │ 4. Read-only scope set
     │ 5. Inspect audit logs & troubleshooting data                               │    Platform and firm logs
     │<───────────────────────────────────────────────────────────────────────────│    record support.viewed
     │                                                                            │
     │                                 │ 6. Owner may click "Revoke" anytime      │
     │                                 │    (Immediate session termination)       │
     │                                 │─────────────────────────────────────────>│
```

---

## 3. Routine Maintenance Playbooks

### 3.1 Cryptographic Secrets Rotation
- **Frequency**: Every 90 days for API secrets; automated rotation for RDS database credentials.
- **RDS Password Rotation**:
  Managed via AWS Secrets Manager with automatic Lambda rotator (`SecretsManagerRDSMySQLRotationMultiUser`).
- **Stripe Webhook Secret Rotation**:
  1. Generate new signing secret in Stripe Dashboard under Developers > Webhooks.
  2. Update `STRIPE_WEBHOOK_SECRET` in AWS Secrets Manager.
  3. ECS tasks automatically pick up the new secret upon rolling reload.

### 3.2 SSL/TLS Certificate Lifecycle
- Certificates are managed through **AWS Certificate Manager (ACM)** with automated DNS validation via Amazon Route 53.
- Certificates auto-renew 30 days prior to expiration without administrator intervention.

### 3.3 Database Optimization & Index Health
Scheduled maintenance windows (Sundays 04:00 UTC) execute automated maintenance:
```sql
-- Reclaim storage and update query planner statistics
VACUUM ANALYZE;

-- Reindex high-churn tables to prevent index bloat
REINDEX TABLE CONCURRENTLY esign_events;
REINDEX TABLE CONCURRENTLY audit_log_entries;
```
