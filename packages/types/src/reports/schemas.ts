import { z } from 'zod';
import { clearable, SearchText, text } from '../clients/text.js';
import { DownloadLink } from '../documents/schemas.js';
import {
  ReportCategory,
  ReportFormat,
  ReportFrequency,
  ReportRunKind,
  ReportRunStatus,
  ReportVisibility,
  RevenueBasis,
} from '../db-enums.js';

// Reports (R55 contract, for the Reports screens): the dashboard (global date range, KPI cards,
// category cards, quick reports, recent and scheduled reports, insights), the report detail (date
// range, comparison, filters, KPIs, charts, table, export, print, save, schedule), the Custom
// Report Builder (category, data source, fields, filters, grouping, preview, run, save, save and
// schedule), saved reports, exports and scheduled reports. Designs:
// docs/mockups/firm-workspace/reports/source/ and its developer guide.
//
// One reporting layer: KPI cards, detail views, the builder's preview, exports and schedules run
// the SAME definition through the same API, so cards, charts and tables reconcile. A saved report
// is a definition (data source, ordered columns, filters, grouping, sort, date rule, display
// settings), never frozen results; a run keeps the definition it ran with. Date boundaries and
// schedules use the firm's time zone. Everything is scoped to the firm on the server and honors
// the caller's permissions: a field or source the caller may not see is not offered and is refused
// (403 FIELD_NOT_ALLOWED); an export obeys the same filters and permissions as the screen, and an
// export of financial or client data is audited. Firm routes under /api/v1/business
// (`@Access('REPORTS')`): everyone with the grid's view reads and runs reports; saving, scheduling
// and exporting need Create, Edit or Manage (403 FORBIDDEN). Never invented values: a metric with
// no source data is 0, N/A or left out as its definition says. Responses are plain objects;
// requests are strict. Audited with ids, report keys and field names only.

const DateTime = z.iso.datetime({ offset: true });
const Day = z.iso.date();
const Page = { total: z.number().int(), page: z.number().int(), pageSize: z.number().int() };
const PersonRef = z.object({ userId: z.uuid(), name: z.string() });

export const SavedReportId = z.uuid();
export const ReportScheduleId = z.uuid();
export const ReportRunId = z.uuid();
/** A built-in quick report: lower case words with dashes or underscores (`revenue-summary`). */
export const ReportSystemKey = z.string().regex(/^[a-z][a-z0-9_-]{1,59}$/, 'Use a report key');
/** A data source of the report catalog (`invoices_payments`, `clients`, `returns`). */
export const ReportSourceKey = z.string().regex(/^[a-z][a-z0-9_]{1,59}$/, 'Use a data source key');
/** A field of a data source. */
export const ReportFieldKey = z.string().regex(/^[a-z][a-zA-Z0-9_.]{0,79}$/, 'Use a field key');

// ---------- Date ranges, comparison, filters ----------

/** The dropdown's ranges, in the firm's time zone. */
export const ReportDatePreset = z.enum([
  'today',
  'last_7_days',
  'last_30_days',
  'this_month',
  'last_month',
  'this_quarter',
  'last_quarter',
  'this_year',
  'last_year',
]);
export type ReportDatePreset = z.infer<typeof ReportDatePreset>;

/** A rolling range (re-evaluated at every run) or a fixed one (start on or before end). */
export const ReportDateSpec = z.discriminatedUnion('rule', [
  z.strictObject({ rule: z.literal('ROLLING'), preset: ReportDatePreset }),
  z
    .strictObject({ rule: z.literal('FIXED'), from: Day, to: Day })
    .refine((d) => d.from <= d.to, 'The start date must be on or before the end date'),
]);
export type ReportDateSpec = z.input<typeof ReportDateSpec>;

export const ReportCompareTo = z.enum(['NONE', 'PREVIOUS_PERIOD', 'SAME_PERIOD_LAST_YEAR']);
export type ReportCompareTo = z.infer<typeof ReportCompareTo>;

/** The operators by field type (the API refuses an operator the field's type lacks). */
export const ReportFilterOp = z.enum([
  'EQUALS',
  'NOT_EQUALS',
  'CONTAINS',
  'NOT_CONTAINS',
  'STARTS_WITH',
  'IS_EMPTY',
  'IS_NOT_EMPTY',
  'GREATER_THAN',
  'LESS_THAN',
  'BETWEEN',
  'ON',
  'BEFORE',
  'AFTER',
  'RELATIVE',
  'IS',
  'IS_NOT',
  'IS_ANY_OF',
  'IS_NONE_OF',
]);
export type ReportFilterOp = z.infer<typeof ReportFilterOp>;

