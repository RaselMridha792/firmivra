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

`SearchField` takes `minWidth` to lower its 14rem default floor (a CSS length, e.g. `'8rem'`), for a filter row with several other fields and little room to spare.

## Firm Backend additions (R44)

Import from `@firmivra/ui` like the rest. Each one has stories under "Firm Backend" in Storybook (default, empty, long text) and design comparisons in `packages/ui/review/r44-*-vs-design.png`. Tones are the kit's tile tones (`blue`, `amber`, `green`, `purple`, `red`, `grey`, `navy`; exported as `tileTones`, `discTones`, `textTones`, `tintTones`).

| Component        | Props in one line                                                                                                                                                                                                             | When to use                                                                                                                         |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `LinkCard`       | `icon`, `title`, `description`, `tone` (tile), `iconTone`, `surface` (`plain`, `blue`, `amber`), `actionLabel` (text link instead of the round arrow), `href` or `onClick`                                                    | navigation tiles: Staff Management's nine cards (round arrow), Settings' Quick Settings (tinted, "Manage Companies →")              |
| `Callout`        | `icon`, `title`, `children`, `action`, `surface` (`info`, `success`, `warning`, `plain`), `iconStyle` (`disc`, `tile`), `tone`, `titleStyle` (`tip` blue title), `size` (`compact` one-line notice)                          | Pro Tip, Need Help?, Make It Yours, and the small notes beside forms ("visible to administrators only", "branding will be applied") |
| `ChecklistCard`  | `title`, `items` (`id`, `label`, `done`), `icon`, `iconTone`, `action` ("View All"), `marker` (`check`, `checkbox`, `number`), `surface` (`plain`, `success`, `info`), `aside` (e.g. a progress ring), `emptyText`           | Security Best Practices, Settings Checklist, What Happens Next?, Submission Summary                                                 |
| `DonutChart`     | `segments` (`label`, `value`, `tone`: `green`, `blue`, `yellow`, `grey`, `red`, `purple`, `navy`), `centerValue`, `centerLabel`, `total` (progress ring), `legend`, `showPercent`, `size` (`sm`, `md`, `lg`), `label`, `emptyText` | Intake Forms' Form Status Chart; Submission Summary's "100% Completed" ring. Empty data draws the grey ring and `emptyText`         |
| `RichTextEditor` | `label`, `value` (HTML), `onChange`, `required`, `placeholder`, `maxLength` (counter), `hint`, `error`, `onRequestLink` (https only), `onInsertImage`, `disabled`                                                            | Services & Pricing' Full Description and other client-facing long text. Paste arrives as plain text; the API sanitizes again        |
| `ColorField`     | `label`, `value` (`#rrggbb`), `onChange`, `presets` (`name`, `value`: named dropdown), `hint`, `error`, `disabled`                                                                                                           | Settings' Brand Colors (swatch + hex), Intake Form Settings' "LVP Blue" (presets)                                                   |
| `FileDropzone`   | `label`, `onFiles`, `onReject`, `accept` (extensions or MIME, `image/*`), `maxBytes`, `multiple`, `maxFiles`, `icon` (`upload`, `image`, any icon), `title` ("click" drawn as a link), `hints`, `disabled`                    | Staff Documents, Login Background Image, any drag-and-drop upload; pair with `uploadFile()` in apps/web                             |
| `Timeline`       | `items` (`id`, `icon`, `tone`, `title`, `time`, `dateTime`, `actor`), `variant` (`rail`, `connected`, `plain`), `emptyText`, `label`                                                                                         | Lead Profile's Recent Activity (`rail`), Intake's Activity Timeline (`connected`), Settings' Recent Changes (`plain`)                |
| `OrgChart`       | `people` (`id`, `name`, `title`, `parentId`, `avatarSrc`, `note`), `emptyText`, `label`                                                                                                                                       | Teams & Departments' Org Chart tab (reporting lines from each person's manager)                                                     |
| `PermissionMatrix` | `rows` (`id`, `label`, `icon`, `tone`), `columns` (`id`, `label`), `value` (granted column ids per row), `onChange`, `rowHeader`, `fullAccess`, `requires` (`{ create: 'view' }`), `isAvailable`, `readOnly`, `caption`, `emptyText` | Create Staff step 2 (icons, Full Access), Settings > Users & Roles (no icons, Export and Admin)                                    |
| `CalendarGrid`   | `view` (`week`, `month`, `mini`), `date`, `events` (`id`, `start`, `end`, `title`, `subtitle`, `tone`), `today`, `selected`, `startHour`, `endHour`, `weekStartsOn`, `onPrev`, `onNext`, `onEventClick`, `onSlotClick`, `onDateClick` | Appointments: the week grid, the small month beside it, the month view; empty hours prefill a new appointment                     |

Pure helpers that go with them (and are unit tested): `donutArcs`, `percentOf`, `plainTextLength`, `HTTPS_LINK`, `normalizeHex`, `checkFiles`, `buildOrgTree`, `toggleCell`, `setRowAll`, `weekDays`, `monthWeeks`, `placeDayEvents`, `sameDay`. New tokens: `amber-surface` (Settings' amber cards) and `chart-green`, `chart-blue`, `chart-yellow`, `chart-grey`, `chart-red` (the status donut), each measured from the design.

## Public links (R56)

| Component         | Props in one line                                                                                                                       | When to use                                                                                                                              |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `PublicLinkBlock` | `url`, `embedCode` (null: `emptyText` instead), `title`, `copyLinkLabel`, `copyEmbedLabel`, `notice` (item takes no new use), `copy` | The shared "Copy link / Copy embed code" block of an intake form, an appointment type or a service package (Octavia's review, Oct 20) |

In apps/web, use it through `components/public-link.tsx` (`<PublicLinkSection kind="APPOINTMENT_TYPE" link={…} />`): it takes the item's `PublicLink` (`packages/types/src/public-links`: `kind`, `itemId`, `url`, `embedCode`, `state`) and says the same thing for all three items. Each item's API answers `GET /business/<its collection>/{id}/public-link` and builds the link with `publicItemUrl` and `publicEmbedCode`.
