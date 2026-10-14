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
}

/** Stable ids: 00000000-0000-4000-d<module>-<n>. */
const id = (n: number) => `00000000-0000-4000-d000-${String(n).padStart(12, '0')}`;
export const SEED_R38_IDS = {
  taskType: id(1),
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
}