const FilterValue = z.union([
  z.string().max(200),
  z.number(),
  z.boolean(),
  z.array(z.string().max(200)).max(100),
  z.strictObject({
    from: z.union([z.string().max(40), z.number()]),
    to: z.union([z.string().max(40), z.number()]),
  }),
]);

/** `value` is absent for IS_EMPTY and IS_NOT_EMPTY, a { from, to } pair for BETWEEN, a list for IS_ANY_OF and IS_NONE_OF. */
export const ReportFilterCondition = z.strictObject({
  field: ReportFieldKey,
  op: ReportFilterOp,
  value: FilterValue.optional(),
});
export type ReportFilterCondition = z.input<typeof ReportFilterCondition>;

/**
 * Conditions joined by AND (the default) or OR, and up to 5 inner groups of conditions with their
 * own AND or OR (the advanced builder). One level of nesting at most.
 */
export const ReportFilters = z.strictObject({
  logic: z.enum(['AND', 'OR']).optional().default('AND'),
  conditions: z.array(ReportFilterCondition).max(20).optional().default([]),
  groups: z
    .array(
      z.strictObject({
        logic: z.enum(['AND', 'OR']),
        conditions: z.array(ReportFilterCondition).min(1).max(20),
      }),
    )
    .max(5)
    .optional()
    .default([]),
});
export type ReportFilters = z.input<typeof ReportFilters>;

export const ReportChartType = z.enum(['AUTO', 'BAR', 'LINE', 'AREA', 'PIE', 'DONUT']);
export type ReportChartType = z.infer<typeof ReportChartType>;

/** The detail view's quick filters (Client Type, Service Type), on top of the definition's filters. */
export const ReportQuickFilters = z.strictObject({
  clientType: z.enum(['ALL', 'NEW', 'EXISTING', 'ACTIVE', 'INACTIVE']).optional(),
  serviceId: z.uuid().optional(),
  serviceCategoryId: z.uuid().optional(),
  clientId: z.uuid().optional(),
  staffUserId: z.uuid().optional(),
});
export type ReportQuickFilters = z.input<typeof ReportQuickFilters>;

// ---------- The catalog: data sources and fields (for the builder) ----------

export const ReportFieldType = z.enum([
  'TEXT',
  'NUMBER',
  'MONEY',
  'PERCENT',
  'DATE',
  'DATETIME',
  'STATUS',
  'BOOLEAN',
]);
export type ReportFieldType = z.infer<typeof ReportFieldType>;

/** A column a report can show, group by, sort or filter on. The list is data: no screen hard-codes it. */
export const ReportField = z.object({
  key: ReportFieldKey,
  label: z.string(),
  type: ReportFieldType,
  /** A status field's values, for the filter and the legend. */
  options: z.array(z.object({ value: z.string(), label: z.string() })),
  groupable: z.boolean(),
  sortable: z.boolean(),
  filterable: z.boolean(),
  /** A number or money field that totals and percentages make sense for. */
  aggregatable: z.boolean(),
  /** An identifier column that stays on (it cannot be hidden). */
  locked: z.boolean(),
  /** Restricted data: offered only to those who may see it. */
  sensitive: z.boolean(),
});
export type ReportField = z.infer<typeof ReportField>;

export const ReportDataSource = z.object({
  key: ReportSourceKey,
  category: ReportCategory,
  label: z.string(),
  description: z.string(),
  fields: z.array(ReportField),
  /** The fields a new report starts with. */
  defaultColumns: z.array(ReportFieldKey),
  /** The source has a date to range by, and which field. */
  dateField: ReportFieldKey.nullable(),
  /** Comparison and the tax toggle make sense only for some sources. */
  supportsComparison: z.boolean(),
  supportsTaxToggle: z.boolean(),
});
export type ReportDataSource = z.infer<typeof ReportDataSource>;
export const ReportDataSourceList = z.object({ items: z.array(ReportDataSource) });
export type ReportDataSourceList = z.infer<typeof ReportDataSourceList>;

/** A built-in quick report (a saved system definition that lives in code). */
export const ReportCatalogItem = z.object({
  key: ReportSystemKey,
  name: z.string(),
  description: z.string(),
  category: ReportCategory,
  dataSource: ReportSourceKey,
});
export type ReportCatalogItem = z.infer<typeof ReportCatalogItem>;

/** GET /business/reports/catalog: the report categories with their quick reports. */
export const ReportCatalog = z.object({
  categories: z.array(
    z.object({ category: ReportCategory, label: z.string(), reports: z.array(ReportCatalogItem) }),
  ),
});
export type ReportCatalog = z.infer<typeof ReportCatalog>;

