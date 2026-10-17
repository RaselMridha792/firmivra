import {
  ApiRequestError,
  type ComplianceApplicabilityRule,
  type ComplianceCalendar,
  type ComplianceClientRef,
  type ComplianceDeadline,
  type ComplianceDeadlineRow,
  type ComplianceDisplayStatus,
  type ComplianceLog,
  type ComplianceRecurrence,
  type ComplianceSettings,
  type ComplianceSuggestion,
  type MemberRef,
} from '@firmivra/types';
import { mockMe } from './appointments';
import { teamFixtures } from './team';

/**
 * The data both halves of the Compliance mock share (mocks/compliance.ts: deadlines;
 * mocks/compliance-library.ts: calendars, recurrences, rules, logs). Synthetic people and
 * deadlines only, dated around today so Overdue, Due Soon and the month calendar are always full.
 */
export type MockRole = 'OWNER' | 'ADMIN' | 'STAFF';
export interface Options {
  role?: MockRole;
  empty?: boolean;
}

const DAY = 86_400_000;
export const uuid = (block: string, n: number) =>
  `0199c0f0-${block}-7000-8000-${String(n).padStart(12, '0')}`;
export const fail = (status: number, code: string, message: string) =>
  new ApiRequestError(status, code, message);
export const copy = <T>(value: T): T => structuredClone(value);
export const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
export const today = () => iso(Date.now());
export const plus = (date: string, days: number) =>
  iso(Date.parse(`${date}T12:00:00Z`) + days * DAY);
export const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / DAY);
export const nowIso = () => new Date().toISOString();

export const CLIENTS: ComplianceClientRef[] = [
  {
    id: '0199b6a1-0000-7000-8000-000000000001',
    displayName: 'Jamie Sample',
    clientNumber: 1001,
    accountType: 'INDIVIDUAL',
  },
  {
    id: '0199b6a1-0000-7000-8000-000000000003',
    displayName: 'Riley Example',
    clientNumber: 1003,
    accountType: 'INDIVIDUAL',
  },
  {
    id: uuid('1c00', 3),
    displayName: 'Taylor Construction LLC',
    clientNumber: 1004,
    accountType: 'BUSINESS',
  },
  {
    id: uuid('1c00', 4),
    displayName: 'Green Leaf Events',
    clientNumber: 1005,
    accountType: 'BUSINESS',
  },
  {
    id: uuid('1c00', 5),
    displayName: 'Nova Creations',
    clientNumber: 1006,
    accountType: 'BUSINESS',
  },
  {
    id: '0199b6a1-0000-7000-8000-000000000002',
    displayName: 'Acme Widgets LLC (fake)',
    clientNumber: 1002,
    accountType: 'BUSINESS',
  },
];
export const KEVIN: MemberRef = {
  userId: '0199c0f0-0b00-7000-8000-000000000001',
  name: 'Kevin Martin',
};
export const ALICIA: MemberRef = {
  userId: '0199c0f0-0b00-7000-8000-000000000002',
  name: 'Alicia Park',
};
export const MEMBERS: MemberRef[] = [mockMe, KEVIN, ALICIA];
/** A team member by user id. The team mock's people are known too, so the pickers' choices work. */
export const memberOf = (userId: string | null | undefined): MemberRef | null => {
  if (!userId) return null;
  const known = MEMBERS.find((m) => m.userId === userId);
  if (known) return known;
  const teammate = teamFixtures().find((m) => m.user.id === userId);
  return { userId, name: teammate?.user.name ?? 'Team member' };
};

export interface Store {
  deadlines: ComplianceDeadline[];
  calendars: ComplianceCalendar[];
  recurrences: ComplianceRecurrence[];
  rules: ComplianceApplicabilityRule[];
  suggestions: ComplianceSuggestion[];
  logs: ComplianceLog[];
  settings: ComplianceSettings;
  next: number;
}

const isOpen = (status: string) =>
  status === 'UPCOMING' || status === 'IN_PROGRESS' || status === 'WAITING_ON_CLIENT';

/** The date the deadline is judged by: the extended date when an extension was filed. */
export const effectiveDue = (d: Pick<ComplianceDeadline, 'dueOn' | 'extendedDueOn'>) =>
  d.extendedDueOn ?? d.dueOn;

