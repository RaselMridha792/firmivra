# UI kit: shared components for the firm workspace

Components in `packages/ui` that Octavia's firm workspace designs (`docs/mockups/firm-workspace/<module>/source/`) use again and again. Build screens from these; do not copy their markup. Every one takes its data through props, has a Storybook story (`pnpm --filter @firmivra/ui storybook`) and uses tokens only. Import from `@firmivra/ui`. Icons are solid Phosphor (`weight="fill"`).

## Lists

| Component    | Props in one line                                                                                                                                              | Used by                                                                                        |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `Table`      | `rows`, `columns`, `rowKey`, `caption`, `dense`, `selection`, `rowActions`, `server`, `noun`, `pageSizes`, `loading`, `emptyTitle`, `emptyText`, `emptyAction` | clients, leads, invoices, documents, staff, tax returns, tasks, payroll, bookkeeping, settings |
| `Pagination` | `page`, `onPage`, `pageCount` (or `hasNext` for cursor paging), `summary`, `pageSize`, `pageSizes`, `onPageSize`                                               | every list's footer (`Table` already includes it)                                              |

## Navigation and overlays

| Component    | Props in one line                                                                                                                         | Used by                                                                              |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `Tabs`       | `items` (`id`, `label`, `count`, `icon`, `content`), `value`, `onChange`, `label`, `variant` (`underline`, `pill`, `segmented`, `folder`) | clients (pill with counts), settings and staff (underline), appointments (segmented) |
| `Stepper`    | `steps`, `current`, `variant="wizard"` for numbered circles on a line                                                                     | staff create, lead to client, document upload, send intake form, communications      |
| `Modal`      | `open`, `title`, `subtitle`, `footer`, `onClose`, `children`                                                                              | choose recipients, confirmations                                                     |
| `Drawer`     | `open`, `title`, `subtitle`, `footer`, `onClose`, `children`; slides in from the right                                                    | record side panels                                                                   |
| `ActionMenu` | `trigger`, `label`, `sections` (`title`, `items` with `icon`, `danger`, `submenu`, `restricted`), `footer`, `align`                       | invoice actions, bulk actions, payroll and bookkeeping row actions, "New" menus      |

## Display and page

| Component     | Props in one line                                                                                                        | Used by                                                                                |
| ------------- | ------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| `Badge`       | `tone` (`success`, `warning`, `danger`, `info`, `purple`, `neutral`), `dot`, `icon`, `children`                          | status, type, role and priority columns in every list                                  |
| `KpiCard`     | `icon`, `tone`, `value`, `label`, `trend` (`text`, `direction`, `good`), `note`, `loading`; `IconTile` is the tile alone | the top row of clients, leads, invoices, documents, staff, tax returns, tasks, payroll |
| `Avatar`      | `name`, `src`, `size` (`sm`, `md`, `lg`, `xl`); initials on a lavender disc without `src`                                | name and "Assigned To" columns, staff, appointments                                    |
| `AvatarGroup` | `people`, `max`, `size`; "+n" for the rest                                                                               | tasks, communications                                                                  |
| `Toggle`      | `checked`, `onChange`, `label`, any button attribute                                                                     | document and automation settings, notification options                                 |
| `PageHeader`  | `title`, `subtitle`, `icon`, `above` (breadcrumb or back link), `actions`                                                | every module page                                                                      |
