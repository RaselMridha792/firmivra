# 05. AWS Cloud Infrastructure & Configuration

## 1. Cloud Architecture Overview
The Firmivra production infrastructure is hosted in **AWS us-east-1** (N. Virginia), managed exclusively via **AWS Cloud Development Kit (CDK) v2** in TypeScript (`infra/`).

*(Auditor Reference: Infrastructure parameters and topology described below represent the as-designed CDK specifications deployed via `infra/src/stacks/`. Live cloud resource outputs and active AWS console states are continuously synchronized through CloudFormation deployments.)*

```
[Internet Users]
       │
[AWS Route 53 (DNS)]
       │
[CloudFront (CDN + Edge Proxy + WAF)]
       │
[Application Load Balancer (ALB)] ── Public Subnets
       │
[ECS Fargate (NestJS API + Next.js Web)] ── Private Application Subnets
       ├── S3 Document Storage (KMS Encrypted)
       ├── AWS Cognito (Staff, Client, Admin Pools)
       ├── Amazon SES (Transactional & Notification Mail)
       └── Amazon RDS (PostgreSQL 16 Multi-AZ) ── Isolated Database Subnets
```

---

## 2. Infrastructure Stacks Breakdown (`infra/src/stacks/`)

### 2.1 Network Stack (`network-stack.ts`)
- **Virtual Private Cloud (VPC)**: 10.0.0.0/16 CIDR spanned across 3 Availability Zones.
- **Subnet Tiers**:
  - `PublicSubnets`: Internet Gateway, NAT Gateways, Application Load Balancers.
  - `ApplicationSubnets`: ECS Fargate tasks, isolated routing to NAT Gateways.
  - `DatabaseSubnets`: RDS PostgreSQL instances, no internet ingress/egress.
- **VPC Endpoints**: Gateway endpoints for Amazon S3; Interface endpoints for ECR, Secrets Manager, and CloudWatch Logs to minimize NAT egress bandwidth.

### 2.2 Data Stack (`data-stack.ts`)
- **Amazon RDS for PostgreSQL**:
  - Version: PostgreSQL 16.
  - Architecture: Multi-AZ automated standby instance with automatic failover.
  - Storage: General Purpose SSD (gp3) with automated storage autoscaling.
  - Encryption: Storage encrypted at rest using AWS KMS Customer Managed Keys.
  - Backups: Automated daily snapshots with 35-day retention; transaction log retention enabling 5-minute Point-in-Time Recovery (PITR).
- **Amazon S3 Document Storage**:
  - Primary Bucket: `firmivra-prod-docs-<region>` (Versioned, SSE-KMS, Block Public Access enabled).
  - Backup Bucket: `firmivra-prod-backups-<region>` with lifecycle transition to S3 Glacier Flexible Retrieval.

### 2.3 Authentication Stack (`auth-stack.ts`)
Three distinct Amazon Cognito User Pools guaranteeing zero identity overlap between security boundaries:
1. `firmivra-prod-staff`: Firm owners, managers, and staff members (Mandatory TOTP MFA).
2. `firmivra-prod-clients`: Client portal user accounts (Optional TOTP MFA).
3. `firmivra-prod-admins`: Platform Super Administrators (Mandatory TOTP MFA).
- Each pool configured with confidential OAuth 2.0 app clients and client secrets accessible only by the API container task role.

### 2.4 Application Compute Stack (`app-stack.ts`)
- **AWS ECS (Fargate Serverless)**:
  - Cluster: `firmivra-prod-cluster`.
  - Services: `firmivra-prod-api` (Port 4000) and `firmivra-prod-web` (Port 3000).
  - Health Checks: Standardized `/api/v1/health` and `/` endpoints with 30s evaluation intervals.
  - Auto-scaling: Target Tracking scaling based on CPU (70%) and Memory (75%) utilization.
- **Edge Distribution & Security**:
  - AWS CloudFront distributions for edge caching, TLS 1.3 termination, and HTTP/2.
  - AWS WAF (Web Application Firewall) attached to ALB and CloudFront:
    - AWS Managed Common Rule Set.
    - Known Bad Inputs / SQLi / XSS protection rules.
    - Rate-limiting rules (per-IP limits on authentication endpoints).

### 2.5 Email & Communications Stack (`email-stack.ts`)
- **Amazon Simple Email Service (SES)**:
  - Domain identities verified with DKIM keys (Easy DKIM) and published SPF/DMARC records.
  - SNS feedback loops for automated bounce and complaint tracking.

### 2.6 Threat Mitigation Stack (`malware-scan.ts`)
- EventBridge integration listening to `s3:ObjectCreated:*` events.
- Dispatches uploaded documents to security inspection pipeline, automatically updating database `scanStatus` to `CLEAN`, `INFECTED`, or `FAILED`.

---

## 3. Environment Configuration & Management
Infrastructure parameters are managed through typed configuration in `infra/src/config.ts`:

```bash
# Synthesize CloudFormation templates
pnpm --filter @firmivra/infra exec cdk synth -c env=prod

# Inspect infrastructure drift / changes before deploy
pnpm --filter @firmivra/infra exec cdk diff -c env=prod

# Deploy infrastructure stacks
pnpm --filter @firmivra/infra exec cdk deploy firmivra-prod-* -c env=prod --require-approval never
```
