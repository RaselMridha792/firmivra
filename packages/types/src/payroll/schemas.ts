import { z } from 'zod';
import { MemberRef } from '../clients/schemas.js';
import { clearable, SearchText, text } from '../clients/text.js';
import {
  PayrollActivityKind,
  PayrollClientStatus,
  PayrollFilingStatus,
  PayrollFrequency,
  PayrollIssueSeverity,
  PayrollLineStatus,
  PayrollPayType,
  PayrollPaymentStatus,
  PayrollReportKind,
  PayrollRunStatus,
  PayrollWorkerStatus,
  PayrollWorkerType,
  PayrollYearEndStatus,
} from '../db-enums.js';

// Payroll (R39 Payroll API): the firm's payroll TRACKING for its clients. Firmivra never runs
// payroll and calculates no payroll tax: every figure is empty (null, or 0 in a total) until the
// provider, an import or the preparer supplies it, and a filing is FILED or PAID only as the
// provider or an import confirmed it. Firm routes: /api/v1/business/payroll.
// - Owner and Admin reach every payroll client; Staff (and the five newer roles) only those whose
//   client is assigned to them (404 NOT_FOUND otherwise), like client records.
// - STAFF+ prepares (status, activities, workers, run lines, ready for review, sync, reports,
//   year-end). MGR (Owner, Admin) adds clients, changes plan, frequency, assignment, pause,
//   archive, approves, submits, reopens and edits settings.
// - Pay rates and run lines hold pay: they are shown to the roles that reach the client.
// Responses are plain objects; requests are strict. Money is in cents, days are `YYYY-MM-DD`.

export {
  PayrollActivityKind,
  PayrollClientStatus,
  PayrollFilingStatus,
  PayrollFrequency,
  PayrollIssueSeverity,
  PayrollLineStatus,
  PayrollPayType,
  PayrollPaymentStatus,
  PayrollReportKind,
  PayrollRunStatus,
  PayrollWorkerStatus,
  PayrollWorkerType,
  PayrollYearEndStatus,
};

const DateTime = z.iso.datetime({ offset: true });
const CalendarDate = z.iso.date();
const Cents = z.number().int().min(0).max(2_000_000_000);
const Int = z.number().int();

export const PayrollClientId = z.uuid();
export const PayrollRunId = z.uuid();
export const PayrollWorkerId = z.uuid();
export const PayrollIssueId = z.uuid();

export const PayrollOk = z.object({ ok: z.literal(true) });
export type PayrollOk = z.infer<typeof PayrollOk>;

// ---------- Providers ----------

/** The catalog keys the Payroll screens know, with the name they show. Others show their key. */
export const PAYROLL_PROVIDERS = {
  gusto: 'Gusto',
  adp: 'ADP',
  paychex: 'Paychex',
  quickbooks_payroll: 'QuickBooks Payroll',
  onpay: 'OnPay',
} as const;
export const PayrollProviderKey = z
  .string()
  .regex(/^[a-z][a-z0-9_]{1,39}$/, 'Use a provider key such as gusto');

export const PayrollProviderRef = z.object({
  key: z.string(),
  label: z.string(),
  /** An Integrations connection exists for the provider and is CONNECTED. */
  connected: z.boolean(),
});
export type PayrollProviderRef = z.infer<typeof PayrollProviderRef>;

/** From the last provider sync against the firm's staleAfterHours; never guessed. */
export const PayrollSyncStatus = z.enum(['SYNCED', 'STALE', 'NEVER', 'NOT_CONNECTED']);
export type PayrollSyncStatus = z.infer<typeof PayrollSyncStatus>;

export const PayrollClientRef = z.object({
  id: z.uuid(),
  displayName: z.string(),
  clientNumber: z.number().int(),
  accountType: z.enum(['INDIVIDUAL', 'BUSINESS']),
});
export type PayrollClientRef = z.infer<typeof PayrollClientRef>;

const Page = {
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
};
const pageQuery = (defaultSize: number) => ({
  page: z.coerce.number().int().min(1).max(100_000).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(defaultSize),
});
const Direction = z.enum(['asc', 'desc']);

// ---------- Overview ----------

export const PayrollOverviewPeriod = z.enum([
  'THIS_MONTH',
  'LAST_MONTH',
  'THIS_QUARTER',
  'THIS_YEAR',
]);
export type PayrollOverviewPeriod = z.infer<typeof PayrollOverviewPeriod>;

/** GET /business/payroll/overview. */
export const PayrollOverviewQuery = z.strictObject({
  period: PayrollOverviewPeriod.optional().default('THIS_MONTH'),
});
export type PayrollOverviewQuery = z.input<typeof PayrollOverviewQuery>;

