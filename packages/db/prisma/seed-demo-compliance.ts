// Demo seed, stage 5 (R0, Oct 19): Compliance & Deadlines for the demo firm. A published IRS
// calendar for this year with its entries and the log of publishing it; two recurring
// definitions and the applicability rules that suggest them; each client's compliance facts and
// sales tax registrations; and every client's deadlines across the statuses the screens show
// (filed, extended, waiting on the client, upcoming, not applicable), with reminders, linked
// documents and related deadlines. Synthetic data, the demo firm only; a re-run changes nothing
// (fixed ids, create-once).
import { runInScope, type createPrismaClient, type TxClient } from '../src/client.js';
import { demoId, SEED_DEMO_CLIENTS, SEED_DEMO_USERS, type DemoStaffKey } from './seed-demo-data.js';
import { demoDay, DEMO_ENGAGEMENTS, type DemoEngagementSlot } from './seed-demo-engagements.js';
import type { DemoOrgResult } from './seed-demo-org.js';

type Prisma = ReturnType<typeof createPrismaClient>;

const user = (key: DemoStaffKey) => SEED_DEMO_USERS[key].id;
const id = (key: string) => demoId(`compliance:${key}`);
const day = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));

/** A business client's tax classification, from its entity type (seed-demo-org's entityTypeFor). */
const CLASSIFICATIONS = ['PARTNERSHIP', 'S_CORPORATION', 'SOLE_PROPRIETOR'] as const;
const classificationFor = (key: string) => CLASSIFICATIONS[Number(key) % CLASSIFICATIONS.length]!;
const RETURN_FORM = {
  PARTNERSHIP: 'Form 1065',
  S_CORPORATION: 'Form 1120-S',
  SOLE_PROPRIETOR: 'Form 1040 (Schedule C)',
} as const;
const STATES = ['GA', 'NC', 'TN', 'VA', 'SC'] as const;

const engagementOf = (clientKey: string, slot: DemoEngagementSlot) =>
  DEMO_ENGAGEMENTS.find(
    (e) => e.clientKey === clientKey && e.slot === slot && e.status !== 'CANCELLED',
  );

export async function seedDemoCompliance(prisma: Prisma, org: DemoOrgResult): Promise<void> {
  const { businessId } = org;
  const year = demoDay(0).getUTCFullYear();

  await runInScope(prisma, { kind: 'business', businessId }, async (tx) => {
    await tx.complianceSettings.upsert({
      where: { businessId },
      update: {},
      create: {
        businessId,
        defaultReminders: [
          { daysBefore: 14, inApp: true, channels: ['EMAIL'] },
          { daysBefore: 3, inApp: true, channels: [] },
        ],
        taskTemplates: {},
        taskDueDateSync: 'LEAD_DAYS',
        taskDueLeadDays: 5,
      },
    });
    await seedCalendar(tx, businessId, year);
    await seedRecurrences(tx, businessId, year);
    for (const [i, c] of SEED_DEMO_CLIENTS.entries()) {
      await seedFacts(tx, org, c.key, c.accountType, i, year);
      await seedDeadlines(tx, org, c.key, c.accountType, i, year);
    }
  });
}

