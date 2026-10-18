import {
  ApiRequestError,
  type PayrollActivity,
  type PayrollClientChange,
  type PayrollClientRef,
  type PayrollClientStatus,
  type PayrollFiling,
  type PayrollFrequency,
  type PayrollIssue,
  type PayrollReport,
  type PayrollRunFigures,
  type PayrollRunLine,
  type PayrollRunRow,
  type PayrollRunStatus,
  type PayrollWorker,
  type PayrollYearEnd,
  type MemberRef,
} from '@firmivra/types';
import { mockMe } from './appointments';
import { teamFixtures } from './team';

/**
 * The data both halves of the Payroll mock share (mocks/payroll.ts). Synthetic businesses and
 * people only, dated around today so every period, pay date and status is always current.
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
export const nowIso = () => new Date().toISOString();
export const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / DAY);

export const PROVIDERS: Record<string, string> = {
  gusto: 'Gusto',
  adp: 'ADP',
  paychex: 'Paychex',
  quickbooks_payroll: 'QuickBooks Payroll',
  onpay: 'OnPay',
};
export const providerRef = (key: string | null) =>
  key ? { key, label: PROVIDERS[key] ?? key, connected: true } : null;

const KEVIN: MemberRef = { userId: '0199c0f0-0b00-7000-8000-000000000001', name: 'Kevin Martin' };
const ALICIA: MemberRef = { userId: '0199c0f0-0b00-7000-8000-000000000002', name: 'Alicia Park' };
export const MEMBERS: MemberRef[] = [mockMe, KEVIN, ALICIA];
export const memberOf = (userId: string | null | undefined): MemberRef | null => {
  if (!userId) return null;
  const known = MEMBERS.find((m) => m.userId === userId);
  if (known) return known;
  const teammate = teamFixtures().find((m) => m.user.id === userId);
  return { userId, name: teammate?.user.name ?? 'Team member' };
};

export interface Run {
  id: string;
  clientId: string;
  periodStart: string;
  periodEnd: string;
  payDate: string;
  frequency: PayrollFrequency;
  status: PayrollRunStatus;
  step: number;
  includeContractors: boolean;
  providerStatus: string | null;
  providerConfirmation: string | null;
  lines: PayrollRunLine[];
  issues: PayrollIssue[];
  employeeTaxesCents: number | null;
  employerTaxesCents: number | null;
  employerBenefitsCents: number | null;
  preparedBy: MemberRef | null;
  readyAt: string | null;
  approvedAt: string | null;
  approvedBy: MemberRef | null;
  submittedAt: string | null;
  submittedBy: MemberRef | null;
  reopenedAt: string | null;
  reopenReason: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Rec {
  id: string;
  client: PayrollClientRef;
  engagementId: string;
  plan: string | null;
  status: PayrollClientStatus;
  frequency: PayrollFrequency | null;
  industry: string | null;
  providerKey: string | null;
  serviceSince: string | null;
  nextPayrollOverride: string | null;
  lastSyncedAt: string | null;
  lastSyncAttemptAt: string | null;
  assignedTo: MemberRef | null;
  pausedAt: string | null;
  archivedAt: string | null;
  workers: PayrollWorker[];
  runs: Run[];
  filings: PayrollFiling[];
  reports: PayrollReport[];
  activities: PayrollActivity[];
  changes: PayrollClientChange[];
  yearEnd: Record<number, PayrollYearEnd>;
  createdAt: string;
}

export interface Store {
  clients: Rec[];
  settings: {
    defaultAssignee: MemberRef | null;
    reminderDaysBefore: number;
    staleAfterHours: number;
    updatedAt: string | null;
  };
  next: number;
}

export const PERIODS_PER_YEAR: Record<PayrollFrequency, number> = {
  WEEKLY: 52,
  BIWEEKLY: 26,
  SEMI_MONTHLY: 24,
  MONTHLY: 12,
};
const HOURS: Record<PayrollFrequency, number> = {
  WEEKLY: 40,
  BIWEEKLY: 80,
  SEMI_MONTHLY: 86.67,
  MONTHLY: 173.33,
};

const eom = (y: number, m: number) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
const ymd = (y: number, m: number, d: number) => iso(Date.UTC(y, m, d, 12));

/** The pay period that contains `date`, and the ones before and after it, for a frequency. */
export function periodAt(freq: PayrollFrequency, date: string, offset: number) {
  const d = new Date(`${date}T12:00:00Z`);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  const day = d.getUTCDate();
  let start: string;
  let end: string;
  if (freq === 'WEEKLY' || freq === 'BIWEEKLY') {
    const len = freq === 'WEEKLY' ? 7 : 14;
    const anchor = Date.parse('2026-01-05T12:00:00Z');
    const n = Math.floor((d.getTime() - anchor) / DAY / len) + offset;
    start = iso(anchor + n * len * DAY);
    end = plus(start, len - 1);
  } else if (freq === 'MONTHLY') {
    const t = new Date(Date.UTC(y, m + offset, 1));
    start = ymd(t.getUTCFullYear(), t.getUTCMonth(), 1);
    end = ymd(t.getUTCFullYear(), t.getUTCMonth(), eom(t.getUTCFullYear(), t.getUTCMonth()));
  } else {
    const half = (day <= 15 ? 0 : 1) + offset;
    const t = new Date(Date.UTC(y, m + Math.floor(half / 2), 1));
    const ty = t.getUTCFullYear();
    const tm = t.getUTCMonth();
    const second = ((half % 2) + 2) % 2 === 1;
    start = ymd(ty, tm, second ? 16 : 1);
    end = ymd(ty, tm, second ? eom(ty, tm) : 15);
  }
  return { start, end, pay: plus(end, 4) };
}

