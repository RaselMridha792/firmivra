import { z } from 'zod';
import { MemberRef } from '../clients/schemas.js';
import { clearable, SearchText, text } from '../clients/text.js';
import {
  AccountingBasis,
  BookkeepingAccountType,
  BookkeepingActivityKind,
  BookkeepingPeriodKind,
  BookkeepingPeriodStatus,
  BookkeepingReportType,
  BookkeepingStatus,
  ConnectionStatus,
  FiguresSource,
  ReconciliationStatus,
  ReportCadence,
  ReportReviewStatus,
  StatusSource,
  SyncOutcome,
  SyncTrigger,
} from '../db-enums.js';

// Bookkeeping (R38 Bookkeeping API): the firm's recurring bookkeeping work for its clients. One
// module, one client list: the status tabs are filters of it. Firmivra keeps no ledger: the
// income, expense and uncategorized figures of a period are null until a preparer enters them or
// an import supplies them, and every total says what it summed. Nothing is estimated or invented.
// Firm routes: /api/v1/business/bookkeeping.
// - Owner and Admin reach every bookkeeping client; Staff (and the five newer roles) only those
//   whose client is assigned to them (404 NOT_FOUND otherwise), like client records.
// - STAFF+ prepares: activity, status, accounts, periods and their checklist, reconciliations
//   (save, ready for review), reports (start, send for review), syncs, the client's portal
//   defaults and alerts. MGR (Owner, Admin) adds clients, changes cadence, assignment and
//   reviewer, pauses, archives, edits settings, approves and reopens reconciliations, approves,
//   closes and reopens periods, and approves and delivers reports (403 FORBIDDEN).
// - Tasks, notes, documents and document requests are the shared modules' (`api.tasks`, notes,
//   `api.documents` with the workspace's `engagementId`), not copies. Transactions, refunds,
//   settlements and the Terms pages need tables that do not exist yet (see the PR's Schema request).
// Responses are plain objects; requests are strict. Money is in cents, days are `YYYY-MM-DD`.

export {
  AccountingBasis,
  BookkeepingAccountType,
  BookkeepingActivityKind,
  BookkeepingPeriodKind,
  BookkeepingPeriodStatus,
  BookkeepingReportType,
  BookkeepingStatus,
  ConnectionStatus,
  FiguresSource,
  ReconciliationStatus,
  ReportCadence,
  ReportReviewStatus,
  StatusSource,
  SyncOutcome,
  SyncTrigger,
};

const DateTime = z.iso.datetime({ offset: true });
const CalendarDate = z.iso.date();
const Int = z.number().int();
/** Whole cents, up to a trillion dollars either way (a credit card balance is negative). */
const Cents = z.number().int('Use whole cents').min(-100_000_000_000_000).max(100_000_000_000_000);
const optionalText = (max: number, lines: 'one' | 'many' = 'one') => clearable(text(max, lines));

export const BookkeepingClientId = z.uuid();
export const BookkeepingConnectionId = z.uuid();
export const BookkeepingAccountId = z.uuid();
export const BookkeepingPeriodId = z.uuid();
export const BookkeepingCloseItemId = z.uuid();
export const BookkeepingReconciliationId = z.uuid();
export const BookkeepingReportId = z.uuid();

export const BookkeepingErrorCode = z.enum([
  'VALIDATION_FAILED',
  'NOT_FOUND',
  'FORBIDDEN',
  'ALREADY_BOOKKEEPING_CLIENT',
  'NO_BOOKKEEPING_SERVICE',
  'CLIENT_STATE',
  'NOT_A_MEMBER',
  'CLIENT_NOT_ASSIGNED',
  'NOT_CONNECTED',
  'CONNECTION_EXISTS',
  'COMPANY_ALREADY_CONNECTED',
  'DUPLICATE',
  'PERIOD_STATE',
  'PERIOD_LOCKED',
  'CLOSE_ITEMS_OPEN',
  'RECON_STATE',
  'RECON_DIFFERENCE',
  'REPORT_STATE',
  'REPORT_NOT_PUBLISHED',
  'NOT_THIS_CLIENTS',
]);
export type BookkeepingErrorCode = z.infer<typeof BookkeepingErrorCode>;

export const BookkeepingOk = z.object({ ok: z.literal(true) });
export type BookkeepingOk = z.infer<typeof BookkeepingOk>;

// ---------- Shared pieces ----------

export const BookkeepingClientRef = z.object({
  id: z.uuid(),
  displayName: z.string(),
  clientNumber: Int,
  accountType: z.enum(['INDIVIDUAL', 'BUSINESS']),
});
export type BookkeepingClientRef = z.infer<typeof BookkeepingClientRef>;

/** Named providers show their name; any other provider key shows itself. Providers are codes, never a fixed list. */
export const BOOKKEEPING_PROVIDERS = {
  quickbooks: 'QuickBooks Online',
  xero: 'Xero',
  freshbooks: 'FreshBooks',
  zoho_books: 'Zoho Books',
} as const;
export const BookkeepingProviderKey = z
  .string()
  .regex(/^[a-z][a-z0-9_]{1,39}$/, 'Use a provider key such as quickbooks');

