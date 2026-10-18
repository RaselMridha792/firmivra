import {
  ApiRequestError,
  CreateReportScheduleRequest,
  DuplicateSavedReportRequest,
  ExportReportRequest,
  RecentReportsQuery,
  ReportLookupQuery,
  ReportsDashboardQuery,
  RunReportRequest,
  SaveReportRequest,
  SaveReportSettingsRequest,
  SavedReportsQuery,
  ReportSchedulesQuery,
  UpdateReportScheduleRequest,
  UpdateSavedReportRequest,
  parseInput,
  type RecentReportRow,
  type ReportCatalogItem,
  type ReportChart,
  type ReportDataSource,
  type ReportDefinitionView,
  type ReportField,
  type ReportInsight,
  type ReportKpi,
  type ReportRange,
  type ReportResult,
  type ReportRunStatusView,
  type ReportScheduleDetail,
  type ReportSettingsView,
  type ReportsClient,
  type SavedReportDetail,
} from '@firmivra/types';
import { mockDelay } from '../lib/mock';
import { mockMe } from './appointments';

/**
 * Mock data for `api.reports` (R55 contract, Reports). Synthetic firms only, dated around today.
 * One small engine runs every report: nine data sources of made-up rows, the contract's
 * definition (columns, filters, grouping, sort, totals, comparison) and one result shape, so the
 * cards, charts and tables reconcile as the contract says. Nothing is ever sent or written: an
 * export only answers a ready run. `empty: true` (NEXT_PUBLIC_API_MOCK_EMPTY=reports) starts with
 * no source rows, so every card is 0 or N/A and no insight is made up.
 */
type MockRole = 'OWNER' | 'ADMIN' | 'STAFF';
interface Options {
  role?: MockRole;
  empty?: boolean;
}
type Cell = string | number | boolean | null;
type Row = Record<string, Cell>;
type Category = ReportCatalogItem['category'];
const fail = (status: number, code: string, message: string) =>
  new ApiRequestError(status, code, message);
const copy = <T>(v: T): T => structuredClone(v);
const nowIso = () => new Date().toISOString();
const DAY = 86_400_000;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const uuid = (block: string, n: number) =>
  `0199c0f0-${block}-7000-8000-${String(n).padStart(12, '0')}`;
const CATEGORY_LABEL: Record<Category, string> = {
  FINANCIAL: 'Financial Reports',
  CLIENT: 'Client Reports',
  TAX: 'Tax Reports',
  BOOKKEEPING: 'Bookkeeping Reports',
  PAYROLL: 'Payroll Reports',
  LEADS: 'Lead Reports',
  COMMUNICATIONS: 'Communications Reports',
  TEAM_PRODUCTIVITY: 'Team Productivity',
  ADVISORY: 'Advisory Reports',
};
const PRESET_LABEL: Record<string, string> = {
  today: 'Today',
  last_7_days: 'Last 7 Days',
  last_30_days: 'Last 30 Days',
  this_month: 'This Month',
  last_month: 'Last Month',
  this_quarter: 'This Quarter',
  last_quarter: 'Last Quarter',
  this_year: 'This Year',
  last_year: 'Last Year',
};

const fld = (
  key: string,
  label: string,
  type: ReportField['type'],
  more: Partial<ReportField> = {},
): ReportField => ({
  key,
  label,
  type,
  options: [],
  groupable: type === 'TEXT' || type === 'STATUS',
  sortable: true,
  filterable: true,
  aggregatable: type === 'MONEY' || type === 'NUMBER',
  locked: false,
  sensitive: false,
  ...more,
});
const opts = (...v: string[]) => v.map((x) => ({ value: x, label: x }));

interface SourceDef {
  meta: ReportDataSource;
  /** The numeric field the main chart sums (or null: count rows). */
  metric: string | null;
  breakdown: string;
  countLabel: string;
  kpis: {
    key: string;
    label: string;
    type: ReportField['type'];
    of: (rows: Row[]) => number | null;
    definition: string;
  }[];
}

const SERVICES = [
  'Tax Preparation',
  'Bookkeeping',
  'Payroll',
  'Advisory & Consulting',
  'Other Services',
];
const NAMES = [
  'Anderson LLC',
  'Brown Consulting',
  'Carter Group',
  'Davis Holdings',
  'Evans Enterprises',
  'Foster Solutions',
  'Green Tech',
  'Harris Retail',
  'Jackson & Co',
  'King Properties',
  'Lopez Bakery',
  'Martin Dental',
];
const STAFF = ['Alex Rivera', 'Sam Staff', 'Mock User', 'Dana Cole'];

function buildRows(empty: boolean) {
  const rows: Record<string, Row[]> = {
    invoices_payments: [],
    clients: [],
    returns: [],
    bookkeeping: [],
    payroll: [],
    leads: [],
    communications: [],
    team: [],
    advisory: [],
  };
  if (empty) return rows;
  const today = Date.now();
  const at = (daysAgo: number) => iso(new Date(today - daysAgo * DAY));
  for (let i = 0; i < 72; i += 1) {
    const amount = (300 + ((i * 137) % 1800)) * 100;
    const state = i % 7;
    const paid = state === 5 ? Math.round(amount / 2) : state === 6 || state === 4 ? 0 : amount;
    rows.invoices_payments!.push({
      invoiceNumber: `INV-${1001 + i}`,
      clientName: NAMES[i % NAMES.length]!,
      serviceCategory: SERVICES[i % SERVICES.length]!,
      invoiceDate: at(Math.round(i * 4.1)),
      dueDate: at(Math.round(i * 4.1) - 14),
      amount,
      amountPaid: paid,
      balanceDue: amount - paid,
      paymentStatus:
        paid === amount ? 'Paid' : paid === 0 ? (state === 6 ? 'Unpaid' : 'Overdue') : 'Partial',
    });
  }
  for (let i = 0; i < 48; i += 1) {
    rows.clients!.push({
      clientName: `${NAMES[i % NAMES.length]} ${i < 12 ? '' : i}`.trim(),
      clientType: i % 3 === 0 ? 'Individual' : 'Business',
      status: i % 9 === 0 ? 'Inactive' : i < 10 ? 'New' : 'Active',
      createdAt: at(i * 7),
      assignedTo: STAFF[i % STAFF.length]!,
      services: 1 + (i % 3),
    });
  }
  const ST = ['Filed', 'Accepted', 'Pending', 'Rejected'];
  for (let i = 0; i < 40; i += 1) {
    rows.returns!.push({
      clientName: NAMES[i % NAMES.length]!,
      taxYear: 2025,
      formType: i % 3 ? '1040' : '1120-S',
      status: ST[(i * 5) % 4 === 3 && i % 5 ? 3 : i % 3]!,
      filedDate: at(i * 6),
      refund: ((i * 211) % 4000) * 100,
    });
  }
  for (let i = 0; i < 24; i += 1) {
    rows.bookkeeping!.push({
      clientName: NAMES[i % NAMES.length]!,
      software: ['QuickBooks Online', 'Xero', 'FreshBooks'][i % 3]!,
      status: ['On Track', 'Needs Attention', 'Overdue'][i % 3]!,
      updatedAt: at(i * 3),
      transactions: 120 + i * 9,
    });
  }
  for (let i = 0; i < 18; i += 1) {
    rows.payroll!.push({
      clientName: NAMES[i % NAMES.length]!,
      employees: 3 + (i % 9),
      payrollTotal: (4000 + i * 530) * 100,
      status: i % 6 === 0 ? 'Processing' : 'On Track',
      runDate: at(i * 8),
    });
  }
  const SRC = ['Website', 'Referral', 'Social Media', 'Event', 'Google Ads'];
  for (let i = 0; i < 60; i += 1) {
    rows.leads!.push({
      leadName: `Lead ${i + 1}`,
      source: SRC[(i * 3) % 5]!,
      status: ['New', 'Contacted', 'Appointment', 'Converted'][i % 4]!,
      createdAt: at(i * 3),
      value: (500 + (i % 7) * 300) * 100,
    });
  }
  for (let i = 0; i < 16; i += 1) {
    rows.communications!.push({
      campaign: `Campaign ${i + 1}`,
      channel: i % 3 ? 'Email' : 'Text',
      sent: 200 + i * 17,
      opened: 90 + i * 8,
      clicked: 30 + i * 3,
      sentAt: at(i * 9),
    });
  }
  STAFF.forEach((s, i) =>
    rows.team!.push({
      staffName: s,
      tasksCompleted: 40 + i * 17,
      workload: 60 + i * 9,
      hours: 120 + i * 11,
      date: at(i * 10),
    }),
  );
  for (let i = 0; i < 10; i += 1) {
    rows.advisory!.push({
      clientName: NAMES[i % NAMES.length]!,
      plan: ['Growth Plan', 'Exit Plan', 'Cash Flow'][i % 3]!,
      goalsOpen: 2 + (i % 4),
      status: ['Active', 'Draft'][i % 2]!,
      startedAt: at(i * 20),
    });
  }
  return rows;
}

