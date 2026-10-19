import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import type {
  ReportCatalogItem,
  ReportCategory,
  ReportCompareTo,
  ReportDatePreset,
  ReportDefinitionView,
  ReportErrorCode,
} from '@firmivra/types';
import { isGridFirmRole, roleCan } from '@firmivra/types';
import type { TenantContext } from '../common/request-context.js';
import type { Filters } from './engine.js';

const refusal = (code: ReportErrorCode, message: string) =>
  new ConflictException({ code, message });

export const reportErrors = {
  duplicateName: () => refusal('DUPLICATE_NAME', 'A saved report with this name already exists'),
  saveConflict: () =>
    refusal('SAVE_CONFLICT', 'Someone saved this after you opened it. Reload and try again.'),
  archived: () => refusal('REPORT_ARCHIVED', 'Restore the report before changing it'),
  notAMember: () => refusal('NOT_A_MEMBER', 'That person is not a member of the firm'),
  recipientNotAllowed: (message: string) => refusal('RECIPIENT_NOT_ALLOWED', message),
  runNotReady: () => refusal('RUN_NOT_READY', 'The file is not ready yet'),
  invalidDefinition: (details: { path: string; message: string }[]) =>
    new BadRequestException({
      code: 'INVALID_DEFINITION',
      message: 'The report is not valid for its data source',
      details,
    }),
  invalidRange: (message: string) => new BadRequestException({ code: 'INVALID_RANGE', message }),
  fieldNotAllowed: (fields: string[]) =>
    new ForbiddenException({
      code: 'FIELD_NOT_ALLOWED',
      message: 'You do not have access to some of these fields',
      details: fields.map((f) => ({ path: f, message: 'Restricted' })),
    }),
  exportNotAllowed: () =>
    new ForbiddenException({ code: 'EXPORT_NOT_ALLOWED', message: 'You may not export reports' }),
  notTheOwner: () =>
    new ForbiddenException({
      code: 'NOT_THE_OWNER',
      message: 'Only its owner, an Owner or an Admin can change this',
    }),
  forbidden: () =>
    new ForbiddenException({ code: 'FORBIDDEN', message: 'You do not have access to this action' }),
  invalid: (path: string, message: string) =>
    new BadRequestException({
      code: 'VALIDATION_FAILED',
      message: 'The request is not valid',
      details: [{ path, message }],
    }),
};

export type Role = 'OWNER' | 'ADMIN' | 'STAFF';
const isAdminTenant = (t: TenantContext | undefined) =>
  t?.kind === 'staff' && (t.role === 'OWNER' || t.role === 'ADMIN');
const grid = (t: TenantContext | undefined, cap: 'MANAGE' | 'CREATE' | 'EDIT' | 'EXPORT') =>
  t?.kind === 'staff' && isGridFirmRole(t.role) && roleCan(t.role, 'REPORTS', cap);

/** Owner and Admin, or a grid role with Manage on Reports: money and team data, sensitive fields. */
export const canSeeRestricted = (t: TenantContext | undefined) =>
  isAdminTenant(t) || grid(t, 'MANAGE');
/** Saving, scheduling and changing reports. */
export const canWrite = (t: TenantContext | undefined) =>
  isAdminTenant(t) || grid(t, 'CREATE') || grid(t, 'EDIT') || grid(t, 'MANAGE');
export const canExport = (t: TenantContext | undefined) =>
  isAdminTenant(t) || grid(t, 'EXPORT') || grid(t, 'MANAGE');
export const isAdmin = isAdminTenant;

export function requireWrite(t: TenantContext | undefined): void {
  if (!canWrite(t)) throw reportErrors.forbidden();
}

export const CATEGORY_LABELS: Record<ReportCategory, string> = {
  FINANCIAL: 'Financial Reports',
  CLIENT: 'Client Reports',
  TAX: 'Tax Reports',
  BOOKKEEPING: 'Bookkeeping Reports',
  PAYROLL: 'Payroll Reports',
  LEADS: 'Lead Reports',
  COMMUNICATIONS: 'Communication Reports',
  TEAM_PRODUCTIVITY: 'Team Productivity',
  ADVISORY: 'Advisory Reports',
};

// ---------- The built-in quick reports (system definitions in code) ----------

export const EMPTY_FILTERS: Filters = { logic: 'AND', conditions: [], groups: [] };

interface SystemDef extends ReportCatalogItem {
  definition: Omit<ReportDefinitionView, 'date' | 'category' | 'dataSource'> & {
    date?: ReportDefinitionView['date'];
  };
}

const base = {
  filters: EMPTY_FILTERS,
  groupBy: null,
  sortBy: null,
  sortDescending: false,
  showTotals: false,
  showPercentage: false,
  compareTo: 'NONE' as ReportCompareTo,
  chartType: 'AUTO' as const,
  showDataLabels: false,
  includeTaxRevenue: false,
};

