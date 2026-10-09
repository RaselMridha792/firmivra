// The firm's internal notes on a client (never shown in the portal).
import type { CaseModule } from '../world.js';

export const records: CaseModule['records'] = {
  /** Firm P's Owner's note on client X. */
  note: {
    clientPrivate: true,
    async create({ tx, businessId, owner, get }) {
      const row = await tx.note.create({
        data: {
          businessId,
          clientId: await get('client'),
          body: 'Fake note',
          authorUserId: owner.id,
        },
      });
      return row.id;
    },
  },
};

export const cases: CaseModule['cases'] = {
  'GET /api/v1/business/clients/:id/notes': { params: { id: 'client' } },
  'POST /api/v1/business/clients/:id/notes': {
    params: { id: 'client' },
    bodyIds: { engagementId: 'engagement' },
    body: { body: 'Fake note' },
  },
  'PATCH /api/v1/business/notes/:id': { params: { id: 'note' }, body: { body: 'Fake edit' } },
  'DELETE /api/v1/business/notes/:id': { params: { id: 'note' } },
};
