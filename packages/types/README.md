# @firmivra/types

Shared API contracts: zod schemas and the TypeScript types inferred from them, plus a typed `fetch` client.

- The API validates request bodies with these schemas (`ZodValidationPipe`).
- The web app calls the API through `createApiClient`, which parses every response with the same schemas.
- Only Rasel's sessions change this package. The developers use what it publishes and ask Rasel when a screen needs more.

## Adding a module (contract first)

A module's **first PR is its contract**, before any API code, so the screens can be built the same day:

1. **Schemas:** `src/<module>/schemas.ts`. Zod schemas for every request and response, the inferred types, and the module's error codes, for example `TaxStatusErrorCode`.
2. **Client:** `src/<module>/client.ts`. `create<Module>Client(request: ApiRequest)` returns one function per endpoint, for example `list`, `create`, `rename`. Use the shared `createRequest(options)` / `ApiRequest` from `@firmivra/types`. It sends JSON and the session cookie, parses the response with your schema, and rejects with `ApiRequestError` (`status`, `code`) on any error. Check request bodies with the schema inside the function, so bad input rejects like an API error would. Export everything from `src/index.ts`.
3. **Register it on `api`:** one line in `apps/web/src/lib/api.ts`, the only line you add in `apps/web` besides the mock:
   ```ts
   taxStatuses: dev && mocked('taxStatuses') ? createTaxStatusesMock() : createTaxStatusesClient(request),
   ```
   Screens then call `api.taxStatuses.list()` through `useApiQuery` / `useApiMutation`.
4. **Mock:** `apps/web/src/mocks/<module-kebab>.ts`, for example `mocks/tax-statuses.ts`.
   - It exports synthetic fixtures (`taxStatusFixtures`) and `create<Module>Mock()`: an in-memory client with the **same type** as the real one.
   - Importing it runs nothing: fixtures are built on first use inside a function (`taxStatusFixtures()`), so a production build drops the whole file. ESLint refuses a call at a mock file's top level.
   - It follows the API's rules and error codes and waits about 250 ms, using `mockDelay()` from `lib/mock.ts`.
   - Developers turn it on with `NEXT_PUBLIC_API_MOCK=taxStatuses` (or `all`) in `apps/web/.env.local`. A "Mock data" badge shows while it's on, and it's always off in production builds.
5. **Then the API:** controller, service and tests in `apps/api`. They validate with the same schemas, so the screen built on the mock works unchanged.

Never edit screens from a module PR. In `apps/web`, change only `src/mocks/<module>.ts` and your line in `src/lib/api.ts`. The auth clients (`createStaffAuthClient`, `createAdminAuthClient`) stay as they are; R2 owns them.
