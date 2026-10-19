// Demo seed, stage 5 (R0, Oct 19): the Payroll module for the demo firm's four payroll clients.
// Each gets its provider and schedule, a staff roster, two completed pay runs with their lines
// (confirmed by the provider) and a current run at a different step (ready for review, blocked by
// an error, submitted, in progress), filings (the last quarter filed and paid, this quarter's
// coming up), registers, last year's year-end, and the firm's payroll settings. Synthetic data;
// Firmivra calculates no payroll tax, so the figures stand in for the provider's. A client already
// seeded is left alone, so a re-run changes nothing.
import { runInScope, type createPrismaClient, type TxClient } from '../src/client.js';
import { demoId, SEED_DEMO_USERS, type DemoStaffKey } from './seed-demo-data.js';
import { demoDay, DEMO_ENGAGEMENTS } from './seed-demo-engagements.js';
import type { DemoOrgResult } from './seed-demo-org.js';

type Prisma = ReturnType<typeof createPrismaClient>;

const user = (key: DemoStaffKey) => SEED_DEMO_USERS[key].id;
const DAY_MS = 86_400_000;

interface DemoWorker {
  name: string;
  type: 'FULL_TIME' | 'PART_TIME' | 'CONTRACTOR';
  pay: 'HOURLY' | 'SALARY';
  /** Hourly: cents per hour. Salary: cents per year. */
  rate: number;
  department: string;
  title: string;
  /** Hours in a two-week period (hourly workers). */
  hours?: number;
  overtime?: number;
  status?: 'ACTIVE' | 'ON_LEAVE' | 'PENDING_SETUP';
}

type CurrentStep = 'READY_FOR_REVIEW' | 'BLOCKED' | 'SUBMITTED' | 'IN_PROGRESS';

interface DemoPayrollClient {
  industry: string;
  provider: string;
  status: 'ON_TRACK' | 'ACTION_REQUIRED' | 'PROCESSING';
  state: string;
  serviceSince: string;
  current: CurrentStep;
  yearEnd: 'DELIVERED' | 'RECONCILED' | 'IN_PROGRESS';
  workers: readonly DemoWorker[];
}

