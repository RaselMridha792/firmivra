# R56: Services & Pricing, the five pages Fahad has not started

Service Categories, Package Builder (list), package detail, package Edit and Discounts & Promotions, on the real catalog contract (`api.servicesPricing`, R55 #685) with its mock. Designs: `docs/mockups/firm-workspace/services-and-pricing/source/` (Package Builder is the only frame of these; the rest come from the docx). Branch `rasel/R56-sp-categories`, web port 3560. Fahad's routes (`new`, `[id]`, `[id]/edit`, `inactive`, `packages/new`, the main list) are not touched.

## Owned paths

`services-pricing/categories/`, `packages/page.tsx`, `packages/[id]/page.tsx`, `packages/[id]/edit/page.tsx`, `promotions/` and the new files in `services-pricing/_components/` (`catalog-frame`, `catalog-shared`, `categories-screen`, `packages-screen`, `package-detail-screen`, `package-edit-screen`, `package-parts`, `promotions-screen`), `apps/web/e2e/mock/r56-sp-*.spec.ts`, `r56-screenshots/s-*`.

## Run it

| State           | Command                                                                                                                                          |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| With data       | `NEXT_PUBLIC_API_MOCK=servicesPricing,me,notifications,team,staff NEXT_PUBLIC_API_MOCK_ROLE=OWNER WEB_PORT=3560 pnpm --filter @firmivra/web dev` |
| Empty           | the same plus `NEXT_PUBLIC_API_MOCK_EMPTY=servicesPricing`                                                                                       |
| API unreachable | `NEXT_PUBLIC_API_MOCK=me,notifications,team,staff` (the shell needs `me`)                                                                        |

## Steps

- [x] 1. `/services-pricing/categories`
- [x] 2. `/services-pricing/packages`
- [x] 3. `/services-pricing/packages/[id]`
- [x] 4. `/services-pricing/packages/[id]/edit`
- [x] 5. `/services-pricing/promotions`
- [x] 6. Mock e2e specs, three states and 375 px checked, PR opened

## Needs from others

- **Create Package** (`packages/new`) is Fahad's page; the list links to it. The builder here is Edit mode only, so it shares no component with his draft (a kit or shared component can follow once both are merged).
- **Package status** is changed by Activate, Deactivate and Save & Activate (the contract has no status field on save), so the design's Status toggle is a badge on the page and the buttons do the change. **Save as Draft** on an existing package is Save Changes.
- **Package icon upload** is not in the contract (approved icon keys only): a select of the approved icons stands in for "Change Icon / Remove".
- **Add Service pricing filter** (docx 9): the contract's service query takes `pricingType`, but the picker only offers search and category. Variable-price services are flagged with the savings warning.
- **Category reorder** is Move up / Move down (the contract takes the full new order); no drag and drop.
- **Category icon and colour** are a short list of approved icons and the six chip tones; there is no custom colour or icon upload.
- **Promotion usage** shows the count only; "affected transactions" has no contract call. A promotion's status changes through Save, Save & Activate and End (the contract has no pause).
- **Package Preview "View Full Page"** (design) is not built; the detail page is its full page and is one click away from the list.
- **Who may change what** (Manage Pricing, Manage Promotions): the API answers 403 and the pages show its message; the buttons are not hidden by role yet.

## Progress log

- 2026-10-17: five pages built on the catalog mock; three specs pass (categories 4, packages and promotions 6); screenshots committed.
