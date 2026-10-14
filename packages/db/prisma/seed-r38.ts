// Synthetic LVP rows for the R38 work modules (Tasks, Compliance & Deadlines, Automations,
// Bookkeeping, Tax Planning). Called once from seed.ts inside LVP's business scope; every row has
// a fixed id or a natural key, so running the seed again changes nothing.
import type { TxClient } from '../src/client.js';

export interface WorkSeedContext {
  businessId: string;
  clientId: string;
  ownerId: string;
  staffId: string;
  taskId: string;
  taxEngagementId: string;
  bookkeepingEngagementId: string;
  taxServiceId: string;
  bookkeepingServiceId: string;
  /// A seeded document of the client.
  documentId: string;
}

/** Stable ids: 00000000-0000-4000-d<module>-<n>. */
const id = (n: number) => `00000000-0000-4000-d000-${String(n).padStart(12, '0')}`;
export const SEED_R38_IDS = {
  taskType: id(1),
  checklist1: id(2),
  checklist2: id(3),
  reminder1: id(4),
  reminder2: id(5),
  attachment: id(6),
  template: id(7),
  series: id(8),
  occurrence1: id(9),
  occurrence2: id(10),
  deadline1: id(11),
  deadline2: id(12),
  deadlineReminder: id(13),
  deadlineDocument: id(14),
  calendar: id(15),
  entry1: id(16),
  entry2: id(17),
} as const;

export async function seedWorkModules(tx: TxClient, c: WorkSeedContext): Promise<void> {
  const { businessId } = c;

  // Tasks.
  const taskType = await tx.taskType.upsert({
    where: { id: SEED_R38_IDS.taskType },
    update: {},
    create: { id: SEED_R38_IDS.taskType, businessId, name: 'Tax Preparation', sortOrder: 1 },
  });
  await tx.task.update({
    where: { id: c.taskId },
    data: { typeId: taskType.id, serviceId: c.taxServiceId, priority: 'HIGH' },
  });
  await tx.taskAssignee.upsert({
    where: { taskId_userId: { taskId: c.taskId, userId: c.ownerId } },
    update: {},
    create: { businessId, taskId: c.taskId, userId: c.ownerId },
  });

  // Tasks: checklist, reminders, an attachment.
  await tx.taskChecklistItem.upsert({
    where: { id: SEED_R38_IDS.checklist1 },
    update: {},
    create: {
      id: SEED_R38_IDS.checklist1,
      businessId,
      taskId: c.taskId,
      label: 'Compare box 1 with last year',
      position: 0,
      required: true,
    },
  });
  await tx.taskChecklistItem.upsert({
    where: { id: SEED_R38_IDS.checklist2 },
    update: {},
    create: {
      id: SEED_R38_IDS.checklist2,
      businessId,
      taskId: c.taskId,
      label: 'Note any large change for the client',
      position: 1,
      assignedUserId: c.staffId,
    },
  });
  await tx.taskReminder.upsert({
    where: { id: SEED_R38_IDS.reminder1 },
    update: {},
    create: { id: SEED_R38_IDS.reminder1, businessId, taskId: c.taskId, daysBefore: 7 },
  });
  await tx.taskReminder.upsert({
    where: { id: SEED_R38_IDS.reminder2 },
    update: {},
    create: {
      id: SEED_R38_IDS.reminder2,
      businessId,
      taskId: c.taskId,
      daysBefore: 0,
      timeOfDay: new Date('1970-01-01T09:00:00Z'),
      channels: ['EMAIL'],
    },
  });
  await tx.taskAttachment.upsert({
    where: { id: SEED_R38_IDS.attachment },
    update: {},
    create: { id: SEED_R38_IDS.attachment, businessId, taskId: c.taskId, documentId: c.documentId },
  });

  // Tasks: a template, a quarterly series and two of its due dates.
  await tx.taskTemplate.upsert({
    where: { id: SEED_R38_IDS.template },
    update: {},
    create: {
      id: SEED_R38_IDS.template,
      businessId,
      name: 'New client onboarding',
      description: 'Welcome call, collect documents, set up the portal.',
      typeId: taskType.id,
      priority: 'MEDIUM',
      dueOffsetDays: 7,
      checklist: [{ label: 'Send the welcome email', required: true }, { label: 'Book the call' }],
      reminders: [{ daysBefore: 1, inApp: true, channels: [] }],
    },
  });
  await tx.taskSeries.upsert({
    where: { id: SEED_R38_IDS.series },
    update: {},
    create: {
      id: SEED_R38_IDS.series,
      businessId,
      clientId: c.clientId,
      engagementId: c.bookkeepingEngagementId,
      serviceId: c.bookkeepingServiceId,
      typeId: taskType.id,
      title: 'Quarterly bookkeeping review',
      priority: 'HIGH',
      assignmentRule: 'SPECIFIC_USER',
      assignedUserId: c.staffId,
      interval: 3,
      unit: 'MONTH',
      pattern: { monthly: 'DAY_OF_MONTH' },
      startOn: new Date('2026-10-15'),
      checklist: [{ label: 'Reconcile bank and card accounts', required: true }],
      reminders: [{ daysBefore: 7, inApp: true, channels: ['EMAIL'] }],
      createdByUserId: c.ownerId,
    },
  });
  await tx.taskOccurrence.upsert({
    where: { id: SEED_R38_IDS.occurrence1 },
    update: {},
    create: {
      id: SEED_R38_IDS.occurrence1,
      businessId,
      seriesId: SEED_R38_IDS.series,
      scheduledOn: new Date('2026-10-15'),
      dueOn: new Date('2026-10-15'),
      state: 'GENERATED',
      taskId: c.taskId,
      generatedAt: new Date('2026-10-01T09:00:00Z'),
    },
  });
  await tx.taskOccurrence.upsert({
    where: { id: SEED_R38_IDS.occurrence2 },
    update: {},
    create: {
      id: SEED_R38_IDS.occurrence2,
      businessId,
      seriesId: SEED_R38_IDS.series,
      scheduledOn: new Date('2027-01-15'),
      dueOn: new Date('2027-01-15'),
    },
  });

  // Compliance: two deadlines of the client, a reminder, a task.
  const deadline = (n: 'deadline1' | 'deadline2', data: Record<string, unknown>) =>
    tx.complianceDeadline.upsert({
      where: { id: SEED_R38_IDS[n] },
      update: {},
      create: {
        id: SEED_R38_IDS[n],
        businessId,
        clientId: c.clientId,
        assignedUserId: c.staffId,
        createdByUserId: c.ownerId,
        ...data,
      } as Parameters<typeof tx.complianceDeadline.create>[0]['data'],
    });
  await deadline('deadline1', {
    name: 'Q4 Estimated Tax Payment',
    type: 'ESTIMATED_TAX',
    source: 'GOVERNMENT',
    agency: 'IRS',
    jurisdiction: 'FEDERAL',
    relatedForm: 'Form 1040-ES',
    taxYear: 2026,
    filingPeriod: 'Q4',
    statutoryDueOn: new Date('2027-01-15'),
    dueOn: new Date('2027-01-15'),
    priority: 'HIGH',
    createTask: true,
    taskTemplateId: SEED_R38_IDS.template,
    clientNotes: 'Your fourth-quarter estimated payment is due January 15.',
  });
  await deadline('deadline2', {
    name: 'Georgia annual registration',
    type: 'ANNUAL_REPORT',
    source: 'GOVERNMENT',
    agency: 'GA SOS',
    jurisdiction: 'STATE',
    state: 'GA',
    statutoryDueOn: new Date('2027-04-01'),
    dueOn: new Date('2027-04-01'),
  });
  await tx.complianceDeadlineReminder.upsert({
    where: { id: SEED_R38_IDS.deadlineReminder },
    update: {},
    create: {
      id: SEED_R38_IDS.deadlineReminder,
      businessId,
      deadlineId: SEED_R38_IDS.deadline1,
      daysBefore: 14,
      channels: ['EMAIL'],
    },
  });
  await tx.complianceDeadlineDocument.upsert({
    where: { id: SEED_R38_IDS.deadlineDocument },
    update: {},
    create: {
      id: SEED_R38_IDS.deadlineDocument,
      businessId,
      deadlineId: SEED_R38_IDS.deadline1,
      documentId: c.documentId,
    },
  });
  await tx.complianceDeadlineLink.upsert({
    where: {
      deadlineId_relatedDeadlineId: {
        deadlineId: SEED_R38_IDS.deadline1,
        relatedDeadlineId: SEED_R38_IDS.deadline2,
      },
    },
    update: {},
    create: {
      businessId,
      deadlineId: SEED_R38_IDS.deadline1,
      relatedDeadlineId: SEED_R38_IDS.deadline2,
    },
  });
  await seedCalendar(tx, businessId);
  await tx.complianceDeadline.update({
    where: { id: SEED_R38_IDS.deadline1 },
    data: {
      calendarEntryId: SEED_R38_IDS.entry1,
      applicabilityReason: 'Individual with estimated tax: IRS calendar 2027, version 1',
    },
  });
  await tx.task.update({
    where: { id: c.taskId },
    data: { deadlineId: SEED_R38_IDS.deadline1, templateId: SEED_R38_IDS.template },
  });
}

