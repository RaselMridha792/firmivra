import { z } from 'zod';
import { BusinessStatus, PlatformReportType, SupportTicketStatus } from '../db-enums.js';

// Super Admin Reports & Analytics (R55): the platform's figures across firms. Designs:
// docs/mockups/super-admin/reports/ (the dashboard, Firm Report Detail, Custom Report Builder and
// the developer instructions). Tables: R0 stage B9 (docs/work/R0-stage-b9-reports.md) and the
// platform's own (businesses, applications, subscriptions, billing, support, audit).
// Routes: /api/v1/admin/reports/..., Super Admin only.
// Every figure is live and nothing is estimated: a figure with no source is null and the screen
// shows it as not available (platform uptime until monitoring exists; per-firm activity and
// feature usage until the daily rollup job fills platform_firm_metrics_daily and
// platform_feature_usage_daily). Money is integer cents of USD from billing records, never from
// plan prices. A change compares with the period of equal length just before ("vs. previous").
// Responses are plain objects; requests are strict.

const DateTime = z.iso.datetime({ offset: true });
const CalendarDate = z.iso.date();
const Page = z.coerce.number().int().min(1).optional().default(1);
const PageSize = z.coerce.number().int().min(1).max(100).optional().default(25);

export { PlatformReportType as AdminReportType };

/** The global date range of every report; left out, the last 30 days ending today. */
export const AdminReportRange = z.strictObject({
  from: CalendarDate.optional(),
  to: CalendarDate.optional(),
});
export type AdminReportRange = z.input<typeof AdminReportRange>;

/** A card: its value for the range and for the range before, or null when there is no source. */
export const AdminReportKpi = z.object({
  value: z.number().nullable(),
  previous: z.number().nullable(),
});
export type AdminReportKpi = z.infer<typeof AdminReportKpi>;

/** One point of a monthly series ("2026-10"). */
export const AdminReportPoint = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/),
  value: z.number(),
});
export type AdminReportPoint = z.infer<typeof AdminReportPoint>;

export const AdminReportFirmRef = z.object({ id: z.uuid(), name: z.string() });

/** Feature keys and their labels (the rollup's `feature`, e.g. `documents.generate`). */
export const ADMIN_REPORT_FEATURES = {
  'documents.generate': 'Document Generation',
  'esign.send': 'eSignature',
  'crm.lead_created': 'CRM / Leads',
  'templates.used': 'Templates',
  'billing.invoice_sent': 'Billing',
  'communications.sent': 'Communications',
} as const;

export const AdminFeatureUsageRow = z.object({
  feature: z.string(),
  label: z.string(),
  events: z.number().int(),
  /** Firms that used it at least once in the range. */
  firms: z.number().int(),
  /** Share of active firms that used it (0 to 100), null with no active firms or no rollup. */
  percent: z.number().nullable(),
});
export type AdminFeatureUsageRow = z.infer<typeof AdminFeatureUsageRow>;

export const AdminReportActivity = z.object({
  at: DateTime,
  /** A stable kind for the icon: firm_registered, firm_status, subscription_changed, payment_failed, user_added, ticket_opened… */
  kind: z.string(),
  title: z.string(),
  detail: z.string().nullable(),
  firm: AdminReportFirmRef.nullable(),
});
export type AdminReportActivity = z.infer<typeof AdminReportActivity>;

// ---------- Overview ----------

export const AdminReportsOverview = z.object({
  range: z.object({
    from: CalendarDate,
    to: CalendarDate,
    previousFrom: CalendarDate,
    previousTo: CalendarDate,
  }),
  kpis: z.object({
    totalFirms: AdminReportKpi,
    activeFirms: AdminReportKpi,
    pendingApplications: AdminReportKpi,
    totalUsers: AdminReportKpi,
    /** Monthly recurring revenue in cents (active recurring billing, monthly equivalent). */
    mrrCents: AdminReportKpi,
    overduePayments: AdminReportKpi,
    openSupportIssues: AdminReportKpi,
    /** Always null until uptime monitoring exists. */
    uptimePercent: AdminReportKpi,
  }),
  /** New firms per month, the last six months. */
  firmGrowth: z.array(AdminReportPoint),
  /** Payments received per month in cents, the last six months. */
  revenueTrend: z.array(AdminReportPoint),
  /** Active firms by plan; "No plan" for firms with no subscription yet. */
  planDistribution: z.array(
    z.object({ planCode: z.string().nullable(), planName: z.string(), firms: z.number().int() }),
  ),
  featureUsage: z.array(AdminFeatureUsageRow),
  recentActivity: z.array(AdminReportActivity),
  /** Firms by payments received in the range. */
  topFirms: z.array(AdminReportFirmRef.extend({ revenueCents: z.number().int() })),
});
export type AdminReportsOverview = z.infer<typeof AdminReportsOverview>;

