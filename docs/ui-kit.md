# UI kit: shared components for the firm workspace

Components in `packages/ui` that Octavia's firm workspace designs (`docs/mockups/firm-workspace/<module>/source/`) use again and again. Build screens from these; do not copy their markup. Every one takes its data through props, has a Storybook story (`pnpm --filter @firmivra/ui storybook`) and uses tokens only. Import from `@firmivra/ui`. Icons are solid Phosphor (`weight="fill"`).

## Lists

| Component    | Props in one line                                                                                                                                              | Used by                                                                                        |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `Table`      | `rows`, `columns`, `rowKey`, `caption`, `dense`, `selection`, `rowActions`, `server`, `noun`, `pageSizes`, `loading`, `emptyTitle`, `emptyText`, `emptyAction` | clients, leads, invoices, documents, staff, tax returns, tasks, payroll, bookkeeping, settings |
| `Pagination` | `page`, `onPage`, `pageCount` (or `hasNext` for cursor paging), `summary`, `pageSize`, `pageSizes`, `onPageSize`                                               | every list's footer (`Table` already includes it)                                              |
| `FilterBar`  | `children` (search, selects), `more` (`FilterGroup`s for "More Filters"), `onApply`, `onClear`, `onReset`; with `SearchField`, `FilterGroup`, `FilterChip`     | clients, leads, invoices, documents, tax returns, tasks, payroll, bookkeeping                  |
| `BulkBar`    | `count`, `noun`, `actions` (`label`, `icon`, `onClick`, `danger`), `children`                                                                                  | clients, leads                                                                                 |
| `IconButton` | `icon`, `label` (accessible name), `tone`, `weight`                                                                                                            | row actions in clients, leads, appointments                                                    |

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

## Dates and forms

| Component         | Props in one line                                                                                                                                           | Used by                                                                           |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `DateRangePicker` | `label`, `value` (`from`, `to` as `YYYY-MM-DD`), `onChange`                                                                                                 | "Last Activity" and "Due Date / Deadline" filters, reports, compliance            |
| `FormSection`     | `step` or `icon`, `title`, `subtitle`, `columns`, `children` (a two-column grid of fields)                                                                  | staff create and edit, create task, create invoice, document request, intake form |
| `FormField`       | `label`, `htmlFor`, `required`, `hint`, `error`, `counter`, `children` (any control); `Input`, `Select`, `Textarea` already carry their own label and error | custom controls: dates, tags, pickers                                             |

`Select` and `Input` take `hideLabel` to hide the visible label (it stays as the accessible name), as in filter bars where the design shows only the field.