/** A KPI card: the value, the same figure for the period before and the change (null when there is nothing to compare). */
export const PayrollKpi = z.object({
  value: Int,
  previous: Int.nullable(),
  changePercent: z.number().nullable(),
});
export type PayrollKpi = z.infer<typeof PayrollKpi>;

export const PayrollOverview = z.object({
  period: z.object({ key: PayrollOverviewPeriod, from: CalendarDate, to: CalendarDate }),
  kpis: z.object({
    /** Payroll clients that are not on hold or archived. */
    activeClients: PayrollKpi,
    /** Gross pay of runs the provider confirmed (submitted, processing or completed), by pay date. */
    totalProcessedCents: PayrollKpi,
    /** Employees the providers reported for the active clients; clients with no report add nothing. */
    totalEmployees: PayrollKpi,
    /** Runs with a pay date in the period. */
    runs: PayrollKpi,
    /** Clients in Action Required or Past Due, plus runs that need attention. */
    needAttention: PayrollKpi,
  }),
  /** Every status but Archived, zero counts included, so the donut always has its legend. */
  statusBreakdown: z.object({
    total: z.number().int(),
    items: z.array(z.object({ status: PayrollClientStatus, count: z.number().int() })),
  }),
  /** Twelve months of the period's year: confirmed gross, and taxes plus deductions where known. */
  volume: z.array(
    z.object({
      month: z.string().regex(/^\d{4}-\d{2}$/),
      grossCents: Int,
      taxesAndDeductionsCents: Int,
    }),
  ),
  byProvider: z.object({
    totalCents: Int,
    items: z.array(
      z.object({
        key: z.string().nullable(),
        label: z.string(),
        grossCents: Int,
        sharePercent: z.number(),
      }),
    ),
  }),
  providers: z.array(
    z.object({
      key: z.string().nullable(),
      label: z.string(),
      clientCount: z.number().int(),
      connected: z.boolean(),
    }),
  ),
  upcomingRuns: z.array(
    z.object({
      payrollClientId: z.uuid(),
      clientName: z.string(),
      frequency: PayrollFrequency.nullable(),
      nextPayrollOn: CalendarDate,
    }),
  ),
});
export type PayrollOverview = z.infer<typeof PayrollOverview>;

// ---------- Payroll clients ----------

export const PayrollClientTab = z.enum([
  'ALL',
  'ON_TRACK',
  'PROCESSING',
  'ACTION_REQUIRED',
  'PAST_DUE',
  'NOT_STARTED',
  /** Clients with a next payroll date today or later, soonest first. */
  'UPCOMING',
]);
export type PayrollClientTab = z.infer<typeof PayrollClientTab>;

export const PayrollClientSort = z.enum([
  'clientName',
  'provider',
  'frequency',
  'employees',
  'status',
  'nextPayrollOn',
  'lastRunOn',
]);

/** GET /business/payroll/clients (and /export, which ignores page and pageSize). */
export const PayrollClientsQuery = z.strictObject({
  tab: PayrollClientTab.optional().default('ALL'),
  clientType: z.enum(['INDIVIDUAL', 'BUSINESS']).optional(),
  providerKey: PayrollProviderKey.optional(),
  frequency: PayrollFrequency.optional(),
  status: PayrollClientStatus.optional(),
  assignedUserId: z.uuid().optional(),
  syncStatus: PayrollSyncStatus.optional(),
  nextFrom: CalendarDate.optional(),
  nextTo: CalendarDate.optional(),
  /** Client name, email or client number (CL-10001). */
  search: SearchText.optional(),
  /** Archived clients show only when asked for (status=ARCHIVED). */
  sort: PayrollClientSort.optional().default('clientName'),
  direction: Direction.optional().default('asc'),
  ...pageQuery(10),
});
export type PayrollClientsQuery = z.input<typeof PayrollClientsQuery>;

export const PayrollClientRow = z.object({
  id: z.uuid(),
  client: PayrollClientRef,
  engagementId: z.uuid(),
  provider: PayrollProviderRef.nullable(),
  frequency: PayrollFrequency.nullable(),
  /** As the provider reported it; null until then. */
  employeeCount: z.number().int().nullable(),
  status: PayrollClientStatus,
  nextPayrollOn: CalendarDate.nullable(),
  nextPayrollSource: z.enum(['provider', 'schedule']).nullable(),
  lastRunOn: CalendarDate.nullable(),
  syncStatus: PayrollSyncStatus,
  lastSyncedAt: DateTime.nullable(),
  assignedTo: MemberRef.nullable(),
});
export type PayrollClientRow = z.infer<typeof PayrollClientRow>;

export const PayrollClientPage = z.object({
  items: z.array(PayrollClientRow).max(100),
  ...Page,
  /** Counts for the tabs, over the same filters but the tab. */
  tabCounts: z.record(PayrollClientTab, z.number().int()),
});
export type PayrollClientPage = z.infer<typeof PayrollClientPage>;