/** In DEMO_ENGAGEMENTS order of the payroll engagements. */
const CLIENTS: readonly DemoPayrollClient[] = [
  {
    industry: 'Landscaping',
    provider: 'gusto',
    status: 'ON_TRACK',
    state: 'NC',
    serviceSince: '2023-03-01',
    current: 'READY_FOR_REVIEW',
    yearEnd: 'DELIVERED',
    workers: [
      {
        name: 'Marcus Reed',
        type: 'FULL_TIME',
        pay: 'SALARY',
        rate: 6_200_000,
        department: 'Operations',
        title: 'Crew Supervisor',
      },
      {
        name: 'Luis Ortega',
        type: 'FULL_TIME',
        pay: 'HOURLY',
        rate: 2150,
        department: 'Field',
        title: 'Landscape Technician',
        hours: 80,
        overtime: 6,
      },
      {
        name: 'Kayla Brooks',
        type: 'FULL_TIME',
        pay: 'HOURLY',
        rate: 1975,
        department: 'Field',
        title: 'Landscape Technician',
        hours: 80,
      },
      {
        name: 'Andre Mitchell',
        type: 'PART_TIME',
        pay: 'HOURLY',
        rate: 1800,
        department: 'Field',
        title: 'Seasonal Laborer',
        hours: 48,
      },
      {
        name: 'Pine Valley Irrigation',
        type: 'CONTRACTOR',
        pay: 'HOURLY',
        rate: 4500,
        department: 'Field',
        title: 'Irrigation Contractor',
        hours: 12,
      },
    ],
  },
  {
    industry: 'Bakery and café',
    provider: 'adp',
    status: 'ACTION_REQUIRED',
    state: 'GA',
    serviceSince: '2024-06-15',
    current: 'BLOCKED',
    yearEnd: 'RECONCILED',
    workers: [
      {
        name: 'Sofia Ramirez',
        type: 'FULL_TIME',
        pay: 'SALARY',
        rate: 5_400_000,
        department: 'Kitchen',
        title: 'Head Baker',
      },
      {
        name: 'Tyler Nguyen',
        type: 'FULL_TIME',
        pay: 'HOURLY',
        rate: 1650,
        department: 'Kitchen',
        title: 'Baker',
        hours: 80,
        overtime: 4,
      },
      {
        name: 'Grace Okafor',
        type: 'PART_TIME',
        pay: 'HOURLY',
        rate: 1500,
        department: 'Front of House',
        title: 'Barista',
        hours: 50,
      },
      {
        name: 'Ethan Park',
        type: 'PART_TIME',
        pay: 'HOURLY',
        rate: 1450,
        department: 'Front of House',
        title: 'Cashier',
        hours: 40,
        status: 'PENDING_SETUP',
      },
    ],
  },
  {
    industry: 'Auto repair',
    provider: 'quickbooks_payroll',
    status: 'PROCESSING',
    state: 'VA',
    serviceSince: '2022-11-01',
    current: 'SUBMITTED',
    yearEnd: 'DELIVERED',
    workers: [
      {
        name: 'Derek Coleman',
        type: 'FULL_TIME',
        pay: 'SALARY',
        rate: 7_000_000,
        department: 'Service',
        title: 'Shop Manager',
      },
      {
        name: 'Hannah Lee',
        type: 'FULL_TIME',
        pay: 'HOURLY',
        rate: 2600,
        department: 'Service',
        title: 'Master Technician',
        hours: 80,
        overtime: 8,
      },
      {
        name: 'Omar Haddad',
        type: 'FULL_TIME',
        pay: 'HOURLY',
        rate: 2300,
        department: 'Service',
        title: 'Technician',
        hours: 80,
      },
      {
        name: 'Rachel Kim',
        type: 'FULL_TIME',
        pay: 'HOURLY',
        rate: 1900,
        department: 'Office',
        title: 'Service Advisor',
        hours: 80,
      },
      {
        name: 'Ben Carter',
        type: 'FULL_TIME',
        pay: 'HOURLY',
        rate: 2100,
        department: 'Service',
        title: 'Technician',
        hours: 0,
        status: 'ON_LEAVE',
      },
    ],
  },
  {
    industry: 'Hardware retail',
    provider: 'gusto',
    status: 'ON_TRACK',
    state: 'TN',
    serviceSince: '2025-01-10',
    current: 'IN_PROGRESS',
    yearEnd: 'IN_PROGRESS',
    workers: [
      {
        name: 'Nora Whitfield',
        type: 'FULL_TIME',
        pay: 'SALARY',
        rate: 5_800_000,
        department: 'Store',
        title: 'Store Manager',
      },
      {
        name: 'Caleb Turner',
        type: 'FULL_TIME',
        pay: 'HOURLY',
        rate: 1700,
        department: 'Store',
        title: 'Sales Associate',
        hours: 80,
      },
      {
        name: 'Priya Shah',
        type: 'PART_TIME',
        pay: 'HOURLY',
        rate: 1600,
        department: 'Store',
        title: 'Sales Associate',
        hours: 44,
      },
    ],
  },
];

/** One worker's pay for a two-week period, in cents. */
const linePay = (w: DemoWorker) => {
  const regular =
    w.pay === 'SALARY' ? Math.round(w.rate / 26) : Math.round((w.hours ?? 0) * w.rate);
  const overtime = Math.round((w.overtime ?? 0) * w.rate * 1.5);
  const deductions = w.type === 'CONTRACTOR' ? 0 : Math.round((regular + overtime) * 0.05);
  return { regular, overtime, deductions, total: regular + overtime - deductions };
};

/** The run's figures from its lines; taxes stand in for the provider's (none is calculated). */
const runFigures = (workers: readonly DemoWorker[]) => {
  const lines = workers.filter((w) => w.status !== 'ON_LEAVE').map(linePay);
  const regular = lines.reduce((s, l) => s + l.regular, 0);
  const overtime = lines.reduce((s, l) => s + l.overtime, 0);
  const gross = regular + overtime;
  const employeeTaxes = Math.round(gross * 0.17);
  const deductions = lines.reduce((s, l) => s + l.deductions, 0);
  const employerTaxes = Math.round(gross * 0.0825);
  const employerBenefits = workers.filter((w) => w.type === 'FULL_TIME').length * 22_500;
  return {
    employeeCount: lines.length,
    regularPayCents: regular,
    overtimePayCents: overtime,
    otherEarningsCents: 0,
    grossCents: gross,
    employeeTaxesCents: employeeTaxes,
    deductionsCents: deductions,
    netCents: gross - employeeTaxes - deductions,
    employerTaxesCents: employerTaxes,
    employerBenefitsCents: employerBenefits,
    employerCostsCents: employerTaxes + employerBenefits,
    totalCostCents: gross + employerTaxes + employerBenefits,
  };
};

