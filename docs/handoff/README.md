# Firmivra Platform Legal & Technical Handoff Pack
**Production Deliverables & Operations Manual**
*Target Milestone: Production Release (November 30, 2026)*
*Lead Engineering: OpenCode-lead (R1)*
*Repository: RaselMridha792/firmivra*

---

## Executive Overview
The **Firmivra Platform Handoff Pack** provides a complete, authoritative, and audit-ready technical transfer package for the Firmivra practice management platform. Designed specifically for professional accounting, tax, and advisory practices, Firmivra delivers a unified multi-tenant architecture with uncompromising security, regulatory compliance, and high-availability operations.

This document serves as the master navigation guide and executive index across all 11 modular handoff chapters.

---

## Table of Contents & Chapter Guide

| Chapter | Title | Primary Focus & Deliverables |
|---|---|---|
| [**01. Source & Repo History**](./01-source-and-repo-history.md) | Source Code & Repository History | Monorepo layout (`apps/web`, `apps/api`, `packages/*`), package dependency graph, branching/tagging standards, and development milestone chronology (Sprints 0–6, Beta, Reviews 1–3, Fix Phase). |
| [**02. Build, Deploy & Rollback**](./02-build-deploy-rollback.md) | Build, Deployment & Rollback Runbook | Production Dockerfile container builds, GitHub Actions CI/CD pipelines, CDK infrastructure automation, and zero-downtime ECS/RDS rollback runbooks. |
| [**03. Dependencies & Licenses**](./03-dependency-and-license-inventory.md) | Dependency & Open Source License Inventory | Complete inventory of production runtime dependencies across web and API; license audit confirming zero copyleft/GPL exposure and 100% permissive licensing (MIT, Apache-2.0, BSD, ISC). |
| [**04. Schemas & Migrations**](./04-schemas-and-migrations.md) | Database Schemas, Multi-Tenancy & Migrations | PostgreSQL 16 schema, Prisma models, Row-Level Security tenant scoping (`business_id`, `Database.withScope()`), and zero-downtime migration protocols. |
| [**05. AWS Infrastructure**](./05-aws-infrastructure.md) | AWS Cloud Infrastructure & Configuration | Cloud architecture blueprint (AWS us-east-1): Multi-AZ VPC, ECS Fargate, RDS PostgreSQL Multi-AZ, S3 KMS-encrypted storage, Cognito pools, CloudFront, WAF, and SES. |
| [**06. Architecture & Data Flows**](./06-architecture-and-data-flows.md) | Architecture & Data Flow Pipelines | End-to-end request lifecycle (Client -> Edge -> ALB -> NestJS -> PostgreSQL/S3), tenant resolution pipeline, file upload/malware scanning sequence, E-Sign composition, and Stripe webhooks. |
| [**07. Access Matrix**](./07-access-matrix.md) | Access Control & Role-Based Permissions (RBAC) | Detailed permissions matrix mapping all 8 platform and firm roles (Super Admin, Support, Owner, Admin, Manager, Preparer, Staff, Viewer, Client Portal) across all 18 functional modules. |
| [**08. Backup & Disaster Recovery**](./08-backup-and-disaster-recovery.md) | Backup Policy & Disaster Recovery Plan | Business continuity standards: RPO < 5 minutes, RTO < 30 minutes. RDS automated snapshots, 35-day Point-in-Time Recovery (PITR), Multi-AZ failover, S3 cross-region replication, and verified recovery procedures. |
| [**09. Incident Runbook**](./09-incident-runbook.md) | Production Incident Response Runbook | Incident classification (P1–P4), alerting thresholds, diagnostic playbooks (high 5xx errors, database connection storms, security containment), and escalation paths. |
| [**10. Admin & Maintenance**](./10-admin-and-maintenance.md) | Platform Administration & Routine Maintenance | Super Admin operations: firm onboarding/approval workflow, tenant suspension, ephemeral support access protocol (`app_enter_support_scope`), secret rotation, and certificate renewal. |
| [**11. Data Portability & Export**](./11-data-export-and-portability.md) | Data Portability, Export & Offboarding Guide | Tenant data ownership: self-service exports across modules, complete offboarding export package structure (JSON/CSV + S3 document archives with SHA-256 manifests), and cryptographic erasure. |

---

## Verification & Compliance References
- **Security Acceptance Pack**: [`docs/work/Q38-security-pack.md`](../work/Q38-security-pack.md) (Complete automated test evidence covering Tenant Isolation, MFA, Malware Scanning, CSP, and Webhook Signatures).
- **Core System Architecture**: [`docs/SYSTEM-DESIGN.md`](../SYSTEM-DESIGN.md).
- **Authentication Specification**: [`docs/AUTH-DESIGN.md`](../AUTH-DESIGN.md).
- **Development & Contribution Guidelines**: [`docs/junior/DEVELOPERS.md`](../junior/DEVELOPERS.md) and [`docs/junior/GIT-WORKFLOW.md`](../junior/GIT-WORKFLOW.md).
