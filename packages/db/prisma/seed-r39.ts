// Local sample data for the R39 tables (templates, communications, reports, integrations,
// payroll, business advisory), for LVP only. Synthetic. Safe to run again: each part finds its
// rows by a natural key before it creates them.
import type { TxClient } from '../src/client.js';
import { SEED_USERS } from './seed-data.js';

export async function seedR39(tx: TxClient, businessId: string) {
  await seedTemplates(tx, businessId);
  await seedIntegrations(tx, businessId);
  await seedIntegrationRequest(tx, businessId);
  await seedAudiences(tx, businessId);
  await seedCommunications(tx, businessId);
  await seedReports(tx, businessId);
  await seedPayroll(tx, businessId);
}

async function seedTemplates(tx: TxClient, businessId: string) {
  const ownerUserId = SEED_USERS.lvpOwner.id;
  const kind = 'EMAIL';
  const category = await tx.templateCategory.upsert({
    where: { businessId_kind_name: { businessId, kind, name: 'Tax Season' } },
    update: {},
    create: { businessId, kind, name: 'Tax Season', sortOrder: 1 },
  });
  const starterKey = 'tax-organizer-ready';
  if (
    await tx.messageTemplate.findUnique({
      where: { businessId_starterKey: { businessId, starterKey } },
    })
  )
    return;
  const template = await tx.messageTemplate.create({
    data: {
      businessId,
      kind,
      categoryId: category.id,
      starterKey,
      ownerUserId,
      status: 'ACTIVE',
      name: 'Tax Organizer Ready',
      subject: 'Your tax organizer is ready',
      access: 'TEAM',
      body: 'Hello [Client First Name], your organizer is ready: [Organizer Link]',
      tags: ['tax', 'organizer'],
      includeInAutomations: true,
    },
  });
  await tx.messageTemplateVersion.create({
    data: {
      businessId,
      templateId: template.id,
      version: 1,
      name: template.name,
      subject: template.subject,
      body: template.body,
      savedByUserId: ownerUserId,
    },
  });
  const link = { businessId, templateId: template.id };
  await tx.messageTemplateShare.create({ data: { ...link, userId: SEED_USERS.lvpStaff.id } });
  await tx.messageTemplateFavorite.create({ data: { ...link, userId: ownerUserId } });
  await tx.messageTemplateUse.create({ data: { ...link, version: 1, purpose: 'communication' } });
  await tx.messageTemplateAttachment.create({
    data: {
      ...link,
      fileName: 'Organizer.pdf',
      contentType: 'application/pdf',
      sizeBytes: 1024,
      s3Key: `tenant/${businessId}/templates/${template.id}/organizer-sample.pdf`,
    },
  });
  await tx.templateBranding.upsert({
    where: { businessId },
    update: {},
    create: { businessId, footerText: 'LVP Accounting & Taxes', disclaimer: 'Sample disclaimer.' },
  });
  await tx.customMergeField.upsert({
    where: { businessId_key: { businessId, key: 'Office Hours' } },
    update: {},
    create: { businessId, key: 'Office Hours', label: 'Office hours', fallback: '9 to 5' },
  });
}

async function seedIntegrations(tx: TxClient, businessId: string) {
  const provider = 'quickbooks_online';
  const environment = 'LIVE' as const;
  const where = { businessId_provider_environment: { businessId, provider, environment } };
  if (await tx.integrationConnection.findUnique({ where })) return;
  const connection = await tx.integrationConnection.create({
    data: {
      businessId,
      provider,
      environment,
      accountLabel: 'LVP Accounting & Taxes LLC',
      accountIdLast4: '3456',
      // Where the secret lives, never the secret (local development has no real connection).
      secretRef: 'firmivra/local/lvp/quickbooks_online',
      entities: ['invoices', 'customers', 'payments'],
      syncEveryMinutes: 60,
      connectedByUserId: SEED_USERS.lvpOwner.id,
      lastSyncAt: new Date(),
      nextSyncAt: new Date(Date.now() + 3_600_000),
    },
  });
  const link = { businessId, connectionId: connection.id };
  await tx.integrationFieldMapping.create({
    data: { ...link, scope: 'client', localField: 'client.name', externalField: 'Customer Name' },
  });
  const now = new Date();
  await tx.integrationSyncRun.create({
    data: {
      ...link,
      entity: 'invoices',
      status: 'SUCCEEDED',
      recordCount: 42,
      startedAt: now,
      finishedAt: now,
    },
  });
}