/** POST /business/payroll/clients (MGR): adds an existing client to payroll; makes the PAYROLL engagement when there is none. */
export const AddPayrollClientRequest = z.strictObject({
  clientId: z.uuid(),
  frequency: PayrollFrequency.optional(),
  providerKey: PayrollProviderKey.optional(),
  industry: text(100).optional(),
  assignedUserId: z.uuid().optional(),
  serviceSince: CalendarDate.optional(),
});
export type AddPayrollClientRequest = z.input<typeof AddPayrollClientRequest>;

const WorkerCounts = z.object({
  fullTime: z.number().int(),
  partTime: z.number().int(),
  contractors: z.number().int(),
  onLeave: z.number().int(),
});

/** One run's figures as the screens show them; every amount is null until supplied. */
export const PayrollRunFigures = z.object({
  employeeCount: z.number().int().nullable(),
  regularPayCents: Int.nullable(),
  overtimePayCents: Int.nullable(),
  otherEarningsCents: Int.nullable(),
  grossCents: Int.nullable(),
  employeeTaxesCents: Int.nullable(),
  deductionsCents: Int.nullable(),
  netCents: Int.nullable(),
  employerTaxesCents: Int.nullable(),
  employerBenefitsCents: Int.nullable(),
  employerCostsCents: Int.nullable(),
  totalCostCents: Int.nullable(),
  /** True once the provider confirmed them. */
  confirmed: z.boolean(),
});
export type PayrollRunFigures = z.infer<typeof PayrollRunFigures>;

export const PayrollRunRow = z.object({
  id: z.uuid(),
  payrollClientId: z.uuid(),
  clientName: z.string(),
  periodStart: CalendarDate,
  periodEnd: CalendarDate,
  payDate: CalendarDate,
  frequency: PayrollFrequency,
  status: PayrollRunStatus,
  step: z.number().int(),
  employeeCount: z.number().int().nullable(),
  /** The run's total payroll cost when known, else null. */
  totalCostCents: Int.nullable(),
  grossCents: Int.nullable(),
  providerStatus: z.string().nullable(),
});
export type PayrollRunRow = z.infer<typeof PayrollRunRow>;

/** GET /business/payroll/clients/{id}: the Client Payroll Workspace header and Overview tab. */
export const PayrollClientWorkspace = z.object({
  id: z.uuid(),
  client: PayrollClientRef,
  engagementId: z.uuid(),
  /** The engagement's package, i.e. the payroll plan. */
  plan: z.string().nullable(),
  status: PayrollClientStatus,
  frequency: PayrollFrequency.nullable(),
  industry: z.string().nullable(),
  provider: PayrollProviderRef.nullable(),
  serviceSince: CalendarDate.nullable(),
  nextPayrollOn: CalendarDate.nullable(),
  nextPayrollSource: z.enum(['provider', 'schedule']).nullable(),
  lastRunOn: CalendarDate.nullable(),
  lastSyncedAt: DateTime.nullable(),
  lastSyncAttemptAt: DateTime.nullable(),
  syncStatus: PayrollSyncStatus,
  assignedTo: MemberRef.nullable(),
  pausedAt: DateTime.nullable(),
  archivedAt: DateTime.nullable(),
  /** The provider's count and when it said so; null until then. */
  employeeCount: z.number().int().nullable(),
  employeeCountAt: DateTime.nullable(),
  /** Counted from the workers listed here (active and on leave). */
  workers: WorkerCounts,
  /** The run being prepared, else the next one not started. */
  currentRun: PayrollRunRow.nullable(),
  /** The newest COMPLETED run's figures and the change against the one before it (null when none). */
  latestRun: z
    .object({
      run: PayrollRunRow,
      figures: PayrollRunFigures,
      changeVsPrevious: z.object({
        grossPercent: z.number().nullable(),
        taxesPercent: z.number().nullable(),
        netPercent: z.number().nullable(),
      }),
    })
    .nullable(),
  /** Runs not yet COMPLETED, soonest pay date first (up to 5). */
  upcomingRuns: z.array(PayrollRunRow),
  recentWorkers: z.array(z.lazy(() => PayrollWorker)),
  openRunIssues: z.number().int(),
  /** Tasks, notes, documents and messages are the existing modules', by this engagement. */
  createdAt: DateTime,
});
export type PayrollClientWorkspace = z.infer<typeof PayrollClientWorkspace>;

/**
 * PATCH /business/payroll/clients/{id}: industry (STAFF+); providerKey, frequency, assignedUserId
 * and nextPayrollOn (MGR; 403 FORBIDDEN otherwise). `null` clears. `nextPayrollOn` is the
 * firm's schedule date (source "schedule"); a provider date replaces it at the next sync.
 */
