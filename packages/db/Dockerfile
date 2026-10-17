# syntax=docker/dockerfile:1
# Migration task image. Build from the repo root: docker build -f packages/db/Dockerfile -t firmivra-migrate .
# Runs `prisma migrate deploy` as the owner role, then sets the app role's password (scripts/migrate-deploy.mjs).
# Also holds the one-off dev command scripts/link-dev-users.mjs, which needs the built package (dist).

# Deploy dev passes our ECR pull-through cache (<registry>/ecr-public); local builds pull from
# ECR Public as before.
ARG BASE_REGISTRY=public.ecr.aws
FROM ${BASE_REGISTRY}/docker/library/node:22-alpine AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH HUSKY=0
RUN corepack enable
WORKDIR /repo

FROM base AS build
COPY . .
RUN pnpm install --frozen-lockfile
# dist: the scoped client and link-users for scripts/link-dev-users.mjs (generate, then build).
RUN pnpm exec turbo run build --filter=@firmivra/db
# All dependencies of packages/db, including the Prisma CLI (a devDependency).
RUN pnpm --filter @firmivra/db deploy --legacy /out

# Demo-seed task image (R0 PART 2, Oct 17): seeds or unseeds the `demo` firm, and bootstraps
# dev's platform org/plan reference data (the plan ladder, the department/role catalog, and the
# CEO mapping -- none of which the normal seed runs on dev), as one-off ECS tasks R1 runs after
# an RDS snapshot and Rasel's go. Built FROM build (not runtime): it needs tsx, a devDependency,
# to run the prisma/*.ts entry points directly. Placed BEFORE runtime, and never named as the
# default target, so a plain `docker build` (deploy-dev's "Build and push migrate" step, no
# --target) still ends on runtime and produces the trimmed migrate-task image -- a stage placed
# after the last-stage-wins default would become it instead.
#   docker build -f packages/db/Dockerfile --target demo-seed-task -t firmivra-demo-seed .
#   docker run ... -e APP_ENV=dev -e DB_HOST=... firmivra-demo-seed node scripts/seed-demo-task.mjs
#   docker run ... -e APP_ENV=dev -e DB_HOST=... firmivra-demo-seed node scripts/unseed-demo-task.mjs
#   docker run ... -e APP_ENV=dev -e DB_HOST=... firmivra-demo-seed node scripts/bootstrap-platform-org-task.mjs
FROM build AS demo-seed-task
WORKDIR /repo/packages/db
ADD --chown=node:node https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem /app/rds-ca.pem
ENV NODE_EXTRA_CA_CERTS=/app/rds-ca.pem
USER node
CMD ["node", "scripts/seed-demo-task.mjs"]

FROM ${BASE_REGISTRY}/docker/library/node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /out/package.json ./package.json
COPY --from=build --chown=node:node /out/node_modules ./node_modules
COPY --from=build --chown=node:node /out/dist ./dist
COPY --from=build --chown=node:node /repo/packages/db/prisma ./prisma
COPY --from=build --chown=node:node /repo/packages/db/prisma.config.ts ./prisma.config.ts
COPY --from=build --chown=node:node /repo/packages/db/scripts/migrate-deploy.mjs ./scripts/migrate-deploy.mjs
COPY --from=build --chown=node:node /repo/packages/db/scripts/set-module.mjs ./scripts/set-module.mjs
COPY --from=build --chown=node:node /repo/packages/db/scripts/link-dev-users.mjs ./scripts/link-dev-users.mjs
ADD --chown=node:node https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem /app/rds-ca.pem
ENV NODE_EXTRA_CA_CERTS=/app/rds-ca.pem
USER node
CMD ["node", "scripts/migrate-deploy.mjs"]