async function seedIntegrationRequest(tx: TxClient, businessId: string) {
  const providerName = 'Sample Books';
  if (await tx.integrationRequest.findFirst({ where: { businessId, providerName } })) return;
  await tx.integrationRequest.create({
    data: {
      businessId,
      requestedByUserId: SEED_USERS.lvpOwner.id,
      providerName,
      connectTo: 'Invoices and payments',
    },
  });
}

async function seedAudiences(tx: TxClient, businessId: string) {
  const client = await tx.client.findFirstOrThrow({ where: { businessId } });
  const ownerUserId = SEED_USERS.lvpOwner.id;
  const list = await tx.communicationSegment.upsert({
    where: { businessId_name: { businessId, name: 'Priority clients' } },
    update: {},
    create: { businessId, name: 'Priority clients', type: 'STATIC', ownerUserId, memberCount: 1 },
  });
  await tx.communicationSegmentMember.upsert({
    where: { segmentId_clientId: { segmentId: list.id, clientId: client.id } },
    update: {},
    create: { businessId, segmentId: list.id, clientId: client.id },
  });
  await tx.communicationSegment.upsert({
    where: { businessId_name: { businessId, name: 'Active clients' } },
    update: {},
    create: {
      businessId,
      name: 'Active clients',
      type: 'DYNAMIC',
      ownerUserId,
      criteria: { all: [{ field: 'status', is: 'ACTIVE' }] },
      criteriaSummary: 'Status is Active',
    },
  });
  await tx.communicationConsent.upsert({
    where: { businessId_clientId_channel: { businessId, clientId: client.id, channel: 'EMAIL' } },
    update: {},
    create: {
      businessId,
      clientId: client.id,
      channel: 'EMAIL',
      status: 'OPTED_IN',
      source: 'portal',
    },
  });
}

async function seedCommunications(tx: TxClient, businessId: string) {
  const name = 'Tax season welcome';
  if (await tx.communication.findFirst({ where: { businessId, name } })) return;
  const segment = await tx.communicationSegment.findUniqueOrThrow({
    where: { businessId_name: { businessId, name: 'Priority clients' } },
  });
  const template = await tx.messageTemplate.findUniqueOrThrow({
    where: { businessId_starterKey: { businessId, starterKey: 'tax-organizer-ready' } },
  });
  const sent = await tx.communication.create({
    data: {
      businessId,
      channel: 'EMAIL',
      name,
      subject: 'Your tax organizer is ready',
      body: 'Hello, your organizer is ready.',
      fromName: 'LVP Accounting & Taxes',
      templateId: template.id,
      templateVersion: 1,
      createdByUserId: SEED_USERS.lvpOwner.id,
    },
  });
  await tx.communicationAudienceEntry.create({
    data: {
      businessId,
      communicationId: sent.id,
      kind: 'SEGMENT',
      segmentId: segment.id,
      segmentName: segment.name,
      criteriaSnapshot: {},
    },
  });
  await tx.communication.update({
    where: { id: sent.id },
    data: {
      status: 'SENDING',
      startedAt: new Date(),
      selectedCount: 1,
      autoExcludedCount: 0,
      manualExcludedCount: 0,
      finalCount: 1,
    },
  });
  const client = await tx.client.findFirstOrThrow({ where: { businessId } });
  const recipient = await tx.communicationRecipient.create({
    data: {
      businessId,
      communicationId: sent.id,
      clientId: client.id,
      addressMask: 'c***@example.test',
      status: 'OPENED',
      sentAt: new Date(),
      openCount: 1,
    },
  });
  await tx.communicationEvent.create({
    data: {
      businessId,
      communicationId: sent.id,
      recipientId: recipient.id,
      type: 'OPENED',
      occurredAt: new Date(),
    },
  });
  await tx.communication.update({
    where: { id: sent.id },
    data: { status: 'SENT', sentAt: new Date() },
  });
  await tx.communication.create({
    data: {
      businessId,
      channel: 'SMS',
      name: 'Appointment reminder draft',
      body: 'Reminder: your appointment is tomorrow.',
      createdByUserId: SEED_USERS.lvpOwner.id,
    },
  });
}