const FIRST = [
  'Jasmine',
  'Marcus',
  'Emily',
  'Robert',
  'Ashley',
  'Daniel',
  'Priya',
  'Luis',
  'Chen',
  'Hannah',
  'Omar',
  'Grace',
  'Noah',
  'Sofia',
  'Ethan',
  'Maya',
  'Liam',
  'Zoe',
  'Isaac',
  'Nina',
  'Owen',
  'Ruby',
  'Caleb',
  'Tessa',
  'Felix',
];
const LAST = [
  'Smith',
  'Davis',
  'Wilson',
  'Johnson',
  'Thompson',
  'Lee',
  'Patel',
  'Garcia',
  'Nguyen',
  'Brown',
  'Khan',
  'Moore',
  'Clark',
  'Lopez',
  'Young',
  'King',
  'Wright',
  'Scott',
  'Adams',
  'Baker',
  'Hill',
  'Reed',
  'Cole',
  'Ward',
  'Fox',
];

const MONEY = (cents: number) => Math.round(cents);

function makeWorkers(
  seed: number,
  count: number,
  contractors: number,
  partTime: number,
  onLeave: number,
  since: string,
): PayrollWorker[] {
  const out: PayrollWorker[] = [];
  for (let i = 0; i < count; i += 1) {
    const type: PayrollWorker['workerType'] =
      i >= count - contractors
        ? 'CONTRACTOR'
        : i >= count - contractors - partTime
          ? 'PART_TIME'
          : 'FULL_TIME';
    const hourly = i % 4 !== 3;
    const status: PayrollWorker['status'] = i === 3 && onLeave > 0 ? 'ON_LEAVE' : 'ACTIVE';
    out.push({
      id: uuid('9a00', seed * 100 + i + 1),
      displayName: `${FIRST[(i + seed) % FIRST.length]} ${LAST[(i * 3 + seed) % LAST.length]}`,
      workerType: type,
      status,
      payType: hourly ? 'HOURLY' : 'SALARY',
      rateCents: hourly ? 1500 + ((i * 175 + seed * 50) % 1800) : 5_200_000 + i * 100_000,
      department: i % 2 === 0 ? 'Operations' : 'Front of house',
      jobTitle: type === 'CONTRACTOR' ? 'Contractor' : i % 3 === 0 ? 'Supervisor' : 'Team member',
      startedOn: plus(since, i * 9),
      directDepositReady: true,
      source: 'provider',
      lastChangeAt: new Date(Date.now() - (i + 1) * 4 * DAY).toISOString(),
      lastChangeNote: i % 3 === 0 ? 'Pay rate updated' : 'Profile synced',
    });
  }
  return out;
}

