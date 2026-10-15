# Services & Pricing: contract for the API session (R43)

Written by R43 (Oct 15) so Arfan builds the Services & Pricing screens on typed mocks while the API is built. Designs: `docs/mockups/firm-workspace/services-and-pricing/source/` (Services & Pricing, Add / Edit Service, Package Builder; the guide is the `.docx` there).

- Schemas: `packages/types/src/services-pricing/schemas.ts`. Client: `createServicesPricingClient` (`api.servicesPricing`) in `services-pricing/client.ts`.
- Mock: `apps/web/src/mocks/services-pricing.ts` (`NEXT_PUBLIC_API_MOCK=servicesPricing`; `NEXT_PUBLIC_API_MOCK_EMPTY=servicesPricing`). Its prices are samples only.
- A service is the firm's existing `services` row (R0: name, description, kind, billing interval, packages, stages, Begin Online flag, archived), extended with pricing; nothing else in the API reads a price today. Paths under `/api/v1/business/catalog`, `@Access('SERVICES_PRICING')`: everyone with view reads (Staff never see internal notes); Create, Edit or Manage change. No business id in any path, query or body. Money is integer cents; the API works out totals and savings and checks them again on save. Editing a price never changes invoices, engagements or payments already made (they keep their own snapshot). Every create, edit, price change, category change, activation, package-content change, promotion change, archive and delete is audited with old and new values.

## Services list (Active Services and Inactive Services tabs)

| Method and path | Roles | Request / response | Status | Tables | Design element |
| --- | --- | --- | --- | --- | --- |
| `GET /business/catalog/summary` | grid view | - / `CatalogSummary` | to build | services, service_categories, promotions, packages | KPI cards: Total Services, Active Services, Inactive Services, Categories, Active Promotions |
| `GET /business/catalog/services` | grid view | `CatalogServicesQuery` / `CatalogServicePage` | to build | services (+ pricing columns), service_categories | Table: Service Name (icon, short description), Category, Pricing ("$99.00+"), Status, Last Updated (by), Actions (Edit, Duplicate, menu); sort on every column; search; All Categories; "Showing 1-8 of 12", pages; also the Package Builder's service picker (`pricingType` filter) |
| `GET /business/catalog/services/{id}/usage` | grid view | - / `ServiceUsage` | to build | packages, engagements, invoices, appointment types, automations | menu View Usage, and the warning before deactivating a service used in packages |
| `POST .../services/{id}/duplicate`, `/activate`, `/deactivate`, `/archive`, `DELETE .../services/{id}` | grid edit; delete: grid delete | - / `CatalogService`, `OkResponse` | to build | services | Duplicate icon and menu; Activate (400 `ACTIVATION_INCOMPLETE`), Deactivate, Archive, Delete (only never used: 409 `IN_USE`) |

## Add / Edit Service