export const UpdatePayrollClientRequest = z
  .strictObject({
    industry: clearable(text(100)),
    providerKey: PayrollProviderKey.nullable().optional(),
    frequency: PayrollFrequency.nullable().optional(),
    assignedUserId: z.uuid().nullable().optional(),
    nextPayrollOn: CalendarDate.nullable().optional(),
  })
  .refine((o) => Object.keys(o).length > 0, 'Change at least one field');
export type UpdatePayrollClientRequest = z.input<typeof UpdatePayrollClientRequest>;

/** The statuses staff set by hand; On Hold and Archived have their own actions. */
export const PayrollManualStatus = z.enum([
  'ON_TRACK',
  'PROCESSING',
  'ACTION_REQUIRED',
  'PAST_DUE',
  'NOT_STARTED',
]);
export const PayrollStatusRequest = z.strictObject({
  status: PayrollManualStatus,
  reason: text(500, 'many').optional(),
});
export type PayrollStatusRequest = z.input<typeof PayrollStatusRequest>;

export const PayrollReasonRequest = z.strictObject({ reason: text(500, 'many').optional() });
export type PayrollReasonRequest = z.input<typeof PayrollReasonRequest>;

export const PayrollRemoveServiceRequest = z.strictObject({ reason: text(500, 'many') });
export type PayrollRemoveServiceRequest = z.input<typeof PayrollRemoveServiceRequest>;

export const PayrollAssignRequest = z.strictObject({ assignedUserId: z.uuid().nullable() });
export type PayrollAssignRequest = z.input<typeof PayrollAssignRequest>;

export const PayrollFrequencyRequest = z.strictObject({ frequency: PayrollFrequency });
export type PayrollFrequencyRequest = z.input<typeof PayrollFrequencyRequest>;

/** The payroll plan is the engagement's package name. */
export const PayrollPlanRequest = z.strictObject({ plan: text(100).nullable() });
export type PayrollPlanRequest = z.input<typeof PayrollPlanRequest>;

/** POST /clients/{id}/sync: queued, not run. 409 PROVIDER_NOT_CONNECTED without a connection. */
export const PayrollSyncQueued = z.object({ queued: z.literal(true), requestedAt: DateTime });
export type PayrollSyncQueued = z.infer<typeof PayrollSyncQueued>;

// ---------- Service history and activities ----------

export const PayrollClientChange = z.object({
  id: z.uuid(),
  field: z.string(),
  oldValue: z.string().nullable(),
  newValue: z.string().nullable(),
  reason: z.string().nullable(),
  changedBy: MemberRef.nullable(),
  changedAt: DateTime,
});
export type PayrollClientChange = z.infer<typeof PayrollClientChange>;

export const PayrollChangeList = z.object({
  items: z.array(PayrollClientChange).max(100),
  ...Page,
});
export type PayrollChangeList = z.infer<typeof PayrollChangeList>;

export const PayrollListQuery = z.strictObject({ ...pageQuery(20) });
export type PayrollListQuery = z.input<typeof PayrollListQuery>;

export const PayrollActivity = z.object({
  id: z.uuid(),
  kind: PayrollActivityKind,
  summary: z.string(),
  occurredAt: DateTime,
  loggedBy: MemberRef.nullable(),
});
export type PayrollActivity = z.infer<typeof PayrollActivity>;

export const PayrollActivityList = z.object({ items: z.array(PayrollActivity).max(100), ...Page });
export type PayrollActivityList = z.infer<typeof PayrollActivityList>;

/** The summary never holds pay, SSNs or bank details. */
export const LogPayrollActivityRequest = z.strictObject({
  kind: PayrollActivityKind,
  summary: text(1_000, 'many'),
  occurredAt: DateTime.optional(),
});
export type LogPayrollActivityRequest = z.input<typeof LogPayrollActivityRequest>;

// ---------- Workers ----------

export const PayrollWorkerTab = z.enum([
  'ALL',
  'FULL_TIME',
  'PART_TIME',
  'ON_LEAVE',
  'CONTRACTORS',
]);
export type PayrollWorkerTab = z.infer<typeof PayrollWorkerTab>;

export const PayrollWorkersQuery = z.strictObject({
  tab: PayrollWorkerTab.optional().default('ALL'),
  /** Left out, Inactive workers stay out of the tabs; ask for them with status=INACTIVE. */
  status: PayrollWorkerStatus.optional(),
  search: SearchText.optional(),
  ...pageQuery(25),
});
export type PayrollWorkersQuery = z.input<typeof PayrollWorkersQuery>;

