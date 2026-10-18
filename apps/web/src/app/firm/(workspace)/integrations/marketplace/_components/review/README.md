# Integration Marketplace: I01, page 2

Scope: `/integrations/marketplace` only. This branch starts from fresh main and does not depend on the unmerged Integrations List PR. It does not change the first page, shared layouts, tokens, API client registration, contracts, schema, infrastructure, lockfile or environment files. Review notes stay beside this page rather than appending to the task file also changed by page 1.

## Design inventory

Reference: `docs/mockups/firm-workspace/integrations/source/add-integration-marketplace.jpg`; developer instructions sections 5 and 6. Header, category sidebar and catalog were cropped and inspected before implementation.

- Breadcrumb: Integrations -> Add Integration.
- Header: puzzle icon, title, current-firm subtitle, search and category selector.
- Categories panel: All Integrations and the 13 categories in the existing contract (including E-Commerce).
- Request panel: information icon, heading, explanation and Request Integration action.
- Banner: Connect. Automate. Grow., explanatory text and connection illustration.
- Featured section: heading, View All and data-driven featured provider cards (four in the reference).
- Full catalog: total, three sorting choices, grid/list controls and data-driven provider cards. Each has a logo fallback, provider name, category, description, supported status/badge, details menu and contextual action.
- Custom Integration card: request action and permission-gated API & Webhooks setup entry.
- Request modal: requester/firm from the signed-in context; provider name, optional website, category, desired workflow and optional reason; validation, submit, pending, error/retry and success states.

## Behavior and verification

- Data uses `api.integrations.marketplace` through `useApiQuery`.
- Management capability comes from the existing `api.integrations.overview().canManage`; the marketplace response does not include a permission field. No field or endpoint is invented.
- Requests use `CreateIntegrationRequest`, `zodResolver`, `useForm` and `useApiMutation(api.integrations.request)`. Requester ids and business ids are never sent by the screen.
- Connected providers lead to their existing connection instead of offering a duplicate Connect action. Unsupported providers do not offer a fake connection action.
- Typed fixtures in `src/mocks/integrations-marketplace.ts` are used through Playwright request interception. They are never production fallback data and do not modify the first page's fixture.
- All category/request/banner/featured/catalog/custom frames remain visible when empty or unreachable. Read-only or unknown permissions disable request actions and hide configuration links.
- Passed: 7 focused mock browser tests, 1 real-API owner sign-in/catalog/modal smoke test, web TypeScript check, changed-page ESLint and production web build.
- Desktop: 1440 px. Mobile: 375 px, checked for sideways overflow. Evidence images here contain synthetic data only.
- The real-API smoke test only reads data and opens/cancels the request modal; it does not connect a provider or create a real request.

## Known visual differences

- The page uses the site's existing PageHeader, font, color, spacing and UI tokens. It does not introduce a separate visual system to imitate a different mockup font.
- No approved provider-logo assets are supplied by the kit. Provider tiles use neutral initials, following the contract's fallback. Approved brand assets are still needed for exact logo matching.
- The banner's unsupplied branded laptop illustration is represented with existing Phosphor icons. No source mockup was used as a fake working interface.
- Shared navigation/header density and colors are owned elsewhere and are unchanged.
- The reference's sample counts are not hard-coded; counts, provider availability and ordering come from the API. The synthetic fixture has 18 providers, including connected and unsupported examples.
- Existing shared-shell image warnings were observed in browser tests; no unrelated shell files were changed.