/** This year's IRS calendar, published, and the log of publishing it. */
async function seedCalendar(tx: TxClient, businessId: string, year: number) {
  const calendarId = id(`calendar:irs:${year}`);
  if (await tx.complianceCalendar.findUnique({ where: { id: calendarId } })) return;
  await tx.complianceCalendar.create({
    data: {
      id: calendarId,
      businessId,
      family: 'IRS_GENERAL',
      authority: 'IRS',
      jurisdiction: 'FEDERAL',
      effectiveYear: year,
      name: `IRS tax calendar ${year}`,
      sourceUrl: 'https://www.irs.gov/publications/p509',
      retrievedAt: day(year, 1, 5),
      createdByUserId: user('manager'),
    },
  });
  await tx.complianceCalendarEntry.createMany({
    data: [
      {
        id: id(`entry:1040es-q4:${year}`),
        businessId,
        calendarId,
        name: `Individual estimated tax, Q4 ${year}`,
        type: 'ESTIMATED_TAX',
        form: 'Form 1040-ES',
        ruleKind: 'FIXED_DATE',
        dueOn: day(year + 1, 1, 15),
      },
      {
        id: id(`entry:941-q3:${year}`),
        businessId,
        calendarId,
        name: `Employer's quarterly return, Q3 ${year}`,
        type: 'PAYROLL',
        form: 'Form 941',
        ruleKind: 'FIXED_DATE',
        dueOn: day(year, 10, 31),
      },
      {
        id: id(`entry:1120s:${year}`),
        businessId,
        calendarId,
        name: 'S corporation return',
        type: 'TAX_FILING',
        form: 'Form 1120-S',
        ruleKind: 'FORMULA',
        rule: { monthsAfterYearEnd: 3, day: 15 },
      },
      {
        id: id(`entry:1065:${year}`),
        businessId,
        calendarId,
        name: 'Partnership return',
        type: 'TAX_FILING',
        form: 'Form 1065',
        ruleKind: 'FORMULA',
        rule: { monthsAfterYearEnd: 3, day: 15 },
      },
    ],
  });
  for (const status of ['VERIFIED', 'PUBLISHED'] as const) {
    await tx.complianceCalendar.update({
      where: { id: calendarId },
      data: {
        status,
        verifiedAt: day(year, 1, 8),
        ...(status === 'PUBLISHED'
          ? { publishedAt: day(year, 1, 9), publishedByUserId: user('manager') }
          : {}),
      },
    });
  }
  await tx.complianceLog.create({
    data: {
      id: id(`log:publish:${year}`),
      businessId,
      kind: 'PUBLISH',
      outcome: 'SUCCESS',
      calendarId,
      message: `IRS tax calendar ${year} published`,
      details: { entries: 4 },
      actorUserId: user('manager'),
      createdAt: day(year, 1, 9),
    },
  });
}

/** Quarterly estimates from the calendar, a monthly sales tax return, and their rules. */
async function seedRecurrences(tx: TxClient, businessId: string, year: number) {
  const estimates = id('recurrence:estimates');
  if (await tx.complianceRecurrence.findUnique({ where: { id: estimates } })) return;
  await tx.complianceRecurrence.create({
    data: {
      id: estimates,
      businessId,
      name: 'Quarterly estimated tax payment',
      type: 'ESTIMATED_TAX',
      agency: 'IRS',
      jurisdiction: 'FEDERAL',
      relatedForm: 'Form 1040-ES',
      calendarEntryId: id(`entry:1040es-q4:${year}`),
      frequency: 'QUARTERLY',
      repeatRule: { dayOfMonth: 15 },
      startOn: day(year + 1, 1, 15),
      assignedUserId: user('taxPreparer'),
      reminders: [{ daysBefore: 14, inApp: true, channels: ['EMAIL'] }],
      createdByUserId: user('manager'),
    },
  });
  await tx.complianceRecurrence.create({
    data: {
      id: id('recurrence:sales-tax'),
      businessId,
      name: 'Monthly sales and use tax return',
      type: 'SALES_TAX',
      agency: 'State Department of Revenue',
      jurisdiction: 'STATE',
      frequency: 'MONTHLY',
      repeatRule: { dayOfMonth: 20 },
      startOn: day(year, 11, 20),
      assignedUserId: user('bookkeeper'),
      reminders: [{ daysBefore: 5, inApp: true, channels: ['EMAIL'] }],
      createdByUserId: user('manager'),
    },
  });
  await tx.complianceApplicabilityRule.create({
    data: {
      id: id('rule:estimates'),
      businessId,
      name: 'Individuals and sole proprietors who owed last year',
      recurrenceId: estimates,
      outcome: 'SUGGEST',
      entityTypes: ['INDIVIDUAL', 'SOLE_PROPRIETOR'],
      services: ['ANNUAL_TAX'],
      excludeStatuses: ['CLOSED'],
      priorYearLiabilityOverCents: 100_000,
      createdByUserId: user('manager'),
    },
  });
  await tx.complianceApplicabilityRule.create({
    data: {
      id: id('rule:941'),
      businessId,
      name: 'Payroll employers: quarterly Form 941',
      calendarEntryId: id(`entry:941-q3:${year}`),
      outcome: 'APPLY',
      services: ['PAYROLL'],
      createdByUserId: user('manager'),
    },
  });
}