/** A worker without SSN, bank or address: those stay at the provider. */
export const PayrollWorker = z.object({
  id: z.uuid(),
  displayName: z.string(),
  workerType: PayrollWorkerType,
  status: PayrollWorkerStatus,
  payType: PayrollPayType.nullable(),
  /** Per hour, or per year for a salary. */
  rateCents: Int.nullable(),
  department: z.string().nullable(),
  jobTitle: z.string().nullable(),
  startedOn: CalendarDate.nullable(),
  directDepositReady: z.boolean().nullable(),
  source: z.enum(['provider', 'import', 'manual']),
  lastChangeAt: DateTime.nullable(),
  lastChangeNote: z.string().nullable(),
});
export type PayrollWorker = z.infer<typeof PayrollWorker>;

export const PayrollWorkerList = z.object({
  items: z.array(PayrollWorker).max(100),
  ...Page,
  tabCounts: z.record(PayrollWorkerTab, z.number().int()),
});
export type PayrollWorkerList = z.infer<typeof PayrollWorkerList>;

const workerFields = {
  displayName: text(200),
  workerType: PayrollWorkerType,
  status: PayrollWorkerStatus,
  payType: PayrollPayType.nullable(),
  rateCents: Cents.nullable(),
  department: clearable(text(100)),
  jobTitle: clearable(text(100)),
  startedOn: CalendarDate.nullable(),
  directDepositReady: z.boolean().nullable(),
};

/** A rate needs a pay type (409-free: 400 VALIDATION_FAILED). Added by hand: source "manual". */
export const CreatePayrollWorkerRequest = z
  .strictObject({
    ...workerFields,
    status: workerFields.status.optional().default('ACTIVE'),
    payType: workerFields.payType.optional(),
    rateCents: workerFields.rateCents.optional(),
    startedOn: workerFields.startedOn.optional(),
    directDepositReady: workerFields.directDepositReady.optional(),
    changeNote: text(300).optional(),
  })
  .refine((o) => o.rateCents == null || o.payType != null, {
    message: 'Choose a pay type for the rate',
    path: ['payType'],
  });
export type CreatePayrollWorkerRequest = z.input<typeof CreatePayrollWorkerRequest>;

/** Send only what changes. A worker is made Inactive, never deleted. */
export const UpdatePayrollWorkerRequest = z
  .strictObject({
    displayName: workerFields.displayName.optional(),
    workerType: workerFields.workerType.optional(),
    status: workerFields.status.optional(),
    payType: workerFields.payType.optional(),
    rateCents: workerFields.rateCents.optional(),
    department: workerFields.department,
    jobTitle: workerFields.jobTitle,
    startedOn: workerFields.startedOn.optional(),
    directDepositReady: workerFields.directDepositReady.optional(),
    changeNote: text(300).optional(),
  })
  .refine((o) => Object.keys(o).length > 0, 'Change at least one field');
export type UpdatePayrollWorkerRequest = z.input<typeof UpdatePayrollWorkerRequest>;

// ---------- Runs ----------

export const PayrollRunsQuery = z.strictObject({
  status: PayrollRunStatus.optional(),
  payrollClientId: z.uuid().optional(),
  payFrom: CalendarDate.optional(),
  payTo: CalendarDate.optional(),
  /** Runs not yet COMPLETED, soonest pay date first (the "Upcoming Payroll Runs" list). */
  upcoming: z.coerce.boolean().optional(),
  ...pageQuery(20),
});
export type PayrollRunsQuery = z.input<typeof PayrollRunsQuery>;

export const PayrollRunPage = z.object({ items: z.array(PayrollRunRow).max(100), ...Page });
export type PayrollRunPage = z.infer<typeof PayrollRunPage>;

/** POST /clients/{id}/runs: a run for one pay period. Lines are made for the active workers. */
export const CreatePayrollRunRequest = z
  .strictObject({
    periodStart: CalendarDate,
    periodEnd: CalendarDate,
    payDate: CalendarDate,
    frequency: PayrollFrequency.optional(),
    includeContractors: z.boolean().optional().default(true),
    /** False only schedules the period (Not Started); true (default) starts preparing it. */
    start: z.boolean().optional().default(true),
  })
  .refine((o) => o.periodEnd >= o.periodStart, {
    message: 'The period must end on or after its start',
    path: ['periodEnd'],
  });
export type CreatePayrollRunRequest = z.input<typeof CreatePayrollRunRequest>;