/** Due Soon and Overdue are never stored: they come from the date, the threshold and the status. */
export function displayStatusOf(
  d: Pick<ComplianceDeadline, 'status' | 'dueOn' | 'extendedDueOn'>,
  dueSoonDays: number,
): ComplianceDisplayStatus {
  if (!isOpen(d.status)) return d.status as ComplianceDisplayStatus;
  const days = daysBetween(today(), effectiveDue(d));
  if (days < 0) return 'OVERDUE';
  if (d.status === 'UPCOMING' && days <= dueSoonDays) return 'DUE_SOON';
  return d.status as ComplianceDisplayStatus;
}

/** A stored deadline with the fields that depend on today brought up to date. */
export function fresh(d: ComplianceDeadline, settings: ComplianceSettings): ComplianceDeadline {
  const out = copy(d);
  out.daysUntilDue = daysBetween(today(), effectiveDue(d));
  out.displayStatus = displayStatusOf(d, settings.dueSoonDays);
  out.relatedDeadlines = out.relatedDeadlines.map((r) => ({ ...r }));
  return out;
}

export function toRow(d: ComplianceDeadline): ComplianceDeadlineRow {
  return {
    id: d.id,
    name: d.name,
    type: d.type,
    source: d.source,
    agency: d.agency,
    client: d.client,
    dueOn: d.dueOn,
    dueTime: d.dueTime,
    extendedDueOn: d.extendedDueOn,
    status: d.status,
    displayStatus: d.displayStatus,
    daysUntilDue: d.daysUntilDue,
    priority: d.priority,
    assignedTo: d.assignedTo,
    taxYear: d.taxYear,
    filingPeriod: d.filingPeriod,
    relatedForm: d.relatedForm,
    state: d.state,
    recurring: d.recurring,
    archived: d.archived,
  };
}

export const DEFAULT_SETTINGS: ComplianceSettings = {
  dueSoonDays: 14,
  atRiskDays: 7,
  staleCalendarDays: 180,
  defaultReminders: [
    { daysBefore: 30, inApp: true, channels: ['EMAIL'] },
    { daysBefore: 7, inApp: true, channels: ['EMAIL'] },
    { daysBefore: 1, inApp: true, channels: [] },
  ],
  sendPastDueNotice: true,
  escalateToManager: false,
  escalateAfterDays: 3,
  taskTemplates: [],
};

type Seed = {
  name: string;
  type: ComplianceDeadline['type'];
  source: ComplianceDeadline['source'];
  client: number;
  offset: number;
  status?: ComplianceDeadline['status'];
  priority?: ComplianceDeadline['priority'];
  agency: string;
  form?: string;
  state?: string;
  assignee?: MemberRef | null;
  recurring?: boolean;
  period?: string;
  completedAgo?: number;
};

export function blankDeadline(
  id: string,
  client: ComplianceClientRef,
  fields: Partial<ComplianceDeadline> & {
    name: string;
    type: ComplianceDeadline['type'];
    dueOn: string;
  },
): ComplianceDeadline {
  const at = nowIso();
  return {
    id,
    source: 'FIRM',
    agency: null,
    client,
    dueTime: null,
    extendedDueOn: null,
    status: 'UPCOMING',
    displayStatus: 'UPCOMING',
    daysUntilDue: 0,
    priority: 'MEDIUM',
    assignedTo: null,
    taxYear: null,
    filingPeriod: null,
    relatedForm: null,
    state: null,
    recurring: false,
    archived: false,
    description: null,
    internalNotes: null,
    clientNotes: null,
    engagementId: null,
    entityType: null,
    jurisdiction: null,
    statutoryDueOn: null,
    dueOverridden: false,
    dueOverrideReason: null,
    extensionFiledOn: null,
    paymentDueOn: null,
    clientVisible: false,
    createTask: false,
    taskTemplateId: null,
    completedAt: null,
    completedBy: null,
    filedOn: null,
    confirmationNumber: null,
    notApplicableReason: null,
    calendarEntry: null,
    applicabilityReason: null,
    recurrence: null,
    createdBy: mockMe,
    reminders: [],
    documents: [],
    tasks: [],
    relatedDeadlines: [],
    calendarStale: false,
    createdAt: at,
    updatedAt: at,
    archivedAt: null,
    ...fields,
  };
}