/** Facts for every business client and every other individual; a few sales tax registrations. */
async function seedFacts(
  tx: TxClient,
  org: DemoOrgResult,
  key: string,
  accountType: 'INDIVIDUAL' | 'BUSINESS',
  i: number,
  year: number,
) {
  const { businessId } = org;
  const clientId = org.clients[key]!;
  const business = accountType === 'BUSINESS';
  if (!business && i % 2 === 1) return;
  const payroll = Boolean(engagementOf(key, 'payroll'));
  const state = STATES[i % STATES.length]!;
  await tx.clientComplianceFacts.upsert({
    where: { businessId_clientId: { businessId, clientId } },
    update: {},
    create: {
      businessId,
      clientId,
      fiscalYearEndMonth: 12,
      fiscalYearEndDay: 31,
      taxClassification: business ? classificationFor(key) : 'INDIVIDUAL',
      elections: business && classificationFor(key) === 'S_CORPORATION' ? ['s_corp_2553'] : [],
      isPayrollEmployer: business ? payroll : false,
      ...(payroll ? { payrollDepositSchedule: 'MONTHLY', payrollStates: [state] } : {}),
      isSalesTaxRegistered: business && i % 3 !== 2,
      priorYearTaxLiabilityCents: (i % 4) * 185_000 + 60_000,
      priorYearTaxYear: year - 1,
      ...(i % 3 === 0 ? { verifiedAt: demoDay(-30), verifiedByUserId: user('manager') } : {}),
      updatedByUserId: user('taxPreparer'),
    },
  });
  if (business && i % 3 !== 2) {
    const registration = id(`sales-tax:${key}:${state}`);
    if (!(await tx.clientSalesTaxRegistration.findUnique({ where: { id: registration } }))) {
      await tx.clientSalesTaxRegistration.create({
        data: {
          id: registration,
          businessId,
          clientId,
          state,
          frequency: i % 2 === 0 ? 'MONTHLY' : 'QUARTERLY',
          accountLast4: String(1000 + i * 37).slice(-4),
          registeredOn: day(year - 3, 3, 1),
        },
      });
    }
  }
}

/**
 * Each client's deadlines: last year's return (filed, or extended and still open), this year's
 * fourth estimated payment for individuals, and for businesses the payroll and sales tax returns
 * and the state annual report. Reminders on the open ones; the filed return's document; the
 * estimate linked to the return.
 */