export const BookkeepingSoftware = z.object({
  key: z.string(),
  label: z.string(),
  status: ConnectionStatus,
});
export type BookkeepingSoftware = z.infer<typeof BookkeepingSoftware>;

/** From the live connection and the last successful sync against the firm's staleSyncHours; never guessed. */
export const BookkeepingSyncStatus = z.enum(['SYNCED', 'STALE', 'NEVER', 'ERROR', 'NOT_CONNECTED']);
export type BookkeepingSyncStatus = z.infer<typeof BookkeepingSyncStatus>;

const Page = { total: Int, page: Int, pageSize: Int };
const pageQuery = (defaultSize: number) => ({
  page: z.coerce.number().int().min(1).max(100_000).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(defaultSize),
});
const Direction = z.enum(['asc', 'desc']);

/** GET list queries that only page. */
export const BookkeepingListQuery = z.strictObject({ ...pageQuery(25) });
export type BookkeepingListQuery = z.input<typeof BookkeepingListQuery>;

// ---------- Settings ----------

export const BookkeepingChannel = z.enum(['EMAIL', 'SMS', 'PORTAL']);
export type BookkeepingChannel = z.infer<typeof BookkeepingChannel>;

export const ReportDelivery = z.enum(['PORTAL', 'EMAIL', 'PORTAL_AND_EMAIL']);
export type ReportDelivery = z.infer<typeof ReportDelivery>;

export const StatusRules = z.strictObject({
  /** A requested document outstanding this many days makes the client MISSING_DOCUMENTS. */
  missingDocumentsAfterDays: z.number().int().min(0).max(90).optional(),
  /** A close or report this many days past due makes the client OVERDUE. */
  overdueAfterDays: z.number().int().min(0).max(90).optional(),
});
export type StatusRules = z.infer<typeof StatusRules>;

export const ReminderDefault = z.strictObject({
  daysBefore: z.number().int().min(0).max(60),
  channels: z.array(BookkeepingChannel).min(1).max(3),
});
export type ReminderDefault = z.infer<typeof ReminderDefault>;

export const ReportScheduleItem = z.strictObject({
  report: BookkeepingReportType,
  cadence: ReportCadence,
  /** The day of the month after the period when the report is due. */
  dueDay: z.number().int().min(1).max(28),
  delivery: ReportDelivery,
});
export type ReportScheduleItem = z.infer<typeof ReportScheduleItem>;

export const DocumentChecklistItem = z.strictObject({
  label: text(120),
  cadence: ReportCadence,
});
export type DocumentChecklistItem = z.infer<typeof DocumentChecklistItem>;

export const CloseChecklistItem = z.strictObject({
  key: z.string().regex(/^[a-z][a-z0-9_]{1,39}$/, 'Use a key such as categorization'),
  label: text(120),
  required: z.boolean(),
});
export type CloseChecklistItem = z.infer<typeof CloseChecklistItem>;

/** What a firm that has set no close checklist gets for each new period (Close Checklist). */
export const DEFAULT_CLOSE_CHECKLIST: readonly CloseChecklistItem[] = [
  { key: 'categorization', label: 'Categorization complete', required: true },
  { key: 'reconciliations', label: 'Reconciliations approved', required: true },
  { key: 'refunds', label: 'Refunds reviewed', required: false },
  { key: 'settlements', label: 'Settlements reviewed', required: false },
  { key: 'documents', label: 'Documents received', required: true },
  { key: 'adjustments', label: 'Adjustments posted', required: false },
  { key: 'profit_loss', label: 'Profit & Loss reviewed', required: true },
  { key: 'balance_sheet', label: 'Balance Sheet reviewed', required: true },
  { key: 'open_items', label: 'Open items resolved', required: false },
  { key: 'reports', label: 'Reports generated', required: true },
  { key: 'reviewer_approval', label: 'Reviewer approval', required: true },
  { key: 'client_delivery', label: 'Delivered to the client', required: false },
];

const unique = <T extends { key?: string; label?: string }>(items: T[]) =>
  new Set(items.map((i) => (i.key ?? i.label ?? '').toLowerCase())).size === items.length;

/** GET and PUT /business/bookkeeping/settings (Owner and Admin). */
export const BookkeepingSettings = z.object({
  defaultCadence: ReportCadence,
  closeTargetDay: Int,
  upcomingReportDays: Int,
  staleSyncHours: Int,
  reconToleranceCents: Int,
  statusRules: StatusRules,
  reminderDefaults: z.array(ReminderDefault),
  reportSchedule: z.array(ReportScheduleItem),
  documentChecklist: z.array(DocumentChecklistItem),
  closeChecklist: z.array(CloseChecklistItem),
  updatedAt: DateTime.nullable(),
});
export type BookkeepingSettings = z.infer<typeof BookkeepingSettings>;