/** The IRS 2027 calendar, published: an entry with a date, and one that needs checking. */
async function seedCalendar(tx: TxClient, businessId: string) {
  const calendarId = SEED_R38_IDS.calendar;
  if (await tx.complianceCalendar.findUnique({ where: { id: calendarId } })) return;
  await tx.complianceCalendar.create({
    data: {
      id: calendarId,
      businessId,
      family: 'IRS_GENERAL',
      authority: 'IRS',
      jurisdiction: 'FEDERAL',
      effectiveYear: 2027,
      name: 'IRS tax calendar 2027',
      sourceUrl: 'https://www.irs.gov/publications/p509',
      retrievedAt: new Date('2026-10-01T12:00:00Z'),
    },
  });
  await tx.complianceCalendarEntry.createMany({
    data: [
      {
        id: SEED_R38_IDS.entry1,
        businessId,
        calendarId,
        name: 'Individual estimated tax, Q4 2026',
        type: 'ESTIMATED_TAX',
        form: 'Form 1040-ES',
        ruleKind: 'FIXED_DATE',
        dueOn: new Date('2027-01-15'),
      },
      {
        id: SEED_R38_IDS.entry2,
        businessId,
        calendarId,
        name: 'S corporation return',
        type: 'TAX_FILING',
        form: 'Form 1120-S',
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
        verifiedAt: new Date('2026-10-02T12:00:00Z'),
        ...(status === 'PUBLISHED' ? { publishedAt: new Date('2026-10-02T13:00:00Z') } : {}),
      },
    });
  }
}