const sum = (rows: Row[], key: string) =>
  rows.reduce((n, r) => n + (typeof r[key] === 'number' ? (r[key] as number) : 0), 0);
const distinct = (rows: Row[], key: string) => new Set(rows.map((r) => r[key])).size;
const pctOf = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : null);

function sources(): Record<string, SourceDef> {
  const def = (
    key: string,
    category: Category,
    label: string,
    description: string,
    fields: ReportField[],
    defaultColumns: string[],
    dateField: string,
    metric: string | null,
    breakdown: string,
    countLabel: string,
    kpis: SourceDef['kpis'],
    extra: Partial<ReportDataSource> = {},
  ): SourceDef => ({
    meta: {
      key,
      category,
      label,
      description,
      fields,
      defaultColumns,
      dateField,
      supportsComparison: true,
      supportsTaxToggle: false,
      ...extra,
    },
    metric,
    breakdown,
    countLabel,
    kpis,
  });
  const m = (
    key: string,
    label: string,
    of: (r: Row[]) => number | null,
    type: ReportField['type'] = 'NUMBER',
    definition = '',
  ): SourceDef['kpis'][number] => ({ key, label, type, of, definition });
  return {
    invoices_payments: def(
      'invoices_payments',
      'FINANCIAL',
      'Invoices & Payments',
      'Invoices with what was paid and what is still due.',
      [
        fld('invoiceNumber', 'Invoice Number', 'TEXT', { locked: true, groupable: false }),
        fld('clientName', 'Client Name', 'TEXT'),
        fld('serviceCategory', 'Service Category', 'STATUS', { options: opts(...SERVICES) }),
        fld('invoiceDate', 'Invoice Date', 'DATE'),
        fld('dueDate', 'Due Date', 'DATE'),
        fld('amount', 'Amount', 'MONEY'),
        fld('amountPaid', 'Amount Paid', 'MONEY'),
        fld('balanceDue', 'Balance Due', 'MONEY'),
        fld('paymentStatus', 'Payment Status', 'STATUS', {
          options: opts('Paid', 'Partial', 'Unpaid', 'Overdue'),
        }),
      ],
      [
        'clientName',
        'invoiceNumber',
        'invoiceDate',
        'serviceCategory',
        'amount',
        'amountPaid',
        'balanceDue',
        'paymentStatus',
      ],
      'invoiceDate',
      'amountPaid',
      'serviceCategory',
      '# of Invoices',
      [
        m(
          'total-revenue',
          'Total Revenue',
          (r) => sum(r, 'amountPaid'),
          'MONEY',
          'Money collected on invoices dated in the range.',
        ),
        m(
          'total-payments',
          'Total Payments',
          (r) => sum(r, 'amountPaid'),
          'MONEY',
          'Payments received.',
        ),
        m(
          'outstanding',
          'Outstanding Invoices',
          (r) => sum(r, 'balanceDue'),
          'MONEY',
          'Balance still due.',
        ),
        m(
          'total-clients',
          'Total Clients',
          (r) => distinct(r, 'clientName'),
          'NUMBER',
          'Clients invoiced in the range.',
        ),
      ],
      { supportsTaxToggle: true },
    ),
    clients: def(
      'clients',
      'CLIENT',
      'Clients',
      'Client records and when they joined.',
      [
        fld('clientName', 'Client Name', 'TEXT', { locked: true, groupable: false }),
        fld('clientType', 'Client Type', 'STATUS', { options: opts('Individual', 'Business') }),
        fld('status', 'Status', 'STATUS', { options: opts('New', 'Active', 'Inactive') }),
        fld('createdAt', 'Client Since', 'DATE'),
        fld('assignedTo', 'Assigned To', 'STATUS', { options: opts(...STAFF) }),
        fld('services', 'Services', 'NUMBER'),
      ],
      ['clientName', 'clientType', 'status', 'createdAt', 'assignedTo'],
      'createdAt',
      null,
      'status',
      '# of Clients',
      [
        m(
          'total-clients',
          'Total Clients',
          (r) => r.length,
          'NUMBER',
          'Clients added in the range.',
        ),
        m(
          'new-clients',
          'New Clients',
          (r) => r.filter((x) => x['status'] === 'New').length,
          'NUMBER',
          'Clients marked new.',
        ),
        m(
          'active-clients',
          'Active Clients',
          (r) => r.filter((x) => x['status'] === 'Active').length,
          'NUMBER',
          'Clients with an active service.',
        ),
      ],
    ),
    returns: def(
      'returns',
      'TAX',
      'Tax Returns',
      'Returns by filing status.',
      [
        fld('clientName', 'Client Name', 'TEXT', { locked: true }),
        fld('taxYear', 'Tax Year', 'NUMBER', { aggregatable: false, groupable: true }),
        fld('formType', 'Form', 'STATUS', { options: opts('1040', '1120-S') }),
        fld('status', 'Filing Status', 'STATUS', {
          options: opts(...['Filed', 'Accepted', 'Pending', 'Rejected']),
        }),
        fld('filedDate', 'Filed On', 'DATE'),
        fld('refund', 'Refund', 'MONEY'),
      ],
      ['clientName', 'taxYear', 'formType', 'status', 'filedDate', 'refund'],
      'filedDate',
      null,
      'status',
      '# of Returns',
      [
        m(
          'returns-filed',
          'Returns Filed',
          (r) => r.length,
          'NUMBER',
          'Returns filed in the range.',
        ),
        m(
          'accepted',
          'Accepted',
          (r) => r.filter((x) => x['status'] === 'Accepted').length,
          'NUMBER',
          'Accepted by the agency.',
        ),
        m(
          'refunds',
          'Refund Amount',
          (r) => sum(r, 'refund'),
          'MONEY',
          'Refunds on filed returns.',
        ),
      ],
    ),
    bookkeeping: def(
      'bookkeeping',
      'BOOKKEEPING',
      'Bookkeeping',
      'Bookkeeping clients and their sync status.',
      [
        fld('clientName', 'Client Name', 'TEXT', { locked: true }),
        fld('software', 'Accounting Software', 'STATUS', {
          options: opts('QuickBooks Online', 'Xero', 'FreshBooks'),
        }),
        fld('status', 'Status', 'STATUS', {
          options: opts('On Track', 'Needs Attention', 'Overdue'),
        }),
        fld('updatedAt', 'Last Synced', 'DATE'),
        fld('transactions', 'Transactions', 'NUMBER'),
      ],
      ['clientName', 'software', 'status', 'updatedAt', 'transactions'],
      'updatedAt',
      'transactions',
      'status',
      '# of Clients',
      [
        m('bk-clients', 'Active Clients', (r) => r.length, 'NUMBER'),
        m('bk-transactions', 'Transactions', (r) => sum(r, 'transactions'), 'NUMBER'),
      ],
    ),
    payroll: def(
      'payroll',
      'PAYROLL',
      'Payroll',
      'Payroll clients and their runs.',
      [
        fld('clientName', 'Client Name', 'TEXT', { locked: true }),
        fld('employees', 'Employees', 'NUMBER'),
        fld('payrollTotal', 'Payroll Total', 'MONEY'),
        fld('status', 'Status', 'STATUS', { options: opts('On Track', 'Processing') }),
        fld('runDate', 'Run Date', 'DATE'),
      ],
      ['clientName', 'employees', 'payrollTotal', 'status', 'runDate'],
      'runDate',
      'payrollTotal',
      'status',
      '# of Runs',
      [
        m('pay-total', 'Total Payroll', (r) => sum(r, 'payrollTotal'), 'MONEY'),
        m('pay-clients', 'Payroll Clients', (r) => distinct(r, 'clientName'), 'NUMBER'),
      ],
    ),
    leads: def(
      'leads',
      'LEADS',
      'Leads',
      'Leads by source and stage.',
      [
        fld('leadName', 'Lead', 'TEXT', { locked: true, groupable: false }),
        fld('source', 'Source', 'STATUS', {
          options: opts('Website', 'Referral', 'Social Media', 'Event', 'Google Ads'),
        }),
        fld('status', 'Stage', 'STATUS', {
          options: opts('New', 'Contacted', 'Appointment', 'Converted'),
        }),
        fld('createdAt', 'Created', 'DATE'),
        fld('value', 'Value', 'MONEY'),
      ],
      ['leadName', 'source', 'status', 'createdAt', 'value'],
      'createdAt',
      null,
      'source',
      '# of Leads',
      [
        m('new-leads', 'New Leads', (r) => r.filter((x) => x['status'] === 'New').length, 'NUMBER'),
        m(
          'converted',
          'Converted',
          (r) => r.filter((x) => x['status'] === 'Converted').length,
          'NUMBER',
        ),
      ],
    ),
    communications: def(
      'communications',
      'COMMUNICATIONS',
      'Communications',
      'Email and text campaigns.',
      [
        fld('campaign', 'Campaign', 'TEXT', { locked: true, groupable: false }),
        fld('channel', 'Channel', 'STATUS', { options: opts('Email', 'Text') }),
        fld('sent', 'Sent', 'NUMBER'),
        fld('opened', 'Opened', 'NUMBER'),
        fld('clicked', 'Clicked', 'NUMBER'),
        fld('sentAt', 'Sent On', 'DATE'),
      ],
      ['campaign', 'channel', 'sent', 'opened', 'clicked', 'sentAt'],
      'sentAt',
      'sent',
      'channel',
      '# of Campaigns',
      [
        m('sent', 'Messages Sent', (r) => sum(r, 'sent'), 'NUMBER'),
        m('open-rate', 'Open Rate', (r) => pctOf(sum(r, 'opened'), sum(r, 'sent')), 'PERCENT'),
      ],
    ),
    team: def(
      'team',
      'TEAM_PRODUCTIVITY',
      'Team Productivity',
      'Staff tasks, workload and hours.',
      [
        fld('staffName', 'Staff', 'TEXT', { locked: true }),
        fld('tasksCompleted', 'Tasks Completed', 'NUMBER'),
        fld('workload', 'Workload %', 'PERCENT', { aggregatable: false }),
        fld('hours', 'Hours', 'NUMBER'),
        fld('date', 'Date', 'DATE'),
      ],
      ['staffName', 'tasksCompleted', 'workload', 'hours'],
      'date',
      'tasksCompleted',
      'staffName',
      '# of Staff',
      [
        m('tasks', 'Tasks Completed', (r) => sum(r, 'tasksCompleted'), 'NUMBER'),
        m('hours', 'Hours', (r) => sum(r, 'hours'), 'NUMBER'),
      ],
    ),
    advisory: def(
      'advisory',
      'ADVISORY',
      'Advisory',
      'Advisory clients and plans.',
      [
        fld('clientName', 'Client Name', 'TEXT', { locked: true }),
        fld('plan', 'Plan', 'STATUS', { options: opts('Growth Plan', 'Exit Plan', 'Cash Flow') }),
        fld('goalsOpen', 'Open Goals', 'NUMBER'),
        fld('status', 'Status', 'STATUS', { options: opts('Active', 'Draft') }),
        fld('startedAt', 'Started', 'DATE'),
      ],
      ['clientName', 'plan', 'goalsOpen', 'status', 'startedAt'],
      'startedAt',
      'goalsOpen',
      'plan',
      '# of Plans',
      [
        m('adv-clients', 'Advisory Clients', (r) => distinct(r, 'clientName'), 'NUMBER'),
        m('goals', 'Open Goals', (r) => sum(r, 'goalsOpen'), 'NUMBER'),
      ],
    ),
  };
}