export const ReportLookupKind = z.enum([
  'SERVICE',
  'SERVICE_CATEGORY',
  'CLIENT',
  'TEAM_MEMBER',
  'LEAD_SOURCE',
  'CAMPAIGN',
]);
export type ReportLookupKind = z.infer<typeof ReportLookupKind>;
/** GET /business/reports/lookups?kind=: the values a selector offers (searchable, only what the caller may see). */
export const ReportLookupQuery = z.strictObject({
  kind: ReportLookupKind,
  search: SearchText.optional(),
  limit: z.coerce.number().int().min(1).max(50).optional().default(20),
});
export type ReportLookupQuery = z.input<typeof ReportLookupQuery>;
export const ReportLookupList = z.object({
  items: z.array(z.object({ id: z.string(), label: z.string() })),
});
export type ReportLookupList = z.infer<typeof ReportLookupList>;

// ---------- A report definition (the builder's output) ----------

/**
 * What the builder stores and every run uses. `columns` are field keys of the data source, in
 * order (at least one, no duplicates). `groupBy` needs a groupable field; `sortBy` a sortable one
 * of the source; `showTotals` and `showPercentage` are only for aggregatable fields; comparison
 * needs a source that supports it and a range that can be compared. A field or condition the
 * source lacks is 400 INVALID_DEFINITION with the paths; one the caller may not see is 403
 * FIELD_NOT_ALLOWED.
 */
export const ReportDefinitionBody = z
  .strictObject({
    category: ReportCategory,
    dataSource: ReportSourceKey,
    columns: z.array(ReportFieldKey).min(1).max(50),
    filters: ReportFilters.optional().default({ logic: 'AND', conditions: [], groups: [] }),
    groupBy: ReportFieldKey.nullable().optional(),
    sortBy: ReportFieldKey.nullable().optional(),
    sortDescending: z.boolean().optional().default(false),
    showTotals: z.boolean().optional().default(false),
    showPercentage: z.boolean().optional().default(false),
    compareTo: ReportCompareTo.optional().default('NONE'),
    date: ReportDateSpec,
    chartType: ReportChartType.optional().default('AUTO'),
    showDataLabels: z.boolean().optional().default(false),
    includeTaxRevenue: z.boolean().optional().default(false),
  })
  .refine((d) => new Set(d.columns).size === d.columns.length, 'Choose each column once');
export type ReportDefinitionBody = z.input<typeof ReportDefinitionBody>;

/** A definition as returned (the same fields, resolved: nothing optional). */
export const ReportDefinitionView = z.object({
  category: ReportCategory,
  dataSource: ReportSourceKey,
  columns: z.array(ReportFieldKey),
  filters: z.object({
    logic: z.enum(['AND', 'OR']),
    conditions: z.array(ReportFilterCondition),
    groups: z.array(
      z.object({ logic: z.enum(['AND', 'OR']), conditions: z.array(ReportFilterCondition) }),
    ),
  }),
  groupBy: ReportFieldKey.nullable(),
  sortBy: ReportFieldKey.nullable(),
  sortDescending: z.boolean(),
  showTotals: z.boolean(),
  showPercentage: z.boolean(),
  compareTo: ReportCompareTo,
  date: z.discriminatedUnion('rule', [
    z.object({ rule: z.literal('ROLLING'), preset: ReportDatePreset }),
    z.object({ rule: z.literal('FIXED'), from: Day, to: Day }),
  ]),
  chartType: ReportChartType,
  showDataLabels: z.boolean(),
  includeTaxRevenue: z.boolean(),
});
export type ReportDefinitionView = z.infer<typeof ReportDefinitionView>;

// ---------- Running a report ----------

/** What a run is of: a built-in quick report, a saved report, or a definition not saved (the builder's Run and Preview). */
export const ReportTarget = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('SYSTEM'), key: ReportSystemKey }),
  z.strictObject({ kind: z.literal('SAVED'), id: SavedReportId }),
  z.strictObject({ kind: z.literal('DEFINITION'), definition: ReportDefinitionBody }),
]);
export type ReportTarget = z.input<typeof ReportTarget>;

/**
 * POST /business/reports/run: one report, run now. The overrides are the detail view's controls
 * (date range, comparison, quick filters, sort, chart type, labels, tax toggle) and change this
 * run only. `preview` (the builder) answers a limited sample of rows and says so. A run that is
 * not a preview is recorded in Recent Reports (kind VIEW). Page and sort are server-side.
 */