export function linesFor(
  workers: PayrollWorker[],
  freq: PayrollFrequency,
  includeContractors: boolean,
  factor: number,
): PayrollRunLine[] {
  return workers
    .filter((w) => w.status !== 'INACTIVE' && (includeContractors || w.workerType !== 'CONTRACTOR'))
    .map((w, i) => {
      const hours =
        w.payType === 'SALARY'
          ? 0
          : w.workerType === 'PART_TIME'
            ? Math.round(HOURS[freq] * 0.7 * 100) / 100
            : HOURS[freq];
      const regular =
        w.payType === 'SALARY'
          ? MONEY(((w.rateCents ?? 0) / PERIODS_PER_YEAR[freq]) * factor)
          : MONEY((w.rateCents ?? 0) * hours * factor);
      const overtime =
        w.payType === 'HOURLY' && i % 5 === 1 ? MONEY((w.rateCents ?? 0) * 1.5 * 4) : 0;
      const other = i % 4 === 2 ? 5000 : 0;
      const deductions = MONEY((regular + overtime + other) * 0.14);
      const onLeave = w.status === 'ON_LEAVE';
      return {
        id: uuid('9b00', Math.floor(Math.random() * 1e9)),
        worker: {
          id: w.id,
          displayName: w.displayName,
          workerType: w.workerType,
          status: w.status,
          payType: w.payType,
          rateCents: w.rateCents,
        },
        hours: onLeave ? 0 : hours,
        regularPayCents: onLeave ? 0 : regular,
        overtimePayCents: onLeave ? 0 : overtime,
        otherEarningsCents: onLeave ? 0 : other,
        deductionsCents: onLeave ? 0 : deductions,
        totalPayCents: onLeave ? 0 : regular + overtime + other - deductions,
        status: i % 7 === 4 ? 'WARNING' : 'READY',
        note: null,
      } satisfies PayrollRunLine;
    });
}

/** The figures of a run: only what the lines and the entered taxes support, nothing invented. */
export function figuresOf(run: Run): PayrollRunFigures {
  const live = run.lines.filter((l) => l.status !== 'EXCLUDED');
  const sum = (f: (l: PayrollRunLine) => number) => live.reduce((n, l) => n + f(l), 0);
  const gross = sum((l) => l.regularPayCents + l.overtimePayCents + l.otherEarningsCents);
  if (run.lines.length === 0) {
    return {
      employeeCount: null,
      regularPayCents: null,
      overtimePayCents: null,
      otherEarningsCents: null,
      grossCents: null,
      employeeTaxesCents: null,
      deductionsCents: null,
      netCents: null,
      employerTaxesCents: null,
      employerBenefitsCents: null,
      employerCostsCents: null,
      totalCostCents: null,
      confirmed: false,
    };
  }
  const employeeTaxes = run.employeeTaxesCents ?? Math.round(gross * 0.12);
  const deductions = sum((l) => l.deductionsCents);
  const employerTaxes = run.employerTaxesCents ?? Math.round(gross * 0.0765);
  const benefits = run.employerBenefitsCents ?? Math.round(gross * 0.038);
  const costs = employerTaxes + benefits;
  return {
    employeeCount: live.length,
    regularPayCents: sum((l) => l.regularPayCents),
    overtimePayCents: sum((l) => l.overtimePayCents),
    otherEarningsCents: sum((l) => l.otherEarningsCents),
    grossCents: gross,
    employeeTaxesCents: employeeTaxes,
    deductionsCents: deductions,
    netCents: gross - employeeTaxes - deductions,
    employerTaxesCents: employerTaxes,
    employerBenefitsCents: benefits,
    employerCostsCents: costs,
    totalCostCents: gross + costs,
    confirmed: run.status === 'COMPLETED',
  };
}