/** The wizard's summary: figures from the lines now, tax and employer costs only as supplied. */
export const PayrollRun = z.object({
  id: z.uuid(),
  payrollClientId: z.uuid(),
  client: PayrollClientRef,
  provider: PayrollProviderRef.nullable(),
  periodStart: CalendarDate,
  periodEnd: CalendarDate,
  payDate: CalendarDate,
  frequency: PayrollFrequency,
  status: PayrollRunStatus,
  step: z.number().int(),
  includeContractors: z.boolean(),
  providerStatus: z.string().nullable(),
  providerConfirmation: z.string().nullable(),
  figures: PayrollRunFigures,
  /** Lines by status, for the "errors, warnings, pending changes" cards. */
  lineCounts: z.object({
    total: z.number().int(),
    ready: z.number().int(),
    warning: z.number().int(),
    error: z.number().int(),
    pendingChange: z.number().int(),
    excluded: z.number().int(),
  }),
  /** Unresolved issues by severity. */
  issueCounts: z.object({
    info: z.number().int(),
    warning: z.number().int(),
    error: z.number().int(),
  }),
  preparedBy: MemberRef.nullable(),
  readyAt: DateTime.nullable(),
  approvedAt: DateTime.nullable(),
  approvedBy: MemberRef.nullable(),
  submittedAt: DateTime.nullable(),
  submittedBy: MemberRef.nullable(),
  reopenedAt: DateTime.nullable(),
  reopenReason: z.string().nullable(),
  completedAt: DateTime.nullable(),
  /** What the caller can do next, from the run's state and role. */
  actions: z.object({
    canEdit: z.boolean(),
    canMarkReady: z.boolean(),
    canApprove: z.boolean(),
    canSubmit: z.boolean(),
    canReopen: z.boolean(),
  }),
  /** The client's last three completed runs. */
  recentRuns: z.array(PayrollRunRow),
  createdAt: DateTime,
  updatedAt: DateTime,
});
export type PayrollRun = z.infer<typeof PayrollRun>;

/**
 * PATCH /runs/{id}: wizard steps 1 to 4, only while the run is being prepared (a run keeps its
 * period: the database refuses to move it). Tax and employer
 * figures are what the provider's report says (cents); Firmivra calculates none. Gross, net,
 * employer costs and total cost follow from the lines and these.
 */
export const UpdatePayrollRunRequest = z
  .strictObject({
    step: z.number().int().min(1).max(5).optional(),
    payDate: CalendarDate.optional(),
    frequency: PayrollFrequency.optional(),
    includeContractors: z.boolean().optional(),
    employeeTaxesCents: Cents.nullable().optional(),
    employerTaxesCents: Cents.nullable().optional(),
    employerBenefitsCents: Cents.nullable().optional(),
  })
  .refine((o) => Object.keys(o).length > 0, 'Change at least one field');
export type UpdatePayrollRunRequest = z.input<typeof UpdatePayrollRunRequest>;

export const PayrollLinesQuery = z.strictObject({
  tab: z
    .enum(['ALL', 'FULL_TIME', 'PART_TIME', 'ON_LEAVE', 'CONTRACTORS'])
    .optional()
    .default('ALL'),
  status: PayrollLineStatus.optional(),
  search: SearchText.optional(),
  ...pageQuery(25),
});
export type PayrollLinesQuery = z.input<typeof PayrollLinesQuery>;

export const PayrollRunLine = z.object({
  id: z.uuid(),
  worker: z.object({
    id: z.uuid(),
    displayName: z.string(),
    workerType: PayrollWorkerType,
    status: PayrollWorkerStatus,
    payType: PayrollPayType.nullable(),
    rateCents: Int.nullable(),
  }),
  hours: z.number(),
  regularPayCents: Int,
  overtimePayCents: Int,
  otherEarningsCents: Int,
  deductionsCents: Int,
  /** Regular plus overtime plus other earnings, less deductions. */
  totalPayCents: Int,
  status: PayrollLineStatus,
  note: z.string().nullable(),
});
export type PayrollRunLine = z.infer<typeof PayrollRunLine>;

export const PayrollLineList = z.object({
  items: z.array(PayrollRunLine).max(100),
  ...Page,
  tabCounts: z.record(
    z.enum(['ALL', 'FULL_TIME', 'PART_TIME', 'ON_LEAVE', 'CONTRACTORS']),
    z.number().int(),
  ),
});
export type PayrollLineList = z.infer<typeof PayrollLineList>;

/**
 * PUT /runs/{id}/lines: sets the lines of the listed workers (only while the run is being
 * prepared; workers of this payroll client only). A line's total is computed, not sent.
 */
export const SavePayrollLinesRequest = z.strictObject({
  lines: z
    .array(
      z.strictObject({
        workerId: z.uuid(),
        hours: z.number().min(0).max(999.99),
        regularPayCents: Cents,
        overtimePayCents: Cents.optional().default(0),
        otherEarningsCents: Cents.optional().default(0),
        deductionsCents: Cents.optional().default(0),
        status: PayrollLineStatus.optional(),
        note: clearable(text(300)),
      }),
    )
    .min(1)
    .max(500),
});
export type SavePayrollLinesRequest = z.input<typeof SavePayrollLinesRequest>;