export const RunReportRequest = z.strictObject({
  target: ReportTarget,
  date: ReportDateSpec.optional(),
  compareTo: ReportCompareTo.optional(),
  quick: ReportQuickFilters.optional(),
  /** More conditions, joined to the definition's by AND (the "More Filters" panel). */
  extraFilters: ReportFilters.optional(),
  sort: z.strictObject({ field: ReportFieldKey, descending: z.boolean() }).optional(),
  search: SearchText.optional(),
  chartType: ReportChartType.optional(),
  showDataLabels: z.boolean().optional(),
  includeTaxRevenue: z.boolean().optional(),
  preview: z.boolean().optional().default(false),
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(25),
});
export type RunReportRequest = z.input<typeof RunReportRequest>;

/** A resolved date range: the dates, the firm's time zone, and the words for it. */
export const ReportRange = z.object({
  from: Day,
  to: Day,
  timezone: z.string(),
  label: z.string(),
});
export type ReportRange = z.infer<typeof ReportRange>;

export const ReportKpi = z.object({
  key: z.string(),
  label: z.string(),
  type: ReportFieldType,
  /** A number (money in cents) or text; null: not available (N/A). */
  value: z.union([z.number(), z.string()]).nullable(),
  /** The comparison period's value, when comparing. */
  previous: z.union([z.number(), z.string()]).nullable(),
  /** Percent change against `previous`, null when it cannot be told. */
  deltaPercent: z.number().nullable(),
  /** The definition of the metric, for its help text. */
  definition: z.string().nullable(),
});
export type ReportKpi = z.infer<typeof ReportKpi>;

export const ReportChartSeries = z.object({
  key: z.string(),
  label: z.string(),
  /** The comparison period's series. */
  comparison: z.boolean(),
  /** One value per label; null: no data in that period. */
  values: z.array(z.number().nullable()),
});
export type ReportChartSeries = z.infer<typeof ReportChartSeries>;

export const ReportChart = z.object({
  type: ReportChartType,
  labels: z.array(z.string()),
  series: z.array(ReportChartSeries),
  /** Values are money in cents. */
  money: z.boolean(),
});
export type ReportChart = z.infer<typeof ReportChart>;

export const ReportTableColumn = z.object({
  key: ReportFieldKey,
  label: z.string(),
  type: ReportFieldType,
  /** An identifier column that cannot be hidden. */
  locked: z.boolean(),
  sortable: z.boolean(),
});
export type ReportTableColumn = z.infer<typeof ReportTableColumn>;

/** Where a row's menu goes: the source record, when the caller may open it. */
export const ReportRowLink = z.object({
  kind: z.enum(['CLIENT', 'INVOICE', 'PAYMENT', 'RETURN', 'LEAD', 'TASK', 'CAMPAIGN', 'SERVICE']),
  id: z.uuid(),
});
export type ReportRowLink = z.infer<typeof ReportRowLink>;

export const ReportTableRow = z.object({
  /** Cells by column key: text, number (money in cents), true/false or null. */
  cells: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()]).nullable()),
  links: z.array(ReportRowLink),
});
export type ReportTableRow = z.infer<typeof ReportTableRow>;

export const ReportInsight = z.object({
  key: z.string(),
  /** A sentence made from the numbers ("Revenue is up 12% against the previous period"). */
  message: z.string(),
  metric: z.string(),
  value: z.number().nullable(),
  threshold: z.string().nullable(),
  /** The period that produced it. */
  range: ReportRange,
  /** Opens the supporting report with its filter, or a source module's list. */
  target: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('REPORT'), reportKey: ReportSystemKey }),
    z.object({
      kind: z.literal('MODULE'),
      module: z.string(),
      query: z.record(z.string(), z.string()),
    }),
  ]),
});
export type ReportInsight = z.infer<typeof ReportInsight>;

/** An active filter, for the chips and Clear All. */
export const ReportFilterChip = z.object({
  field: z.string(),
  label: z.string(),
  value: z.string(),
});
export type ReportFilterChip = z.infer<typeof ReportFilterChip>;

