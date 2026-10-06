# @firmivra/api

NestJS 12 REST API at `/api/v1`. Backend: Tumit and Ibrahim. Read `docs/AUTH-DESIGN.md` first.

## Run it

```bash
docker compose up -d && pnpm db:migrate && pnpm db:seed   # once
pnpm --filter @firmivra/api dev                             # http://localhost:4000/api/v1/health
```

OpenAPI docs: `http://localhost:4000/api/docs` (not in production). Port and URLs come from the root `.env` (`API_PORT`).

Local sign-in (`AUTH_MODE=local`, development and test only):

```bash
curl -X POST localhost:4000/api/v1/dev/token -H 'content-type: application/json' -d '{"email":"owner@lvp.test"}'
curl localhost:4000/api/v1/me -H "authorization: Bearer <token>"
```

The response also sets that site's HttpOnly access cookie (`fv_admin_access` for a Super Admin, `fv_access` otherwise). Seeded users are listed in `packages/db/README.md`.

## Every request

1. `requestContextMiddleware`: request id (`x-request-id`), IP and user agent in an AsyncLocalStorage context.
2. `crossSiteGuard`: POST, PUT, PATCH and DELETE need a JSON body (415 `UNSUPPORTED_MEDIA_TYPE`) and, from a browser, an `Origin` of the route's own site, from `ADMIN_BASE_URL` for `/api/v1/admin/*` and `APP_BASE_URL` or `PORTAL_BASE_URL` otherwise (403 `ORIGIN_NOT_ALLOWED`). No CORS: each site calls the API on its own host.
3. `ThrottlerGuard`: rate limit (300 a minute per viewer IP; stricter on sensitive routes). Behind CloudFront and the ALB the viewer IP is the second address from the right in `X-Forwarded-For` (`trust proxy` 2).
4. `AuthGuard`: token from the site's access cookie or `Authorization: Bearer`, verified (Cognito, or the local key), user loaded by Cognito `sub`. Skipped for `@Public()`.
5. `TenantGuard`: for routes with a firm role, finds the firm (`:slug` route param, else `x-business-id` header, else the caller's only firm) and the caller's role from `Membership` or `ClientAccount`. No link to the firm: **404**. Several firms and no header: 400 `BUSINESS_REQUIRED`. Firm not `ACTIVE`: 403 `BUSINESS_SETUP_REQUIRED` (still in setup) or `BUSINESS_INACTIVE` (suspended or closed), unless the route allows that status.
6. `RolesGuard`: **default deny**. Every non-public route needs `@Roles(...)`. Wrong role: **403**.

### Two sites, two kinds of session

- Routes under `/api/v1/admin/` belong to the Super Admin site: they read only the `fv_admin_*` cookies and accept only Super Admins. Every other route reads only the `fv_*` cookies and never accepts a Super Admin session, not even as a Bearer token.
- So `@Roles('SUPER_ADMIN')` goes only on routes under `admin/`, and firm roles never do. The API refuses to start otherwise and names the route.
- Roles always come from the database on every request (no cache): removing someone from a firm takes effect at once.

Errors always look like `{ "error": { "code", "message", "requestId", "details?" } }`.

## Adding a module

```ts
@Controller('clients')
@Roles(...FIRM_STAFF) // required: routes without @Roles are refused
export class ClientsController {
  constructor(
    private readonly tenantPrisma: TenantPrisma,
    private readonly audit: AuditService,
  ) {}

  @Get(':id')
  async get(@Param('id') id: string) {
    const client = await this.tenantPrisma.db.clientAccount.findUnique({ where: { id } }); // RLS: this firm only
    if (!client) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Not found' });
    await this.audit.log('client.viewed', { type: 'client', id });
    return client;
  }
}
```

- Roles: `FIRM_STAFF` (owner, admin, staff), `FIRM_MANAGERS` (owner, admin), `'CLIENT'` on portal routes (`:slug`), `'SUPER_ADMIN'` on `admin/` routes, `'AUTHENTICATED'` for anyone signed in.
- Firm status: firm routes work only for `ACTIVE` firms. A route a firm needs before that (the setup wizard after approval) says so: `@AllowBusinessStatuses('PENDING_SETUP', 'ACTIVE')`.
- Database: `TenantPrisma.db` for firm data (never `businessId` from the body or query). Super Admin routes use `PlatformPrisma.db` for platform tables; it throws unless `RolesGuard` verified a Super Admin for this request. `@Inject(DATABASE)` with `forPlatform()` is for the auth guards and sign-in only; Rasel reviews any other use.
- Request bodies: a zod schema in `packages/types` and `@Body(new ZodValidationPipe(Schema))`.
- Audit: `AuditService.log(action, entity, metadata)` for every action on client data. No secrets or personal data in metadata.
- Tests: an e2e test per endpoint, including firm A versus firm B (see `test/e2e/api.e2e.test.ts`).

## Tests

`pnpm --filter @firmivra/api test` runs the guard unit tests and the e2e tests against the API's own test database (`<database>_test_api`, created and reset automatically).

## Docker

`docker build -f apps/api/Dockerfile -t firmivra-api .` from the repo root (Node 22 Alpine, non-root, production dependencies only).
