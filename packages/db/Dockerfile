# syntax=docker/dockerfile:1
# Migration task image. Build from the repo root: docker build -f packages/db/Dockerfile -t firmivra-migrate .
# Runs `prisma migrate deploy` as the owner role, then sets the app role's password (scripts/migrate-deploy.mjs).

FROM node:22-alpine AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH HUSKY=0
RUN corepack enable
WORKDIR /repo

FROM base AS build
COPY . .
RUN pnpm install --frozen-lockfile
# All dependencies of packages/db, including the Prisma CLI (a devDependency).
RUN pnpm --filter @firmivra/db deploy --legacy /out

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /out/package.json ./package.json
COPY --from=build --chown=node:node /out/node_modules ./node_modules
COPY --from=build --chown=node:node /repo/packages/db/prisma ./prisma
COPY --from=build --chown=node:node /repo/packages/db/prisma.config.ts ./prisma.config.ts
COPY --from=build --chown=node:node /repo/packages/db/scripts/migrate-deploy.mjs ./scripts/migrate-deploy.mjs
ADD --chown=node:node https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem /app/rds-ca.pem
ENV NODE_EXTRA_CA_CERTS=/app/rds-ca.pem
USER node
CMD ["node", "scripts/migrate-deploy.mjs"]