export const SaveBookkeepingSettingsRequest = z.strictObject({
  defaultCadence: ReportCadence.optional().default('MONTHLY'),
  closeTargetDay: z.number().int().min(1).max(28).optional().default(10),
  upcomingReportDays: z.number().int().min(1).max(90).optional().default(14),
  staleSyncHours: z.number().int().min(1).max(720).optional().default(48),
  reconToleranceCents: z.number().int().min(0).max(100_000).optional().default(0),
  statusRules: StatusRules.optional().default({}),
  reminderDefaults: z.array(ReminderDefault).max(10).optional().default([]),
  reportSchedule: z.array(ReportScheduleItem).max(30).optional().default([]),
  documentChecklist: z
    .array(DocumentChecklistItem)
    .max(50)
    .refine(unique, 'Each document is listed once')
    .optional()
    .default([]),
  closeChecklist: z
    .array(CloseChecklistItem)
    .max(30)
    .refine(unique, 'Each step has its own key')
    .optional()
    .default([]),
});
export type SaveBookkeepingSettingsRequest = z.input<typeof SaveBookkeepingSettingsRequest>;

// ---------- Overview ----------

export const BookkeepingOverviewPeriod = z.enum([
  'THIS_MONTH',
  'LAST_MONTH',
  'THIS_QUARTER',
  'THIS_YEAR',
]);
export type BookkeepingOverviewPeriod = z.infer<typeof BookkeepingOverviewPeriod>;

/** GET /business/bookkeeping/overview. */
export const BookkeepingOverviewQuery = z.strictObject({
  period: BookkeepingOverviewPeriod.optional().default('THIS_MONTH'),
});
export type BookkeepingOverviewQuery = z.input<typeof BookkeepingOverviewQuery>;

/** A KPI card: the value, the same figure for the period before and the change (null when there is nothing to compare). */
export const BookkeepingKpi = z.object({
  value: Int,
  previous: Int.nullable(),
  changePercent: z.number().nullable(),
});
export type BookkeepingKpi = z.infer<typeof BookkeepingKpi>;

export const BookkeepingStatusCount = z.object({ status: BookkeepingStatus, count: Int });

export const BookkeepingOverview = z.object({
  period: z.object({ key: BookkeepingOverviewPeriod, from: CalendarDate, to: CalendarDate }),
  kpis: z.object({
    /** Bookkeeping clients that are not paused or archived. */
    activeClients: BookkeepingKpi,
    /**
     * The three money cards sum the period figures that preparers entered or imported for the
     * active clients: periods inside the overview's dates with both income and expenses known,
     * the shortest period first so a quarter never counts on top of its months. A client with no
     * such period adds nothing; `clientsWithFigures` says how many did.
     */
    totalIncomeCents: BookkeepingKpi,
    totalExpensesCents: BookkeepingKpi,
    netProfitCents: BookkeepingKpi,
    clientsWithFigures: Int,
    /** Active clients with a report due within the firm's upcoming window. */
    clientsWithUpcomingReports: BookkeepingKpi,
  }),
  statusBreakdown: z.object({ total: Int, items: z.array(BookkeepingStatusCount) }),
  /** The year of `period.to`, month by month: only periods of kind MONTH with figures count. */
  monthly: z.array(z.object({ month: z.string(), incomeCents: Int, expensesCents: Int })),
  software: z.array(
    z.object({
      /** null: clients with no live accounting connection. */
      key: z.string().nullable(),
      label: z.string(),
      clientCount: Int,
      /** At least one of the clients' connections is CONNECTED. */
      connected: z.boolean(),
    }),
  ),
  upcomingReports: z.array(
    z.object({
      reportId: z.uuid(),
      bookkeepingClientId: z.uuid(),
      clientName: z.string(),
      reportType: BookkeepingReportType,
      reportName: z.string(),
      periodLabel: z.string(),
      dueOn: CalendarDate,
      status: ReportReviewStatus,
    }),
  ),
});
export type BookkeepingOverview = z.infer<typeof BookkeepingOverview>;

// ---------- Client list ----------

export const BookkeepingClientTab = z.enum([
  'ALL',
  'ON_TRACK',
  'NEEDS_ATTENTION',
  'MISSING_DOCUMENTS',
  'OVERDUE',
  'NOT_STARTED',
  'UPCOMING',
]);
export type BookkeepingClientTab = z.infer<typeof BookkeepingClientTab>;

export const BookkeepingClientSort = z.enum(['clientName', 'plan', 'status', 'nextReportDueOn']);

/** GET /business/bookkeeping/clients (and /clients/export without the paging). Archived clients are left out. */
export const BookkeepingClientsQuery = z.strictObject({
  tab: BookkeepingClientTab.optional().default('ALL'),
  /** On top of the tab; a tab and a different status together find nothing. */
  status: BookkeepingStatus.optional(),
  search: SearchText.optional(),
  clientType: z.enum(['INDIVIDUAL', 'BUSINESS']).optional(),
  /** The plan (package) of the Bookkeeping service. */
  plan: text(80).optional(),
  /** A provider key, or `NOT_CONNECTED`. */
  software: z.union([BookkeepingProviderKey, z.literal('NOT_CONNECTED')]).optional(),
  assignedUserId: z.uuid().optional(),
  paused: z.enum(['true', 'false']).optional(),
  reportDueFrom: CalendarDate.optional(),
  reportDueTo: CalendarDate.optional(),
  sort: BookkeepingClientSort.optional().default('clientName'),
  direction: Direction.optional().default('asc'),
  ...pageQuery(25),
});
export type BookkeepingClientsQuery = z.input<typeof BookkeepingClientsQuery>;