/** Two-week periods ending yesterday (k = 0, the current run), and k periods before. */
const period = (k: number) => {
  const end = demoDay(-1 - 14 * k);
  const start = new Date(end.getTime() - 13 * DAY_MS);
  return { periodStart: start, periodEnd: end, payDate: new Date(end.getTime() + 5 * DAY_MS) };
};

export async function seedDemoPayroll(prisma: Prisma, org: DemoOrgResult): Promise<void> {
  const { businessId } = org;
  const engagements = DEMO_ENGAGEMENTS.filter((e) => e.slot === 'payroll' && e.status === 'ACTIVE');

  await runInScope(prisma, { kind: 'business', businessId }, async (tx) => {
    await tx.payrollSettings.upsert({
      where: { businessId },
      update: {},
      create: {
        businessId,
        defaultAssigneeId: user('bookkeeper'),
        reminderDaysBefore: 2,
        staleAfterHours: 36,
        settings: {
          reportVisibility: 'client_portal',
          dueDateRule: 'two_business_days_before_pay',
        },
        updatedByUserId: user('admin'),
      },
    });
    for (const [j, e] of engagements.entries()) {
      await seedClient(tx, org, e.clientKey, e.id, CLIENTS[j % CLIENTS.length]!);
    }
  });
}

async function seedClient(
  tx: TxClient,
  org: DemoOrgResult,
  clientKey: string,
  engagementId: string,
  p: DemoPayrollClient,
) {
  const { businessId } = org;
  const payrollClientId = demoId(`payroll-client:${clientKey}`);
  if (await tx.payrollClient.findUnique({ where: { id: payrollClientId } })) return;
  const key = (part: string) => demoId(`payroll:${clientKey}:${part}`);
  const link = { businessId, payrollClientId };
  const year = demoDay(0).getUTCFullYear();

  await tx.payrollClient.create({
    data: {
      id: payrollClientId,
      businessId,
      clientId: org.clients[clientKey]!,
      engagementId,
      status: p.status,
      frequency: 'BIWEEKLY',
      providerKey: p.provider,
      industry: p.industry,
      employeeCount: p.workers.filter((w) => w.type !== 'CONTRACTOR').length,
      employeeCountAt: demoDay(-1),
      nextPayrollOn: period(0).payDate,
      nextPayrollSource: 'provider',
      lastRunOn: period(1).payDate,
      lastSyncedAt: demoDay(-1),
      lastSyncAttemptAt: demoDay(-1),
      assignedUserId: user('bookkeeper'),
      serviceSince: new Date(p.serviceSince),
      settings: { reportSchedule: 'each_run', remindClientDaysBefore: 2 },
    },
  });
  await tx.payrollClientChange.create({
    data: {
      id: key('change:status'),
      ...link,
      field: 'status',
      oldValue: 'NOT_STARTED',
      newValue: 'ON_TRACK',
      changedByUserId: user('manager'),
      changedAt: new Date(p.serviceSince),
    },
  });
  if (p.status !== 'ON_TRACK') {
    await tx.payrollClientChange.create({
      data: {
        id: key('change:status:now'),
        ...link,
        field: 'status',
        oldValue: 'ON_TRACK',
        newValue: p.status,
        reason:
          p.status === 'ACTION_REQUIRED' ? 'New hire is missing direct deposit details.' : null,
        changedByUserId: user('bookkeeper'),
        changedAt: demoDay(-1),
      },
    });
  }
  for (const [kind, summary, day] of [
    ['PAYROLL_REVIEW', 'Reviewed the last register against the timesheets; no differences.', -9],
    ['CLIENT_CALL', 'Confirmed next pay date and the holiday schedule with the owner.', -3],
  ] as const) {
    await tx.payrollActivity.create({
      data: {
        id: key(`activity:${kind}`),
        ...link,
        kind,
        summary,
        occurredAt: demoDay(day),
        loggedByUserId: user('bookkeeper'),
      },
    });
  }

  // The roster.
  const workerIds: string[] = [];
  for (const [i, w] of p.workers.entries()) {
    const id = key(`worker:${i}`);
    workerIds.push(id);
    await tx.payrollWorker.create({
      data: {
        id,
        ...link,
        externalId: `${p.provider}-${clientKey}-${i + 1}`,
        displayName: w.name,
        workerType: w.type,
        status: w.status ?? 'ACTIVE',
        payType: w.pay,
        rateCents: w.rate,
        department: w.department,
        jobTitle: w.title,
        startedOn: new Date(p.serviceSince),
        directDepositReady: w.status !== 'PENDING_SETUP',
        source: 'provider',
        sourceSyncedAt: demoDay(-1),
        ...(w.status === 'PENDING_SETUP'
          ? {
              lastChangeAt: demoDay(-4),
              lastChangeNote: 'New hire; bank details not validated yet.',
            }
          : {}),
      },
    });
  }

  // Runs: two completed (k = 2, 1), then the current one (k = 0).
  const figures = runFigures(p.workers);
  for (const k of [2, 1, 0]) {
    const runId = key(`run:${k}`);
    const dates = period(k);
    const done = k > 0;
    await tx.payrollRun.create({
      data: {
        id: runId,
        ...link,
        ...dates,
        frequency: 'BIWEEKLY',
        status: 'IN_PROGRESS',
        step: done ? 4 : 2,
        includeContractors: true,
        source: done || p.current === 'SUBMITTED' ? 'provider' : 'manual',
        providerRunId: `${p.provider}-run-${clientKey}-${k}`,
        ...(done || p.current !== 'IN_PROGRESS' ? figures : {}),
        figuresConfirmed: done,
        preparedByUserId: user('bookkeeper'),
      },
    });
    for (const [i, w] of p.workers.entries()) {
      if (w.status === 'ON_LEAVE') continue;
      const pay = linePay(w);
      const blocked = !done && p.current === 'BLOCKED' && w.status === 'PENDING_SETUP';
      await tx.payrollRunLine.create({
        data: {
          id: key(`run:${k}:line:${i}`),
          businessId,
          runId,
          workerId: workerIds[i]!,
          hours: w.pay === 'SALARY' ? 80 : (w.hours ?? 0) + (w.overtime ?? 0),
          regularPayCents: pay.regular,
          overtimePayCents: pay.overtime,
          deductionsCents: pay.deductions,
          totalPayCents: pay.total,
          status: blocked ? 'ERROR' : w.overtime ? 'WARNING' : 'READY',
          ...(blocked ? { note: 'Direct deposit not validated at the provider.' } : {}),
          ...(w.overtime && !blocked ? { note: 'Overtime this period.' } : {}),
        },
      });
    }
    const overtimeWorker = p.workers.findIndex((w) => w.overtime);
    if (overtimeWorker >= 0) {
      await tx.payrollRunIssue.create({
        data: {
          id: key(`run:${k}:issue:overtime`),
          businessId,
          runId,
          workerId: workerIds[overtimeWorker]!,
          severity: 'WARNING',
          code: 'overtime_review',
          message: 'Overtime hours this period. Confirm them with the timesheet.',
          ...(done ? { resolvedAt: dates.payDate, resolvedByUserId: user('bookkeeper') } : {}),
        },
      });
    }
    if (!done && p.current === 'BLOCKED') {
      const newHire = p.workers.findIndex((w) => w.status === 'PENDING_SETUP');
      await tx.payrollRunIssue.create({
        data: {
          id: key(`run:${k}:issue:deposit`),
          businessId,
          runId,
          workerId: workerIds[newHire]!,
          severity: 'ERROR',
          code: 'direct_deposit_missing',
          message: 'New hire has no validated direct deposit. Ask the client for the form.',
        },
      });
    }

    // Move the run along the workflow to where it stands.
    const ready = new Date(dates.payDate.getTime() - 3 * DAY_MS);
    const approved = new Date(dates.payDate.getTime() - 2 * DAY_MS);
    const move = (data: Record<string, unknown>) =>
      tx.payrollRun.update({ where: { id: runId }, data });
    if (done || p.current === 'READY_FOR_REVIEW' || p.current === 'SUBMITTED') {
      await move({ status: 'READY_FOR_REVIEW', readyAt: ready, step: 4 });
    }
    if (done || p.current === 'SUBMITTED') {
      await move({
        status: 'APPROVED',
        approvedAt: approved,
        approvedByUserId: user('manager'),
        step: 5,
      });
    }
    if (done) {
      await move({
        status: 'COMPLETED',
        submittedAt: approved,
        submittedByUserId: user('bookkeeper'),
        providerConfirmation: `${p.provider.toUpperCase()}-${clientKey}${k}`,
        providerStatus: 'paid',
        completedAt: dates.payDate,
      });
      await tx.payrollReport.create({
        data: {
          id: key(`run:${k}:register`),
          ...link,
          runId,
          kind: 'REGISTER',
          periodStart: dates.periodStart,
          periodEnd: dates.periodEnd,
          source: 'provider',
          pulledAt: dates.payDate,
          requestedByUserId: user('bookkeeper'),
        },
      });
    } else if (p.current === 'SUBMITTED') {
      await move({
        status: 'SUBMITTED',
        submittedAt: approved,
        submittedByUserId: user('bookkeeper'),
        providerStatus: 'processing',
      });
    }
  }

  // Filings: last quarter filed and paid (confirmed by the provider), this quarter's coming up,
  // last year's federal unemployment return.
  const filing = (part: string, data: Record<string, unknown>) =>
    tx.payrollFiling.create({ data: { id: key(`filing:${part}`), ...link, ...data } as never });
  const confirmed = {
    status: 'FILED',
    paymentStatus: 'PAID',
    source: 'provider',
    sourceSyncedAt: demoDay(-20),
    confirmedAt: demoDay(-20),
  };
  await filing('941:q2', {
    form: '941',
    jurisdiction: 'federal',
    periodStart: new Date(Date.UTC(year, 3, 1)),
    periodEnd: new Date(Date.UTC(year, 5, 30)),
    dueOn: new Date(Date.UTC(year, 6, 31)),
    confirmationRef: `941-Q2-${clientKey}`,
    ...confirmed,
  });
  await filing('state:q2', {
    form: `${p.state} withholding`,
    jurisdiction: p.state,
    periodStart: new Date(Date.UTC(year, 3, 1)),
    periodEnd: new Date(Date.UTC(year, 5, 30)),
    dueOn: new Date(Date.UTC(year, 6, 31)),
    ...confirmed,
  });
  await filing('941:q3', {
    form: '941',
    jurisdiction: 'federal',
    periodStart: new Date(Date.UTC(year, 6, 1)),
    periodEnd: new Date(Date.UTC(year, 8, 30)),
    dueOn: new Date(Date.UTC(year, 9, 31)),
    status: 'IN_PROGRESS',
    paymentStatus: 'SCHEDULED',
    source: 'provider',
    sourceSyncedAt: demoDay(-1),
  });
  await filing('940:prior', {
    form: '940',
    jurisdiction: 'federal',
    periodStart: new Date(Date.UTC(year - 1, 0, 1)),
    periodEnd: new Date(Date.UTC(year - 1, 11, 31)),
    dueOn: new Date(Date.UTC(year, 1, 2)),
    ...confirmed,
  });
  await tx.payrollReport.create({
    data: {
      id: key('report:941:q2'),
      ...link,
      kind: 'TAX_FILING',
      periodStart: new Date(Date.UTC(year, 3, 1)),
      periodEnd: new Date(Date.UTC(year, 5, 30)),
      source: 'provider',
      pulledAt: demoDay(-20),
    },
  });

  // Last year's year-end.
  const reconciled = p.yearEnd !== 'IN_PROGRESS';
  await tx.payrollYearEnd.create({
    data: {
      id: key(`year-end:${year - 1}`),
      ...link,
      taxYear: year - 1,
      status: p.yearEnd,
      items: {
        worker_review: 'done',
        missing_information: reconciled ? 'done' : 'pending',
        w2_w3: reconciled ? 'done' : 'pending',
        form_1099: p.workers.some((w) => w.type === 'CONTRACTOR')
          ? reconciled
            ? 'done'
            : 'pending'
          : 'not_needed',
        reconciliation: reconciled ? 'done' : 'pending',
        client_delivery: p.yearEnd === 'DELIVERED' ? 'done' : 'pending',
      },
      ...(p.yearEnd === 'IN_PROGRESS'
        ? { exceptionsNote: 'Waiting on the client for one address change before the W-2s.' }
        : {}),
      ...(reconciled ? { reconciledAt: new Date(Date.UTC(year, 0, 22)) } : {}),
      ...(p.yearEnd === 'DELIVERED'
        ? { deliveredAt: new Date(Date.UTC(year, 0, 28)), deliveredByUserId: user('bookkeeper') }
        : {}),
    },
  });
}