export const PayrollIssue = z.object({
  id: z.uuid(),
  severity: PayrollIssueSeverity,
  code: z.string(),
  message: z.string(),
  workerId: z.uuid().nullable(),
  workerName: z.string().nullable(),
  resolvedAt: DateTime.nullable(),
  resolvedBy: MemberRef.nullable(),
  createdAt: DateTime,
});
export type PayrollIssue = z.infer<typeof PayrollIssue>;

export const PayrollIssuesQuery = z.strictObject({
  severity: PayrollIssueSeverity.optional(),
  /** `true` lists unresolved issues only, `false` resolved only. */
  open: z.enum(['true', 'false']).optional(),
});
export type PayrollIssuesQuery = z.input<typeof PayrollIssuesQuery>;

export const PayrollIssueList = z.object({ items: z.array(PayrollIssue).max(200) });
export type PayrollIssueList = z.infer<typeof PayrollIssueList>;

export const ResolvePayrollIssueRequest = z.strictObject({ resolved: z.boolean() });
export type ResolvePayrollIssueRequest = z.input<typeof ResolvePayrollIssueRequest>;

/** POST /runs/{id}/{ready,approve}: no body. */
export const PayrollEmptyRequest = z.strictObject({});

/** POST /runs/{id}/submit (MGR): record that the provider took it, with the provider's reference. */
export const SubmitPayrollRunRequest = z.strictObject({
  providerConfirmation: text(100),
  providerStatus: z
    .string()
    .regex(/^[a-z][a-z0-9_]{0,59}$/)
    .optional(),
});
export type SubmitPayrollRunRequest = z.input<typeof SubmitPayrollRunRequest>;

/** POST /runs/{id}/complete (MGR): the provider finished the run. */
export const CompletePayrollRunRequest = z.strictObject({
  providerStatus: z
    .string()
    .regex(/^[a-z][a-z0-9_]{0,59}$/)
    .optional(),
});
export type CompletePayrollRunRequest = z.input<typeof CompletePayrollRunRequest>;

export const ReopenPayrollRunRequest = z.strictObject({ reason: text(500, 'many') });
export type ReopenPayrollRunRequest = z.input<typeof ReopenPayrollRunRequest>;

// ---------- Filings, reports and year-end ----------

export const PayrollFilingsQuery = z.strictObject({
  status: PayrollFilingStatus.optional(),
  year: z.coerce.number().int().min(2000).max(2100).optional(),
});
export type PayrollFilingsQuery = z.input<typeof PayrollFilingsQuery>;

/** Only what the provider or an import confirmed; otherwise UNKNOWN. Nothing is inferred from tasks. */
export const PayrollFiling = z.object({
  id: z.uuid(),
  form: z.string(),
  jurisdiction: z.string(),
  periodStart: CalendarDate,
  periodEnd: CalendarDate,
  dueOn: CalendarDate.nullable(),
  status: PayrollFilingStatus,
  paymentStatus: PayrollPaymentStatus,
  confirmationRef: z.string().nullable(),
  source: z.enum(['provider', 'import']).nullable(),
  sourceSyncedAt: DateTime.nullable(),
  confirmedAt: DateTime.nullable(),
});
export type PayrollFiling = z.infer<typeof PayrollFiling>;

export const PayrollFilingList = z.object({
  items: z.array(PayrollFiling).max(500),
  counts: z.object({
    upcoming: z.number().int(),
    filed: z.number().int(),
    needsAttention: z.number().int(),
  }),
});
export type PayrollFilingList = z.infer<typeof PayrollFilingList>;

export const PayrollReportsQuery = z.strictObject({
  kind: PayrollReportKind.optional(),
  runId: z.uuid().optional(),
  ...pageQuery(20),
});
export type PayrollReportsQuery = z.input<typeof PayrollReportsQuery>;

export const PayrollReport = z.object({
  id: z.uuid(),
  kind: PayrollReportKind,
  runId: z.uuid().nullable(),
  periodStart: CalendarDate,
  periodEnd: CalendarDate,
  version: z.number().int(),
  documentId: z.uuid().nullable(),
  source: z.enum(['provider', 'import']),
  pulledAt: DateTime,
  requestedBy: MemberRef.nullable(),
});
export type PayrollReport = z.infer<typeof PayrollReport>;

export const PayrollReportList = z.object({ items: z.array(PayrollReport).max(100), ...Page });
export type PayrollReportList = z.infer<typeof PayrollReportList>;

/**
 * POST /clients/{id}/reports: adds a report the provider supplied, as a file already in the
 * firm's document vault (documentId). Each add is a new version; earlier ones stay. Reports are
 * recorded as imports: no provider pull exists yet.
 */
export const AddPayrollReportRequest = z
  .strictObject({
    kind: PayrollReportKind,
    periodStart: CalendarDate,
    periodEnd: CalendarDate,
    runId: z.uuid().optional(),
    documentId: z.uuid(),
  })
  .refine((o) => o.periodEnd >= o.periodStart, {
    message: 'The period must end on or after its start',
    path: ['periodEnd'],
  });