async function seedDeadlines(
  tx: TxClient,
  org: DemoOrgResult,
  key: string,
  accountType: 'INDIVIDUAL' | 'BUSINESS',
  i: number,
  year: number,
) {
  const { businessId } = org;
  const clientId = org.clients[key]!;
  const business = accountType === 'BUSINESS';
  const returnId = id(`deadline:${key}:return`);
  if (await tx.complianceDeadline.findUnique({ where: { id: returnId } })) return;
  const state = STATES[i % STATES.length]!;
  const tax = engagementOf(key, 'tax2025');
  const base = { businessId, clientId, createdByUserId: user('manager') };

  // Last year's return: filed for most, extended and open for some, waiting on one client.
  const form = business ? RETURN_FORM[classificationFor(key)] : 'Form 1040';
  const statutory =
    business && classificationFor(key) !== 'SOLE_PROPRIETOR' ? day(year, 3, 15) : day(year, 4, 15);
  const extended =
    business && classificationFor(key) !== 'SOLE_PROPRIETOR' ? day(year, 9, 15) : day(year, 10, 15);
  const shape = i % 5;
  const filed = shape <= 2;
  await tx.complianceDeadline.create({
    data: {
      ...base,
      id: returnId,
      engagementId: tax?.id ?? null,
      name: `${year - 1} ${form}`,
      type: 'TAX_FILING',
      source: 'GOVERNMENT',
      agency: 'IRS',
      jurisdiction: 'FEDERAL',
      relatedForm: form,
      taxYear: year - 1,
      filingPeriod: 'Annual',
      statutoryDueOn: statutory,
      dueOn: statutory,
      ...(shape !== 0
        ? {
            extensionFiledOn: new Date(statutory.getTime() - 5 * 86_400_000),
            extendedDueOn: extended,
          }
        : {}),
      paymentDueOn: statutory,
      priority: 'HIGH',
      status: filed ? 'COMPLETED' : shape === 3 ? 'WAITING_ON_CLIENT' : 'IN_PROGRESS',
      assignedUserId: user(business ? 'manager' : 'taxPreparer'),
      clientVisible: true,
      ...(filed
        ? {
            completedAt: demoDay(-30 - i),
            completedByUserId: user('taxPreparer'),
            filedOn: demoDay(-30 - i),
            confirmationNumber: `EF${year}${String(4000 + i * 13)}`,
          }
        : {}),
      ...(shape === 3
        ? { clientNotes: 'We are waiting on your brokerage statement to finish.' }
        : {}),
      ...(filed
        ? {}
        : { internalNotes: 'Extended; past the extended date if not filed this week.' }),
    },
  });
  if (filed) {
    const document = await tx.document.findFirst({
      where: { businessId, clientId },
      select: { id: true },
      orderBy: { id: 'asc' },
    });
    if (document) {
      await tx.complianceDeadlineDocument.create({
        data: {
          id: id(`deadline:${key}:return:doc`),
          businessId,
          deadlineId: returnId,
          documentId: document.id,
        },
      });
    }
  }

  const open: string[] = filed ? [] : [returnId];
  if (!business || classificationFor(key) === 'SOLE_PROPRIETOR') {
    // This year's fourth estimated payment, from the calendar, with the rule's decision.
    const estimate = id(`deadline:${key}:es-q4`);
    await tx.complianceDeadline.create({
      data: {
        ...base,
        id: estimate,
        name: `Q4 ${year} estimated tax payment`,
        type: 'ESTIMATED_TAX',
        source: 'GOVERNMENT',
        agency: 'IRS',
        jurisdiction: 'FEDERAL',
        relatedForm: 'Form 1040-ES',
        taxYear: year,
        filingPeriod: 'Q4',
        statutoryDueOn: day(year + 1, 1, 15),
        dueOn: day(year + 1, 1, 15),
        paymentDueOn: day(year + 1, 1, 15),
        priority: 'MEDIUM',
        assignedUserId: user('taxPreparer'),
        clientVisible: true,
        clientNotes: 'Your fourth-quarter estimated payment is due January 15.',
        calendarEntryId: id(`entry:1040es-q4:${year}`),
        recurrenceId: id('recurrence:estimates'),
        applicabilityReason: `Owed tax last year: IRS tax calendar ${year}, version 1`,
      },
    });
    open.push(estimate);
    await tx.complianceDeadlineLink.create({
      data: { businessId, deadlineId: estimate, relatedDeadlineId: returnId },
    });
    await tx.complianceApplicabilityRecord.create({
      data: {
        id: id(`record:${key}:es-q4`),
        businessId,
        clientId,
        ruleId: id('rule:estimates'),
        ruleVersion: 1,
        dueOn: day(year + 1, 1, 15),
        decision: 'CONFIRMED',
        reason: `Owed tax last year: IRS tax calendar ${year}, version 1`,
        deadlineId: estimate,
        decidedByUserId: user('manager'),
        decidedAt: demoDay(-12),
      },
    });
  } else if (i % 4 === 1) {
    // A suggestion the firm hasn't decided yet (no deadline until it does).
    await tx.complianceApplicabilityRecord.create({
      data: {
        id: id(`record:${key}:es-q4`),
        businessId,
        clientId,
        ruleId: id('rule:estimates'),
        ruleVersion: 1,
        dueOn: day(year + 1, 1, 15),
        decision: i % 8 === 1 ? 'NEEDS_REVIEW' : 'SUGGESTED',
        reason: 'Owner draws suggest estimated payments; confirm with the owner.',
      },
    });
  }

  if (business) {
    if (engagementOf(key, 'payroll')) {
      const payroll = id(`deadline:${key}:941-q3`);
      await tx.complianceDeadline.create({
        data: {
          ...base,
          id: payroll,
          engagementId: engagementOf(key, 'payroll')!.id,
          name: `Q3 ${year} Form 941`,
          type: 'PAYROLL',
          source: 'GOVERNMENT',
          agency: 'IRS',
          jurisdiction: 'FEDERAL',
          relatedForm: 'Form 941',
          taxYear: year,
          filingPeriod: 'Q3 (Jul-Sep)',
          statutoryDueOn: day(year, 10, 31),
          dueOn: day(year, 10, 31),
          priority: 'HIGH',
          status: 'IN_PROGRESS',
          assignedUserId: user('bookkeeper'),
          calendarEntryId: id(`entry:941-q3:${year}`),
          applicabilityReason: `Payroll employer: IRS tax calendar ${year}, version 1`,
        },
      });
      open.push(payroll);
      await tx.complianceApplicabilityRecord.create({
        data: {
          id: id(`record:${key}:941-q3`),
          businessId,
          clientId,
          ruleId: id('rule:941'),
          ruleVersion: 1,
          dueOn: day(year, 10, 31),
          decision: 'CONFIRMED',
          reason: `Payroll employer: IRS tax calendar ${year}, version 1`,
          deadlineId: payroll,
          decidedByUserId: user('manager'),
          decidedAt: demoDay(-20),
        },
      });
    }
    if (i % 3 !== 2) {
      const salesTax = id(`deadline:${key}:sales-tax`);
      await tx.complianceDeadline.create({
        data: {
          ...base,
          id: salesTax,
          engagementId: engagementOf(key, 'books')?.id ?? null,
          name: `${state} sales and use tax return`,
          type: 'SALES_TAX',
          source: 'GOVERNMENT',
          agency: `${state} DOR`,
          jurisdiction: 'STATE',
          state,
          taxYear: year,
          filingPeriod: 'October',
          statutoryDueOn: day(year, 11, 20),
          dueOn: day(year, 11, 20),
          priority: 'MEDIUM',
          assignedUserId: user('bookkeeper'),
          recurrenceId: id('recurrence:sales-tax'),
        },
      });
      open.push(salesTax);
    }
    await tx.complianceDeadline.create({
      data: {
        ...base,
        id: id(`deadline:${key}:annual-report`),
        name: `${state} annual report`,
        type: 'ANNUAL_REPORT',
        source: 'GOVERNMENT',
        agency: `${state} Secretary of State`,
        jurisdiction: 'STATE',
        state,
        taxYear: year + 1,
        statutoryDueOn: day(year + 1, 4, 1),
        dueOn: day(year + 1, 4, 1),
        priority: 'LOW',
        assignedUserId: user('clientSupport'),
        ...(i % 4 === 0
          ? {
              status: 'NOT_APPLICABLE',
              notApplicableReason: 'Registered agent files it for the client.',
            }
          : {}),
      },
    });
  }

  // Reminders on the open ones: two weeks ahead by email, and three days ahead in-app.
  for (const deadlineId of open) {
    for (const [daysBefore, channels] of [
      [14, ['EMAIL']],
      [3, []],
    ] as const) {
      await tx.complianceDeadlineReminder.create({
        data: {
          id: demoId(`compliance:reminder:${deadlineId}:${daysBefore}`),
          businessId,
          deadlineId,
          daysBefore,
          channels: [...channels],
        },
      });
    }
  }
}
