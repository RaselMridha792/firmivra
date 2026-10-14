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