// ---------- Tabs ----------

export const AdminRevenueReport = z.object({
  mrrCents: AdminReportKpi,
  arrCents: AdminReportKpi,
  /** Payments received in the range. */
  collectedCents: AdminReportKpi,
  refundedCents: AdminReportKpi,
  failedPayments: AdminReportKpi,
  /** Issued, past due, with a balance (at the end of the range). */
  overdueCents: z.number().int(),
  upgrades: z.number().int(),
  downgrades: z.number().int(),
  cancellations: z.number().int(),
  trend: z.array(AdminReportPoint),
  byPlan: z.array(
    z.object({ planName: z.string(), revenueCents: z.number().int(), firms: z.number().int() }),
  ),
  byFirm: z.array(AdminReportFirmRef.extend({ revenueCents: z.number().int() })),
});
export type AdminRevenueReport = z.infer<typeof AdminRevenueReport>;

export const AdminUsersReport = z.object({
  /** Firm staff and client logins. */
  totalUsers: AdminReportKpi,
  newUsers: AdminReportKpi,
  /** From the daily rollup; null until it runs. */
  activeUsers: AdminReportKpi,
  byPool: z.array(z.object({ pool: z.enum(['STAFF', 'CLIENT']), users: z.number().int() })),
  signups: z.array(AdminReportPoint),
  /** From the daily rollup (latest day per firm); empty until it runs. */
  byFirm: z.array(
    AdminReportFirmRef.extend({
      totalUsers: z.number().int(),
      activeUsers: z.number().int(),
      lastLoginAt: DateTime.nullable(),
    }),
  ),
});
export type AdminUsersReport = z.infer<typeof AdminUsersReport>;

export const AdminFeatureUsageQuery = AdminReportRange.extend({
  feature: z.string().max(80).optional(),
  planCode: z.string().max(40).optional(),
});
export type AdminFeatureUsageQuery = z.input<typeof AdminFeatureUsageQuery>;

export const AdminFeatureUsageReport = z.object({
  rows: z.array(AdminFeatureUsageRow),
  /** Whether the rollup has any day in the range (else every figure is unknown, not zero). */
  hasData: z.boolean(),
});
export type AdminFeatureUsageReport = z.infer<typeof AdminFeatureUsageReport>;

export const AdminSupportReport = z.object({
  total: AdminReportKpi,
  open: z.number().int(),
  inProgress: z.number().int(),
  closed: AdminReportKpi,
  /** Minutes from opening to the first response, for tickets answered in the range. */
  avgFirstResponseMinutes: z.number().nullable(),
  /** Hours from opening to resolution, SLA pauses left out, for tickets resolved in the range. */
  avgResolutionHours: z.number().nullable(),
  byPriority: z.array(z.object({ priority: z.string(), tickets: z.number().int() })),
  byFirm: z.array(AdminReportFirmRef.extend({ tickets: z.number().int() })),
  volume: z.array(AdminReportPoint),
});
export type AdminSupportReport = z.infer<typeof AdminSupportReport>;

// ---------- Firms ----------

export const AdminFirmsReportQuery = AdminReportRange.extend({
  search: z.string().trim().max(100).optional(),
  status: BusinessStatus.optional(),
  planCode: z.string().max(40).optional(),
  /** Joined on or after / on or before these days (the firm's sign-up), inclusive. */
  joinedFrom: CalendarDate.optional(),
  joinedTo: CalendarDate.optional(),
  sort: z.enum(['name', 'joined', 'revenue', 'users']).optional().default('name'),
  descending: z.union([z.boolean(), z.stringbool()]).optional().default(false),
  page: Page,
  pageSize: PageSize,
});
export type AdminFirmsReportQuery = z.input<typeof AdminFirmsReportQuery>;