/** The answer to a run: everything the detail view and the builder's preview show, from one dataset. */
export const ReportResult = z.object({
  title: z.string(),
  /** The report's own id or key, for the target of an export or a schedule. */
  target: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('SYSTEM'), key: ReportSystemKey }),
    z.object({ kind: z.literal('SAVED'), id: z.uuid() }),
    z.object({ kind: z.literal('DEFINITION') }),
  ]),
  category: ReportCategory,
  definition: ReportDefinitionView,
  range: ReportRange,
  comparisonRange: ReportRange.nullable(),
  /** The report's own words for why a range or comparison was adapted or turned off. */
  notices: z.array(z.string()),
  kpis: z.array(ReportKpi),
  chart: ReportChart.nullable(),
  breakdown: ReportChart.nullable(),
  chips: z.array(ReportFilterChip),
  table: z.object({
    columns: z.array(ReportTableColumn),
    rows: z.array(ReportTableRow),
    /** Totals of the meaningful numeric columns, by column key. */
    totals: z.record(z.string(), z.number()).nullable(),
    ...Page,
  }),
  insights: z.array(ReportInsight),
  /** A preview: a limited sample of the rows. */
  preview: z.boolean(),
  generatedAt: DateTime,
  /** The data may be older than the firm's freshness setting (a cached aggregate). */
  stale: z.boolean(),
  /** The run recorded in Recent Reports (not for a preview). */
  runId: ReportRunId.nullable(),
});
export type ReportResult = z.infer<typeof ReportResult>;

// ---------- The dashboard ----------

/**
 * GET /business/reports: the dashboard. `date` is the global range (default: the firm's default
 * preset) and `compareTo` the comparison; both apply to the KPIs and the category cards.
 */
export const ReportsDashboardQuery = z.strictObject({
  preset: ReportDatePreset.optional(),
  from: Day.optional(),
  to: Day.optional(),
  compareTo: ReportCompareTo.optional(),
});
export type ReportsDashboardQuery = z.input<typeof ReportsDashboardQuery>;

export const ReportsKpiCard = ReportKpi.extend({
  /** The quick report the card opens ("revenue-summary"). */
  reportKey: ReportSystemKey,
});
export type ReportsKpiCard = z.infer<typeof ReportsKpiCard>;

/** A category card: a headline, a small summary chart, and the report it opens. */
export const ReportsCategoryCard = z.object({
  category: ReportCategory,
  label: z.string(),
  headline: ReportKpi.nullable(),
  chart: ReportChart.nullable(),
  reportKey: ReportSystemKey,
  /** The caller may open it (Team Productivity and money reports are permission-gated). */
  allowed: z.boolean(),
});
export type ReportsCategoryCard = z.infer<typeof ReportsCategoryCard>;

export const RecentReportRow = z.object({
  /** The run, for "View". */
  runId: ReportRunId,
  name: z.string(),
  category: ReportCategory,
  kind: ReportRunKind,
  /** A saved report or a built-in one; null for an ad hoc definition. */
  savedReportId: SavedReportId.nullable(),
  systemKey: ReportSystemKey.nullable(),
  saved: z.boolean(),
  owner: PersonRef.nullable(),
  at: DateTime,
});
export type RecentReportRow = z.infer<typeof RecentReportRow>;

export const ReportScheduleRow = z.object({
  id: ReportScheduleId,
  name: z.string(),
  reportName: z.string(),
  category: ReportCategory,
  frequency: ReportFrequency,
  /** "Every Monday at 8:00 AM", in the firm's time zone. */
  description: z.string(),
  nextRunAt: DateTime.nullable(),
  lastRunAt: DateTime.nullable(),
  lastStatus: ReportRunStatus.nullable(),
  recipientCount: z.number().int(),
  formats: z.array(ReportFormat),
  owner: PersonRef,
  active: z.boolean(),
});
export type ReportScheduleRow = z.infer<typeof ReportScheduleRow>;

export const ReportsDashboard = z.object({
  range: ReportRange,
  comparisonRange: ReportRange.nullable(),
  kpis: z.array(ReportsKpiCard),
  categories: z.array(ReportsCategoryCard),
  quickReports: z.array(ReportCatalogItem),
  recent: z.array(RecentReportRow).max(5),
  scheduled: z.array(ReportScheduleRow).max(5),
  insights: z.array(ReportInsight).max(5),
  generatedAt: DateTime,
  stale: z.boolean(),
  canCreate: z.boolean(),
  canExport: z.boolean(),
});
export type ReportsDashboard = z.infer<typeof ReportsDashboard>;

// ---------- Recent reports ----------

/** GET /business/reports/recent ("View All"): the caller's own and the shared reports opened lately. */
export const RecentReportsQuery = z.strictObject({
  category: ReportCategory.optional(),
  kind: ReportRunKind.optional(),
  search: SearchText.optional(),
  sort: z.enum(['at', 'name', 'category']).optional().default('at'),
  direction: z.enum(['asc', 'desc']).optional().default('desc'),
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(25),
});
export type RecentReportsQuery = z.input<typeof RecentReportsQuery>;
export const RecentReportPage = z.object({ items: z.array(RecentReportRow).max(100), ...Page });
export type RecentReportPage = z.infer<typeof RecentReportPage>;