const SYSTEM: {
  key: string;
  name: string;
  description: string;
  category: Category;
  source: string;
  groupBy: string | null;
  columns?: string[];
}[] = [
  {
    key: 'revenue-summary',
    name: 'Revenue Summary',
    description: 'Revenue, payments and outstanding by service.',
    category: 'FINANCIAL',
    source: 'invoices_payments',
    groupBy: 'serviceCategory',
    columns: ['serviceCategory', 'amount', 'amountPaid', 'balanceDue'],
  },
  {
    key: 'unpaid-invoices',
    name: 'Unpaid Invoices',
    description: 'Invoices with a balance due.',
    category: 'FINANCIAL',
    source: 'invoices_payments',
    groupBy: null,
  },
  {
    key: 'new-clients-month',
    name: 'New Clients This Month',
    description: 'Clients added in the range.',
    category: 'CLIENT',
    source: 'clients',
    groupBy: null,
  },
  {
    key: 'client-retention',
    name: 'Client Retention',
    description: 'Clients by status.',
    category: 'CLIENT',
    source: 'clients',
    groupBy: 'status',
    columns: ['status', 'services'],
  },
  {
    key: 'returns-by-filing-status',
    name: 'Returns by Filing Status',
    description: 'Filed, accepted, pending and rejected returns.',
    category: 'TAX',
    source: 'returns',
    groupBy: 'status',
    columns: ['status', 'refund'],
  },
  {
    key: 'bookkeeping-status',
    name: 'Bookkeeping Status',
    description: 'Bookkeeping clients by status.',
    category: 'BOOKKEEPING',
    source: 'bookkeeping',
    groupBy: 'status',
    columns: ['status', 'transactions'],
  },
  {
    key: 'payroll-summary',
    name: 'Payroll Summary',
    description: 'Payroll totals by status.',
    category: 'PAYROLL',
    source: 'payroll',
    groupBy: 'status',
    columns: ['status', 'payrollTotal', 'employees'],
  },
  {
    key: 'top-lead-sources',
    name: 'Top Lead Sources',
    description: 'Leads by source.',
    category: 'LEADS',
    source: 'leads',
    groupBy: 'source',
    columns: ['source', 'value'],
  },
  {
    key: 'communication-performance',
    name: 'Communication Performance',
    description: 'Sent, opened and clicked by channel.',
    category: 'COMMUNICATIONS',
    source: 'communications',
    groupBy: 'channel',
    columns: ['channel', 'sent', 'opened', 'clicked'],
  },
  {
    key: 'staff-activity',
    name: 'Staff Activity',
    description: 'Tasks completed and hours by staff member.',
    category: 'TEAM_PRODUCTIVITY',
    source: 'team',
    groupBy: 'staffName',
    columns: ['staffName', 'tasksCompleted', 'hours'],
  },
  {
    key: 'advisory-plans',
    name: 'Advisory Plans',
    description: 'Plans and open goals.',
    category: 'ADVISORY',
    source: 'advisory',
    groupBy: 'plan',
    columns: ['plan', 'goalsOpen'],
  },
];