export const BookkeepingClientRow = z.object({
  /** The bookkeeping client's id (the profile), used by every /clients/{id} route. */
  id: z.uuid(),
  client: BookkeepingClientRef,
  engagementId: z.uuid(),
  plan: z.string().nullable(),
  assignedTo: MemberRef.nullable(),
  software: BookkeepingSoftware.nullable(),
  status: BookkeepingStatus,
  statusSource: StatusSource,
  /** Why: "3 documents outstanding", "Sync failed Oct 12". */
  statusReason: z.string().nullable(),
  cadence: ReportCadence,
  syncStatus: BookkeepingSyncStatus,
  lastSyncedAt: DateTime.nullable(),
  nextReportDueOn: CalendarDate.nullable(),
  paused: z.boolean(),
});
export type BookkeepingClientRow = z.infer<typeof BookkeepingClientRow>;

export const BookkeepingClientPage = z.object({
  items: z.array(BookkeepingClientRow),
  ...Page,
  /** Counts for the tabs, under the other filters. */
  tabCounts: z.record(BookkeepingClientTab, Int),
});
export type BookkeepingClientPage = z.infer<typeof BookkeepingClientPage>;

// ---------- Client workspace ----------

export const PortalDefaults = z.strictObject({
  reports: z.boolean().optional(),
  tasks: z.boolean().optional(),
  documents: z.boolean().optional(),
  notes: z.boolean().optional(),
});
export type PortalDefaults = z.infer<typeof PortalDefaults>;

export const BookkeepingAlerts = z.strictObject({
  missingDocuments: z.boolean().optional(),
  staleSync: z.boolean().optional(),
  overdueClose: z.boolean().optional(),
  failedIntegration: z.boolean().optional(),
});
export type BookkeepingAlerts = z.infer<typeof BookkeepingAlerts>;

export const CategorizationRule = z.strictObject({
  /** Text a transaction description contains. */
  match: text(120),
  category: text(120),
});
export type CategorizationRule = z.infer<typeof CategorizationRule>;

export const BookkeepingConnection = z.object({
  id: z.uuid(),
  provider: z.string(),
  label: z.string(),
  providerCompanyId: z.string(),
  companyName: z.string().nullable(),
  status: ConnectionStatus,
  syncStatus: BookkeepingSyncStatus,
  lastSyncAt: DateTime.nullable(),
  lastSuccessfulSyncAt: DateTime.nullable(),
  /** A safe code (EXPIRED_TOKEN, RATE_LIMITED), never a message from the provider. */
  lastErrorCode: z.string().nullable(),
  connectedAt: DateTime,
  disconnectedAt: DateTime.nullable(),
});
export type BookkeepingConnection = z.infer<typeof BookkeepingConnection>;

export const BookkeepingAccount = z.object({
  id: z.uuid(),
  name: z.string(),
  type: BookkeepingAccountType,
  institution: z.string().nullable(),
  /** The last 2 to 4 characters of the account number; the number itself is never stored. */
  mask: z.string().nullable(),
  connectionId: z.uuid().nullable(),
  currency: z.string(),
  balanceCents: Int.nullable(),
  balanceAsOf: DateTime.nullable(),
  status: ConnectionStatus,
  /** A period's reconciliation needs this account. */
  reconcile: z.boolean(),
  archived: z.boolean(),
});
export type BookkeepingAccount = z.infer<typeof BookkeepingAccount>;

export const CloseProgress = z.object({
  done: Int,
  total: Int,
  requiredDone: Int,
  requiredTotal: Int,
});
export type CloseProgress = z.infer<typeof CloseProgress>;

export const BookkeepingPeriodSummary = z.object({
  id: z.uuid(),
  kind: BookkeepingPeriodKind,
  periodStart: CalendarDate,
  periodEnd: CalendarDate,
  label: z.string(),
  status: BookkeepingPeriodStatus,
  closeByOn: CalendarDate.nullable(),
  closeVersion: Int,
  /** The close is past its date and not closed. */
  overdue: z.boolean(),
  incomeCents: Int.nullable(),
  expensesCents: Int.nullable(),
  /** Income less expenses; null unless both are known. */
  netProfitCents: Int.nullable(),
  figuresSource: FiguresSource.nullable(),
  figuresAsOf: DateTime.nullable(),
  uncategorizedCount: Int.nullable(),
  progress: CloseProgress,
});
export type BookkeepingPeriodSummary = z.infer<typeof BookkeepingPeriodSummary>;