// ---------- Saved reports ----------

export const SavedReportRow = z.object({
  id: SavedReportId,
  name: z.string(),
  description: z.string().nullable(),
  category: ReportCategory,
  dataSource: ReportSourceKey,
  visibility: ReportVisibility,
  owner: PersonRef,
  /** The caller's own favourite. */
  favorite: z.boolean(),
  archived: z.boolean(),
  /** Last time anyone ran it. */
  lastRunAt: DateTime.nullable(),
  scheduleCount: z.number().int(),
  updatedAt: DateTime,
});
export type SavedReportRow = z.infer<typeof SavedReportRow>;

export const SavedReportDetail = SavedReportRow.extend({
  definition: ReportDefinitionView,
  /** SELECTED: the firm roles (OWNER, ADMIN, STAFF) and the people it is shared with. */
  sharedRoles: z.array(z.enum(['OWNER', 'ADMIN', 'STAFF'])),
  sharedWith: z.array(PersonRef),
  /** The caller may change it (its owner, or an Owner or Admin). */
  canEdit: z.boolean(),
  createdAt: DateTime,
  /** Send it back on a change: 409 SAVE_CONFLICT when someone saved after it was loaded. */
  etag: z.string(),
});
export type SavedReportDetail = z.infer<typeof SavedReportDetail>;

export const SavedReportsQuery = z.strictObject({
  category: ReportCategory.optional(),
  /** `mine`: the caller's; `shared`: shared with them; `favorites`; `all`: all they may open. */
  tab: z.enum(['all', 'mine', 'shared', 'favorites']).optional().default('all'),
  includeArchived: z.union([z.boolean(), z.stringbool()]).optional(),
  search: SearchText.optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(25),
});
export type SavedReportsQuery = z.input<typeof SavedReportsQuery>;
export const SavedReportPage = z.object({ items: z.array(SavedReportRow).max(100), ...Page });
export type SavedReportPage = z.infer<typeof SavedReportPage>;

const Visibility = {
  visibility: ReportVisibility.optional().default('PRIVATE'),
  /** With SELECTED: firm roles that can open it. */
  sharedRoles: z
    .array(z.enum(['OWNER', 'ADMIN', 'STAFF']))
    .max(3)
    .optional()
    .default([]),
  /** With SELECTED: the people it is shared with (members of the firm). */
  sharedWithUserIds: z.array(z.uuid()).max(100).optional().default([]),
};

/**
 * POST /business/reports/saved (Save Report) and Save As: the name is unique among the firm's
 * live reports ignoring case (409 DUPLICATE_NAME; the screen warns first). The caller becomes the
 * owner.
 */
export const SaveReportRequest = z.strictObject({
  name: text(120),
  description: clearable(text(500, 'many')),
  ...Visibility,
  favorite: z.boolean().optional().default(false),
  definition: ReportDefinitionBody,
});
export type SaveReportRequest = z.input<typeof SaveReportRequest>;

/** PATCH /business/reports/saved/{id}: only the owner, an Owner or an Admin; `etag` guards it. */
export const UpdateSavedReportRequest = z
  .strictObject({
    name: text(120).optional(),
    description: clearable(text(500, 'many')),
    visibility: ReportVisibility.optional(),
    sharedRoles: z
      .array(z.enum(['OWNER', 'ADMIN', 'STAFF']))
      .max(3)
      .optional(),
    sharedWithUserIds: z.array(z.uuid()).max(100).optional(),
    definition: ReportDefinitionBody.optional(),
    etag: z.string().min(1).max(100),
  })
  .refine(
    (o) => Object.keys(o).filter((k) => k !== 'etag').length > 0,
    'Change at least one field',
  );
export type UpdateSavedReportRequest = z.input<typeof UpdateSavedReportRequest>;

/** POST .../saved/{id}/duplicate (Save As): a private copy "(Copy)". */
export const DuplicateSavedReportRequest = z.strictObject({ name: text(120).optional() });
export type DuplicateSavedReportRequest = z.input<typeof DuplicateSavedReportRequest>;

// ---------- Exports and print ----------

/**
 * POST /business/reports/exports: exports a report with the filters and permissions of the screen.
 * CSV is raw values for analysis, XLSX has headings and number and date formats, PDF is the
 * presentation (title, range, filters, KPIs, charts, the table). Large exports are queued: the
 * answer is a run to poll. The file name is the safe report name and range; never data. Export
 * needs the Export capability (403 EXPORT_NOT_ALLOWED), and one of financial or client data is
 * audited. Print is the browser's, with a print-friendly view.
 */