export type AddPayrollReportRequest = z.input<typeof AddPayrollReportRequest>;

export const PAYROLL_YEAR_END_STEPS = [
  'WORKER_REVIEW',
  'MISSING_INFORMATION',
  'W2_W3',
  'FORM_1099',
  'RECONCILIATION',
  'CLIENT_DELIVERY',
] as const;
export const PayrollYearEndStep = z.enum(PAYROLL_YEAR_END_STEPS);
export const PayrollYearEndStepState = z.enum(['NOT_STARTED', 'IN_PROGRESS', 'DONE']);
export type PayrollYearEndStepState = z.infer<typeof PayrollYearEndStepState>;

export const PayrollYearEndQuery = z.strictObject({
  taxYear: z.coerce.number().int().min(2000).max(2100).optional(),
});
export type PayrollYearEndQuery = z.input<typeof PayrollYearEndQuery>;

/** The year-end checklist; with no work recorded yet every step is NOT_STARTED. */
export const PayrollYearEnd = z.object({
  taxYear: z.number().int(),
  status: PayrollYearEndStatus,
  items: z.array(z.object({ step: PayrollYearEndStep, state: PayrollYearEndStepState })),
  exceptionsNote: z.string().nullable(),
  reconciledAt: DateTime.nullable(),
  deliveredAt: DateTime.nullable(),
  deliveredBy: MemberRef.nullable(),
  updatedAt: DateTime.nullable(),
});
export type PayrollYearEnd = z.infer<typeof PayrollYearEnd>;

/**
 * PUT /clients/{id}/year-end/{taxYear}: sets the listed steps. The status follows: RECONCILED
 * when RECONCILIATION is DONE, DELIVERED when CLIENT_DELIVERY is also DONE (needs RECONCILIATION).
 */
export const SavePayrollYearEndRequest = z
  .strictObject({
    items: z
      .array(z.strictObject({ step: PayrollYearEndStep, state: PayrollYearEndStepState }))
      .max(PAYROLL_YEAR_END_STEPS.length)
      .optional(),
    exceptionsNote: clearable(text(1_000, 'many')),
  })
  .refine((o) => o.items !== undefined || o.exceptionsNote !== undefined, 'Change something');
export type SavePayrollYearEndRequest = z.input<typeof SavePayrollYearEndRequest>;

// ---------- Settings ----------

/** GET / PUT /business/payroll/settings (MGR). The defaults show until the firm saves its own. */
export const PayrollSettings = z.object({
  defaultAssignee: MemberRef.nullable(),
  reminderDaysBefore: z.number().int(),
  staleAfterHours: z.number().int(),
  updatedAt: DateTime.nullable(),
});
export type PayrollSettings = z.infer<typeof PayrollSettings>;

export const SavePayrollSettingsRequest = z.strictObject({
  defaultAssigneeId: z.uuid().nullable(),
  reminderDaysBefore: z.number().int().min(0).max(30),
  staleAfterHours: z.number().int().min(1).max(720),
});
export type SavePayrollSettingsRequest = z.input<typeof SavePayrollSettingsRequest>;

export const PayrollErrorCode = z.enum([
  /** 409: the client is already a payroll client. */
  'ALREADY_PAYROLL_CLIENT',
  /** 409: the firm has no active Payroll service in its catalog to attach the client to. */
  'NO_PAYROLL_SERVICE',
  /** 409: the assignee is not an active member of the firm. */
  'NOT_A_MEMBER',
  /** 409: the assignee is Staff and this client is not assigned to them. */
  'CLIENT_NOT_ASSIGNED',
  /** 409: the action needs the provider connected (sync). */
  'PROVIDER_NOT_CONNECTED',
  /** 409: the client has no pay frequency yet. */
  'FREQUENCY_REQUIRED',
  /** 409: a run for this period already exists. */
  'RUN_EXISTS',
  /** 409: the run's state does not allow this action (also the database's PAYROLL_RUN_STATUS, PAYROLL_RUN_LOCKED, PAYROLL_RUN_COMPLETED). */
  'RUN_STATE',
  /** 409: errors must be resolved before approving (the database's PAYROLL_RUN_BLOCKED). */
  'RUN_BLOCKED',
  /** 409: a run with no lines is not marked ready. */
  'RUN_EMPTY',
  /** 409: the service is paused, archived or not in a state that allows it. */
  'CLIENT_STATE',
  /** 409: the worker or the document is not this payroll client's or this firm's. */
  'NOT_THIS_CLIENTS',
  /** 409: the same report, form or period is already recorded. */
  'DUPLICATE',
]);
export type PayrollErrorCode = z.infer<typeof PayrollErrorCode>;