| Method and path | Roles | Request / response | Status | Tables | Design element |
| --- | --- | --- | --- | --- | --- |
| `POST /business/catalog/services` | grid create | `CreateCatalogServiceRequest` / `CatalogService` | to build | services (+ category_id, short_description, icon, status, pricing_type, base_price_cents, billing_frequency, taxable, require_client_approval, full_description, included, not_included, line_items_mode, internal_notes), service_line_items (new), service_add_ons (new) | 1 Basic Information (Service Name, Category, Short Description 0/300, Status, Service Icon); 2 Pricing & Billing (Pricing Type, Base Price, Billing Frequency, Taxable Service, Require Client Approval); 3 Service Details (Full Description 0/1000, What's Included, Not Included); 4 Service Line Items (Item Name, Description, Quantity, Price, Total, Add Line Item, Total Price); Optional Add-Ons (Add-On Name, Price, edit, delete); Internal Settings (Internal Notes 0/500); Save as Draft (`activate: false`), Save & Activate; 409 `DUPLICATE_NAME` unless `allowDuplicateName` |
| `GET /business/catalog/services/{id}`, `PATCH ...` | read: grid view; save: grid edit | `UpdateCatalogServiceRequest` / `CatalogService` | to build | as above | Edit (same id); 409 `SAVE_CONFLICT` on a stale `version` |

The Service Preview (Client View) and View Full Page are the browser's, from the form; they never show internal notes. "Book This Service" in the preview is a sample button.

## Service Categories tab

| Method and path | Roles | Request / response | Status | Tables | Design element |
| --- | --- | --- | --- | --- | --- |
| `GET /business/catalog/categories` | grid view | - / `ServiceCategoryList` | to build | service_categories (new) | Service Categories tab, All Categories dropdown, category chips |
| `POST /business/catalog/categories`, `PUT /{id}`, `PUT /categories/order`, `POST /{id}/merge`, `DELETE /{id}` | grid manage | `SaveServiceCategoryRequest`, `ReorderCategoriesRequest`, `MergeCategoryRequest` / `ServiceCategory` | to build | service_categories, services | Add, rename, reorder, deactivate, merge, delete (only unused) |

## Package Builder tab

| Method and path | Roles | Request / response | Status | Tables | Design element |
| --- | --- | --- | --- | --- | --- |
| `GET /business/catalog/packages` | grid view | - / `ServicePackageList` | to build | packages (new) | package list |
| `GET /business/catalog/packages/{id}`, `POST /packages`, `PATCH /{id}` | read: grid view; save: grid edit | `CreateServicePackageRequest`, `UpdateServicePackageRequest` / `ServicePackage` | to build | packages, package_services (new), package_add_ons (new) | 1 Package Information (Name, Category, Short Description 0/200, Status, Icon); 2 Select Services to Include (Service Name, Category, Individual Price, Included in Package toggle, remove, Add Service); 3 Package Pricing (Total of Selected Services, Package Price, Discount type and value, Client Savings); 4 Optional Add-Ons; Internal Notes 0/500; Package Settings (Visible to Clients, Allow Client to Add Optional Add-Ons, Display on Website/Portal); Save as Draft, Save & Activate |
| `POST /business/catalog/packages/pricing` | grid view | `PackagePricingRequest` / `PackagePricing` | to build | services (read) | the pricing panel recalculated as the form changes; `variablePrice` warns when a Starting At, Hourly or Custom Quote service makes savings an estimate |
| `POST .../packages/{id}/activate`, `/deactivate`, `/duplicate`, `/archive` | grid edit | - / `ServicePackage` | to build | packages | Activate (409 `PACKAGE_HAS_INACTIVE_SERVICE`), and the package menus |

## Discounts & Promotions tab

| Method and path | Roles | Request / response | Status | Tables | Design element |
| --- | --- | --- | --- | --- | --- |
| `GET /business/catalog/promotions` | grid view | - / `PromotionList` | to build | promotions (new) | promotions list (no design: the guide's fields) |
| `POST /business/catalog/promotions`, `PUT /{id}`, `POST /{id}/end` | grid manage | `SavePromotionRequest` / `Promotion` | to build | promotions, promotion_targets (new) | Name, Discount Type, Value, Applies To, Start / End, Client Eligibility, Promo Code, Stacking, Status, Usage; 409 `PROMOTION_CONFLICT` |

## New database work this needs (Rasel)

Columns on `services` listed above (the existing `billing_interval` maps to `billing_frequency`; `description` to the full description; `kind` stays for Begin Online and engagements). New tables: `service_categories`, `service_line_items`, `service_add_ons`, `packages`, `package_services`, `package_add_ons`, `promotions`, `promotion_targets`. Invoices and engagements must snapshot service name, description, quantity, rate and amount when they use a service (Invoices & Payments module).

## Not in the designs, or in conflict

- **Discounts & Promotions and Service Categories tabs** have no design: the contract follows the guide.
- **Package list page** ("Back to Packages") has no design: `ServicePackageRow` holds what a list would show.
- **Service icons**: the design shows coloured icons; uploads are not designed, so `icon` is an approved icon key the screen maps to a Phosphor icon.
- **Category chip colours** are a token name (`tone`), never a hex colour.
- **"$99.00+"**: the list shows "+" for Starting At prices; the design also shows "+" on prices that may be fixed. The screen formats from `price.type`.
- **Package discount and package price** both appear: the API keeps the price the admin enters and shows the discount as the computed comparison; when only a discount is given, it works out the price.
- **Rich text** in Full Description: the toolbar is shown; the contract stores plain text with line breaks until a safe formatted-text rule is agreed.
- **Taxable Service** marks the service only; tax is calculated by the configured tax settings (not built).
- **"Book This Service" / "Get Started"** buttons in previews: client booking is a later portal flow.
