// Local sample data for the R39 tables (templates, communications, reports, integrations,
// payroll, business advisory), for LVP only. Synthetic. Safe to run again: each part finds its
// rows by a natural key before it creates them.
import type { TxClient } from '../src/client.js';
import { SEED_USERS } from './seed-data.js';

export async function seedR39(tx: TxClient, businessId: string) {
  await seedTemplates(tx, businessId);
  await seedIntegrations(tx, businessId);
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