export const AdminFirmReportRow = z.object({
  id: z.uuid(),
  name: z.string(),
  status: BusinessStatus,
  planName: z.string().nullable(),
  joinedAt: DateTime,
  contactName: z.string().nullable(),
  contactEmail: z.string().nullable(),
  /** From the rollup's latest day; null until it runs. */
  totalUsers: z.number().int().nullable(),
  /** Payments received in the range. */
  revenueCents: z.number().int(),
  openTickets: z.number().int(),
  lastLoginAt: DateTime.nullable(),
});
export type AdminFirmReportRow = z.infer<typeof AdminFirmReportRow>;

export const AdminFirmsReport = z.object({
  items: z.array(AdminFirmReportRow),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
});
export type AdminFirmsReport = z.infer<typeof AdminFirmsReport>;

/** GET /admin/reports/firms/{businessId}: Firm Report Detail. */
export const AdminFirmReport = z.object({
  firm: z.object({
    id: z.uuid(),
    name: z.string(),
    status: BusinessStatus,
    businessType: z.string().nullable(),
    planName: z.string().nullable(),
    since: DateTime,
    contactName: z.string().nullable(),
    contactEmail: z.string().nullable(),
    contactPhone: z.string().nullable(),
    /** Not stored for firms yet (the application's address only): null. */
    location: z.string().nullable(),
  }),
  kpis: z.object({
    totalUsers: AdminReportKpi,
    revenueCents: AdminReportKpi,
    activeDocuments: AdminReportKpi,
    leads: AdminReportKpi,
    supportTickets: AdminReportKpi,
  }),
  userGrowth: z.array(AdminReportPoint),
  documentActivity: z.array(
    z.object({ month: z.string(), created: z.number().int(), completed: z.number().int() }),
  ),
  featureUsage: z.array(AdminFeatureUsageRow),
  recentActivity: z.array(AdminReportActivity),
  openTickets: z.array(
    z.object({
      id: z.uuid(),
      number: z.number().int(),
      subject: z.string(),
      priority: z.string(),
      status: SupportTicketStatus,
      createdAt: DateTime,
    }),
  ),
  /** Whether the rollup has any day for the firm (else its activity figures are unknown). */
  hasActivityData: z.boolean(),
});
export type AdminFirmReport = z.infer<typeof AdminFirmReport>;

// ---------- Custom Report Builder ----------

export const AdminReportFieldKey = z.string().regex(/^[a-z][a-z0-9_.]{0,79}$/);

export const AdminReportField = z.object({
  key: z.string(),
  label: z.string(),
  type: z.enum(['text', 'number', 'money', 'date', 'datetime', 'status']),
  /** Shown only to roles that may see personal details (contact email and phone). */
  sensitive: z.boolean(),
  sortable: z.boolean(),
});
export type AdminReportField = z.infer<typeof AdminReportField>;

export const AdminReportFilterDef = z.object({
  key: z.string(),
  label: z.string(),
  /** `date` takes a day (YYYY-MM-DD). */
  type: z.enum(['select', 'text', 'date']),
  options: z.array(z.object({ value: z.string(), label: z.string() })),
});

export const AdminReportCatalog = z.object({
  type: PlatformReportType,
  fields: z.array(AdminReportField),
  filters: z.array(AdminReportFilterDef),
  defaultFields: z.array(z.string()),
});
export type AdminReportCatalog = z.infer<typeof AdminReportCatalog>;

export const AdminReportDateRange = z.union([
  z.strictObject({
    preset: z.enum([
      'LAST_7_DAYS',
      'LAST_30_DAYS',
      'THIS_MONTH',
      'LAST_MONTH',
      'THIS_QUARTER',
      'THIS_YEAR',
    ]),
  }),
  z
    .strictObject({ from: CalendarDate, to: CalendarDate })
    .refine((r) => r.from <= r.to, 'End on or after the start'),
]);
export type AdminReportDateRange = z.infer<typeof AdminReportDateRange>;