async function seedReports(tx: TxClient, businessId: string) {
  await tx.reportSettings.upsert({ where: { businessId }, update: {}, create: { businessId } });
  const ownerUserId = SEED_USERS.lvpOwner.id;
  if (await tx.reportDefinition.findFirst({ where: { businessId, name: 'Custom Revenue Report' } }))
    return;
  const report = await tx.reportDefinition.create({
    data: {
      businessId,
      category: 'FINANCIAL',
      dataSource: 'invoices_payments',
      name: 'Custom Revenue Report',
      columns: ['client_name', 'invoice_number', 'invoice_date', 'amount', 'balance_due'],
      filters: [{ field: 'payment_status', op: 'is_any_of', value: ['paid', 'partial'] }],
      groupBy: 'service_type',
      sortBy: 'amount',
      sortDescending: true,
      showTotals: true,
      datePreset: 'this_year',
      ownerUserId,
      visibility: 'COMPANY',
    },
  });
  const link = { businessId, definitionId: report.id };
  await tx.reportFavorite.create({ data: { ...link, userId: ownerUserId } });
  await tx.reportShare.create({ data: { ...link, userId: SEED_USERS.lvpStaff.id } });
  const schedule = await tx.reportSchedule.create({
    data: {
      businessId,
      definitionId: report.id,
      name: 'Weekly revenue report',
      frequency: 'WEEKLY',
      weekday: 1,
      runTime: new Date('1970-01-01T08:00:00Z'),
      timezone: 'America/New_York',
      datePreset: 'previous_week',
      formats: ['PDF'],
      ownerUserId,
    },
  });
  await tx.reportScheduleRecipient.create({
    data: { businessId, scheduleId: schedule.id, userId: SEED_USERS.lvpOwner.id },
  });
  const now = new Date();
  await tx.reportRun.create({
    data: {
      businessId,
      definitionId: report.id,
      scheduleId: schedule.id,
      kind: 'SCHEDULED',
      status: 'SUCCEEDED',
      format: 'PDF',
      rowCount: 10,
      startedAt: now,
      finishedAt: now,
    },
  });
}