export const ExportReportRequest = z.strictObject({
  run: RunReportRequest.omit({ preview: true, page: true, pageSize: true }),
  format: ReportFormat,
  /** Hidden columns are left out; locked ones stay. */
  hiddenColumns: z.array(ReportFieldKey).max(50).optional(),
});
export type ExportReportRequest = z.input<typeof ExportReportRequest>;

export const ReportRunStatusView = z.object({
  runId: ReportRunId,
  kind: ReportRunKind,
  status: ReportRunStatus,
  format: ReportFormat.nullable(),
  rowCount: z.number().int().nullable(),
  /** A short code when it failed (never a message with data). */
  errorCode: z.string().nullable(),
  fileName: z.string().nullable(),
  /** The file is ready to download (a link is made by GET .../download). */
  ready: z.boolean(),
  createdAt: DateTime,
  finishedAt: DateTime.nullable(),
});
export type ReportRunStatusView = z.infer<typeof ReportRunStatusView>;
export { DownloadLink as ReportDownloadLink };

// ---------- Schedules ----------

/** The run time, in the firm's time zone: HH:mm on the hour or in 5-minute steps. */
const RunTime = z.string().regex(/^([01]\d|2[0-3]):[0-5][05]$/, 'Use HH:mm in 5 minute steps');

const ScheduleFields = {
  name: text(120),
  frequency: ReportFrequency,
  /** WEEKLY: 0 (Sunday) to 6. */
  weekday: z.number().int().min(0).max(6).nullable().optional(),
  /** MONTHLY, QUARTERLY and ANNUAL: 1 to 31 (clamped to a short month's last day). */
  dayOfMonth: z.number().int().min(1).max(31).nullable().optional(),
  /** ANNUAL: 1 to 12. */
  monthOfYear: z.number().int().min(1).max(12).nullable().optional(),
  runTime: RunTime,
  /** The range each run covers: a rolling preset (a recurring report is never fixed). */
  datePreset: ReportDatePreset,
  formats: z.array(ReportFormat).min(1).max(3),
  /** Members of the firm and approved outside addresses; each must be allowed to see the data (409 RECIPIENT_NOT_ALLOWED). */
  recipientUserIds: z.array(z.uuid()).max(50).optional().default([]),
  recipientEmails: z.array(z.email().max(254)).max(20).optional().default([]),
  deliverEmail: z.boolean().optional().default(true),
  deliverInApp: z.boolean().optional().default(false),
  active: z.boolean().optional().default(true),
};

const checkSchedule = (
  s: {
    frequency: string;
    weekday?: number | null;
    dayOfMonth?: number | null;
    monthOfYear?: number | null;
    recipientUserIds: string[];
    recipientEmails: string[];
    deliverEmail: boolean;
    deliverInApp: boolean;
  },
  ctx: z.RefinementCtx,
) => {
  const need = (ok: boolean, path: string, message: string) => {
    if (!ok) ctx.addIssue({ code: 'custom', path: [path], message });
  };
  if (s.frequency === 'WEEKLY') need(s.weekday != null, 'weekday', 'Choose the weekday');
  if (['MONTHLY', 'QUARTERLY', 'ANNUAL'].includes(s.frequency)) {
    need(s.dayOfMonth != null, 'dayOfMonth', 'Choose the day of the month');
  }
  if (s.frequency === 'ANNUAL') need(s.monthOfYear != null, 'monthOfYear', 'Choose the month');
  need(
    s.recipientUserIds.length + s.recipientEmails.length > 0,
    'recipientUserIds',
    'Add a recipient',
  );
  need(s.deliverEmail || s.deliverInApp, 'deliverEmail', 'Choose how it is delivered');
};

/**
 * POST /business/reports/schedules (Schedule Report, Save & Schedule): a saved report, a built-in
 * one, or a new report saved with the schedule (`newReport`: nothing is scheduled when saving
 * fails). Runs server-side at the firm's time zone; the answer has the next run.
 */
export const CreateReportScheduleRequest = z
  .strictObject({
    target: z.discriminatedUnion('kind', [
      z.strictObject({ kind: z.literal('SYSTEM'), key: ReportSystemKey }),
      z.strictObject({ kind: z.literal('SAVED'), id: SavedReportId }),
      z.strictObject({ kind: z.literal('NEW'), report: SaveReportRequest }),
    ]),
    ...ScheduleFields,
  })
  .superRefine(checkSchedule);
export type CreateReportScheduleRequest = z.input<typeof CreateReportScheduleRequest>;