function resolveRange(
  spec: { rule: 'ROLLING'; preset: string } | { rule: 'FIXED'; from: string; to: string },
): ReportRange {
  const t = new Date();
  const y = t.getUTCFullYear();
  const mo = t.getUTCMonth();
  const u = (yy: number, mm: number, dd: number) => new Date(Date.UTC(yy, mm, dd));
  if (spec.rule === 'FIXED')
    return {
      from: spec.from,
      to: spec.to,
      timezone: 'America/New_York',
      label: `${spec.from} – ${spec.to}`,
    };
  const p = spec.preset;
  const label = PRESET_LABEL[p] ?? p;
  const r = (from: Date, to: Date) => ({
    from: iso(from),
    to: iso(to),
    timezone: 'America/New_York',
    label,
  });
  if (p === 'today') return r(t, t);
  if (p === 'last_7_days') return r(new Date(t.getTime() - 6 * DAY), t);
  if (p === 'last_30_days') return r(new Date(t.getTime() - 29 * DAY), t);
  if (p === 'last_month') return r(u(y, mo - 1, 1), u(y, mo, 0));
  if (p === 'this_quarter') {
    const q = Math.floor(mo / 3) * 3;
    return r(u(y, q, 1), t);
  }
  if (p === 'last_quarter') {
    const q = Math.floor(mo / 3) * 3;
    return r(u(y, q - 3, 1), u(y, q, 0));
  }
  if (p === 'last_year') return r(u(y - 1, 0, 1), u(y - 1, 11, 31));
  if (p === 'this_year') return r(u(y, 0, 1), t);
  return r(u(y, mo, 1), t);
}
const shiftRange = (
  r: ReportRange,
  how: 'PREVIOUS_PERIOD' | 'SAME_PERIOD_LAST_YEAR',
): ReportRange => {
  const from = new Date(`${r.from}T00:00:00Z`);
  const to = new Date(`${r.to}T00:00:00Z`);
  if (how === 'SAME_PERIOD_LAST_YEAR') {
    return {
      ...r,
      from: iso(
        new Date(Date.UTC(from.getUTCFullYear() - 1, from.getUTCMonth(), from.getUTCDate())),
      ),
      to: iso(new Date(Date.UTC(to.getUTCFullYear() - 1, to.getUTCMonth(), to.getUTCDate()))),
      label: 'Same period last year',
    };
  }
  const len = to.getTime() - from.getTime() + DAY;
  return {
    ...r,
    from: iso(new Date(from.getTime() - len)),
    to: iso(new Date(from.getTime() - DAY)),
    label: 'Previous period',
  };
};
const delta = (a: number | null, b: number | null) =>
  a === null || b === null || b === 0 ? null : Math.round(((a - b) / Math.abs(b)) * 1000) / 10;