export function rowOf(rec: Rec, run: Run): PayrollRunRow {
  const f = figuresOf(run);
  return {
    id: run.id,
    payrollClientId: rec.id,
    clientName: rec.client.displayName,
    periodStart: run.periodStart,
    periodEnd: run.periodEnd,
    payDate: run.payDate,
    frequency: run.frequency,
    status: run.status,
    step: run.step,
    employeeCount: f.employeeCount,
    totalCostCents: f.totalCostCents,
    grossCents: f.grossCents,
    providerStatus: run.providerStatus,
  };
}

interface Spec {
  name: string;
  provider: string | null;
  freq: PayrollFrequency;
  workers: number;
  contractors?: number;
  partTime?: number;
  onLeave?: number;
  run: 'none' | 'inprogress' | 'ready' | 'submitted' | 'attention' | 'pastdue';
  type?: 'INDIVIDUAL' | 'BUSINESS';
  industry: string;
  assignee: MemberRef;
}
const SPECS: Spec[] = [
  {
    name: 'Green Leaf Café LLC',
    provider: 'gusto',
    freq: 'SEMI_MONTHLY',
    workers: 25,
    partTime: 5,
    onLeave: 1,
    run: 'inprogress',
    industry: 'Restaurant',
    assignee: KEVIN,
  },
  {
    name: 'Turner Group LLC',
    provider: 'adp',
    freq: 'WEEKLY',
    workers: 12,
    partTime: 2,
    run: 'submitted',
    industry: 'Construction',
    assignee: ALICIA,
  },
  {
    name: 'Davis Consulting',
    provider: 'quickbooks_payroll',
    freq: 'MONTHLY',
    workers: 6,
    run: 'attention',
    industry: 'Consulting',
    assignee: mockMe,
  },
  {
    name: 'Walker Properties',
    provider: 'paychex',
    freq: 'BIWEEKLY',
    workers: 18,
    partTime: 4,
    run: 'ready',
    industry: 'Real estate',
    assignee: KEVIN,
  },
  {
    name: 'Jordan Services',
    provider: 'onpay',
    freq: 'WEEKLY',
    workers: 9,
    contractors: 2,
    run: 'pastdue',
    industry: 'Cleaning',
    assignee: ALICIA,
  },
  {
    name: 'Smith Enterprises',
    provider: 'gusto',
    freq: 'SEMI_MONTHLY',
    workers: 22,
    partTime: 6,
    run: 'none',
    industry: 'Retail',
    assignee: mockMe,
  },
  {
    name: 'Thompson Holdings',
    provider: 'paychex',
    freq: 'MONTHLY',
    workers: 14,
    run: 'submitted',
    industry: 'Holding company',
    assignee: KEVIN,
  },
  {
    name: 'Roberts & Co.',
    provider: null,
    freq: 'MONTHLY',
    workers: 8,
    run: 'none',
    industry: 'Accounting',
    assignee: ALICIA,
  },
];

