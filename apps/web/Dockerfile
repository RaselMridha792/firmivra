# syntax=docker/dockerfile:1
# Build from the repo root: docker build -f apps/web/Dockerfile -t firmivra-web .
# Serves admin., app. and portal. by host name. In AWS, CloudFront sends /api/* to the API instead.

FROM public.ecr.aws/docker/library/node:22-alpine AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH HUSKY=0 NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /repo

FROM base AS build
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm exec turbo run build --filter=@firmivra/web...

FROM public.ecr.aws/docker/library/node:22-alpine AS runtime
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=build --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD wget -qO- http://127.0.0.1:3000/healthz || exit 1
CMD ["node", "apps/web/server.js"]
