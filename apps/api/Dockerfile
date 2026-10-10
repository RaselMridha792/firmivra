# syntax=docker/dockerfile:1
# Build from the repo root: docker build -f apps/api/Dockerfile -t firmivra-api .

FROM public.ecr.aws/docker/library/node:22-alpine AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH HUSKY=0
RUN corepack enable
WORKDIR /repo

FROM base AS build
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm exec turbo run build --filter=@firmivra/api...
# A self-contained copy of the API with production dependencies only.
RUN pnpm --filter @firmivra/api deploy --prod --legacy /out

FROM public.ecr.aws/docker/library/node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /out/package.json ./package.json
COPY --from=build --chown=node:node /out/node_modules ./node_modules
COPY --from=build --chown=node:node /out/dist ./dist
# Amazon RDS certificate bundle, so the database connection is verified (sslmode=verify-full).
ADD --chown=node:node https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem /app/rds-ca.pem
ENV NODE_EXTRA_CA_CERTS=/app/rds-ca.pem
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD wget -qO- http://127.0.0.1:${API_PORT:-4000}/api/v1/health || exit 1
CMD ["node", "dist/main.js"]