export const SYSTEM_REPORTS: readonly SystemDef[] = [
  {
    key: 'revenue_summary',
    name: 'Revenue Summary',
    description: 'Payments received in the period, with totals.',
    category: 'FINANCIAL',
    dataSource: 'payments_received',
    definition: {
      ...base,
      columns: ['invoice', 'client', 'amount', 'method', 'paidOn'],
      filters: {
        logic: 'AND',
        conditions: [{ field: 'status', op: 'IS', value: 'SUCCEEDED' }],
        groups: [],
      },
      sortBy: 'paidOn',
      sortDescending: true,
      showTotals: true,
      compareTo: 'PREVIOUS_PERIOD',
    },
  },
  {
    key: 'outstanding_invoices',
    name: 'Outstanding Invoices',
    description: 'Open invoices and how overdue they are.',
    category: 'FINANCIAL',
    dataSource: 'invoices_payments',
    definition: {
      ...base,
      columns: ['number', 'client', 'total', 'dueOn', 'daysOverdue'],
      filters: {
        logic: 'AND',
        conditions: [{ field: 'status', op: 'IS', value: 'OPEN' }],
        groups: [],
      },
      sortBy: 'dueOn',
      showTotals: true,
    },
  },
  {
    key: 'invoices_by_status',
    name: 'Invoices by Status',
    description: 'Invoice counts and totals by status.',
    category: 'FINANCIAL',
    dataSource: 'invoices_payments',
    definition: {
      ...base,
      columns: ['total'],
      groupBy: 'status',
      showTotals: true,
      showPercentage: true,
    },
  },
  {
    key: 'new_clients',
    name: 'New Clients',
    description: 'Clients added in the period.',
    category: 'CLIENT',
    dataSource: 'clients',
    definition: {
      ...base,
      columns: ['name', 'accountType', 'status', 'assignedTo', 'createdOn'],
      sortBy: 'createdOn',
      sortDescending: true,
      compareTo: 'PREVIOUS_PERIOD',
    },
  },
  {
    key: 'clients_by_status',
    name: 'Clients by Status',
    description: 'How many clients are in each status.',
    category: 'CLIENT',
    dataSource: 'clients',
    definition: { ...base, columns: [], groupBy: 'status', showTotals: true, showPercentage: true },
  },
  {
    key: 'clients_by_source',
    name: 'Clients by Source',
    description: 'Where clients came from.',
    category: 'CLIENT',
    dataSource: 'clients',
    definition: { ...base, columns: [], groupBy: 'source', showTotals: true, showPercentage: true },
  },
  {
    key: 'returns_filed',
    name: 'Returns Filed',
    description: 'Returns filed in the period, by preparer and type.',
    category: 'TAX',
    dataSource: 'tax_returns',
    definition: {
      ...base,
      columns: ['client', 'taxYear', 'filingType', 'status', 'preparer', 'filedOn'],
      sortBy: 'filedOn',
      sortDescending: true,
      compareTo: 'PREVIOUS_PERIOD',
    },
  },
  {
    key: 'returns_by_filing_status',
    name: 'Returns by Filing Status',
    description: 'Filed returns by status (filed, accepted, rejected).',
    category: 'TAX',
    dataSource: 'tax_returns',
    definition: { ...base, columns: [], groupBy: 'status', showTotals: true, showPercentage: true },
  },
  {
    key: 'lead_sources',
    name: 'Lead Sources',
    description: 'Where leads come from.',
    category: 'LEADS',
    dataSource: 'leads',
    definition: {
      ...base,
      columns: [],
      groupBy: 'source',
      showTotals: true,
      showPercentage: true,
      compareTo: 'PREVIOUS_PERIOD',
    },
  },
  {
    key: 'lead_pipeline',
    name: 'Lead Pipeline',
    description: 'Leads by stage.',
    category: 'LEADS',
    dataSource: 'leads',
    definition: { ...base, columns: [], groupBy: 'status', showTotals: true, showPercentage: true },
  },
  {
    key: 'task_workload',
    name: 'Task Workload',
    description: 'Tasks by person.',
    category: 'TEAM_PRODUCTIVITY',
    dataSource: 'tasks',
    definition: { ...base, columns: [], groupBy: 'assignedTo', showTotals: true },
  },
  {
    key: 'overdue_tasks',
    name: 'Overdue Tasks',
    description: 'Open tasks past their due date.',
    category: 'TEAM_PRODUCTIVITY',
    dataSource: 'tasks',
    definition: {
      ...base,
      columns: ['title', 'client', 'priority', 'assignedTo', 'dueOn'],
      filters: {
        logic: 'AND',
        conditions: [{ field: 'overdue', op: 'IS', value: true }],
        groups: [],
      },
      sortBy: 'dueOn',
    },
  },
];

