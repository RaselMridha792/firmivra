// Local sample data for the R39 tables (templates, communications, reports, integrations,
// payroll, business advisory), for LVP only. Synthetic. Safe to run again: each part finds its
// rows by a natural key before it creates them.
import type { TxClient } from '../src/client.js';
import { SEED_USERS } from './seed-data.js';

export async function seedR39(tx: TxClient, businessId: string) {
  await seedTemplates(tx, businessId);
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
}
