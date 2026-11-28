# 08. Backup Policy & Disaster Recovery Plan

## 1. Business Continuity Targets
The Firmivra platform is engineered to meet strict availability and data retention objectives for professional accounting practices:
- **Recovery Point Objective (RPO)**: **< 5 minutes** (as-designed architectural target). Data loss is bounded to less than five minutes of transactions through continuous write-ahead log (WAL) streaming.
- **Recovery Time Objective (RTO)**: **< 30 minutes** (as-designed architectural target). Full operational restoration in an alternate availability zone or restored database cluster within thirty minutes.

*(Auditor Reference: The metrics above represent as-designed infrastructure specifications based on AWS RDS Multi-AZ synchronous replication and continuous S3 WAL archiving. Empirical recovery measurements are subject to scheduled live disaster recovery drills post-launch.)*

---

## 2. Backup Strategy & Policies

### 2.1 Amazon RDS for PostgreSQL (Relational Data)
1. **Continuous Point-in-Time Recovery (PITR)**:
   - Amazon RDS continuously archives write-ahead logs (WAL) to Amazon S3.
   - Any point in time within the **35-day retention window** can be selected for restoration down to the exact second (`RestoreDBInstanceToPointInTime`).
2. **Automated Daily Snapshots**:
   - Automated full storage volume snapshots are taken daily during the maintenance window (03:00–04:00 UTC).
   - Snapshots are encrypted with AWS KMS Customer Managed Keys (CMK) and retained for 35 days.
3. **Multi-AZ Synchronous Replication**:
   - High availability is provided by synchronous replication to a standby instance in a secondary Availability Zone.
   - In the event of primary hardware failure, AZ outage, or maintenance disruption, RDS automatically fails over to the standby within 60 seconds with zero manual intervention and zero data loss.

### 2.2 Amazon S3 (Document Vault & Artifacts)
1. **Object Versioning**: Enabled on all primary document buckets (`firmivra-prod-docs-*`). Overwritten or deleted objects retain their version history indefinitely.
2. **Lifecycle Policies**: Transition older non-current versions to S3 Standard-IA (Infrequent Access) after 30 days and Glacier Flexible Retrieval after 90 days.
3. **Cross-Region Replication (CRR)**: Asynchronous replication to a secondary AWS region (`us-west-2`) ensures survivability against broad regional disasters.

---

## 3. Disaster Recovery Execution Runbook

### 3.1 Point-in-Time Recovery (PITR) Execution
In the event of catastrophic data corruption or human error:

```bash
# 1. Initiate point-in-time restore to a target timestamp
aws rds restore-db-instance-to-point-in-time \
  --source-db-instance-identifier firmivra-prod-db \
  --target-db-instance-identifier firmivra-prod-db-restored \
  --restore-time 2026-11-28T14:30:00Z \
  --db-instance-class db.m6g.xlarge \
  --multi-az \
  --publicly-accessible false

# 2. Monitor restoration progress
aws rds wait db-instance-available \
  --db-instance-identifier firmivra-prod-db-restored

# 3. Update application database connection secret in AWS Secrets Manager
aws secretsmanager update-secret \
  --secret-id firmivra-prod-db-credentials \
  --secret-string '{"host":"<restored-db-endpoint>","port":5432,"dbname":"firmivra","username":"firmivra_app","password":"<password>"}'

# 4. Trigger ECS application rolling restart to bind to restored database
aws ecs update-service \
  --cluster firmivra-prod-cluster \
  --service firmivra-prod-api-service \
  --force-new-deployment
```

### 3.2 Verification Checklist Post-Restore
- [ ] Confirm database connection health via `/api/v1/health`.
- [ ] Verify Super Admin platform console login and platform audit log integrity.
- [ ] Inspect tenant firm records and verify that latest pre-incident transactions exist.
- [ ] Test document retrieval against Amazon S3 to verify cryptographic signature validity.