export const BookkeepingReportRow = z.object({
  id: z.uuid(),
  bookkeepingClientId: z.uuid(),
  client: BookkeepingClientRef,
  periodId: z.uuid().nullable(),
  reportType: BookkeepingReportType,
  /** The type's name, or the firm's own name for a CUSTOM one. */
  name: z.string(),
  customName: z.string().nullable(),
  periodLabel: z.string(),
  basis: AccountingBasis.nullable(),
  dueOn: CalendarDate.nullable(),
  /** Past its due date and not delivered. */
  overdue: z.boolean(),
  status: ReportReviewStatus,
  generatedAt: DateTime.nullable(),
  generatedBy: MemberRef.nullable(),
  reviewedAt: DateTime.nullable(),
  reviewedBy: MemberRef.nullable(),
  reviewNote: z.string().nullable(),
  deliveredAt: DateTime.nullable(),
  deliveredBy: MemberRef.nullable(),
  /** The published engagement report the client sees. */
  engagementReportId: z.uuid().nullable(),
});
export type BookkeepingReportRow = z.infer<typeof BookkeepingReportRow>;

export const BookkeepingActivity = z.object({
  id: z.uuid(),
  kind: BookkeepingActivityKind,
  summary: z.string(),
  actor: MemberRef.nullable(),
  createdAt: DateTime,
});
export type BookkeepingActivity = z.infer<typeof BookkeepingActivity>;

export const BookkeepingClientWorkspace = z.object({
  id: z.uuid(),
  client: BookkeepingClientRef.extend({
    email: z.string().nullable(),
    phone: z.string().nullable(),
  }),
  engagementId: z.uuid(),
  engagementStatus: z.enum(['PENDING', 'ACTIVE', 'COMPLETED', 'CANCELLED']),
  plan: z.string().nullable(),
  /** When the Bookkeeping engagement began. */
  clientSince: DateTime,
  assignedTo: MemberRef.nullable(),
  reviewer: MemberRef.nullable(),
  status: BookkeepingStatus,
  statusSource: StatusSource,
  statusReason: z.string().nullable(),
  statusChangedAt: DateTime,
  cadence: ReportCadence,
  cadenceMonths: Int.nullable(),
  /** The client's own day, else the firm's. */
  closeTargetDay: Int,
  nextReportDueOn: CalendarDate.nullable(),
  paused: z.boolean(),
  pausedAt: DateTime.nullable(),
  pauseReason: z.string().nullable(),
  archived: z.boolean(),
  portalDefaults: PortalDefaults,
  alerts: BookkeepingAlerts,
  /** null: the firm's schedule and checklist apply. */
  reportSchedule: z.array(ReportScheduleItem).nullable(),
  documentChecklist: z.array(DocumentChecklistItem).nullable(),
  categorizationRules: z.array(CategorizationRule),
  connections: z.array(BookkeepingConnection),
  accounts: z.array(BookkeepingAccount),
  /** The period being worked: the newest one not closed, else the newest. null before the first. */
  currentPeriod: BookkeepingPeriodSummary.nullable(),
  /** The latest period's figures, as entered or imported; null where none were. */
  kpis: z.object({
    incomeCents: Int.nullable(),
    expensesCents: Int.nullable(),
    netProfitCents: Int.nullable(),
    uncategorizedCount: Int.nullable(),
  }),
  /** The year to date from the periods of this year with figures; null when none have. */
  yearToDate: z
    .object({
      incomeCents: Int,
      expensesCents: Int,
      netProfitCents: Int,
      /** Expenses as a share of income to one decimal; null with no income. */
      expenseRatioPercent: z.number().nullable(),
    })
    .nullable(),
  /** The last twelve MONTH periods with figures, oldest first. */
  trend: z.array(
    z.object({ label: z.string(), month: z.string(), incomeCents: Int, expensesCents: Int }),
  ),
  upcomingReports: z.array(BookkeepingReportRow),
  /** Counts of what lives in the shared modules, with the engagementId to list them by. */
  shared: z.object({
    openTasks: Int,
    overdueTasks: Int,
    documents: Int,
    outstandingDocumentRequests: Int,
    notes: Int,
  }),
  recentActivity: z.array(BookkeepingActivity),
});
export type BookkeepingClientWorkspace = z.infer<typeof BookkeepingClientWorkspace>;

// ---------- Client requests ----------

export const AddBookkeepingClientRequest = z.strictObject({
  clientId: z.uuid(),
  plan: optionalText(80),
  cadence: ReportCadence.optional(),
  cadenceMonths: z.number().int().min(1).max(24).nullable().optional(),
  assignedUserId: z.uuid().nullable().optional(),
  reviewerUserId: z.uuid().nullable().optional(),
});
export type AddBookkeepingClientRequest = z.input<typeof AddBookkeepingClientRequest>;

export const UpdateBookkeepingClientRequest = z
  .strictObject({
    // Owner and Admin:
    cadence: ReportCadence.optional(),
    cadenceMonths: z.number().int().min(1).max(24).nullable().optional(),
    closeTargetDay: z.number().int().min(1).max(28).nullable().optional(),
    reviewerUserId: z.uuid().nullable().optional(),
    nextReportDueOn: CalendarDate.nullable().optional(),
    reportSchedule: z.array(ReportScheduleItem).max(30).nullable().optional(),
    documentChecklist: z.array(DocumentChecklistItem).max(50).nullable().optional(),
    // Staff too:
    portalDefaults: PortalDefaults.optional(),
    alerts: BookkeepingAlerts.optional(),
    categorizationRules: z.array(CategorizationRule).max(200).optional(),
  })
  .refine((b) => Object.values(b).some((v) => v !== undefined), 'Send at least one field');
