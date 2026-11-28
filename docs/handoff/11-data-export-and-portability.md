# 11. Data Portability, Export & Offboarding Guide

## 1. Compliance & Data Portability Mandates
Firmivra provides full tenant data ownership and portability in strict alignment with professional accounting standards (IRS 7-year document retention rules) and privacy regulations (GDPR Article 20, CCPA/CPRA).

---

## 2. Self-Service Tenant Export Capabilities
Firm administrators and authorized staff have built-in self-service export tools across all core modules:

| Module / Domain | Export Route | Format | Content Included |
|---|---|---|---|
| **Client Records** | `POST /api/v1/business/clients/export` | CSV | Client numbers, display names, email, phone, tags, assigned staff, services. |
| **Leads & Pipeline** | `POST /api/v1/business/leads/export` | CSV | Lead names, status, source, value, follow-up history, notes. |
| **Report Builder** | `POST /api/v1/business/reports/exports` | CSV / Excel | Custom reports, tax savings summaries, revenue, practice KPIs. |
| **Firm Audit Log** | `POST /api/v1/business/audit-log/export` | CSV | Chronological immutable log of all staff actions, logins, and downloads. |
| **Automations Runs** | `POST /api/v1/business/automations/runs/export` | CSV | Execution history of all triggered rules, events, and delivery outcomes. |

---

## 3. Complete Offboarding Export Bundle
When a firm concludes its subscription or requests offboarding, the platform generates a comprehensive **Tenant Export Package**:

```
tenant-export-<firmSlug>-<timestamp>.zip
├── metadata.json                 # Export manifest, schema versions, SHA-256 checksums
├── data/
│   ├── clients.json              # Full client records with custom fields
│   ├── contacts.json             # All associated primary and secondary contacts
│   ├── invoices.json             # Invoice history, line items, and payment allocations
│   ├── appointments.json         # Past and upcoming appointments and attendees
│   ├── tax_returns.json          # Return workspace records, statuses, e-file tracking
│   ├── tax_plans.json            # Strategic tax plans, scenario calculations, strategies
│   └── audit_trail.json          # Complete compliance audit history
└── documents/
    ├── vault/                    # All client vault documents with original filenames
    └── signatures/               # Completed E-Sign PDFs paired with their Audit Certificates
        ├── contract_signed.pdf
        └── contract_certificate.pdf
```

### 3.1 Document Integrity Manifest (`metadata.json`)
Every exported document is cataloged with its cryptographic SHA-256 hash to prove non-tampering since generation:
```json
{
  "firmId": "0199b6a0-0000-7000-8000-000000000001",
  "firmName": "LVP Accounting & Taxes",
  "exportedAt": "2026-11-28T16:00:00Z",
  "filesCount": 1420,
  "documents": [
    {
      "documentId": "0199b6e0-0000-7000-8000-000000000001",
      "path": "documents/signatures/engagement_letter.pdf",
      "sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      "certificatePath": "documents/signatures/engagement_letter_certificate.pdf"
    }
  ]
}
```

---

## 4. Tenant Purge & Cryptographic Erasure Procedure
1. **Grace Period**: Tenant data is retained in `SUSPENDED` status for 30 calendar days following account termination.
2. **Hard Deletion Request**: Upon verified written instruction from the firm Owner:
   ```sql
   -- Purge tenant records from database (Cascades through foreign keys)
   DELETE FROM businesses WHERE id = '<business_id>';
   ```
3. **S3 Object Purge**: Automated script empties tenant S3 prefixes:
   ```bash
   aws s3 rm s3://firmivra-prod-docs/tenant/<business_id>/ --recursive
   ```
4. **KMS Cryptographic Shredding**: The firm's dedicated Customer Master Key is scheduled for deletion:
   ```bash
   aws kms schedule-key-deletion --key-id <firm_kms_key_id> --pending-window-in-days 7
   ```
   *Once the KMS key is deleted, any lingering ciphertext backups become mathematically impossible to decrypt, guaranteeing complete cryptographic erasure.*
