# @firmivra/web

One Next.js 16 app (App Router) for three sites, chosen in `src/proxy.ts` by the host map from config (`ADMIN_HOST`, `APP_HOST`, `PORTAL_HOST`, read on every request):

| Host                 | Route folder                 | Who                    |
| -------------------- | ---------------------------- | ---------------------- |
| `ADMIN_HOST`         | `src/app/admin/`             | Super Admin (Nahid)    |
| `APP_HOST`           | `src/app/firm/`              | Firm workspace (Fahad) |
| `PORTAL_HOST/{slug}` | `src/app/portal/[firmSlug]/` | Client portal (Nahid)  |

- UI comes only from `@firmivra/ui` (tokens and components). Tailwind 4 reads the tokens from `@firmivra/ui/styles.css`.
- The browser calls the API at `/api/v1` on its own host (`src/lib/api.ts`, typed by `@firmivra/types`), so the API's HttpOnly cookie is per site. Locally Next forwards `/api/v1` to `API_BASE_URL`; in AWS CloudFront does it.
- Sign-in: `src/lib/auth.ts`. Locally the screens offer the seeded users (`POST /api/v1/dev/token`). The real Cognito-backed screens follow the mockups in Sprint 1 and 2.
- The current pages are placeholders that prove sign-in and `/me` work on each host.
- The bare host (`localhost:3000`) has a minimal dark Coming Soon page with the Firmivra wordmark,
  a short platform description and a live countdown to the planned first beta on January 8, 2027.
  The date-only target is interpreted as midnight UTC, labeled on the page. At zero the timer
  stops and shows a preparations message; it does not claim the product has launched.

```bash
pnpm --filter @firmivra/web dev        # needs the API: pnpm dev at the root starts both
pnpm --filter @firmivra/web test:e2e   # Playwright: each site loads, local sign-in end to end
```

Browser checks also cover the Coming Soon page on desktop/mobile and countdown rollover.
For installed Edge, set `PLAYWRIGHT_CHANNEL=msedge` (PowerShell: `$env:PLAYWRIGHT_CHANNEL = 'msedge'`).

`agentRules: false` keeps `next dev` from generating extra agent instruction files.
Follow the existing repository instructions and Next.js docs bundled in `node_modules/next/dist/docs`.

Docker: `docker build -f apps/web/Dockerfile -t firmivra-web .` from the repo root (standalone output, non-root, health check at `/healthz`).
