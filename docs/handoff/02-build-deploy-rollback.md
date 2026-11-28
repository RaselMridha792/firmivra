# 02. Build, Deployment & Rollback Runbook

## 1. Local Development & Build Lifecycle

### 1.1 Prerequisites
- **Node.js**: v22.22.0 or higher.
- **Package Manager**: `pnpm` v10.32 (enable via `corepack enable`).
- **Docker**: Docker Desktop with Compose v2.
- **AWS CLI & Session**: AWS CLI v2 configured for deployment targets.
- **Database Engine**: PostgreSQL 16 (provided via Docker Compose for local dev).

### 1.2 Local Setup Sequence
```bash
# 1. Clone and install dependencies
git clone https://github.com/RaselMridha792/firmivra.git && cd firmivra
pnpm install

# 2. Local environment configuration
cp .env.example .env

# 3. Start local containerized infrastructure
docker compose up -d
# Confirms Postgres (port 5433), S3 Mock (port 9090), and Mailpit (port 8025)

# 4. Initialize Database
pnpm --filter @firmivra/db generate
pnpm db:migrate
pnpm db:seed

# 5. Build Workspace Packages
pnpm --filter @firmivra/types build
pnpm build
```

---

## 2. Production Containerization
Production containers are built using multi-stage Dockerfiles to minimize image size and eliminate build toolchains from runtime images:

### 2.1 Backend API Container (`apps/api`)
```dockerfile
# syntax=docker/dockerfile:1
FROM node:22-alpine AS builder
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.32.0 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY packages/ packages/
COPY apps/api/ apps/api/
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @firmivra/types build
RUN pnpm --filter @firmivra/db build
RUN pnpm --filter @firmivra/api build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/apps/api/dist ./dist
COPY --from=builder /app/apps/api/package.json ./package.json
USER node
EXPOSE 4000
CMD ["node", "dist/main.js"]
```

### 2.2 Frontend Web Container (`apps/web`)
```dockerfile
FROM node:22-alpine AS builder
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.32.0 --activate
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @firmivra/types build
RUN pnpm --filter @firmivra/ui build
RUN pnpm --filter @firmivra/web build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
COPY --from=builder /app/apps/web/.next/standalone ./
COPY --from=builder /app/apps/web/.next/static ./.next/static
COPY --from=builder /app/apps/web/public ./public
USER node
EXPOSE 3000
CMD ["node", "server.js"]
```

---

## 3. Continuous Deployment (CI/CD) Architecture
Deployments are fully automated via GitHub Actions pipelines authenticated to AWS using OpenID Connect (OIDC) roles, eliminating static AWS access keys.

### 3.1 Pipelines
1. **Pull Request Validation (`test.yml`)**:
   - Triggers on PR creation/update to `main`.
   - Runs full ESLint, TypeScript recursive typecheck, Vitest unit suite, and Playwright mock E2E suite.
2. **Development Deployment (`deploy-dev.yml`)**:
   - Triggers automatically upon merge to `main`.
   - Builds and tags container images with Git SHA.
   - Pushes images to AWS ECR (`firmivra-dev-api`, `firmivra-dev-web`).
   - Runs database migrations: `prisma migrate deploy`.
   - Executes AWS CDK deployment: `cdk deploy firmivra-dev-* --require-approval never`.
3. **Production Deployment (`deploy-prod.yml`)**:
   - Triggers upon creation of a release tag (`v*.*.*`) or manual dispatch approved by lead.
   - Deploys to `firmivra-prod-*` stacks.

---

## 4. Rollback Runbooks

### 4.1 Application Service Rollback (Zero Downtime)
If a newly deployed container revision introduces a regression, roll back immediately to the previous ECS task definition revision:

```bash
# 1. Identify previous stable task definition revision
aws ecs describe-services \
  --cluster firmivra-prod-cluster \
  --services firmivra-prod-api-service \
  --query "services[0].taskDefinition"

# 2. Update service to point to previous task definition revision (e.g. revision 42)
aws ecs update-service \
  --cluster firmivra-prod-cluster \
  --service firmivra-prod-api-service \
  --task-definition firmivra-prod-api:42 \
  --force-new-deployment

# 3. Repeat for Web service if needed
aws ecs update-service \
  --cluster firmivra-prod-cluster \
  --service firmivra-prod-web-service \
  --task-definition firmivra-prod-web:38 \
  --force-new-deployment

# 4. Monitor deployment stabilization
aws ecs wait services-stable \
  --cluster firmivra-prod-cluster \
  --services firmivra-prod-api-service firmivra-prod-web-service
```

### 4.2 Edge / CDN Cache Invalidation
Whenever frontend code or static assets are rolled back:
```bash
aws cloudfront create-invalidation \
  --distribution-id <DISTRIBUTION_ID> \
  --paths "/*"
```

### 4.3 Database Migration Rollback Strategy
1. **Schema Expand-and-Contract**: All Firmivra migrations are authored following backward-compatible expand-and-contract patterns. Old code revisions remain fully functional with newly migrated database schemas.
2. **Targeted Reversion**:
   If a migration must be reverted, author a forward-reverting migration:
   ```bash
   pnpm --filter @firmivra/db exec prisma migrate dev --name revert_<feature>
   ```
3. **Emergency Point-in-Time Recovery (PITR)**:
   In the event of catastrophic data corruption, restore the RDS cluster to a point-in-time prior to the incident (refer to Chapter 08).
