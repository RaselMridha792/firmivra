// Tasks on an engagement.
import type { CaseModule } from '../world.js';

export const records: CaseModule['records'] = {
  task: {
    clientPrivate: true,
    async create({ tx, businessId, get }) {
      const row = await tx.task.create({
        data: {
          businessId,
          clientId: await get('client'),
          engagementId: await get('engagement'),
          title: 'Fake task',
        },
      });
      return row.id;
    },
  },
};

export const cases: CaseModule['cases'] = {
  'POST /api/v1/business/tasks': {
    params: {},
    bodyIds: { clientId: 'client', engagementId: 'engagement', assignedUserId: 'adminUser' },
    body: { title: 'Fake task' },
  },
  'PATCH /api/v1/business/tasks/:id': {
    params: { id: 'task' },
    bodyIds: { assignedUserId: 'adminUser' },
    body: { title: 'Fake renamed task' },
  },
};