export function createReportsMock({ role = 'OWNER', empty = false }: Options = {}): ReportsClient {
  let next = 4000;
  const id = (block: string) => uuid(block, next++);
  const run = async <T>(work: () => T): Promise<T> => {
    await mockDelay();
    return copy(work());
  };
  const manage = () => {
    if (role === 'STAFF') throw fail(403, 'FORBIDDEN', 'This action is not permitted');
  };
  const rows = buildRows(empty);
  const srcs = sources();
  let settings: ReportSettingsView = {
    revenueBasis: 'COLLECTED',
    includeTaxDefault: false,
    defaultDatePreset: 'this_year',
    staleAfterMinutes: 60,
    timezone: 'America/New_York',
    updatedAt: null,
  };
  const savedReports: SavedReportDetail[] = [];
  const schedules: ReportScheduleDetail[] = [];
  const recent: RecentReportRow[] = [];
  const runs = new Map<string, ReportRunStatusView>();
  const person = { userId: mockMe.userId, name: mockMe.name };

  const defOf = (key: string): ReportDefinitionView => {
    const s = SYSTEM.find((x) => x.key === key);
    if (!s) throw fail(404, 'NOT_FOUND', 'That report was not found.');
    const src = srcs[s.source]!;
    return {
      category: s.category,
      dataSource: s.source,
      columns: s.columns ?? src.meta.defaultColumns,
      filters: {
        logic: 'AND',
        conditions:
          key === 'unpaid-invoices' ? [{ field: 'balanceDue', op: 'GREATER_THAN', value: 0 }] : [],
        groups: [],
      },
      groupBy: s.groupBy,
      sortBy: null,
      sortDescending: false,
      showTotals: !!s.groupBy,
      showPercentage: !!s.groupBy,
      compareTo: 'NONE',
      date: { rule: 'ROLLING', preset: settings.defaultDatePreset },
      chartType: 'AUTO',
      showDataLabels: false,
      includeTaxRevenue: settings.includeTaxDefault,
    };
  };
  const viewOf = (b: Record<string, unknown>): ReportDefinitionView => {
    const d = b as Partial<ReportDefinitionView> &
      Pick<ReportDefinitionView, 'category' | 'dataSource' | 'columns' | 'date'>;
    return {
      category: d.category,
      dataSource: d.dataSource,
      columns: d.columns,
      filters: {
        logic: d.filters?.logic ?? 'AND',
        conditions: d.filters?.conditions ?? [],
        groups: d.filters?.groups ?? [],
      },
      groupBy: d.groupBy ?? null,
      sortBy: d.sortBy ?? null,
      sortDescending: d.sortDescending ?? false,
      showTotals: d.showTotals ?? false,
      showPercentage: d.showPercentage ?? false,
      compareTo: d.compareTo ?? 'NONE',
      date: d.date,
      chartType: d.chartType ?? 'AUTO',
      showDataLabels: d.showDataLabels ?? false,
      includeTaxRevenue: d.includeTaxRevenue ?? false,
    };
  };
  const check = (d: ReportDefinitionView) => {
    const src = srcs[d.dataSource];
    if (!src) throw fail(400, 'INVALID_DEFINITION', 'That data source does not exist.');
    for (const c of d.columns)
      if (!src.meta.fields.some((f) => f.key === c))
        throw fail(400, 'INVALID_DEFINITION', `${c} is not a field of ${src.meta.label}.`);
    if (d.groupBy && !src.meta.fields.find((f) => f.key === d.groupBy)?.groupable)
      throw fail(400, 'INVALID_DEFINITION', 'That field cannot be grouped.');
  };
  const matches = (r: Row, c: { field: string; op: string; value?: unknown }) => {
    const v = r[c.field];
    const s = String(v ?? '').toLowerCase();
    const x = String(c.value ?? '').toLowerCase();
    switch (c.op) {
      case 'EQUALS':
      case 'IS':
        return s === x;
      case 'NOT_EQUALS':
      case 'IS_NOT':
        return s !== x;
      case 'CONTAINS':
        return s.includes(x);
      case 'NOT_CONTAINS':
        return !s.includes(x);
      case 'STARTS_WITH':
        return s.startsWith(x);
      case 'IS_EMPTY':
        return v === null || v === '';
      case 'IS_NOT_EMPTY':
        return v !== null && v !== '';
      case 'GREATER_THAN':
        return Number(v) > Number(c.value);
      case 'LESS_THAN':
        return Number(v) < Number(c.value);
      case 'IS_ANY_OF':
        return Array.isArray(c.value) && c.value.map((q) => String(q).toLowerCase()).includes(s);
      case 'IS_NONE_OF':
        return Array.isArray(c.value) && !c.value.map((q) => String(q).toLowerCase()).includes(s);
      default:
        return true;
    }
  };
  const inRange = (src: SourceDef, r: Row, range: ReportRange) => {
    const f = src.meta.dateField;
    if (!f) return true;
    const d = String(r[f] ?? '');
    return d >= range.from && d <= range.to;
  };
  const apply = (
    src: SourceDef,
    d: ReportDefinitionView,
    range: ReportRange,
    extra: { conditions?: { field: string; op: string; value?: unknown }[] } = {},
  ) => {
    const all = [...d.filters.conditions, ...(extra.conditions ?? [])];
    return (rows[src.meta.key] ?? [])
      .filter((r) => inRange(src, r, range))
      .filter((r) =>
        d.filters.logic === 'OR' && d.filters.conditions.length
          ? d.filters.conditions.some((c) => matches(r, c)) &&
            (extra.conditions ?? []).every((c) => matches(r, c))
          : all.every((c) => matches(r, c)),
      );
  };
  const monthLabels = (range: ReportRange) => {
    const out: string[] = [];
    const from = new Date(`${range.from}T00:00:00Z`);
    const to = new Date(`${range.to}T00:00:00Z`);
    for (
      let t = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1));
      t <= to;
      t = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 1))
    )
      out.push(`${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}`);
    return out.slice(-12);
  };
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const monthly = (src: SourceDef, rs: Row[], labels: string[], shiftYear = 0): (number | null)[] =>
    labels.map((l) => {
      const key = `${Number(l.slice(0, 4)) - shiftYear}-${l.slice(5)}`;
      const part = rs.filter((r) => String(r[src.meta.dateField ?? ''] ?? '').startsWith(key));
      return part.length === 0 ? null : src.metric ? sum(part, src.metric) : part.length;
    });
  const kpisOf = (src: SourceDef, cur: Row[], prev: Row[] | null): ReportKpi[] =>
    src.kpis.map((k) => {
      const value = cur.length || k.of(cur) ? k.of(cur) : empty ? null : k.of(cur);
      const previous = prev ? k.of(prev) : null;
      return {
        key: k.key,
        label: k.label,
        type: k.type,
        value: cur.length === 0 ? (k.type === 'MONEY' || k.type === 'NUMBER' ? 0 : null) : value,
        previous: prev ? previous : null,
        deltaPercent: prev && cur.length ? delta(value, previous) : null,
        definition: k.definition || null,
      };
    });
  const breakdownChart = (src: SourceDef, rs: Row[]): ReportChart | null => {
    if (rs.length === 0) return null;
    const groups = new Map<string, number>();
    for (const r of rs)
      groups.set(
        String(r[src.breakdown]),
        (groups.get(String(r[src.breakdown])) ?? 0) + (src.metric ? Number(r[src.metric] ?? 0) : 1),
      );
    return {
      type: 'DONUT',
      labels: [...groups.keys()],
      series: [
        { key: 'value', label: src.meta.label, comparison: false, values: [...groups.values()] },
      ],
      money: src.meta.fields.find((f) => f.key === src.metric)?.type === 'MONEY',
    };
  };
  const insightsOf = (
    src: SourceDef,
    cur: Row[],
    kpis: ReportKpi[],
    range: ReportRange,
  ): ReportInsight[] => {
    if (cur.length === 0) return [];
    const out: ReportInsight[] = [];
    const k = kpis[0];
    const sys = SYSTEM.find((s) => s.source === src.meta.key)?.key ?? 'revenue-summary';
    if (k && k.deltaPercent !== null)
      out.push({
        key: `${k.key}-change`,
        message: `${k.label} is ${k.deltaPercent >= 0 ? 'up' : 'down'} ${Math.abs(k.deltaPercent)}% compared to the previous period.`,
        metric: k.key,
        value: k.deltaPercent,
        threshold: null,
        range,
        target: { kind: 'REPORT', reportKey: sys },
      });
    const bd = breakdownChart(src, cur);
    if (bd) {
      const vals = bd.series[0]!.values.map((v) => v ?? 0);
      const total = vals.reduce((a, b) => a + b, 0);
      const top = vals.indexOf(Math.max(...vals));
      if (total > 0)
        out.push({
          key: 'top-group',
          message: `${bd.labels[top]} makes up ${Math.round((vals[top]! / total) * 100)}% of ${src.meta.label.toLowerCase()} this period.`,
          metric: 'share',
          value: Math.round((vals[top]! / total) * 100),
          threshold: null,
          range,
          target: { kind: 'REPORT', reportKey: sys },
        });
    }
    return out;
  };

  const runDef = (
    d: ReportDefinitionView,
    title: string,
    target: ReportResult['target'],
    q: {
      date?: ReportDefinitionView['date'];
      compareTo?: ReportDefinitionView['compareTo'];
      search?: string;
      sort?: { field: string; descending: boolean };
      page: number;
      pageSize: number;
      preview?: boolean;
      quick?: { clientType?: string };
      extra?: { conditions?: { field: string; op: string; value?: unknown }[] };
    },
  ): ReportResult => {
    check(d);
    const src = srcs[d.dataSource]!;
    const dateSpec = q.date ?? d.date;
    const range = resolveRange(dateSpec as never);
    const compare = q.compareTo ?? d.compareTo;
    const cmpRange =
      compare === 'NONE' || !src.meta.supportsComparison ? null : shiftRange(range, compare);
    const cur = apply(src, d, range, q.extra);
    const prev = cmpRange ? apply(src, d, cmpRange, q.extra) : null;
    const labels = monthLabels(range);
    const money = src.meta.fields.find((f) => f.key === src.metric)?.type === 'MONEY';
    const chart: ReportChart | null =
      cur.length === 0
        ? null
        : {
            type: d.chartType === 'AUTO' ? 'BAR' : d.chartType,
            labels: labels.map((l) => MON[Number(l.slice(5)) - 1]!),
            series: [
              {
                key: 'this',
                label: 'This period',
                comparison: false,
                values: monthly(src, cur, labels),
              },
              ...(cmpRange
                ? [
                    {
                      key: 'last',
                      label: cmpRange.label,
                      comparison: true,
                      values: monthly(src, prev ?? [], labels, 1),
                    },
                  ]
                : []),
            ],
            money,
          };
    const kpis = kpisOf(src, cur, prev);
    const needle = q.search?.toLowerCase();
    let list = cur.filter(
      (r) => !needle || Object.values(r).some((v) => String(v).toLowerCase().includes(needle)),
    );
    const fieldsOf = (keys: string[]) =>
      keys.map((k) => src.meta.fields.find((f) => f.key === k)!).filter(Boolean);
    let columns;
    let tableRows: { cells: Row; links: never[] }[];
    let totals: Record<string, number> | null = null;
    if (d.groupBy) {
      const g = d.groupBy;
      const numeric = fieldsOf(d.columns).filter((f) => f.aggregatable && f.key !== g);
      const groups = new Map<string, Row[]>();
      for (const r of list) groups.set(String(r[g]), [...(groups.get(String(r[g])) ?? []), r]);
      const base = [...groups].map(([k, rs]) => {
        const cells: Row = { [g]: k };
        for (const f of numeric) cells[f.key] = sum(rs, f.key);
        cells['_count'] = rs.length;
        return cells;
      });
      columns = [
        {
          key: g,
          label: src.meta.fields.find((f) => f.key === g)!.label,
          type: src.meta.fields.find((f) => f.key === g)!.type,
          locked: true,
          sortable: true,
        },
        ...numeric.map((f) => ({
          key: f.key,
          label: f.label,
          type: f.type,
          locked: f.locked,
          sortable: true,
        })),
        {
          key: '_count',
          label: src.countLabel,
          type: 'NUMBER' as const,
          locked: false,
          sortable: true,
        },
      ];
      const totalCount = base.reduce((n, c) => n + Number(c['_count']), 0);
      if (d.showPercentage) {
        columns.push({
          key: '_pct',
          label: '% of Total',
          type: 'PERCENT' as const,
          locked: false,
          sortable: true,
        });
        for (const c of base)
          c['_pct'] = totalCount ? Math.round((Number(c['_count']) / totalCount) * 100) : 0;
      }
      if (d.showTotals)
        totals = Object.fromEntries([
          ...numeric.map((f) => [f.key, base.reduce((n, c) => n + Number(c[f.key]), 0)]),
          ['_count', totalCount],
        ]);
      tableRows = base.map((cells) => ({ cells, links: [] }));
    } else {
      const flds = fieldsOf(d.columns);
      columns = flds.map((f) => ({
        key: f.key,
        label: f.label,
        type: f.type,
        locked: f.locked,
        sortable: f.sortable,
      }));
      tableRows = list.map((r) => ({
        cells: Object.fromEntries(flds.map((f) => [f.key, r[f.key] ?? null])),
        links: [],
      }));
      if (d.showTotals)
        totals = Object.fromEntries(
          flds.filter((f) => f.aggregatable).map((f) => [f.key, sum(list, f.key)]),
        );
    }
    const sortKey = q.sort?.field ?? d.sortBy;
    const desc = q.sort ? q.sort.descending : d.sortDescending;
    if (sortKey)
      tableRows.sort(
        (a, b) =>
          String(a.cells[sortKey] ?? '').localeCompare(String(b.cells[sortKey] ?? ''), undefined, {
            numeric: true,
          }) * (desc ? -1 : 1),
      );
    list = [];
    const total = tableRows.length;
    const pageRows = q.preview
      ? tableRows.slice(0, 10)
      : tableRows.slice((q.page - 1) * q.pageSize, q.page * q.pageSize);
    const chips = (d.filters.conditions as { field: string; op: string; value?: unknown }[]).map(
      (c) => ({
        field: c.field,
        label: src.meta.fields.find((f) => f.key === c.field)?.label ?? c.field,
        value:
          `${c.op.toLowerCase().replace(/_/g, ' ')} ${Array.isArray(c.value) ? c.value.join(', ') : String(c.value ?? '')}`.trim(),
      }),
    );
    const runId = q.preview ? null : id('c900');
    if (runId)
      recent.unshift({
        runId,
        name: title,
        category: d.category,
        kind: 'VIEW',
        savedReportId: target.kind === 'SAVED' ? target.id : null,
        systemKey: target.kind === 'SYSTEM' ? target.key : null,
        saved: target.kind === 'SAVED',
        owner: person,
        at: nowIso(),
      });
    return {
      title,
      target,
      category: d.category,
      definition: d,
      range,
      comparisonRange: cmpRange,
      notices:
        compare !== 'NONE' && !src.meta.supportsComparison
          ? ['Comparison is not available for this data source.']
          : [],
      kpis,
      chart,
      breakdown: breakdownChart(src, cur),
      chips,
      table: { columns, rows: pageRows, totals, total, page: q.page, pageSize: q.pageSize },
      insights: insightsOf(src, cur, kpis, range),
      preview: !!q.preview,
      generatedAt: nowIso(),
      stale: false,
      runId,
    };
  };

  const resolveTarget = (t: ReturnType<typeof parseInput<typeof RunReportRequest>>['target']) => {
    if (t.kind === 'SYSTEM') {
      const s = SYSTEM.find((x) => x.key === t.key);
      if (!s) throw fail(404, 'NOT_FOUND', 'That report was not found.');
      return { d: defOf(t.key), title: s.name, target: { kind: 'SYSTEM' as const, key: t.key } };
    }
    if (t.kind === 'SAVED') {
      const r = savedReports.find((x) => x.id === t.id);
      if (!r) throw fail(404, 'NOT_FOUND', 'That report was not found.');
      return { d: r.definition, title: r.name, target: { kind: 'SAVED' as const, id: t.id } };
    }
    return {
      d: viewOf(t.definition as never),
      title: 'Custom Report',
      target: { kind: 'DEFINITION' as const },
    };
  };
  const scheduleRow = (s: ReportScheduleDetail) => {
    const {
      target: _t,
      weekday: _w,
      dayOfMonth: _d,
      monthOfYear: _m,
      runTime: _r,
      timezone: _z,
      datePreset: _p,
      recipientUsers: _u,
      recipientEmails: _e,
      deliverEmail: _de,
      deliverInApp: _di,
      consecutiveFailures: _c,
      createdAt: _ca,
      ...row
    } = s;
    void [_t, _w, _d, _m, _r, _z, _p, _u, _e, _de, _di, _c, _ca];
    return row;
  };
  const DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const describe = (s: {
    frequency: string;
    weekday?: number | null;
    dayOfMonth?: number | null;
    runTime: string;
  }) => {
    const [h, m] = s.runTime.split(':').map(Number);
    const time = `${((h! + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h! >= 12 ? 'PM' : 'AM'}`;
    if (s.frequency === 'DAILY') return `Every day at ${time}`;
    if (s.frequency === 'WEEKLY') return `Every ${DOW[s.weekday ?? 1]} at ${time}`;
    return `${s.dayOfMonth ?? 1}${['th', 'st', 'nd', 'rd'][(s.dayOfMonth ?? 1) % 10 > 3 ? 0 : (s.dayOfMonth ?? 1) % 10] ?? 'th'} of each ${s.frequency === 'MONTHLY' ? 'month' : s.frequency === 'QUARTERLY' ? 'quarter' : 'year'} at ${time}`;
  };

  if (!empty) {
    for (const [n, name, desc, key, freq, wd, dom] of [
      [0, 'Weekly Revenue Report', 'revenue-summary', 'revenue-summary', 'WEEKLY', 1, null],
      [1, 'Monthly Client Report', 'client-retention', 'client-retention', 'MONTHLY', null, 1],
      [2, 'Payroll Summary', 'payroll-summary', 'payroll-summary', 'MONTHLY', null, 1],
      [
        3,
        'Quarterly Tax Report',
        'returns-by-filing-status',
        'returns-by-filing-status',
        'QUARTERLY',
        null,
        1,
      ],
    ] as const) {
      const s = SYSTEM.find((x) => x.key === key)!;
      void desc;
      schedules.push({
        id: id('c800'),
        name,
        reportName: s.name,
        category: s.category,
        frequency: freq,
        description: describe({ frequency: freq, weekday: wd, dayOfMonth: dom, runTime: '08:00' }),
        nextRunAt: new Date(Date.now() + (n + 1) * 2 * DAY).toISOString(),
        lastRunAt: new Date(Date.now() - 5 * DAY).toISOString(),
        lastStatus: 'SUCCEEDED',
        recipientCount: 2,
        formats: ['PDF'],
        owner: person,
        active: n !== 3,
        target: { kind: 'SYSTEM', key },
        weekday: wd,
        dayOfMonth: dom,
        monthOfYear: null,
        runTime: '08:00',
        timezone: 'America/New_York',
        datePreset: 'this_month',
        recipientUsers: [person],
        recipientEmails: [],
        deliverEmail: true,
        deliverInApp: false,
        consecutiveFailures: 0,
        createdAt: nowIso(),
      });
    }
    for (const [i, key] of (
      [
        'revenue-summary',
        'new-clients-month',
        'returns-by-filing-status',
        'top-lead-sources',
      ] as const
    ).entries()) {
      const s = SYSTEM.find((x) => x.key === key)!;
      recent.push({
        runId: id('c900'),
        name: s.name,
        category: s.category,
        kind: 'VIEW',
        savedReportId: null,
        systemKey: key,
        saved: false,
        owner: person,
        at: new Date(Date.now() - (i + 1) * DAY * 2).toISOString(),
      });
    }
  }

  const saveFrom = (
    b: ReturnType<typeof parseInput<typeof SaveReportRequest>>,
  ): SavedReportDetail => {
    const d = viewOf(b.definition as never);
    check(d);
    if (savedReports.some((r) => !r.archived && r.name.toLowerCase() === b.name.toLowerCase()))
      throw fail(409, 'DUPLICATE_NAME', 'A report with this name already exists.');
    const at = nowIso();
    const r: SavedReportDetail = {
      id: id('c700'),
      name: b.name,
      description: b.description ?? null,
      category: d.category,
      dataSource: d.dataSource,
      visibility: b.visibility,
      owner: person,
      favorite: b.favorite,
      archived: false,
      lastRunAt: null,
      scheduleCount: 0,
      updatedAt: at,
      definition: d,
      sharedRoles: b.sharedRoles,
      sharedWith: [],
      canEdit: true,
      createdAt: at,
      etag: `e${next++}`,
    };
    savedReports.unshift(r);
    return r;
  };
  const findSaved = (sid: string) => {
    const r = savedReports.find((x) => x.id === sid);
    if (!r) throw fail(404, 'NOT_FOUND', 'That report was not found.');
    return r;
  };
  const findSchedule = (sid: string) => {
    const r = schedules.find((x) => x.id === sid);
    if (!r) throw fail(404, 'NOT_FOUND', 'That schedule was not found.');
    return r;
  };
  const page = <T>(items: T[], p: number, size: number) => ({
    items: items.slice((p - 1) * size, p * size),
    total: items.length,
    page: p,
    pageSize: size,
  });

  return {
    dashboard: (q = {}) =>
      run(() => {
        const query = parseInput(ReportsDashboardQuery, q);
        const spec =
          query.from && query.to
            ? { rule: 'FIXED' as const, from: query.from, to: query.to }
            : { rule: 'ROLLING' as const, preset: query.preset ?? settings.defaultDatePreset };
        const range = resolveRange(spec);
        const cmpMode = query.compareTo ?? 'SAME_PERIOD_LAST_YEAR';
        const cmp = cmpMode === 'NONE' ? null : shiftRange(range, cmpMode);
        const card = (key: string, source: string, kpiKey: string, label: string) => {
          const src = srcs[source]!;
          const cur = apply(src, defOf(key), range);
          const prev = cmp ? apply(src, defOf(key), cmp) : null;
          const k = kpisOf(src, cur, prev).find((x) => x.key === kpiKey)!;
          return { ...k, label, reportKey: key };
        };
        const kpis = [
          card('client-retention', 'clients', 'total-clients', 'Total Clients'),
          card('new-clients-month', 'clients', 'new-clients', 'New Clients'),
          card('revenue-summary', 'invoices_payments', 'total-revenue', 'Total Revenue'),
          card('returns-by-filing-status', 'returns', 'returns-filed', 'Returns Filed'),
        ];
        const categories = (Object.keys(CATEGORY_LABEL) as Category[]).map((category) => {
          const s = SYSTEM.find((x) => x.category === category)!;
          const src = srcs[s.source]!;
          const cur = apply(src, defOf(s.key), range);
          const hk = kpisOf(src, cur, null)[0] ?? null;
          return {
            category,
            label: CATEGORY_LABEL[category],
            headline: hk,
            chart: breakdownChart(src, cur),
            reportKey: s.key,
            allowed: !(
              role === 'STAFF' &&
              (category === 'TEAM_PRODUCTIVITY' || category === 'FINANCIAL')
            ),
          };
        });
        const insights: ReportInsight[] = [];
        for (const s of SYSTEM.slice(0, 3)) {
          const src = srcs[s.source]!;
          const cur = apply(src, defOf(s.key), range);
          const prev = cmp ? apply(src, defOf(s.key), cmp) : null;
          insights.push(...insightsOf(src, cur, kpisOf(src, cur, prev), range).slice(0, 2));
        }
        return {
          range,
          comparisonRange: cmp,
          kpis,
          categories,
          quickReports: SYSTEM.map((s) => ({
            key: s.key,
            name: s.name,
            description: s.description,
            category: s.category,
            dataSource: s.source,
          })),
          recent: recent.slice(0, 5),
          scheduled: schedules.slice(0, 5).map(scheduleRow),
          insights: insights.slice(0, 5),
          generatedAt: nowIso(),
          stale: false,
          canCreate: role !== 'STAFF',
          canExport: role !== 'STAFF',
        };
      }),
    catalog: () =>
      run(() => ({
        categories: (Object.keys(CATEGORY_LABEL) as Category[]).map((category) => ({
          category,
          label: CATEGORY_LABEL[category],
          reports: SYSTEM.filter((s) => s.category === category).map((s) => ({
            key: s.key,
            name: s.name,
            description: s.description,
            category: s.category,
            dataSource: s.source,
          })),
        })),
      })),
    sources: () => run(() => Object.values(srcs).map((s) => s.meta)),
    lookups: (q) =>
      run(() => {
        const query = parseInput(ReportLookupQuery, q);
        const term = query.search?.toLowerCase();
        const items =
          query.kind === 'SERVICE' || query.kind === 'SERVICE_CATEGORY'
            ? SERVICES
            : query.kind === 'CLIENT'
              ? NAMES
              : query.kind === 'TEAM_MEMBER'
                ? STAFF
                : ['Website', 'Referral', 'Social Media', 'Event', 'Google Ads'];
        return items
          .filter((x) => !term || x.toLowerCase().includes(term))
          .slice(0, query.limit)
          .map((label) => ({ id: label, label }));
      }),
    run: (body) =>
      run(() => {
        const input = parseInput(RunReportRequest, body);
        const t = resolveTarget(input.target);
        const extra = [...(input.extraFilters?.conditions ?? [])];
        if (
          input.quick?.clientType &&
          input.quick.clientType !== 'ALL' &&
          t.d.dataSource === 'clients'
        )
          extra.push({
            field: 'status',
            op: 'IS',
            value:
              input.quick.clientType === 'NEW'
                ? 'New'
                : input.quick.clientType === 'INACTIVE'
                  ? 'Inactive'
                  : 'Active',
          });
        if (input.quick?.serviceCategoryId && t.d.dataSource === 'invoices_payments')
          extra.push({ field: 'serviceCategory', op: 'IS', value: input.quick.serviceCategoryId });
        const d = {
          ...t.d,
          chartType: input.chartType ?? t.d.chartType,
          showDataLabels: input.showDataLabels ?? t.d.showDataLabels,
        };
        return runDef(d, t.title, t.target, {
          ...(input.date ? { date: input.date as never } : {}),
          ...(input.compareTo ? { compareTo: input.compareTo } : {}),
          ...(input.search ? { search: input.search } : {}),
          ...(input.sort ? { sort: input.sort } : {}),
          page: input.page,
          pageSize: input.pageSize,
          preview: input.preview,
          extra: { conditions: extra },
        });
      }),
    recent: (q = {}) =>
      run(() => {
        const query = parseInput(RecentReportsQuery, q);
        const term = query.search?.toLowerCase();
        const list = recent
          .filter(
            (r) =>
              (!query.category || r.category === query.category) &&
              (!query.kind || r.kind === query.kind) &&
              (!term || r.name.toLowerCase().includes(term)),
          )
          .sort(
            (a, b) =>
              (query.sort === 'name'
                ? a.name.localeCompare(b.name)
                : query.sort === 'category'
                  ? a.category.localeCompare(b.category)
                  : a.at.localeCompare(b.at)) * (query.direction === 'asc' ? 1 : -1),
          );
        return page(list, query.page, query.pageSize);
      }),
    saved: (q = {}) =>
      run(() => {
        const query = parseInput(SavedReportsQuery, q);
        const term = query.search?.toLowerCase();
        const list = savedReports
          .filter(
            (r) =>
              (query.includeArchived ? true : !r.archived) &&
              (!query.category || r.category === query.category) &&
              (query.tab !== 'favorites' || r.favorite) &&
              (!term || r.name.toLowerCase().includes(term)),
          )
          .map(
            ({
              definition: _d,
              sharedRoles: _s,
              sharedWith: _w,
              canEdit: _c,
              createdAt: _ca,
              etag: _e,
              ...row
            }) => (void [_d, _s, _w, _c, _ca, _e], row),
          );
        return page(list, query.page, query.pageSize);
      }),
    save: (body) =>
      run(() => {
        manage();
        return saveFrom(parseInput(SaveReportRequest, body));
      }),
    savedReport: (sid) => run(() => findSaved(sid)),
    updateSaved: (sid, body) =>
      run(() => {
        manage();
        const input = parseInput(UpdateSavedReportRequest, body);
        const r = findSaved(sid);
        if (input.etag !== r.etag)
          throw fail(409, 'SAVE_CONFLICT', 'Someone saved this report after you opened it.');
        if (r.archived)
          throw fail(409, 'REPORT_ARCHIVED', 'Restore the report before changing it.');
        if (input.name !== undefined) {
          if (
            savedReports.some(
              (x) =>
                x.id !== r.id && !x.archived && x.name.toLowerCase() === input.name!.toLowerCase(),
            )
          )
            throw fail(409, 'DUPLICATE_NAME', 'A report with this name already exists.');
          r.name = input.name;
        }
        if (input.description !== undefined) r.description = input.description;
        if (input.visibility) r.visibility = input.visibility;
        if (input.definition) r.definition = viewOf(input.definition as never);
        r.etag = `e${next++}`;
        r.updatedAt = nowIso();
        return r;
      }),
    duplicateSaved: (sid, body = {}) =>
      run(() => {
        manage();
        const input = parseInput(DuplicateSavedReportRequest, body);
        const r = findSaved(sid);
        let name = input.name ?? `${r.name} (Copy)`;
        let n = 2;
        while (savedReports.some((x) => !x.archived && x.name.toLowerCase() === name.toLowerCase()))
          name = `${r.name} (Copy ${n++})`;
        const c = {
          ...copy(r),
          id: id('c700'),
          name,
          visibility: 'PRIVATE' as const,
          favorite: false,
          scheduleCount: 0,
          etag: `e${next++}`,
        };
        savedReports.unshift(c);
        return c;
      }),
    archiveSaved: (sid) =>
      run(() => {
        manage();
        const r = findSaved(sid);
        r.archived = true;
        return r;
      }),
    restoreSaved: (sid) =>
      run(() => {
        manage();
        const r = findSaved(sid);
        r.archived = false;
        return r;
      }),
    favorite: (sid) =>
      run(() => {
        const r = findSaved(sid);
        r.favorite = true;
        return r;
      }),
    unfavorite: (sid) =>
      run(() => {
        const r = findSaved(sid);
        r.favorite = false;
        return r;
      }),

    exportReport: (body) =>
      run(() => {
        if (role === 'STAFF')
          throw fail(403, 'EXPORT_NOT_ALLOWED', 'Your role cannot export reports.');
        const input = parseInput(ExportReportRequest, body);
        const t = resolveTarget(input.run.target as never);
        const rid = id('c600');
        const v: ReportRunStatusView = {
          runId: rid,
          kind: 'EXPORT',
          status: 'SUCCEEDED',
          format: input.format,
          rowCount: 25,
          errorCode: null,
          fileName: `${t.title.toLowerCase().replace(/\W+/g, '-')}.${input.format.toLowerCase()}`,
          ready: true,
          createdAt: nowIso(),
          finishedAt: nowIso(),
        };
        runs.set(rid, v);
        return v;
      }),
    runStatus: (rid) =>
      run(() => {
        const v = runs.get(rid);
        if (!v) throw fail(404, 'NOT_FOUND', 'That run was not found.');
        return v;
      }),
    download: (rid) =>
      run(() => {
        const v = runs.get(rid);
        if (!v) throw fail(404, 'NOT_FOUND', 'That run was not found.');
        return {
          url: `mock:download/${v.fileName}`,
          expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
        };
      }),

    schedules: (q = {}) =>
      run(() => {
        const query = parseInput(ReportSchedulesQuery, q);
        const term = query.search?.toLowerCase();
        return page(
          schedules
            .filter(
              (s) =>
                (query.status === 'all' || (query.status === 'active' ? s.active : !s.active)) &&
                (!term || s.name.toLowerCase().includes(term)),
            )
            .map(scheduleRow),
          query.page,
          query.pageSize,
        );
      }),
    createSchedule: (body) =>
      run(() => {
        manage();
        const input = parseInput(CreateReportScheduleRequest, body);
        let target: ReportScheduleDetail['target'];
        let reportName: string;
        let category: Category;
        if (input.target.kind === 'NEW') {
          const r = saveFrom(input.target.report);
          target = { kind: 'SAVED', id: r.id };
          reportName = r.name;
          category = r.category;
          r.scheduleCount += 1;
        } else if (input.target.kind === 'SAVED') {
          const r = findSaved(input.target.id);
          target = { kind: 'SAVED', id: r.id };
          reportName = r.name;
          category = r.category;
          r.scheduleCount += 1;
        } else {
          const s = SYSTEM.find((x) => x.key === (input.target as { key: string }).key);
          if (!s) throw fail(404, 'NOT_FOUND', 'That report was not found.');
          target = { kind: 'SYSTEM', key: s.key };
          reportName = s.name;
          category = s.category;
        }
        const s: ReportScheduleDetail = {
          id: id('c800'),
          name: input.name,
          reportName,
          category,
          frequency: input.frequency,
          description: describe(input),
          nextRunAt: new Date(Date.now() + DAY).toISOString(),
          lastRunAt: null,
          lastStatus: null,
          recipientCount: input.recipientUserIds.length + input.recipientEmails.length,
          formats: input.formats,
          owner: person,
          active: input.active,
          target,
          weekday: input.weekday ?? null,
          dayOfMonth: input.dayOfMonth ?? null,
          monthOfYear: input.monthOfYear ?? null,
          runTime: input.runTime,
          timezone: 'America/New_York',
          datePreset: input.datePreset,
          recipientUsers: input.recipientUserIds.length ? [person] : [],
          recipientEmails: input.recipientEmails,
          deliverEmail: input.deliverEmail,
          deliverInApp: input.deliverInApp,
          consecutiveFailures: 0,
          createdAt: nowIso(),
        };
        schedules.unshift(s);
        return s;
      }),
    schedule: (sid) => run(() => findSchedule(sid)),
    updateSchedule: (sid, body) =>
      run(() => {
        manage();
        const input = parseInput(UpdateReportScheduleRequest, body);
        const s = findSchedule(sid);
        Object.assign(
          s,
          Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)),
        );
        s.description = describe(s);
        return s;
      }),
    pauseSchedule: (sid) =>
      run(() => {
        manage();
        const s = findSchedule(sid);
        s.active = false;
        return s;
      }),
    resumeSchedule: (sid) =>
      run(() => {
        manage();
        const s = findSchedule(sid);
        s.active = true;
        return s;
      }),
    duplicateSchedule: (sid) =>
      run(() => {
        manage();
        const s = findSchedule(sid);
        const c = { ...copy(s), id: id('c800'), name: `${s.name} (Copy)`, active: false };
        schedules.unshift(c);
        return c;
      }),
    runScheduleNow: (sid) =>
      run(() => {
        manage();
        const s = findSchedule(sid);
        s.lastRunAt = nowIso();
        s.lastStatus = 'SUCCEEDED';
        const rid = id('c600');
        const v: ReportRunStatusView = {
          runId: rid,
          kind: 'SCHEDULED',
          status: 'SUCCEEDED',
          format: s.formats[0] ?? 'PDF',
          rowCount: 12,
          errorCode: null,
          fileName: `${s.name.toLowerCase().replace(/\W+/g, '-')}.pdf`,
          ready: true,
          createdAt: nowIso(),
          finishedAt: nowIso(),
        };
        runs.set(rid, v);
        return v;
      }),
    deleteSchedule: (sid) =>
      run(() => {
        manage();
        findSchedule(sid);
        schedules.splice(
          schedules.findIndex((x) => x.id === sid),
          1,
        );
        return { ok: true as const };
      }),

    settings: () => run(() => settings),
    saveSettings: (body) =>
      run(() => {
        manage();
        const input = parseInput(SaveReportSettingsRequest, body);
        settings = {
          ...settings,
          ...Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)),
          updatedAt: nowIso(),
        } as ReportSettingsView;
        return settings;
      }),
  };
}
