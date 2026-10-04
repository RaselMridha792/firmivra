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

The response also sets the `fv_access` HttpOnly cookie. Seeded users are listed in `packages/db/README.md`.

## Every request

1. `requestContextMiddleware`: request id (`x-request-id`), IP and user agent in an AsyncLocalStorage context.
2. `ThrottlerGuard`: rate limit (300 a minute per IP; stricter on sensitive routes).
3. `AuthGuard`: token from the `fv_access` cookie or `Authorization: Bearer`, verified (Cognito, or the local key), user loaded by Cognito `sub`. Skipped for `@Public()`.
4. `TenantGuard`: for routes with a firm role, finds the firm (`:slug` route param, else `x-business-id` header, else the caller's only firm) and the caller's role from `Membership` or `ClientAccount`. No link to the firm: **404**. Suspended or closed firm: 403 `BUSINESS_INACTIVE`.
5. `RolesGuard`: **default deny**. Every non-public route needs `@Roles(...)`.

Errors always look like `{ "error": { "code", "message", "requestId", "details?" } }`.

## Adding a module

```ts
@Controller('clients')
@Roles('OWNER', 'ADMIN', 'STAFF') // required: routes without @Roles are refused
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

- Database: `TenantPrisma.db` for firm data (never `businessId` from the body or query). Platform work goes through `@Inject(DATABASE)` with `forPlatform()`; Rasel reviews any use of it.
- Request bodies: a zod schema in `packages/types` and `@Body(new ZodValidationPipe(Schema))`.
- Audit: `AuditService.log(action, entity, metadata)` for every action on client data. No secrets or personal data in metadata.
- Tests: an e2e test per endpoint, including firm A versus firm B (see `test/e2e/api.e2e.test.ts`).

## Tests

`pnpm --filter @firmivra/api test` runs the guard unit tests and the e2e tests against the API's own test database (`<database>_test_api`, created and reset automatically).

## Docker

`docker build -f apps/api/Dockerfile -t firmivra-api .` from the repo root (Node 22 Alpine, non-root, production dependencies only).