async function seedPayroll(tx: TxClient, businessId: string) {
  await tx.payrollSettings.upsert({ where: { businessId }, update: {}, create: { businessId } });
  const service = await tx.service.findFirstOrThrow({ where: { businessId, kind: 'PAYROLL' } });
  const client = await tx.client.findFirstOrThrow({ where: { businessId } });
  let engagement = await tx.engagement.findFirst({
    where: { businessId, clientId: client.id, serviceId: service.id },
  });
  engagement ??= await tx.engagement.create({
    data: { businessId, clientId: client.id, serviceId: service.id, title: '2026 Payroll' },
  });
  if (
    await tx.payrollClient.findUnique({
      where: { businessId_engagementId: { businessId, engagementId: engagement.id } },
    })
  )
    return;
  const payrollClient = await tx.payrollClient.create({
    data: {
      businessId,
      clientId: client.id,
      engagementId: engagement.id,
      status: 'ON_TRACK',
      frequency: 'BIWEEKLY',
      providerKey: 'gusto',
      industry: 'Restaurant',
      assignedUserId: SEED_USERS.lvpStaff.id,
      serviceSince: new Date('2024-01-15'),
    },
  });
  const link = { businessId, payrollClientId: payrollClient.id };
  await tx.payrollClientChange.create({
    data: {
      ...link,
      field: 'status',
      oldValue: 'NOT_STARTED',
      newValue: 'ON_TRACK',
      changedByUserId: SEED_USERS.lvpOwner.id,
    },
  });
  const worker = { ...link, source: 'import', workerType: 'FULL_TIME' as const };
  await tx.payrollWorker.create({
    data: {
      ...worker,
      displayName: 'Jasmine Smith',
      payType: 'HOURLY',
      rateCents: 1800,
      externalId: 'sample-1',
    },
  });
  await tx.payrollWorker.create({
    data: {
      ...worker,
      displayName: 'Emily Wilson',
      workerType: 'PART_TIME',
      payType: 'HOURLY',
      rateCents: 1650,
    },
  });
  const paid = new Date();
  await tx.payrollRun.create({
    data: {
      ...link,
      periodStart: new Date('2026-08-16'),
      periodEnd: new Date('2026-08-31'),
      payDate: new Date('2026-09-05'),
      frequency: 'SEMI_MONTHLY',
      status: 'COMPLETED',
      step: 5,
      source: 'provider',
      figuresConfirmed: true,
      employeeCount: 25,
      regularPayCents: 4_200_000,
      overtimePayCents: 300_000,
      otherEarningsCents: 120_000,
      grossCents: 4_620_000,
      employeeTaxesCents: 689_000,
      deductionsCents: 315_000,
      netCents: 3_616_000,
      readyAt: paid,
      approvedAt: paid,
      approvedByUserId: SEED_USERS.lvpOwner.id,
      submittedAt: paid,
      completedAt: paid,
    },
  });
  await tx.payrollRun.create({
    data: {
      ...link,
      periodStart: new Date('2026-09-01'),
      periodEnd: new Date('2026-09-15'),
      payDate: new Date('2026-09-19'),
      frequency: 'SEMI_MONTHLY',
      status: 'IN_PROGRESS',
      step: 2,
    },
  });
  await tx.payrollActivity.create({
    data: {
      ...link,
      kind: 'CLIENT_CALL',
      summary: 'Confirmed the pay schedule.',
      loggedByUserId: SEED_USERS.lvpOwner.id,
    },
  });

  const jasmine = await tx.payrollWorker.findFirstOrThrow({
    where: { ...link, displayName: 'Jasmine Smith' },
  });
  const current = await tx.payrollRun.findFirstOrThrow({
    where: { ...link, status: 'IN_PROGRESS' },
  });
  await tx.payrollRunLine.create({
    data: {
      businessId,
      runId: current.id,
      workerId: jasmine.id,
      hours: 80,
      regularPayCents: 144_000,
      otherEarningsCents: 5000,
      deductionsCents: 22_045,
      totalPayCents: 126_955,
    },
  });
  await tx.payrollRunIssue.create({
    data: {
      businessId,
      runId: current.id,
      severity: 'WARNING',
      code: 'overtime_review',
      message: 'Two workers have overtime hours. Review for accuracy.',
    },
  });
  await tx.payrollFiling.create({
    data: {
      ...link,
      form: '941',
      jurisdiction: 'federal',
      periodStart: new Date('2026-04-01'),
      periodEnd: new Date('2026-06-30'),
      dueOn: new Date('2026-07-31'),
      status: 'FILED',
      paymentStatus: 'PAID',
      source: 'import',
      sourceSyncedAt: new Date(),
      confirmedAt: new Date(),
    },
  });
  await tx.payrollReport.create({
    data: {
      ...link,
      kind: 'REGISTER',
      periodStart: new Date('2026-08-16'),
      periodEnd: new Date('2026-08-31'),
      source: 'import',
    },
  });
  await tx.payrollYearEnd.create({
    data: {
      ...link,
      taxYear: 2025,
      status: 'IN_PROGRESS',
      items: { worker_review: 'done', w2_w3: 'pending' },
    },
  });
}
