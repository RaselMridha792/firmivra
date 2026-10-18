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
  /// The client's published bookkeeping report (an engagement report).
  reportId: string;
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
  recurrence: id(18),
  rule: id(19),
  record: id(20),
  complianceLog: id(21),
  automationRule: id(22),
  automationVersion: id(23),
  automationTemplate: id(24),
  run1: id(25),
  run2: id(26),
  exec1: id(27),
  exec2: id(28),
  exec3: id(29),
  automationSettings: id(30),
  bkProfile: id(31),
  bkActivity1: id(32),
  bkActivity2: id(33),
  bkConnection: id(34),
  bkSync: id(35),
  bkAccount1: id(36),
  bkAccount2: id(37),
  bkPeriodAug: id(38),
  bkPeriodSep: id(39),
  bkRecon1: id(40),
  bkRecon2: id(41),
  bkReport1: id(42),
  bkReport2: id(43),
  bkReport3: id(44),
  strategy1: id(45),
  strategy2: id(46),
  plan: id(47),
  planStrategy1: id(48),
  planStrategy2: id(49),
  planStrategy3: id(50),
  planInput1: id(51),
  planInput2: id(52),
  planVersion: id(53),
  planDocument: id(54),
  scenario: id(55),
  opportunity1: id(56),
  opportunity2: id(57),
  opportunityEvent1: id(58),
  opportunityEvent2: id(59),
} as const;