export const systemReport = (key: string) => SYSTEM_REPORTS.find((r) => r.key === key);

// ---------- Definitions as the database stores them ----------

const COMPARE_DB: Record<ReportCompareTo, string | null> = {
  NONE: null,
  PREVIOUS_PERIOD: 'previous_period',
  SAME_PERIOD_LAST_YEAR: 'same_period_last_year',
};
export const compareToDb = (c: ReportCompareTo) => COMPARE_DB[c];
export const compareFromDb = (include: boolean, value: string | null): ReportCompareTo =>
  include && value === 'previous_period'
    ? 'PREVIOUS_PERIOD'
    : include && value === 'same_period_last_year'
      ? 'SAME_PERIOD_LAST_YEAR'
      : 'NONE';

export interface DefinitionRow {
  category: ReportCategory;
  dataSource: string;
  columns: string[];
  filters: unknown;
  groupBy: string | null;
  sortBy: string | null;
  sortDescending: boolean;
  showTotals: boolean;
  showPercentage: boolean;
  includeComparison: boolean;
  compareTo: string | null;
  dateRule: 'FIXED' | 'ROLLING';
  datePreset: string | null;
  dateFrom: Date | null;
  dateTo: Date | null;
  chartType: string;
  showDataLabels: boolean;
  includeTaxRevenue: boolean;
}

/** Field names are stored lower_snake (the database pattern); the API's keys are camelCase. */
export const snake = (k: string) => k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
export const camel = (k: string) => k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());

/** The database keeps filters as an array; ours is one group object, stored as its only item. */
const asFilters = (raw: unknown): Filters => {
  const first = Array.isArray(raw) ? raw[0] : raw;
  const f = (first && typeof first === 'object' ? first : {}) as Partial<Filters>;
  return {
    logic: f.logic === 'OR' ? 'OR' : 'AND',
    conditions: f.conditions ?? [],
    groups: f.groups ?? [],
  };
};

export function toView(r: DefinitionRow): ReportDefinitionView {
  return {
    category: r.category,
    dataSource: r.dataSource,
    columns: r.columns.map(camel),
    filters: asFilters(r.filters) as ReportDefinitionView['filters'],
    groupBy: r.groupBy ? camel(r.groupBy) : null,
    sortBy: r.sortBy ? camel(r.sortBy) : null,
    sortDescending: r.sortDescending,
    showTotals: r.showTotals,
    showPercentage: r.showPercentage,
    compareTo: compareFromDb(r.includeComparison, r.compareTo),
    date:
      r.dateRule === 'FIXED' && r.dateFrom && r.dateTo
        ? {
            rule: 'FIXED',
            from: r.dateFrom.toISOString().slice(0, 10),
            to: r.dateTo.toISOString().slice(0, 10),
          }
        : { rule: 'ROLLING', preset: (r.datePreset ?? 'this_year') as ReportDatePreset },
    chartType: r.chartType.toUpperCase() as ReportDefinitionView['chartType'],
    showDataLabels: r.showDataLabels,
    includeTaxRevenue: r.includeTaxRevenue,
  };
}

/** A definition (validated by the contract) as columns of `report_definitions`. */
export function toRow(d: ReportDefinitionView) {
  return {
    category: d.category,
    dataSource: d.dataSource,
    columns: d.columns.map(snake),
    filters: [d.filters] as unknown as object,
    groupBy: d.groupBy ? snake(d.groupBy) : null,
    sortBy: d.sortBy ? snake(d.sortBy) : null,
    sortDescending: d.sortDescending,
    showTotals: d.showTotals,
    showPercentage: d.showPercentage,
    includeComparison: d.compareTo !== 'NONE',
    compareTo: compareToDb(d.compareTo),
    dateRule: d.date.rule,
    datePreset: d.date.rule === 'ROLLING' ? d.date.preset : null,
    dateFrom: d.date.rule === 'FIXED' ? new Date(`${d.date.from}T00:00:00.000Z`) : null,
    dateTo: d.date.rule === 'FIXED' ? new Date(`${d.date.to}T00:00:00.000Z`) : null,
    // The database has no pie chart: it is stored as a donut.
    chartType: d.chartType === 'PIE' ? 'donut' : d.chartType.toLowerCase(),
    showDataLabels: d.showDataLabels,
    includeTaxRevenue: d.includeTaxRevenue,
  };
}

/** A safe file name from a report name and a range: letters, digits and dashes, never data. */
export const safeFileName = (name: string, from: string, to: string, ext: string) =>
  `${
    name
      .replace(/[^A-Za-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'report'
  }_${from}_${to}.${ext}`;
