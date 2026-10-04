# @firmivra/types

Shared API contracts: zod schemas and the TypeScript types inferred from them, plus a typed `fetch` client.

- The API validates request bodies with these schemas (`ZodValidationPipe`).
- The web app calls the API through `createApiClient`, which parses every response with the same schemas.
- A frontend/backend pair agrees a change here first, in its own small PR, before building on it.