export type UpdateBookkeepingClientRequest = z.input<typeof UpdateBookkeepingClientRequest>;

/** `AUTOMATIC` hands the status back to the rules; anything else is set by hand. */
export const BookkeepingStatusRequest = z.strictObject({
  status: z.union([BookkeepingStatus, z.literal('AUTOMATIC')]),
  reason: optionalText(300),
});
export type BookkeepingStatusRequest = z.input<typeof BookkeepingStatusRequest>;

export const BookkeepingPauseRequest = z.strictObject({ reason: text(500) });
export type BookkeepingPauseRequest = z.input<typeof BookkeepingPauseRequest>;

export const BookkeepingReasonRequest = z.strictObject({ reason: optionalText(500) });
export type BookkeepingReasonRequest = z.input<typeof BookkeepingReasonRequest>;

export const BookkeepingAssignRequest = z.strictObject({ assignedUserId: z.uuid().nullable() });
export type BookkeepingAssignRequest = z.input<typeof BookkeepingAssignRequest>;

export const LogBookkeepingActivityRequest = z.strictObject({
  kind: z.enum(['NOTE', 'CONTACT', 'OTHER']).optional().default('NOTE'),
  summary: text(300),
});
export type LogBookkeepingActivityRequest = z.input<typeof LogBookkeepingActivityRequest>;

export const BookkeepingActivityList = z.object({
  items: z.array(BookkeepingActivity),
  ...Page,
});
export type BookkeepingActivityList = z.infer<typeof BookkeepingActivityList>;

/** What a request to sync did: the runs are finished by the integration worker, never here. */
export const BookkeepingSyncQueued = z.object({
  queued: Int,
  requestedAt: DateTime,
});
export type BookkeepingSyncQueued = z.infer<typeof BookkeepingSyncQueued>;

export const BookkeepingStatusRefreshed = z.object({ checked: Int, changed: Int });
export type BookkeepingStatusRefreshed = z.infer<typeof BookkeepingStatusRefreshed>;

// ---------- Connections and accounts ----------

export const BookkeepingConnectionList = z.object({ items: z.array(BookkeepingConnection) });
export type BookkeepingConnectionList = z.infer<typeof BookkeepingConnectionList>;

/**
 * Maps a provider's company to this client. The provider's own sign-in (and the token it
 * returns) happens outside this API and is kept in the secret store; no token comes through here.
 */
export const ConnectBookkeepingRequest = z.strictObject({
  provider: BookkeepingProviderKey,
  /** The company's id at the provider (a realm id, an organisation id). */
  providerCompany: text(120),
  companyName: optionalText(200),
});
export type ConnectBookkeepingRequest = z.input<typeof ConnectBookkeepingRequest>;

export const UpdateBookkeepingConnectionRequest = z.strictObject({
  companyName: optionalText(200),
});
export type UpdateBookkeepingConnectionRequest = z.input<typeof UpdateBookkeepingConnectionRequest>;

export const BookkeepingSyncRun = z.object({
  id: z.uuid(),
  trigger: SyncTrigger,
  outcome: SyncOutcome,
  startedAt: DateTime,
  finishedAt: DateTime.nullable(),
  errorCode: z.string().nullable(),
  message: z.string().nullable(),
  counts: z.record(z.string(), z.number()),
  requestedBy: MemberRef.nullable(),
});
export type BookkeepingSyncRun = z.infer<typeof BookkeepingSyncRun>;

export const BookkeepingSyncRunList = z.object({ items: z.array(BookkeepingSyncRun), ...Page });
export type BookkeepingSyncRunList = z.infer<typeof BookkeepingSyncRunList>;

export const BookkeepingAccountList = z.object({ items: z.array(BookkeepingAccount) });
export type BookkeepingAccountList = z.infer<typeof BookkeepingAccountList>;

const Mask = z
  .string()
  .trim()
  .regex(/^[0-9A-Za-z]{2,4}$/, 'Use the last 2 to 4 characters');

/** An account added by hand; connected accounts come from their provider's sync. */
export const AddBookkeepingAccountRequest = z
  .strictObject({
    name: text(120),
    type: BookkeepingAccountType,
    institution: optionalText(120),
    mask: Mask.nullable().optional(),
    balanceCents: Cents.nullable().optional(),
    balanceAsOf: DateTime.nullable().optional(),
    reconcile: z.boolean().optional().default(true),
  })
  .refine((b) => (b.balanceCents === undefined || b.balanceCents === null) === !b.balanceAsOf, {
    message: 'A balance needs its date, and a date its balance',
    path: ['balanceAsOf'],
  });
export type AddBookkeepingAccountRequest = z.input<typeof AddBookkeepingAccountRequest>;