export function seedStore(empty: boolean): Store {
  const store: Store = {
    clients: [],
    settings: {
      defaultAssignee: null,
      reminderDaysBefore: 3,
      staleAfterHours: 48,
      updatedAt: null,
    },
    next: 1000,
  };
  if (empty) return store;
  const d0 = today();
  SPECS.forEach((s, idx) => {
    const n = idx + 1;
    const recId = uuid('9c00', n);
    const workers = makeWorkers(
      n,
      s.workers,
      s.contractors ?? 0,
      s.partTime ?? 0,
      s.onLeave ?? 0,
      '2023-03-01',
    );
    const runs: Run[] = [];
    const mk = (offset: number, status: PayrollRunStatus, k: number): Run => {
      const p = periodAt(s.freq, d0, offset);
      const done = status === 'COMPLETED';
      const run: Run = {
        id: uuid('9d00', n * 100 + k),
        clientId: recId,
        periodStart: p.start,
        periodEnd: p.end,
        payDate: p.pay,
        frequency: s.freq,
        status,
        step: status === 'NOT_STARTED' ? 1 : done ? 5 : 2,
        includeContractors: true,
        providerStatus: done ? 'paid' : status === 'SUBMITTED' ? 'processing' : null,
        providerConfirmation: done || status === 'SUBMITTED' ? `CONF-${n}${k}` : null,
        lines:
          status === 'NOT_STARTED'
            ? []
            : linesFor(workers, s.freq, true, 1 + ((k % 5) - 2) * 0.012),
        issues: [],
        employeeTaxesCents: null,
        employerTaxesCents: null,
        employerBenefitsCents: null,
        preparedBy: done || status !== 'NOT_STARTED' ? s.assignee : null,
        readyAt: null,
        approvedAt: null,
        approvedBy: null,
        submittedAt: null,
        submittedBy: null,
        reopenedAt: null,
        reopenReason: null,
        completedAt: done ? new Date(Date.parse(`${p.pay}T12:00:00Z`)).toISOString() : null,
        createdAt: nowIso(),
        updatedAt: nowIso(),
      };
      if (['READY_FOR_REVIEW', 'APPROVED', 'SUBMITTED', 'COMPLETED'].includes(status)) {
        run.readyAt = nowIso();
        run.step = 5;
      }
      if (['APPROVED', 'SUBMITTED', 'COMPLETED'].includes(status)) {
        run.approvedAt = nowIso();
        run.approvedBy = mockMe;
      }
      if (['SUBMITTED', 'COMPLETED'].includes(status)) {
        run.submittedAt = nowIso();
        run.submittedBy = mockMe;
      }
      return run;
    };
    // Past runs, oldest first, then the current one and the next three.
    const back = { WEEKLY: 14, BIWEEKLY: 8, SEMI_MONTHLY: 8, MONTHLY: 6 }[s.freq];
    const hasProvider = s.provider !== null;
    let k = 1;
    if (hasProvider) {
      for (let o = -back; o < 0; o += 1) runs.push(mk(o, 'COMPLETED', k++));
    }
    const current: Record<Spec['run'], PayrollRunStatus> = {
      none: 'NOT_STARTED',
      inprogress: 'IN_PROGRESS',
      ready: 'READY_FOR_REVIEW',
      submitted: 'SUBMITTED',
      attention: 'NEEDS_ATTENTION',
      pastdue: 'IN_PROGRESS',
    };
    // A past-due client's open run is the previous period (its pay date has gone by).
    const cur = mk(s.run === 'pastdue' ? -1 : 0, current[s.run], k++);
    if (s.run === 'pastdue') cur.step = 3;
    if (hasProvider) runs.push(cur);
    for (let o = s.run === 'pastdue' ? 0 : 1; o <= (s.run === 'pastdue' ? 2 : 3); o += 1) {
      if (hasProvider) runs.push(mk(o, 'NOT_STARTED', k++));
    }
    const status: PayrollClientStatus = !hasProvider
      ? 'NOT_STARTED'
      : s.run === 'pastdue'
        ? 'PAST_DUE'
        : s.run === 'attention'
          ? 'ACTION_REQUIRED'
          : s.run === 'inprogress' || s.run === 'submitted'
            ? 'PROCESSING'
            : 'ON_TRACK';
    const at = nowIso();
    store.clients.push({
      id: recId,
      client: {
        id: uuid('1d00', n),
        displayName: s.name,
        clientNumber: 2000 + n,
        accountType: s.type ?? 'BUSINESS',
      },
      engagementId: uuid('1e00', n),
      plan: 'Full-Service Payroll',
      status,
      frequency: s.freq,
      industry: s.industry,
      providerKey: s.provider,
      serviceSince: '2024-01-15',
      nextPayrollOverride: null,
      lastSyncedAt: hasProvider ? new Date(Date.now() - 6 * 3_600_000).toISOString() : null,
      lastSyncAttemptAt: hasProvider ? new Date(Date.now() - 6 * 3_600_000).toISOString() : null,
      assignedTo: s.assignee,
      pausedAt: null,
      archivedAt: null,
      workers,
      runs,
      filings: hasProvider
        ? [
            {
              id: uuid('9e00', n * 10 + 1),
              form: '941',
              jurisdiction: 'Federal',
              periodStart: '2026-07-01',
              periodEnd: '2026-09-30',
              dueOn: '2026-10-31',
              status: 'UPCOMING',
              paymentStatus: 'SCHEDULED',
              confirmationRef: null,
              source: 'provider',
              sourceSyncedAt: at,
              confirmedAt: null,
            },
            {
              id: uuid('9e00', n * 10 + 2),
              form: '941',
              jurisdiction: 'Federal',
              periodStart: '2026-04-01',
              periodEnd: '2026-06-30',
              dueOn: '2026-07-31',
              status: 'FILED',
              paymentStatus: 'PAID',
              confirmationRef: `IRS-${n}0731`,
              source: 'provider',
              sourceSyncedAt: at,
              confirmedAt: at,
            },
            {
              id: uuid('9e00', n * 10 + 3),
              form: '940',
              jurisdiction: 'Federal',
              periodStart: '2025-01-01',
              periodEnd: '2025-12-31',
              dueOn: '2026-02-02',
              status: 'FILED',
              paymentStatus: 'PAID',
              confirmationRef: `IRS-${n}0202`,
              source: 'provider',
              sourceSyncedAt: at,
              confirmedAt: at,
            },
            ...(s.run === 'attention'
              ? ([
                  {
                    id: uuid('9e00', n * 10 + 4),
                    form: 'State withholding',
                    jurisdiction: 'GA',
                    periodStart: '2026-09-01',
                    periodEnd: '2026-09-30',
                    dueOn: '2026-10-15',
                    status: 'NEEDS_ATTENTION',
                    paymentStatus: 'UNKNOWN',
                    confirmationRef: null,
                    source: 'provider',
                    sourceSyncedAt: at,
                    confirmedAt: null,
                  },
                ] as PayrollFiling[])
              : []),
          ]
        : [],
      reports: hasProvider
        ? [
            {
              id: uuid('9f00', n * 10 + 1),
              kind: 'REGISTER',
              runId: runs.find((r) => r.status === 'COMPLETED')?.id ?? null,
              periodStart: runs[runs.length - 5]?.periodStart ?? d0,
              periodEnd: runs[runs.length - 5]?.periodEnd ?? d0,
              version: 1,
              documentId: null,
              source: 'provider',
              pulledAt: at,
              requestedBy: s.assignee,
            },
            {
              id: uuid('9f00', n * 10 + 2),
              kind: 'EMPLOYER_TAX',
              runId: null,
              periodStart: '2026-07-01',
              periodEnd: '2026-09-30',
              version: 1,
              documentId: null,
              source: 'provider',
              pulledAt: at,
              requestedBy: s.assignee,
            },
          ]
        : [],
      activities: [
        {
          id: uuid('9a10', n * 10 + 1),
          kind: 'PAYROLL_REVIEW',
          summary: 'Reviewed the last payroll register with the client.',
          occurredAt: new Date(Date.now() - 6 * DAY).toISOString(),
          loggedBy: s.assignee,
        },
        {
          id: uuid('9a10', n * 10 + 2),
          kind: 'CLIENT_CALL',
          summary: 'Client confirmed the new hire start date.',
          occurredAt: new Date(Date.now() - 10 * DAY).toISOString(),
          loggedBy: mockMe,
        },
      ],
      changes: [
        {
          id: uuid('9a20', n * 10 + 1),
          field: 'frequency',
          oldValue: null,
          newValue: s.freq,
          reason: 'Service set up',
          changedBy: s.assignee,
          changedAt: at,
        },
      ],
      yearEnd: {},
      createdAt: at,
    });
  });
  return store;
}
