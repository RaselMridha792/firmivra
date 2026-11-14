// Tax Planning Review 2, Project Deadlines (R56): firm P's Owner's own PRIVATE deadline. Another
// member of firm P who it is not shared with also gets 404 (test/e2e/project-deadlines.e2e.test.ts).
import type { CaseModule } from '../world.js';

const BASE = '/api/v1/business/tax-planning/project-deadlines';
const ids = { serviceId: 'service', clientId: 'client', sharedWithUserIds: 'staffUser' };
const body = {
  name: 'Fake planning review',
  dueAt: '2033-04-15T21:00:00.000Z',
  visibility: 'SHARED',
  reminders: [{ amount: 1, unit: 'DAYS' }],
};

export const records: CaseModule['records'] = {
  projectDeadline: {
    async create({ tx, businessId, owner, get }) {
      const row = await tx.projectDeadline.create({
        data: {
          businessId,
          name: 'Fake planning review',
          dueAt: new Date('2033-04-15T21:00:00Z'),
          serviceId: await get('service'),
          ownerUserId: owner.id,
        },
      });
      return row.id;
    },
  },
};

export const cases: CaseModule['cases'] = {
  [`POST ${BASE}`]: { params: {}, bodyIds: ids, body },
  [`GET ${BASE}/:id`]: { params: { id: 'projectDeadline' } },
  [`PUT ${BASE}/:id`]: { params: { id: 'projectDeadline' }, bodyIds: ids, body },
  [`POST ${BASE}/:id/complete`]: { params: { id: 'projectDeadline' } },
  [`POST ${BASE}/:id/reopen`]: { params: { id: 'projectDeadline' } },
  [`DELETE ${BASE}/:id`]: { params: { id: 'projectDeadline' } },
};