export const UpdateBookkeepingAccountRequest = z
  .strictObject({
    name: text(120).optional(),
    institution: optionalText(120),
    mask: Mask.nullable().optional(),
    balanceCents: Cents.nullable().optional(),
    balanceAsOf: DateTime.nullable().optional(),
    reconcile: z.boolean().optional(),
    archived: z.boolean().optional(),
  })
  .refine((b) => Object.values(b).some((v) => v !== undefined), 'Send at least one field')
  .refine((b) => b.balanceAsOf === undefined || b.balanceCents !== undefined, {
    message: 'Send the balance with its date',
    path: ['balanceAsOf'],
  });
export type UpdateBookkeepingAccountRequest = z.input<typeof UpdateBookkeepingAccountRequest>;

// ---------- Periods and the close ----------

export const BookkeepingPeriodsQuery = z.strictObject({
  status: BookkeepingPeriodStatus.optional(),
  year: z.coerce.number().int().min(2000).max(2100).optional(),
  ...pageQuery(24),
});
export type BookkeepingPeriodsQuery = z.input<typeof BookkeepingPeriodsQuery>;

export const BookkeepingPeriodList = z.object({
  items: z.array(BookkeepingPeriodSummary),
  ...Page,
});
export type BookkeepingPeriodList = z.infer<typeof BookkeepingPeriodList>;

/** A start and end day, a kind and, for CUSTOM, a label; the others are named from the dates. */
export const CreateBookkeepingPeriodRequest = z
  .strictObject({
    kind: BookkeepingPeriodKind.optional().default('MONTH'),
    periodStart: CalendarDate,
    periodEnd: CalendarDate,
    label: optionalText(60),
    closeByOn: CalendarDate.nullable().optional(),
  })
  .refine((b) => b.periodEnd >= b.periodStart, {
    message: 'The period cannot end before it starts',
    path: ['periodEnd'],
  })
  .refine((b) => b.kind !== 'CUSTOM' || !!b.label, {
    message: 'Name a custom period',
    path: ['label'],
  });
export type CreateBookkeepingPeriodRequest = z.input<typeof CreateBookkeepingPeriodRequest>;

const PeriodCents = z.number().int('Use whole cents').min(0).max(100_000_000_000_000);

/**
 * Figures are entered by hand (figuresSource MANUAL). Income and expenses always come together:
 * send both, or one when the other is already known; null clears both.
 */
export const UpdateBookkeepingPeriodRequest = z
  .strictObject({
    closeByOn: CalendarDate.nullable().optional(),
    incomeCents: PeriodCents.nullable().optional(),
    expensesCents: PeriodCents.nullable().optional(),
    uncategorizedCount: z.number().int().min(0).max(10_000_000).nullable().optional(),
  })
  .refine((b) => Object.values(b).some((v) => v !== undefined), 'Send at least one field');
export type UpdateBookkeepingPeriodRequest = z.input<typeof UpdateBookkeepingPeriodRequest>;

export const BookkeepingCloseItem = z.object({
  id: z.uuid(),
  itemKey: z.string(),
  label: z.string(),
  required: z.boolean(),
  position: Int,
  completed: z.boolean(),
  completedAt: DateTime.nullable(),
  completedBy: MemberRef.nullable(),
  note: z.string().nullable(),
});
export type BookkeepingCloseItem = z.infer<typeof BookkeepingCloseItem>;

export const BookkeepingReconciliation = z.object({
  id: z.uuid(),
  periodId: z.uuid(),
  account: z.object({
    id: z.uuid(),
    name: z.string(),
    type: BookkeepingAccountType,
    mask: z.string().nullable(),
  }),
  statementStart: CalendarDate,
  statementEnd: CalendarDate,
  beginningBalanceCents: Int,
  endingBalanceCents: Int,
  clearedBalanceCents: Int,
  clearedCount: Int,
  /** Ending less cleared; zero when the account is reconciled. */
  differenceCents: Int,
  toleranceCents: Int,
  /** The difference is within the tolerance: the reconciliation may be approved. */
  withinTolerance: z.boolean(),
  exceptionsCount: Int,
  statementDocumentId: z.uuid().nullable(),
  status: ReconciliationStatus,
  readyForReviewAt: DateTime.nullable(),
  approvedAt: DateTime.nullable(),
  approvedBy: MemberRef.nullable(),
  reopenedAt: DateTime.nullable(),
  reopenReason: z.string().nullable(),
  updatedAt: DateTime,
});
export type BookkeepingReconciliation = z.infer<typeof BookkeepingReconciliation>;

export const BookkeepingPeriod = BookkeepingPeriodSummary.extend({
  bookkeepingClientId: z.uuid(),
  client: BookkeepingClientRef,
  readyForReviewAt: DateTime.nullable(),
  readyForReviewBy: MemberRef.nullable(),
  approvedAt: DateTime.nullable(),
  approvedBy: MemberRef.nullable(),
  closedAt: DateTime.nullable(),
  closedBy: MemberRef.nullable(),
  reopenedAt: DateTime.nullable(),
  reopenedBy: MemberRef.nullable(),
  reopenReason: z.string().nullable(),
  /** The period's checklist, in order. */
  closeItems: z.array(BookkeepingCloseItem),
  reconciliations: z.array(BookkeepingReconciliation),
  /** Accounts marked reconcile with no reconciliation in this period yet. */
  accountsWithoutReconciliation: z.array(z.object({ id: z.uuid(), name: z.string() })),
  reports: z.array(BookkeepingReportRow),
});
export type BookkeepingPeriod = z.infer<typeof BookkeepingPeriod>;

