# @firmivra/api

NestJS 12 REST API at `/api/v1`. Built by Rasel's Claude Code sessions (the API workstreams in `docs/work/`). Read `docs/AUTH-DESIGN.md` first.

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
2. `crossSiteGuard`: POST, PUT, PATCH and DELETE need a JSON body (415 `UNSUPPORTED_MEDIA_TYPE`) and, from a browser, an `Origin` of the route's own site: `ADMIN_BASE_URL` for `/api/v1/admin/*`, `PORTAL_BASE_URL` for `/api/v1/portal/*`, `APP_BASE_URL` or `PORTAL_BASE_URL` otherwise (403 `ORIGIN_NOT_ALLOWED`). No CORS: each site calls the API on its own host.
3. `ThrottlerGuard`: rate limit (300 a minute per viewer IP; stricter on sensitive routes). Behind CloudFront and the ALB the viewer IP is the second address from the right in `X-Forwarded-For` (`trust proxy` 2).
4. `AuthGuard`: token from the route's access cookie (the site's, or on `portal/{slug}/` routes that firm's `fv_portal_{slug}_access`) or `Authorization: Bearer`, verified (Cognito, or the local key), user loaded by Cognito `sub`. Portal routes take only the clients pool. Skipped for `@Public()`.
5. `TenantGuard`: for routes with a firm role, finds the firm (on `portal/:firmSlug/...` routes the `:firmSlug` param and nothing else; elsewhere the `x-business-id` header, else the caller's only firm) and the caller's role from `Membership` or `ClientAccount`. For clients the context also holds their own `clientAccountId`: portal routes take the client from it, never from the URL. No link to the firm: **404**. Several firms and no header: 400 `BUSINESS_REQUIRED`. Firm not `ACTIVE`: 403 `BUSINESS_SETUP_REQUIRED` (still in setup) or `BUSINESS_INACTIVE` (suspended or closed), unless the route allows that status.
6. `RolesGuard`: **default deny**. Every non-public route needs `@Roles(...)`. Wrong role: **403**.

### Two sites, two kinds of session, and a session per portal

- Routes under `/api/v1/admin/` belong to the Super Admin site: they read only the `fv_admin_*` cookies and accept only Super Admins. Every other route reads only the `fv_*` cookies and never accepts a Super Admin session, not even as a Bearer token.
- Routes under `/api/v1/portal/{slug}/` read only that firm's `fv_portal_{slug}_*` cookies (paths `/api/v1/portal/{slug}/`) and accept only clients. A client has a login per firm; their sign-in challenge and refresh envelope are sealed with the firm and never open on another firm's portal. On another firm's portal a client is simply signed out (401).
- Portal sign-in (`client-auth/portal-sign-in.controller.ts`) reuses the staff sign-in routes (`SignInRoutes`) with a `SignInPlace` (pool, cookies, firm). Who may sign in is one rule in `auth/portal-clients.ts`: an ACTIVE client of the firm, or a pending one who verified email and phone. `GET portal/{slug}/me` is `AUTHENTICATED` (a pending client reads it too) and checks that rule itself.
- So `@Roles('SUPER_ADMIN')` goes only on routes under `admin/`, and firm roles and `'AUTHENTICATED'` never do (`AUTHENTICATED` would let a removed Super Admin in until their token expires). A route never has both `@Public()` and `@Roles()`: `@Public()` would win, also from the class. The API refuses to start otherwise and names the route.
- Roles always come from the database on every request (no cache): removing someone from a firm takes effect at once.

Errors always look like `{ "error": { "code", "message", "requestId", "details?" } }`.

## Calling the API from the web app

Each site calls the API on its own host: `/api/v1/...` on `app.`, `admin.` or `portal.` (Next.js forwards it locally, CloudFront in AWS). There is no CORS. The API refuses requests from other sites, and that shapes how the web app may call it.

**Changes (POST, PUT, PATCH, DELETE): from the browser only.**

- Use the shared clients: `api` (`apps/web/src/lib/api.ts`), `staffAuth` and `adminAuth` (`apps/web/src/lib/auth.ts`), from client components (event handlers, effects). They send JSON with `credentials: 'include'`; the browser adds `Origin` and the HttpOnly session cookies. JavaScript never reads or sends a token.
- Refused: an HTML `<form>` posting to `/api/v1` (415 `UNSUPPORTED_MEDIA_TYPE`: bodies must be JSON), and any call from another site's page (403 `ORIGIN_NOT_ALLOWED`). The Super Admin site uses only `/api/v1/admin/*`; the firm and portal sites never call those.
- When a call answers 401 `UNAUTHENTICATED`, call `refresh` once from the browser and retry; if refresh answers 401 too, go to sign-in.

**Server-side code (server components, route handlers, server actions, `proxy.ts`): reads only.**

- It may GET from the API with the incoming request's `cookie` header forwarded, for example `/api/v1/me` before rendering. The access cookie is host-only with `Path=/`, so the web server receives it with the page request.
- It never sends a change with the user's cookie. Node's `fetch` sends no `Origin` and no `Sec-Fetch-Site`, so the API takes it for a relayed session and answers 403 `ORIGIN_NOT_ALLOWED`. A server action that needs a change returns to the client component, which calls the API.
- It never refreshes: the refresh cookie (`SameSite=Strict`, path `/api/v1/auth` or `/api/v1/admin/auth`) never reaches page requests. A server-side GET that answers 401 renders the signed-out state.

Locally, `APP_BASE_URL`, `PORTAL_BASE_URL` and `ADMIN_BASE_URL` in `.env` must be the addresses in the browser, port included (for example `http://app.localhost:3320`), or every change answers 403.

## Invites (`InvitesService`)

Staff invites and activation live in `apps/api/src/auth/invites.service.ts` (R2). Other modules import `SignInModule` and inject `InvitesService`; they never write `invites` or invited memberships themselves.

- `createInvite({ businessId, email, name, role, invitedBy })`: creates the person if needed, an `INVITED` membership and a 7-day link, emails it (`ActivationMailer`), audits `membership.invited` in the firm. The invite keeps the `name` and `email` the inviter typed (#52: one line, at most 120 characters). The service checks them with `CreateInviteRequest`'s rules for every caller, R4 included (400 `VALIDATION_FAILED`, before any login is created). Until the person joins, those are what the firm shows, never their user row: staff users are shared across firms. `invitedBy` is `{ userId, role }` of the firm owner or admin, or `null` for the platform (R4: a new firm's owner on approval, role `OWNER`). The owner may give `ADMIN` or `STAFF`, an admin only `STAFF` (403 `FORBIDDEN`); only the platform gives `OWNER`. Someone with an open invite gets a new link and the old one stops working; a deactivated member is invited again; an active member is 409 `ALREADY_MEMBER`. The result never shows whether the person has a login at another firm. Emails are lower-cased. The service itself refuses a suspended or closed firm (403 `BUSINESS_INACTIVE`; a firm in setup may invite), and caps links at `INVITE_LIMITS` (50 a day per firm, 5 a day per person, counted in the database; 429 `RATE_LIMITED`).
- `resendInvite({ businessId, membershipId, invitedBy })` (Team API, T03): a new link for an open invite, to the name and email typed for its newest invite (invites made before #52 have none: then the user row, its name made to fit, one line and at most 120 characters), with the membership's role, same role rules. 409 `NOT_INVITED` when the membership is not `INVITED`. The membership, its role and those details are read again in the transaction that makes the link, so a deactivation, an activation or a re-invite that commits first wins; 404 when it is not in this firm.
- The link is `{APP_BASE_URL}/activate#token=...`: the token sits in the fragment, so it never reaches CloudFront, the load balancer, Next.js logs or a Referer header. The page reads it and posts it to `/api/v1/auth/activation/check`, then `activate` (new person) or, after sign-in, `activation/accept` (existing login).
- Using a link is one transaction: claim the invite (its row stays locked), make the membership `ACTIVE`, and for a new person set the Cognito password last. A second activation or a resend waits and then finds the link used; a failure rolls everything back. Transactions may run 15 s for this (`database.module.ts`).
- Lock order: the invite rows first, then the membership, in every transaction that changes both (activation, invite and resend, the Team API's deactivate). Invites to one person at one firm also run one at a time (an advisory lock), so one link stays open.
- Until R6's email sender, `ActivationMailer` logs the link only with `AUTH_MODE=local`; anywhere else it sends nothing and logs neither the token nor the address.

## Email and SMS (`NotifyService`)

Never send email or SMS any other way. Inject the service and send a typed template:

```ts
constructor(@Inject(NOTIFY_SERVICE) private readonly notify: NotifyService) {}

await this.notify.send({
  template: 'document.requested',
  to: client.email,
  businessId, // the firm it comes from (branding, sender name); null for Firmivra's own
  recipient: { clientAccountId }, // their notification preferences apply
  data: { name, firmName, title, dueOn, link },
});
```

- The templates and the data each needs are in `src/notify/notify.types.ts` (`NotifyTemplates`). Add a template there before using it; `TEMPLATE_CHANNEL` says email or SMS.
- `data` holds names, dates, titles and links only: never a password, a full SSN or EIN, a bank number, an amount or document content. A code or token goes only in the field made for it.
- A delivery failure is logged without the address or the data, and never fails the caller's flow.
- Until R6 step 2 it only logs: the whole message with `AUTH_MODE=local`, otherwise just the template and the firm.

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

- Roles: `FIRM_STAFF` (owner, admin, staff), `FIRM_MANAGERS` (owner, admin), `'CLIENT'` on portal routes (`portal/:firmSlug/...`), `'SUPER_ADMIN'` on `admin/` routes, `'AUTHENTICATED'` for anyone signed in.
- Firm status: firm routes work only for `ACTIVE` firms. A route a firm needs before that (the setup wizard after approval) says so: `@AllowBusinessStatuses('PENDING_SETUP', 'ACTIVE')`.
- Database: `TenantPrisma.db` for firm data (never `businessId` from the body or query). Super Admin routes use `PlatformPrisma.db` for platform tables; it throws unless `RolesGuard` verified a Super Admin for this request. `@Inject(DATABASE)` with `forPlatform()` is for the auth guards and sign-in only; Rasel reviews any other use.
- Request bodies: a zod schema in `packages/types` and `@Body(new ZodValidationPipe(Schema))`.
- Audit: `AuditService.log(action, entity, metadata)` for every action on client data. No secrets or personal data in metadata.
- Tests: an e2e test per endpoint, including firm A versus firm B (see `test/e2e/api.e2e.test.ts`).

## Tests

`pnpm --filter @firmivra/api test` runs the guard unit tests and the e2e tests against the API's own test database (`<database>_test_api`, created and reset automatically).

## Docker

`docker build -f apps/api/Dockerfile -t firmivra-api .` from the repo root (Node 22 Alpine, non-root, production dependencies only).