/** PATCH .../schedules/{id}: the fields sent change. The report itself does not change. */
export const UpdateReportScheduleRequest = z
  .strictObject({
    name: ScheduleFields.name.optional(),
    frequency: ScheduleFields.frequency.optional(),
    weekday: ScheduleFields.weekday,
    dayOfMonth: ScheduleFields.dayOfMonth,
    monthOfYear: ScheduleFields.monthOfYear,
    runTime: RunTime.optional(),
    datePreset: ReportDatePreset.optional(),
    formats: ScheduleFields.formats.optional(),
    recipientUserIds: z.array(z.uuid()).max(50).optional(),
    recipientEmails: z.array(z.email().max(254)).max(20).optional(),
    deliverEmail: z.boolean().optional(),
    deliverInApp: z.boolean().optional(),
  })
  .refine((o) => Object.keys(o).length > 0, 'Change at least one field');
export type UpdateReportScheduleRequest = z.input<typeof UpdateReportScheduleRequest>;

export const ReportScheduleDetail = ReportScheduleRow.extend({
  target: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('SYSTEM'), key: ReportSystemKey }),
    z.object({ kind: z.literal('SAVED'), id: SavedReportId }),
  ]),
  weekday: z.number().int().nullable(),
  dayOfMonth: z.number().int().nullable(),
  monthOfYear: z.number().int().nullable(),
  runTime: z.string(),
  timezone: z.string(),
  datePreset: ReportDatePreset,
  recipientUsers: z.array(PersonRef),
  recipientEmails: z.array(z.string()),
  deliverEmail: z.boolean(),
  deliverInApp: z.boolean(),
  consecutiveFailures: z.number().int(),
  createdAt: DateTime,
});
export type ReportScheduleDetail = z.infer<typeof ReportScheduleDetail>;

export const ReportSchedulesQuery = z.strictObject({
  status: z.enum(['all', 'active', 'paused']).optional().default('all'),
  search: SearchText.optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(25),
});
export type ReportSchedulesQuery = z.input<typeof ReportSchedulesQuery>;
export const ReportSchedulePage = z.object({ items: z.array(ReportScheduleRow).max(100), ...Page });
export type ReportSchedulePage = z.infer<typeof ReportSchedulePage>;

// ---------- Metric settings ----------

/**
 * GET and PUT /business/reports/settings: the metric definitions every report, KPI card and
 * export of the firm shares (what "Total Revenue" means), so the numbers reconcile. Owner and
 * Admin change them.
 */
export const ReportSettingsView = z.object({
  revenueBasis: RevenueBasis,
  includeTaxDefault: z.boolean(),
  defaultDatePreset: ReportDatePreset,
  staleAfterMinutes: z.number().int(),
  timezone: z.string(),
  updatedAt: DateTime.nullable(),
});
export type ReportSettingsView = z.infer<typeof ReportSettingsView>;
export const SaveReportSettingsRequest = z
  .strictObject({
    revenueBasis: RevenueBasis.optional(),
    includeTaxDefault: z.boolean().optional(),
    defaultDatePreset: ReportDatePreset.optional(),
    staleAfterMinutes: z.number().int().min(5).max(1_440).optional(),
  })
  .refine((o) => Object.keys(o).length > 0, 'Change at least one field');
export type SaveReportSettingsRequest = z.input<typeof SaveReportSettingsRequest>;

// ---------- Errors ----------

export const ReportErrorCode = z.enum([
  /** 409: a live saved report has this name (the screen warns before saving). */
  'DUPLICATE_NAME',
  /** 409: someone saved after it was loaded. */
  'SAVE_CONFLICT',
  /** 400: a field, operator, grouping or comparison the data source does not allow. */
  'INVALID_DEFINITION',
  /** 400: the date range is not valid for the report (start after end, or not comparable). */
  'INVALID_RANGE',
  /** 403: a field or data source the caller may not see. */
  'FIELD_NOT_ALLOWED',
  /** 403: export needs the Export capability. */
  'EXPORT_NOT_ALLOWED',
  /** 403: only the owner, an Owner or an Admin changes a saved report or schedule. */
  'NOT_THE_OWNER',
  /** 409: the saved report is archived. */
  'REPORT_ARCHIVED',
  /** 409: a recipient may not receive this report's data. */
  'RECIPIENT_NOT_ALLOWED',
  /** 409: a person is not a member of the firm. */
  'NOT_A_MEMBER',
  /** 409: the file is not ready (queued or failed). */
  'RUN_NOT_READY',
]);
export type ReportErrorCode = z.infer<typeof ReportErrorCode>;