const Definition = {
  type: PlatformReportType,
  fields: z.array(AdminReportFieldKey).min(1, 'Choose at least one field').max(100),
  /** Filter key to value, from the catalogue's filters. */
  filters: z.record(z.string().max(60), z.string().max(200)).optional().default({}),
  dateRange: AdminReportDateRange.optional().default({ preset: 'LAST_30_DAYS' }),
  sort: z
    .array(z.strictObject({ field: AdminReportFieldKey, direction: z.enum(['asc', 'desc']) }))
    .max(3)
    .optional()
    .default([]),
};

export const AdminReportRunRequest = z.strictObject({
  ...Definition,
  page: Page,
  pageSize: PageSize,
});
export type AdminReportRunRequest = z.input<typeof AdminReportRunRequest>;

export const AdminReportResult = z.object({
  columns: z.array(AdminReportField),
  rows: z.array(z.record(z.string(), z.union([z.string(), z.number(), z.null()]))),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
  generatedAt: DateTime,
});
export type AdminReportResult = z.infer<typeof AdminReportResult>;

/** Export to CSV: the file in the answer (title, time, period and filters on top), audited. */
export const AdminReportExportRequest = z.strictObject({
  ...Definition,
  format: z.literal('CSV'),
  title: z.string().trim().min(1).max(120).optional(),
});
export type AdminReportExportRequest = z.input<typeof AdminReportExportRequest>;
export const ADMIN_REPORT_EXPORT_MAX = 10_000;

export const AdminReportFile = z.object({
  fileName: z.string(),
  mimeType: z.string(),
  content: z.string(),
  rowCount: z.number().int(),
});
export type AdminReportFile = z.infer<typeof AdminReportFile>;

// ---------- Saved reports ----------

export const AdminSavedReport = z.object({
  id: z.uuid(),
  name: z.string(),
  description: z.string().nullable(),
  type: PlatformReportType,
  fields: z.array(z.string()),
  filters: z.record(z.string(), z.string()),
  dateRange: AdminReportDateRange,
  sort: z.array(z.object({ field: z.string(), direction: z.enum(['asc', 'desc']) })),
  shared: z.boolean(),
  owner: z.object({ id: z.uuid(), name: z.string() }),
  isYours: z.boolean(),
  lastRunAt: DateTime.nullable(),
  createdAt: DateTime,
  updatedAt: DateTime,
});
export type AdminSavedReport = z.infer<typeof AdminSavedReport>;

export const AdminSavedReportList = z.object({ items: z.array(AdminSavedReport) });
export type AdminSavedReportList = z.infer<typeof AdminSavedReportList>;

export const SaveAdminReportRequest = z.strictObject({
  name: z.string().trim().min(1, 'Name the report').max(120),
  description: z.string().trim().max(1000).nullable().optional(),
  shared: z.boolean().optional().default(false),
  type: Definition.type,
  fields: Definition.fields,
  filters: Definition.filters,
  dateRange: Definition.dateRange,
  sort: Definition.sort,
});
export type SaveAdminReportRequest = z.input<typeof SaveAdminReportRequest>;

/** Rename, describe, share, or change the definition (yours only; 404 otherwise). */
export const UpdateAdminReportRequest = z.strictObject({
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(1000).nullable().optional(),
  shared: z.boolean().optional(),
  fields: Definition.fields.optional(),
  filters: z.record(z.string().max(60), z.string().max(200)).optional(),
  dateRange: AdminReportDateRange.optional(),
  sort: z
    .array(z.strictObject({ field: AdminReportFieldKey, direction: z.enum(['asc', 'desc']) }))
    .max(3)
    .optional(),
});
export type UpdateAdminReportRequest = z.input<typeof UpdateAdminReportRequest>;

export const AdminSavedReportRunQuery = z.strictObject({ page: Page, pageSize: PageSize });
export type AdminSavedReportRunQuery = z.input<typeof AdminSavedReportRunQuery>;

/** Stable `error.code` values of these routes, besides the generic ones. */
export const AdminReportsErrorCode = z.enum([
  /** 400: a field or filter the report type does not have. */
  'UNKNOWN_FIELD',
  /** 409: another of your saved reports has this name. */
  'DUPLICATE_NAME',
  /** 409: more rows than one export holds; narrow the filters. */
  'EXPORT_TOO_LARGE',
]);
export type AdminReportsErrorCode = z.infer<typeof AdminReportsErrorCode>;
