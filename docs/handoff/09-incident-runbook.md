# 09. Production Incident Response Runbook

## 1. Incident Severity Tiers & Service Level Objectives (SLO)

| Severity | Definition | Initial Response | Status Cadence | Target Resolution |
|---|---|---|---|---|
| **P1 - Critical** | Complete platform outage, widespread data corruption, or total failure of core authentication/database systems. | **< 15 minutes** | Every 30 minutes | **< 2 hours** |
| **P2 - Major** | Core workflow impaired (e.g. E-Sign packet failure, payments offline, upload pipeline blocked). | **< 30 minutes** | Every 1 hour | **< 4 hours** |
| **P3 - Moderate** | Isolated functional issue affecting non-critical modules; viable workaround exists. | **< 2 hours** | Daily | **< 24 hours** |
| **P4 - Minor** | Cosmetic defects, minor UI inconsistencies, or non-blocking documentation updates. | **< 1 business day** | Normal backlog | Next release |

*(Auditor Reference: Response and resolution windows defined above represent operational targets established by platform service level agreements. Compliance measurements are audited against live PagerDuty and incident tracking post-launch.)*

---

## 2. Incident Management & Escalation Flow
1. **Detection & Alerting**: P1/P2 alerts dispatched via PagerDuty / Opsgenie from CloudWatch Alarms (High 5xx rate, RDS CPU > 85%, ALB target response time > 2s).
2. **Incident Roles**:
   - **Incident Commander (IC)**: Directs investigation, delegates tasks, manages timeline.
   - **Technical Lead**: Inspects logs, runs diagnostics, prepares code/infrastructure patches.
   - **Communications Lead**: Posts updates to status page and notifies affected firm owners.
3. **Post-Mortem**: Required for all P1 and P2 incidents within 48 hours of resolution.

---

## 3. Diagnostic & Remediation Playbooks

### 3.1 Playbook A: High API 5xx Error Rates
```bash
# 1. Inspect recent API container logs via AWS CloudWatch Logs Insights
fields @timestamp, @message
| filter @message like /ERROR/ or @message like /Exception/
| sort @timestamp desc
| limit 50

# 2. Check ECS container task health and memory/CPU limits
aws ecs describe-services \
  --cluster firmivra-prod-cluster \
  --services firmivra-prod-api-service

# 3. If tasks are crash-looping due to bad release, execute immediate rollback:
aws ecs update-service \
  --cluster firmivra-prod-cluster \
  --service firmivra-prod-api-service \
  --task-definition firmivra-prod-api:<previous-stable-revision> \
  --force-new-deployment
```

### 3.2 Playbook B: Database Connection Pool Exhaustion
```bash
# 1. Inspect active PostgreSQL backend connections
SELECT count(*), state FROM pg_stat_activity GROUP BY state;

# 2. Identify long-running transactions or deadlocks
SELECT pid, now() - pg_stat_activity.query_start AS duration, query, state
FROM pg_stat_activity
WHERE state != 'idle' AND (now() - pg_stat_activity.query_start) > interval '1 minute';

# 3. Terminate stuck transaction blocking pools
SELECT pg_terminate_backend(<pid>);

# 4. If connection storm persists, scale ECS tasks temporarily and increase RDS max_connections:
aws rds modify-db-parameter-group \
  --db-parameter-group-name firmivra-prod-pg-params \
  --parameters "ParameterName=max_connections,ParameterValue=500,ApplyMethod=immediate"
```

### 3.3 Playbook C: Suspected Security Breach or Unauthorized Access
```bash
# 1. Immediately revoke compromised user or firm sessions in database:
#    Setting token_version increments invalidates all issued JWT cookies instantly.
UPDATE users SET token_version = token_version + 1 WHERE id = '<user_id>';

# 2. Lock firm workspace if compromise is tenant-wide:
UPDATE businesses SET status = 'SUSPENDED', suspended_at = NOW(), suspend_reason = 'Security containment' WHERE id = '<business_id>';

# 3. Rotate affected AWS Secrets in Secrets Manager:
aws secretsmanager rotate-secret --secret-id firmivra-prod-db-credentials
```