export const UpdateBookkeepingCloseItemRequest = z
  .strictObject({
    completed: z.boolean().optional(),
    note: optionalText(500),
  })
  .refine((b) => b.completed !== undefined || b.note !== undefined, 'Send at least one field');
export type UpdateBookkeepingCloseItemRequest = z.input<typeof UpdateBookkeepingCloseItemRequest>;

export const BookkeepingReopenRequest = z.strictObject({ reason: text(500) });
export type BookkeepingReopenRequest = z.input<typeof BookkeepingReopenRequest>;

export const BookkeepingSendBackRequest = z.strictObject({ note: optionalText(1000) });
export type BookkeepingSendBackRequest = z.input<typeof BookkeepingSendBackRequest>;

// ---------- Reconciliations ----------

export const BookkeepingReconciliationList = z.object({
  items: z.array(BookkeepingReconciliation),
});
export type BookkeepingReconciliationList = z.infer<typeof BookkeepingReconciliationList>;

export const CreateBookkeepingReconciliationRequest = z
  .strictObject({
    accountId: z.uuid(),
    statementStart: CalendarDate,
    statementEnd: CalendarDate,
    beginningBalanceCents: Cents,
    endingBalanceCents: Cents,
    clearedBalanceCents: Cents.optional(),
    clearedCount: z.number().int().min(0).max(10_000_000).optional(),
    exceptionsCount: z.number().int().min(0).max(10_000_000).optional(),
    statementDocumentId: z.uuid().nullable().optional(),
  })
  .refine((b) => b.statementEnd >= b.statementStart, {
    message: 'The statement cannot end before it starts',
    path: ['statementEnd'],
  });
export type CreateBookkeepingReconciliationRequest = z.input<
  typeof CreateBookkeepingReconciliationRequest
>;

/** Save progress: whatever is sent changes; the difference is worked out, never sent. */
export const UpdateBookkeepingReconciliationRequest = z
  .strictObject({
    statementStart: CalendarDate.optional(),
    statementEnd: CalendarDate.optional(),
    beginningBalanceCents: Cents.optional(),
    endingBalanceCents: Cents.optional(),
    clearedBalanceCents: Cents.optional(),
    clearedCount: z.number().int().min(0).max(10_000_000).optional(),
    exceptionsCount: z.number().int().min(0).max(10_000_000).optional(),
    statementDocumentId: z.uuid().nullable().optional(),
  })
  .refine((b) => Object.values(b).some((v) => v !== undefined), 'Send at least one field');
export type UpdateBookkeepingReconciliationRequest = z.input<
  typeof UpdateBookkeepingReconciliationRequest
>;

// ---------- Reports ----------

export const BookkeepingReportsQuery = z.strictObject({
  status: ReportReviewStatus.optional(),
  reportType: BookkeepingReportType.optional(),
  bookkeepingClientId: z.uuid().optional(),
  periodId: z.uuid().optional(),
  dueFrom: CalendarDate.optional(),
  dueTo: CalendarDate.optional(),
  /** Not delivered yet and due within the firm's upcoming window (the Upcoming Reports tab). */
  upcoming: z.enum(['true', 'false']).optional(),
  overdue: z.enum(['true', 'false']).optional(),
  search: SearchText.optional(),
  ...pageQuery(25),
});
export type BookkeepingReportsQuery = z.input<typeof BookkeepingReportsQuery>;

export const BookkeepingReportPage = z.object({ items: z.array(BookkeepingReportRow), ...Page });
export type BookkeepingReportPage = z.infer<typeof BookkeepingReportPage>;

export const AddBookkeepingReportRequest = z
  .strictObject({
    reportType: BookkeepingReportType,
    customName: optionalText(120),
    periodLabel: text(60),
    periodId: z.uuid().nullable().optional(),
    basis: AccountingBasis.nullable().optional(),
    dueOn: CalendarDate.nullable().optional(),
  })
  .refine((b) => (b.reportType === 'CUSTOM') === !!b.customName, {
    message: 'Only a custom report has a name of its own, and it needs one',
    path: ['customName'],
  });
export type AddBookkeepingReportRequest = z.input<typeof AddBookkeepingReportRequest>;

export const UpdateBookkeepingReportRequest = z
  .strictObject({
    dueOn: CalendarDate.nullable().optional(),
    basis: AccountingBasis.nullable().optional(),
    reviewNote: optionalText(1000),
  })
  .refine((b) => Object.values(b).some((v) => v !== undefined), 'Send at least one field');
export type UpdateBookkeepingReportRequest = z.input<typeof UpdateBookkeepingReportRequest>;

/** Delivery links the published engagement report the client sees (`api.workspaces` reports). */
export const DeliverBookkeepingReportRequest = z.strictObject({ engagementReportId: z.uuid() });
export type DeliverBookkeepingReportRequest = z.input<typeof DeliverBookkeepingReportRequest>;
