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

  // Tasks: a template.
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
}