const SEEDS: Seed[] = [
  {
    name: 'Q3 Estimated Tax Payment',
    type: 'ESTIMATED_TAX',
    source: 'GOVERNMENT',
    client: 0,
    offset: -9,
    priority: 'HIGH',
    agency: 'IRS',
    form: '1040-ES',
    assignee: KEVIN,
    period: 'Q3',
  },
  {
    name: 'Form 941 Quarterly Payroll Return',
    type: 'PAYROLL',
    source: 'GOVERNMENT',
    client: 2,
    offset: -4,
    priority: 'HIGH',
    agency: 'IRS',
    form: '941',
    assignee: ALICIA,
    recurring: true,
    period: 'Q3',
  },
  {
    name: 'Georgia Sales Tax Return',
    type: 'SALES_TAX',
    source: 'GOVERNMENT',
    client: 3,
    offset: -2,
    status: 'WAITING_ON_CLIENT',
    agency: 'GA DOR',
    state: 'GA',
    assignee: mockMe,
    recurring: true,
    period: 'September',
  },
  {
    name: 'Form 1065 Partnership Return',
    type: 'TAX_FILING',
    source: 'GOVERNMENT',
    client: 2,
    offset: 3,
    priority: 'HIGH',
    agency: 'IRS',
    form: '1065',
    assignee: KEVIN,
    period: 'Tax year',
  },
  {
    name: 'Annual Registration',
    type: 'ANNUAL_REPORT',
    source: 'GOVERNMENT',
    client: 3,
    offset: 6,
    agency: 'GA Secretary of State',
    state: 'GA',
    assignee: ALICIA,
  },
  {
    name: 'Monthly Bookkeeping Close',
    type: 'BOOKKEEPING',
    source: 'FIRM',
    client: 4,
    offset: 8,
    status: 'IN_PROGRESS',
    agency: 'Firm',
    assignee: mockMe,
    recurring: true,
    period: 'October',
  },
  {
    name: 'Form 1120-S S Corporation Return',
    type: 'TAX_FILING',
    source: 'GOVERNMENT',
    client: 4,
    offset: 12,
    priority: 'HIGH',
    agency: 'IRS',
    form: '1120-S',
    assignee: KEVIN,
  },
  {
    name: 'Form 2553 S Election',
    type: 'ELECTION',
    source: 'CLIENT_SPECIFIC',
    client: 1,
    offset: 15,
    agency: 'IRS',
    form: '2553',
    assignee: ALICIA,
  },
  {
    name: 'Quarterly Payroll Tax Deposit',
    type: 'PAYROLL',
    source: 'GOVERNMENT',
    client: 2,
    offset: 19,
    agency: 'IRS',
    assignee: mockMe,
    recurring: true,
  },
  {
    name: 'Business License Renewal',
    type: 'LICENSE_PERMIT',
    source: 'GOVERNMENT',
    client: 3,
    offset: 24,
    agency: 'City of Atlanta',
    state: 'GA',
    assignee: ALICIA,
  },
  {
    name: 'Form 940 Annual Unemployment Tax',
    type: 'PAYROLL',
    source: 'GOVERNMENT',
    client: 2,
    offset: 33,
    agency: 'IRS',
    form: '940',
    assignee: KEVIN,
  },
  {
    name: 'Q4 Estimated Tax Payment',
    type: 'ESTIMATED_TAX',
    source: 'GOVERNMENT',
    client: 0,
    offset: 40,
    agency: 'IRS',
    form: '1040-ES',
    assignee: KEVIN,
    recurring: true,
  },
  {
    name: 'Year-End Tax Planning Review',
    type: 'ADVISORY',
    source: 'FIRM',
    client: 1,
    offset: 47,
    agency: 'Firm',
    assignee: mockMe,
  },
  {
    name: 'Document Request Cut-off',
    type: 'OTHER',
    source: 'FIRM',
    client: 4,
    offset: 55,
    agency: 'Firm',
    assignee: ALICIA,
  },
  {
    name: 'Form 1040 Individual Return',
    type: 'TAX_FILING',
    source: 'GOVERNMENT',
    client: 1,
    offset: 120,
    priority: 'HIGH',
    agency: 'IRS',
    form: '1040',
    assignee: KEVIN,
  },
  {
    name: 'Q2 Estimated Tax Payment',
    type: 'ESTIMATED_TAX',
    source: 'GOVERNMENT',
    client: 0,
    offset: -48,
    status: 'COMPLETED',
    agency: 'IRS',
    form: '1040-ES',
    assignee: KEVIN,
    completedAgo: 50,
  },
  {
    name: 'Form 941 Quarterly Payroll Return',
    type: 'PAYROLL',
    source: 'GOVERNMENT',
    client: 2,
    offset: -20,
    status: 'COMPLETED',
    agency: 'IRS',
    form: '941',
    assignee: ALICIA,
    recurring: true,
    completedAgo: 22,
    period: 'Q2',
  },
  {
    name: 'Georgia Sales Tax Return',
    type: 'SALES_TAX',
    source: 'GOVERNMENT',
    client: 3,
    offset: -12,
    status: 'COMPLETED',
    agency: 'GA DOR',
    state: 'GA',
    assignee: mockMe,
    recurring: true,
    completedAgo: 13,
    period: 'August',
  },
  {
    name: 'Monthly Bookkeeping Close',
    type: 'BOOKKEEPING',
    source: 'FIRM',
    client: 4,
    offset: -10,
    status: 'COMPLETED',
    agency: 'Firm',
    assignee: mockMe,
    recurring: true,
    completedAgo: 10,
    period: 'September',
  },
  {
    name: 'Annual Report',
    type: 'ANNUAL_REPORT',
    source: 'GOVERNMENT',
    client: 4,
    offset: -6,
    status: 'COMPLETED',
    agency: 'NC Secretary of State',
    state: 'NC',
    assignee: ALICIA,
    completedAgo: 7,
  },
  {
    name: 'Form 7004 Extension Request',
    type: 'TAX_FILING',
    source: 'FIRM',
    client: 2,
    offset: -3,
    status: 'COMPLETED',
    agency: 'IRS',
    form: '7004',
    assignee: KEVIN,
    completedAgo: 3,
  },
];