/** Stage C1: LVP's September ledger, a refund, a Stripe payout, a report version and the terms. */
export const SEED_C1_IDS = {
  catSales: id(201),
  catSoftware: id(202),
  catSupplies: id(203),
  catFees: id(204),
  txPayout: id(205),
  txAdobe: id(206),
  txOfficeDepot: id(207),
  txTransferOut: id(208),
  txTransferIn: id(209),
  txRefund: id(210),
  refund: id(211),
  settlement: id(212),
  reportVersion: id(213),
  terms: id(214),
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
  await tx.complianceRecurrence.upsert({
    where: { id: SEED_R38_IDS.recurrence },
    update: {},
    create: {
      id: SEED_R38_IDS.recurrence,
      businessId,
      name: 'Quarterly estimated tax payment',
      type: 'ESTIMATED_TAX',
      agency: 'IRS',
      jurisdiction: 'FEDERAL',
      relatedForm: 'Form 1040-ES',
      calendarEntryId: SEED_R38_IDS.entry1,
      frequency: 'QUARTERLY',
      repeatRule: { dayOfMonth: 15 },
      startOn: new Date('2027-01-15'),
      createTask: true,
      taskTemplateId: SEED_R38_IDS.template,
      assignedUserId: c.staffId,
      reminders: [{ daysBefore: 14, inApp: true, channels: ['EMAIL'] }],
      createdByUserId: c.ownerId,
    },
  });
  const rule = await tx.complianceApplicabilityRule.upsert({
    where: { id: SEED_R38_IDS.rule },
    update: {},
    create: {
      id: SEED_R38_IDS.rule,
      businessId,
      name: 'Individuals and sole proprietors with estimated tax',
      recurrenceId: SEED_R38_IDS.recurrence,
      outcome: 'SUGGEST',
      entityTypes: ['INDIVIDUAL', 'SOLE_PROPRIETOR'],
      services: ['ANNUAL_TAX'],
      excludeStatuses: ['TAX_EXEMPT', 'CLOSED'],
      priorYearLiabilityOverCents: 100000,
      createdByUserId: c.ownerId,
    },
  });
  await tx.complianceApplicabilityRecord.upsert({
    where: { id: SEED_R38_IDS.record },
    update: {},
    create: {
      id: SEED_R38_IDS.record,
      businessId,
      clientId: c.clientId,
      ruleId: rule.id,
      ruleVersion: rule.version,
      dueOn: new Date('2027-01-15'),
      decision: 'CONFIRMED',
      reason: 'Individual with estimated tax: IRS calendar 2027, version 1',
      deadlineId: SEED_R38_IDS.deadline1,
      decidedByUserId: c.ownerId,
      decidedAt: new Date('2026-10-02T14:00:00Z'),
    },
  });
  await tx.complianceDeadline.update({
    where: { id: SEED_R38_IDS.deadline1 },
    data: { recurrenceId: SEED_R38_IDS.recurrence },
  });
  await tx.complianceLog.upsert({
    where: { id: SEED_R38_IDS.complianceLog },
    update: {},
    create: {
      id: SEED_R38_IDS.complianceLog,
      businessId,
      kind: 'PUBLISH',
      outcome: 'SUCCESS',
      calendarId: SEED_R38_IDS.calendar,
      message: 'IRS tax calendar 2027 published',
      details: { entries: 2 },
      actorUserId: c.ownerId,
    },
  });
  await tx.complianceSettings.upsert({
    where: { businessId },
    update: {},
    create: {
      businessId,
      defaultReminders: [{ daysBefore: 14, inApp: true, channels: ['EMAIL'] }],
      taskTemplates: { ESTIMATED_TAX: SEED_R38_IDS.template },
    },
  });
  await tx.task.update({
    where: { id: c.taskId },
    data: { deadlineId: SEED_R38_IDS.deadline1, templateId: SEED_R38_IDS.template },
  });
  await seedAutomations(tx, c);
  await seedAutomationRuns(tx, c);
  await seedBookkeeping(tx, c);
  await seedBookkeepingConnection(tx, c);
  await seedBookkeepingPeriods(tx, c);
  await seedBookkeepingReports(tx, c);
  await seedBookkeepingLedger(tx, c);
  await seedTaxPlanning(tx, c);
  await seedTaxPlanDetails(tx, c);
  await seedOpportunities(tx, c);
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

/** An active rule with its first version, and a template. */
async function seedAutomations(tx: TxClient, c: WorkSeedContext) {
  const { businessId } = c;
  const definition = {
    trigger: {
      module: 'COMPLIANCE_DEADLINES',
      event: 'deadline.approaching',
      timing: 'BEFORE',
      offsetValue: 14,
      offsetUnit: 'DAY',
    },
    matchMode: 'ALL',
    conditions: [{ field: 'client.type', operator: 'is', value: 'BUSINESS' }],
    actions: [
      { id: 'a1', type: 'create_task', config: { templateId: SEED_R38_IDS.template } },
      {
        id: 'a2',
        type: 'send_email',
        config: { template: 'Estimated Tax Reminder' },
        delayMinutes: 0,
      },
    ],
    settings: { preventDuplicatesDays: 7, logAll: true, notifyOnFailure: true },
  };
  if (!(await tx.automationRule.findUnique({ where: { id: SEED_R38_IDS.automationRule } }))) {
    await tx.automationRule.create({
      data: {
        id: SEED_R38_IDS.automationRule,
        businessId,
        name: 'Client reminder, 14 days before estimated tax',
        category: 'COMPLIANCE_DEADLINES',
        priority: 'HIGH',
        ownerUserId: c.ownerId,
        createdByUserId: c.ownerId,
      },
    });
    await tx.automationRuleVersion.create({
      data: {
        id: SEED_R38_IDS.automationVersion,
        businessId,
        ruleId: SEED_R38_IDS.automationRule,
        version: 1,
        triggerModule: 'COMPLIANCE_DEADLINES',
        triggerEvent: 'deadline.approaching',
        timing: 'BEFORE',
        offsetValue: 14,
        offsetUnit: 'DAY',
        conditions: definition.conditions,
        actions: definition.actions,
        settings: definition.settings,
        createdByUserId: c.ownerId,
      },
    });
    await tx.automationRule.update({
      where: { id: SEED_R38_IDS.automationRule },
      data: { status: 'ACTIVE', currentVersionId: SEED_R38_IDS.automationVersion },
    });
  }
  await tx.automationTemplate.upsert({
    where: { id: SEED_R38_IDS.automationTemplate },
    update: {},
    create: {
      id: SEED_R38_IDS.automationTemplate,
      businessId,
      name: 'Estimated tax payment workflow',
      category: 'COMPLIANCE_DEADLINES',
      definition,
      createdByUserId: c.ownerId,
    },
  });
}

/** A successful run (task created, email sent), a failed one (invalid address) and the settings. */
async function seedAutomationRuns(tx: TxClient, c: WorkSeedContext) {
  const { businessId } = c;
  const run = (n: 'run1' | 'run2', data: Record<string, unknown>) =>
    tx.automationRun.upsert({
      where: { id: SEED_R38_IDS[n] },
      update: {},
      create: {
        id: SEED_R38_IDS[n],
        businessId,
        ruleId: SEED_R38_IDS.automationRule,
        ruleVersionId: SEED_R38_IDS.automationVersion,
        sourceModule: 'COMPLIANCE_DEADLINES',
        clientId: c.clientId,
        recordKind: 'deadline',
        recordId: SEED_R38_IDS.deadline1,
        correlationId: SEED_R38_IDS[n],
        ...data,
      } as Parameters<typeof tx.automationRun.create>[0]['data'],
    });
  await run('run1', {
    status: 'SUCCESS',
    sourceEventKey: 'deadline.approaching:2027-01-01',
    startedAt: new Date('2026-10-01T09:00:00Z'),
    finishedAt: new Date('2026-10-01T09:00:08Z'),
    durationMs: 8000,
  });
  await run('run2', {
    status: 'FAILED',
    sourceEventKey: 'deadline.approaching:2027-01-02',
    startedAt: new Date('2026-10-02T09:00:00Z'),
    finishedAt: new Date('2026-10-02T09:00:04Z'),
    durationMs: 4000,
    errorCode: 'EMAIL_UNDELIVERABLE',
    message: 'The email address is not valid.',
  });
  const exec = (
    n: 'exec1' | 'exec2' | 'exec3',
    runKey: 'run1' | 'run2',
    data: Record<string, unknown>,
  ) =>
    tx.automationActionExecution.upsert({
      where: { id: SEED_R38_IDS[n] },
      update: {},
      create: {
        id: SEED_R38_IDS[n],
        businessId,
        runId: SEED_R38_IDS[runKey],
        startedAt: new Date('2026-10-01T09:00:01Z'),
        finishedAt: new Date('2026-10-01T09:00:03Z'),
        ...data,
      } as Parameters<typeof tx.automationActionExecution.create>[0]['data'],
    });
  await exec('exec1', 'run1', {
    actionKey: 'a1',
    position: 0,
    actionType: 'create_task',
    status: 'SUCCESS',
    attempts: 1,
    idempotencyKey: `${SEED_R38_IDS.run1}:a1`,
    resultKind: 'task',
    resultId: c.taskId,
  });
  await exec('exec2', 'run1', {
    actionKey: 'a2',
    position: 1,
    actionType: 'send_email',
    status: 'SUCCESS',
    attempts: 1,
    idempotencyKey: `${SEED_R38_IDS.run1}:a2`,
  });
  await exec('exec3', 'run2', {
    actionKey: 'a2',
    position: 1,
    actionType: 'send_email',
    status: 'FAILED',
    attempts: 1,
    retryable: false,
    errorCode: 'EMAIL_UNDELIVERABLE',
    detail: 'Invalid email address',
    idempotencyKey: `${SEED_R38_IDS.run2}:a2`,
  });
  await tx.automationSettings.upsert({
    where: { businessId },
    update: {},
    create: { businessId, failureAlertUserIds: [c.ownerId] },
  });
}

/** Bookkeeping: the firm's settings, the client's profile and two activity lines. */
async function seedBookkeeping(tx: TxClient, c: WorkSeedContext) {
  const { businessId } = c;
  await tx.bookkeepingSettings.upsert({
    where: { businessId },
    update: {},
    create: {
      businessId,
      closeChecklist: [
        { key: 'categorization', label: 'Transactions categorized', required: true },
        { key: 'reconciliations', label: 'Bank and card accounts reconciled', required: true },
        { key: 'reports', label: 'Reports generated', required: true },
        { key: 'approval', label: 'Reviewer approval', required: true },
        { key: 'delivery', label: 'Delivered to the client', required: false },
      ],
      documentChecklist: [{ label: 'Bank statements', cadence: 'MONTHLY' }],
    },
  });
  await tx.bookkeepingProfile.upsert({
    where: { id: SEED_R38_IDS.bkProfile },
    update: {},
    create: {
      id: SEED_R38_IDS.bkProfile,
      businessId,
      engagementId: c.bookkeepingEngagementId,
      cadence: 'MONTHLY',
      closeTargetDay: 10,
      nextReportDueOn: new Date('2026-10-15'),
      status: 'ON_TRACK',
      statusSource: 'AUTOMATIC',
      statusReason: 'No outstanding items',
      reviewerUserId: c.ownerId,
      portalDefaults: { reports: true, tasks: false, documents: true, notes: false },
      alerts: {
        missingDocuments: true,
        staleSync: true,
        overdueClose: true,
        failedIntegration: true,
      },
    },
  });
  for (const [n, kind, summary] of [
    ['bkActivity1', 'STATUS_CHANGE', 'Status set to On Track'],
    ['bkActivity2', 'REPORT', 'August report delivered'],
  ] as const) {
    await tx.bookkeepingActivity.upsert({
      where: { id: SEED_R38_IDS[n] },
      update: {},
      create: {
        id: SEED_R38_IDS[n],
        businessId,
        engagementId: c.bookkeepingEngagementId,
        kind,
        summary,
        actorUserId: c.staffId,
      },
    });
  }
}

/** A QuickBooks connection with one good sync, a checking account and a credit card. */
async function seedBookkeepingConnection(tx: TxClient, c: WorkSeedContext) {
  const { businessId } = c;
  const syncedAt = new Date('2026-09-28T10:12:00Z');
  await tx.bookkeepingConnection.upsert({
    where: { id: SEED_R38_IDS.bkConnection },
    update: {},
    create: {
      id: SEED_R38_IDS.bkConnection,
      businessId,
      engagementId: c.bookkeepingEngagementId,
      provider: 'quickbooks',
      providerCompanyId: '9130000000000001',
      companyName: 'Sample Cafe LLC',
      credentialRef: 'local/seed/quickbooks-sample',
      lastSyncAt: syncedAt,
      lastSuccessfulSyncAt: syncedAt,
      connectedByUserId: c.staffId,
    },
  });
  await tx.bookkeepingSyncRun.upsert({
    where: { id: SEED_R38_IDS.bkSync },
    update: {},
    create: {
      id: SEED_R38_IDS.bkSync,
      businessId,
      connectionId: SEED_R38_IDS.bkConnection,
      trigger: 'MANUAL',
      outcome: 'SUCCESS',
      startedAt: syncedAt,
      finishedAt: new Date('2026-09-28T10:12:09Z'),
      counts: { accounts: 2 },
      requestedByUserId: c.staffId,
    },
  });
  for (const [n, name, type, mask, balanceCents] of [
    ['bkAccount1', 'Business Checking', 'BANK', '0001', 1245032],
    ['bkAccount2', 'Business Card', 'CREDIT_CARD', '0002', -234012],
  ] as const) {
    await tx.bookkeepingAccount.upsert({
      where: { id: SEED_R38_IDS[n] },
      update: {},
      create: {
        id: SEED_R38_IDS[n],
        businessId,
        engagementId: c.bookkeepingEngagementId,
        connectionId: SEED_R38_IDS.bkConnection,
        sourceAccountId: `acct-${mask}`,
        name,
        type,
        institution: 'Sample Bank',
        mask,
        balanceCents,
        balanceAsOf: syncedAt,
      },
    });
  }
}

const CLOSE_STEPS = [
  ['categorization', 'Transactions categorized'],
  ['reconciliations', 'Bank and card accounts reconciled'],
  ['reports', 'Reports generated'],
  ['approval', 'Reviewer approval'],
] as const;

/** August: reconciled, approved and closed. September: in progress, with its checklist. */
async function seedBookkeepingPeriods(tx: TxClient, c: WorkSeedContext) {
  const { businessId } = c;
  const base = { businessId, engagementId: c.bookkeepingEngagementId };
  const items = (periodId: string, done: boolean) =>
    tx.bookkeepingCloseItem.createMany({
      data: CLOSE_STEPS.map(([itemKey, label], position) => ({
        businessId,
        periodId,
        itemKey,
        label,
        position,
        ...(done
          ? { completedAt: new Date('2026-09-09T15:00:00Z'), completedByUserId: c.staffId }
          : {}),
      })),
    });
  if (!(await tx.bookkeepingPeriod.findUnique({ where: { id: SEED_R38_IDS.bkPeriodAug } }))) {
    await tx.bookkeepingPeriod.create({
      data: {
        ...base,
        id: SEED_R38_IDS.bkPeriodAug,
        label: 'August 2026',
        periodStart: new Date('2026-08-01'),
        periodEnd: new Date('2026-08-31'),
        closeByOn: new Date('2026-09-10'),
        incomeCents: 2190000,
        expensesCents: 1500000,
        figuresSource: 'MANUAL',
        figuresAsOf: new Date('2026-09-08T12:00:00Z'),
        uncategorizedCount: 0,
      },
    });
    await items(SEED_R38_IDS.bkPeriodAug, true);
    await tx.bookkeepingReconciliation.create({
      data: {
        id: SEED_R38_IDS.bkRecon1,
        businessId,
        periodId: SEED_R38_IDS.bkPeriodAug,
        accountId: SEED_R38_IDS.bkAccount1,
        statementStart: new Date('2026-08-01'),
        statementEnd: new Date('2026-08-31'),
        beginningBalanceCents: 1100000,
        endingBalanceCents: 1180000,
        clearedBalanceCents: 1180000,
        clearedCount: 42,
        differenceCents: 0,
        status: 'APPROVED',
        readyForReviewAt: new Date('2026-09-09T15:00:00Z'),
        approvedAt: new Date('2026-09-09T16:00:00Z'),
        approvedBy: c.ownerId,
      },
    });
    const at = (h: number) => new Date(`2026-09-09T${h}:00:00Z`);
    const steps = [
      ['IN_PROGRESS', {}],
      ['READY_FOR_REVIEW', { readyForReviewAt: at(15), readyForReviewBy: c.staffId }],
      ['APPROVED', { approvedAt: at(16), approvedBy: c.ownerId }],
      ['CLOSED', { closedAt: at(17), closedBy: c.ownerId }],
    ] as const;
    for (const [status, data] of steps) {
      await tx.bookkeepingPeriod.update({
        where: { id: SEED_R38_IDS.bkPeriodAug },
        data: { status, ...data },
      });
    }
  }
  await tx.bookkeepingPeriod.upsert({
    where: { id: SEED_R38_IDS.bkPeriodSep },
    update: {},
    create: {
      ...base,
      id: SEED_R38_IDS.bkPeriodSep,
      label: 'September 2026',
      periodStart: new Date('2026-09-01'),
      periodEnd: new Date('2026-09-30'),
      status: 'IN_PROGRESS',
      closeByOn: new Date('2026-10-10'),
      incomeCents: 2458000,
      expensesCents: 1622000,
      figuresSource: 'MANUAL',
      figuresAsOf: new Date('2026-09-28T10:12:00Z'),
      uncategorizedCount: 12,
    },
  });
  if (!(await tx.bookkeepingCloseItem.count({ where: { periodId: SEED_R38_IDS.bkPeriodSep } }))) {
    await items(SEED_R38_IDS.bkPeriodSep, false);
  }
  await tx.bookkeepingReconciliation.upsert({
    where: { id: SEED_R38_IDS.bkRecon2 },
    update: {},
    create: {
      id: SEED_R38_IDS.bkRecon2,
      businessId,
      periodId: SEED_R38_IDS.bkPeriodSep,
      accountId: SEED_R38_IDS.bkAccount1,
      statementStart: new Date('2026-09-01'),
      statementEnd: new Date('2026-09-30'),
      beginningBalanceCents: 1180000,
      endingBalanceCents: 1245032,
      clearedBalanceCents: 1240000,
      clearedCount: 31,
      differenceCents: 5032,
      exceptionsCount: 2,
    },
  });
}

/**
 * Stage C1: September for LVP's bookkeeping client. Categories; a Stripe payout deposit matched to
 * its settlement; a categorized software charge; a split office-supplies charge; a transfer from
 * checking to the card; a vendor refund linked to its purchase; the P&L's first version; the
 * engagement terms in force.
 */
async function seedBookkeepingLedger(tx: TxClient, c: WorkSeedContext) {
  const ids = SEED_C1_IDS;
  if (await tx.bookkeepingTransaction.findUnique({ where: { id: ids.txPayout } })) return;
  const { businessId } = c;
  const base = { businessId, engagementId: c.bookkeepingEngagementId };
  for (const [key, name, type] of [
    ['catSales', 'Sales', 'INCOME'],
    ['catSoftware', 'Software & Subscriptions', 'EXPENSE'],
    ['catSupplies', 'Office Supplies', 'EXPENSE'],
    ['catFees', 'Merchant Fees', 'EXPENSE'],
  ] as const) {
    await tx.bookkeepingCategory.create({ data: { ...base, id: ids[key], name, type } });
  }
  const synced = { connectionId: SEED_R38_IDS.bkConnection, source: 'SYNC' as const };
  const checking = { ...base, ...synced, accountId: SEED_R38_IDS.bkAccount1 };
  const card = { ...base, ...synced, accountId: SEED_R38_IDS.bkAccount2 };
  await tx.bookkeepingTransaction.create({
    data: {
      ...checking,
      id: ids.txPayout,
      sourceTransactionId: 'bank-0905-1',
      transactionDate: new Date('2026-09-05'),
      description: 'STRIPE TRANSFER',
      payee: 'Stripe',
      amountCents: 482_500,
      direction: 'CREDIT',
      kind: 'PAYOUT',
      status: 'CATEGORIZED',
      categoryId: ids.catSales,
    },
  });
  await tx.bookkeepingTransaction.create({
    data: {
      ...card,
      id: ids.txAdobe,
      sourceTransactionId: 'card-0908-1',
      transactionDate: new Date('2026-09-08'),
      description: 'ADOBE *CREATIVE CLD',
      payee: 'Adobe',
      amountCents: 5_999,
      direction: 'DEBIT',
      status: 'CATEGORIZED',
      categoryId: ids.catSoftware,
    },
  });
  await tx.bookkeepingTransaction.create({
    data: {
      ...card,
      id: ids.txOfficeDepot,
      sourceTransactionId: 'card-0912-1',
      transactionDate: new Date('2026-09-12'),
      description: 'OFFICE DEPOT #1123',
      payee: 'Office Depot',
      amountCents: 18_250,
      direction: 'DEBIT',
      status: 'CATEGORIZED',
    },
  });
  for (const [categoryId, amountCents, memo] of [
    [ids.catSupplies, 12_000, 'Toner and paper'],
    [ids.catSoftware, 6_250, 'Label software licence'],
  ] as const) {
    await tx.bookkeepingTransactionSplit.create({
      data: { ...base, transactionId: ids.txOfficeDepot, categoryId, amountCents, memo },
    });
  }
  // The card payment from checking: both sides, then linked to each other.
  await tx.bookkeepingTransaction.create({
    data: {
      ...checking,
      id: ids.txTransferOut,
      sourceTransactionId: 'bank-0915-1',
      transactionDate: new Date('2026-09-15'),
      description: 'PAYMENT TO CARD 0002',
      amountCents: 150_000,
      direction: 'DEBIT',
      kind: 'TRANSFER',
    },
  });
  await tx.bookkeepingTransaction.create({
    data: {
      ...card,
      id: ids.txTransferIn,
      sourceTransactionId: 'card-0915-1',
      transactionDate: new Date('2026-09-15'),
      description: 'PAYMENT RECEIVED - THANK YOU',
      amountCents: 150_000,
      direction: 'CREDIT',
      kind: 'TRANSFER',
    },
  });
  await tx.bookkeepingTransaction.update({
    where: { id: ids.txTransferOut },
    data: { transferPairId: ids.txTransferIn, status: 'CATEGORIZED' },
  });
  await tx.bookkeepingTransaction.update({
    where: { id: ids.txTransferIn },
    data: { transferPairId: ids.txTransferOut, status: 'CATEGORIZED' },
  });
  await tx.bookkeepingTransaction.create({
    data: {
      ...card,
      id: ids.txRefund,
      sourceTransactionId: 'card-0920-1',
      transactionDate: new Date('2026-09-20'),
      description: 'OFFICE DEPOT #1123 RETURN',
      payee: 'Office Depot',
      amountCents: 3_500,
      direction: 'CREDIT',
      kind: 'REFUND',
      status: 'CATEGORIZED',
      categoryId: ids.catSupplies,
    },
  });
  await tx.bookkeepingRefund.create({
    data: {
      ...base,
      id: ids.refund,
      kind: 'REFUND_RECEIVED',
      originalTransactionId: ids.txOfficeDepot,
      transactionId: ids.txRefund,
      refundDate: new Date('2026-09-20'),
      amountCents: 3_500,
      reason: 'Returned an unopened toner cartridge.',
      method: 'Card credit',
      status: 'COMPLETED',
      categoryId: ids.catSupplies,
    },
  });
  await tx.bookkeepingSettlement.create({
    data: {
      ...base,
      id: ids.settlement,
      connectionId: SEED_R38_IDS.bkConnection,
      processor: 'stripe',
      sourceSettlementId: 'po_2026_0905',
      periodStart: new Date('2026-09-01'),
      periodEnd: new Date('2026-09-03'),
      payoutDate: new Date('2026-09-05'),
      grossCents: 500_000,
      refundsCents: 5_000,
      feesCents: 12_500,
      netPayoutCents: 482_500,
      netSource: 'CALCULATED',
      depositTransactionId: ids.txPayout,
      status: 'MATCHED',
      matchedByUserId: c.staffId,
    },
  });
  await tx.bookkeepingReportVersion.create({
    data: {
      ...base,
      id: ids.reportVersion,
      reportId: SEED_R38_IDS.bkReport1,
      version: 1,
      parameters: { period: '2026-09', basis: 'ACCRUAL', compare: 'PRIOR_MONTH' },
      summary: { incomeCents: 482_500, expensesCents: 20_749, netCents: 461_751 },
      generatedByUserId: c.staffId,
    },
  });
  await tx.bookkeepingTerms.create({
    data: {
      ...base,
      id: ids.terms,
      version: 1,
      packageName: 'Monthly Bookkeeping',
      startDate: new Date('2026-09-01'),
      renewalType: 'AUTO',
      noticeDays: 30,
      billingFrequency: 'MONTHLY',
      billingTiming: 'ADVANCE',
      paymentTerms: 'NET_15',
      preferredPaymentMethod: 'ACH',
      monthlyFeeCents: 45_000,
      setupFeeCents: 25_000,
      includedServices: [
        'Monthly categorization',
        'Bank and card reconciliations',
        'Monthly P&L and balance sheet',
      ],
      excludedServices: ['Payroll processing', 'Tax return preparation', 'Sales tax filings'],
      deliverables: ['Monthly close by the 10th', 'One review call per quarter'],
      clientResponsibilities: [
        'Upload statements and receipts by the 5th',
        'Answer questions within 3 business days',
      ],
      firmResponsibilities: ['Close each month by the 10th', 'Flag unusual transactions'],
      effectiveFrom: new Date('2026-09-01'),
    },
  });
  await tx.bookkeepingTermsEvent.create({
    data: { businessId, termsId: ids.terms, kind: 'CREATED', actorUserId: c.staffId },
  });
  await tx.bookkeepingTerms.update({ where: { id: ids.terms }, data: { status: 'ACTIVE' } });
  await tx.bookkeepingTermsEvent.create({
    data: {
      businessId,
      termsId: ids.terms,
      kind: 'ACTIVATED',
      effectiveDate: new Date('2026-09-01'),
      actorUserId: c.ownerId,
    },
  });
}

/** September's P&L in progress, Q3's balance sheet not started, August's reconciliation delivered. */
async function seedBookkeepingReports(tx: TxClient, c: WorkSeedContext) {
  const { businessId } = c;
  const base = { businessId, engagementId: c.bookkeepingEngagementId };
  const generated = { generatedAt: new Date('2026-10-02T12:00:00Z'), generatedByUserId: c.staffId };
  await tx.bookkeepingReport.upsert({
    where: { id: SEED_R38_IDS.bkReport1 },
    update: {},
    create: {
      ...base,
      id: SEED_R38_IDS.bkReport1,
      periodId: SEED_R38_IDS.bkPeriodSep,
      reportType: 'PROFIT_LOSS',
      periodLabel: 'September 2026',
      basis: 'ACCRUAL',
      dueOn: new Date('2026-10-15'),
      status: 'IN_PROGRESS',
    },
  });
  await tx.bookkeepingReport.upsert({
    where: { id: SEED_R38_IDS.bkReport2 },
    update: {},
    create: {
      ...base,
      id: SEED_R38_IDS.bkReport2,
      reportType: 'BALANCE_SHEET',
      periodLabel: 'Q3 2026',
      dueOn: new Date('2026-10-20'),
    },
  });
  if (!(await tx.bookkeepingReport.findUnique({ where: { id: SEED_R38_IDS.bkReport3 } }))) {
    await tx.bookkeepingReport.create({
      data: {
        ...base,
        id: SEED_R38_IDS.bkReport3,
        periodId: SEED_R38_IDS.bkPeriodAug,
        reportType: 'RECONCILIATION',
        periodLabel: 'August 2026',
        dueOn: new Date('2026-09-15'),
        engagementReportId: c.reportId,
      },
    });
    const steps = [
      ['IN_PROGRESS', {}],
      ['IN_REVIEW', generated],
      ['APPROVED', { reviewedAt: new Date('2026-10-02T14:00:00Z'), reviewedByUserId: c.ownerId }],
      [
        'DELIVERED',
        { deliveredAt: new Date('2026-10-03T09:00:00Z'), deliveredByUserId: c.ownerId },
      ],
    ] as const;
    for (const [status, data] of steps) {
      await tx.bookkeepingReport.update({
        where: { id: SEED_R38_IDS.bkReport3 },
        data: { status, ...data },
      });
    }
  }
}

/** Two library strategies and a 2027 plan for the client with three strategies (one custom). */
async function seedTaxPlanning(tx: TxClient, c: WorkSeedContext) {
  const { businessId } = c;
  const strategy = (
    n: 'strategy1' | 'strategy2',
    name: string,
    category: 'RETIREMENT' | 'DEDUCTIONS',
    priority: 'HIGH' | 'MEDIUM',
  ) =>
    tx.taxPlanningStrategy.upsert({
      where: { id: SEED_R38_IDS[n] },
      update: {},
      create: {
        id: SEED_R38_IDS[n],
        businessId,
        name,
        category,
        defaultPriority: priority,
        description: 'Sample strategy for demonstration.',
        eligibility: { requires: ['earnedIncome'] },
        requiredInputs: ['agi', 'retirementContributions'],
        requiredDocuments: ['Most recent pay stubs'],
        implementationChecklist: [{ label: 'Confirm the contribution limit' }],
        createdByUserId: c.ownerId,
      },
    });
  await strategy('strategy1', 'Maximize retirement contributions', 'RETIREMENT', 'HIGH');
  await strategy('strategy2', 'Evaluate HSA contributions', 'DEDUCTIONS', 'MEDIUM');
  await tx.taxPlan.upsert({
    where: { id: SEED_R38_IDS.plan },
    update: {},
    create: {
      id: SEED_R38_IDS.plan,
      businessId,
      clientId: c.clientId,
      name: '2027 Tax Strategy Plan',
      planYear: 2027,
      filingStatus: 'SINGLE',
      entityType: 'INDIVIDUAL',
      status: 'IN_PROGRESS',
      goals: ['REDUCE_TAXABLE_INCOME', 'INCREASE_RETIREMENT_SAVINGS'],
      assignedUserId: c.staffId,
      targetCompletionOn: new Date('2026-12-15'),
      nextDiscussionOn: new Date('2026-11-05'),
      createdByUserId: c.ownerId,
    },
  });
  const planStrategy = (
    n: 'planStrategy1' | 'planStrategy2' | 'planStrategy3',
    data: Record<string, unknown>,
  ) =>
    tx.taxPlanStrategy.upsert({
      where: { id: SEED_R38_IDS[n] },
      update: {},
      create: {
        id: SEED_R38_IDS[n],
        businessId,
        planId: SEED_R38_IDS.plan,
        ...data,
      } as Parameters<typeof tx.taxPlanStrategy.create>[0]['data'],
    });
  await planStrategy('planStrategy1', {
    strategyId: SEED_R38_IDS.strategy1,
    displayName: 'Maximize retirement contributions',
    priority: 'HIGH',
    status: 'ACCEPTED',
    estimatedSavingsCents: 650000,
    estimateDataYear: 2025,
    estimateCalculatedAt: new Date('2026-10-02T12:00:00Z'),
    assumptions: 'Based on 2025 income and the 2026 401(k) limit.',
    position: 0,
  });
  await planStrategy('planStrategy2', {
    strategyId: SEED_R38_IDS.strategy2,
    displayName: 'Evaluate HSA contributions',
    priority: 'MEDIUM',
    estimatedSavingsCents: 120000,
    estimateDataYear: 2025,
    overrideSavingsCents: 100000,
    overrideReason: 'Client expects lower eligible contributions',
    overrideByUserId: c.ownerId,
    position: 1,
  });
  await planStrategy('planStrategy3', {
    customName: 'Prepay 2027 property tax',
    customCategory: 'TIMING',
    displayName: 'Prepay 2027 property tax',
    priority: 'LOW',
    position: 2,
  });
}

/** The plan's figures, a finalized snapshot, a document and a saved calculator scenario. */
async function seedTaxPlanDetails(tx: TxClient, c: WorkSeedContext) {
  const { businessId } = c;
  const plan = { businessId, planId: SEED_R38_IDS.plan };
  await tx.taxPlanInput.upsert({
    where: { id: SEED_R38_IDS.planInput1 },
    update: {},
    create: {
      ...plan,
      id: SEED_R38_IDS.planInput1,
      key: 'agi',
      kind: 'HISTORICAL',
      taxYear: 2026,
      amountCents: 14230000,
      source: 'Tax return 2026',
      asOf: new Date('2026-10-01T12:00:00Z'),
      enteredByUserId: c.staffId,
    },
  });
  await tx.taxPlanInput.upsert({
    where: { id: SEED_R38_IDS.planInput2 },
    update: {},
    create: {
      ...plan,
      id: SEED_R38_IDS.planInput2,
      key: 'retirement_contributions',
      kind: 'ADJUSTMENT',
      taxYear: 2027,
      amountCents: 200000,
      source: 'Manual entry',
      note: 'Client reported a mid-year change',
      enteredByUserId: c.staffId,
    },
  });
  await tx.taxPlanVersion.upsert({
    where: { id: SEED_R38_IDS.planVersion },
    update: {},
    create: {
      ...plan,
      id: SEED_R38_IDS.planVersion,
      version: 1,
      event: 'FINALIZED',
      taxYear: 2027,
      snapshot: {
        strategies: [
          {
            name: 'Maximize retirement contributions',
            priority: 'HIGH',
            estimatedSavingsCents: 650000,
            dataYear: 2026,
          },
        ],
        assumptions: 'Estimates, not guarantees.',
      },
      sourceDataAsOf: new Date('2026-10-01T12:00:00Z'),
      createdByUserId: c.ownerId,
    },
  });
  await tx.taxPlanDocument.upsert({
    where: { id: SEED_R38_IDS.planDocument },
    update: {},
    create: {
      ...plan,
      id: SEED_R38_IDS.planDocument,
      documentId: c.documentId,
      planStrategyId: SEED_R38_IDS.planStrategy1,
      category: 'Income',
      addedByUserId: c.staffId,
    },
  });
  await tx.taxSavingsScenario.upsert({
    where: { id: SEED_R38_IDS.scenario },
    update: {},
    create: {
      id: SEED_R38_IDS.scenario,
      businessId,
      clientId: c.clientId,
      planId: SEED_R38_IDS.plan,
      name: 'Max 401(k) at the limit',
      taxYear: 2027,
      filingStatus: 'SINGLE',
      baselineInputs: { agiCents: 14230000 },
      strategyInputs: { additionalContributionCents: 2300000 },
      baselineTaxCents: 2556000,
      modeledTaxCents: 1906000,
      differenceCents: 650000,
      assumptions: 'Based on the 2027 contribution limit as entered.',
      savedToPlanAt: new Date('2026-10-03T10:00:00Z'),
      createdByUserId: c.staffId,
    },
  });
}

/** One opportunity added to the plan after review, one new and unreviewed, with their history. */
async function seedOpportunities(tx: TxClient, c: WorkSeedContext) {
  const { businessId } = c;
  const base = {
    businessId,
    clientId: c.clientId,
    taxYear: 2027,
    source: 'SYSTEM' as const,
    ruleId: 'retirement.room_to_contribute',
    lastEvaluatedAt: new Date('2026-10-02T12:00:00Z'),
    estimateBasis: 'Based on 2026 income and the contribution limit.',
    createdByUserId: c.ownerId,
  };
  await tx.taxOpportunity.upsert({
    where: { id: SEED_R38_IDS.opportunity1 },
    update: {},
    create: {
      ...base,
      id: SEED_R38_IDS.opportunity1,
      strategyId: SEED_R38_IDS.strategy1,
      name: 'Maximize retirement contributions',
      category: 'RETIREMENT',
      priority: 'HIGH',
      description: 'Increase contributions to retirement accounts to reduce taxable income.',
      status: 'ADDED_TO_PLAN',
      whyExplanation: 'There is room to increase contributions to eligible retirement accounts.',
      clientDataUsed: [
        { label: 'Adjusted gross income', amountCents: 14230000 },
        { label: 'Filing status', text: 'Single' },
      ],
      estimatedSavingsCents: 650000,
      suggestedActionCents: 2300000,
      newTaxableIncomeCents: 11930000,
      effectiveRateBeforeBp: 1800,
      effectiveRateAfterBp: 1600,
      recommendedActions: [
        'Increase 401(k) contribution to the limit',
        'Review the employer match',
      ],
      eligibility: [{ text: 'Client has earned income from employment', met: true }],
      documentsNeeded: [{ label: 'Most recent pay stubs', received: true }],
      assignedUserId: c.staffId,
      planId: SEED_R38_IDS.plan,
      planStrategyId: SEED_R38_IDS.planStrategy1,
      reviewedAt: new Date('2026-10-02T13:00:00Z'),
      reviewedByUserId: c.ownerId,
    },
  });
  await tx.taxOpportunity.upsert({
    where: { id: SEED_R38_IDS.opportunity2 },
    update: {},
    create: {
      ...base,
      id: SEED_R38_IDS.opportunity2,
      strategyId: SEED_R38_IDS.strategy2,
      name: 'Evaluate HSA contributions',
      category: 'DEDUCTIONS',
      priority: 'MEDIUM',
      dataComplete: false,
      missingData: ['health plan type'],
      whyExplanation: 'The health plan type is not on file, so eligibility is not confirmed.',
    },
  });
  await tx.taxOpportunityEvent.upsert({
    where: { id: SEED_R38_IDS.opportunityEvent1 },
    update: {},
    create: {
      id: SEED_R38_IDS.opportunityEvent1,
      businessId,
      opportunityId: SEED_R38_IDS.opportunity1,
      kind: 'SCREENED',
      details: { ruleId: 'retirement.room_to_contribute' },
    },
  });
  await tx.taxOpportunityEvent.upsert({
    where: { id: SEED_R38_IDS.opportunityEvent2 },
    update: {},
    create: {
      id: SEED_R38_IDS.opportunityEvent2,
      businessId,
      opportunityId: SEED_R38_IDS.opportunity1,
      kind: 'STATUS',
      fromStatus: 'UNDER_REVIEW',
      toStatus: 'ADDED_TO_PLAN',
      reason: 'Reviewed with the client',
      actorUserId: c.ownerId,
    },
  });
}