export function seedDeadlines(): ComplianceDeadline[] {
  const d0 = today();
  const out = SEEDS.map((s, i) => {
    const client = CLIENTS[s.client]!;
    const dueOn = plus(d0, s.offset);
    const done = s.status === 'COMPLETED';
    const doneAt = done ? new Date(Date.now() - (s.completedAgo ?? 1) * DAY).toISOString() : null;
    return blankDeadline(uuid('2d00', i + 1), client, {
      name: s.name,
      type: s.type,
      source: s.source,
      agency: s.agency,
      dueOn,
      status: s.status ?? 'UPCOMING',
      priority: s.priority ?? 'MEDIUM',
      assignedTo: s.assignee === undefined ? mockMe : s.assignee,
      relatedForm: s.form ?? null,
      state: s.state ?? null,
      jurisdiction: s.state ? 'STATE' : s.agency === 'Firm' ? 'INTERNAL' : 'FEDERAL',
      recurring: s.recurring ?? false,
      recurrence: s.recurring
        ? { id: uuid('3e00', 1 + (i % 3)), name: 'Recurring deadline' }
        : null,
      taxYear: new Date().getFullYear(),
      filingPeriod: s.period ?? null,
      statutoryDueOn: dueOn,
      completedAt: doneAt,
      completedBy: done ? (s.assignee ?? mockMe) : null,
      filedOn: done ? iso(Date.parse(doneAt!)) : null,
      confirmationNumber: done ? `CONF-${1000 + i}` : null,
      reminders: [
        { daysBefore: 7, inApp: true, channels: ['EMAIL'] },
        { daysBefore: 1, inApp: true, channels: [] },
      ],
      description: `${s.name} for ${client.displayName}.`,
      clientVisible: i % 3 === 0,
    });
  });
  // One archived deadline, for the Archived list.
  out.push(
    blankDeadline(uuid('2d00', 99), CLIENTS[0]!, {
      name: 'Form 4868 Extension (old)',
      type: 'TAX_FILING',
      agency: 'IRS',
      dueOn: plus(d0, -200),
      status: 'CANCELLED',
      archived: true,
      archivedAt: nowIso(),
    }),
  );
  return out;
}
