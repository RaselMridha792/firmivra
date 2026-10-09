// The firm's tips and articles.
import type { CaseModule } from '../world.js';

export const records: CaseModule['records'] = {
  content: {
    async create({ tx, businessId }) {
      const row = await tx.contentItem.create({
        data: { businessId, kind: 'TIP', title: 'Fake tip', body: 'Fake body' },
      });
      return row.id;
    },
  },
};

export const cases: CaseModule['cases'] = {
  'PATCH /api/v1/business/content/:id': {
    params: { id: 'content' },
    body: { title: 'Fake renamed content' },
  },
  'DELETE /api/v1/business/content/:id': { params: { id: 'content' } },
  'POST /api/v1/business/content/:id/publish': { params: { id: 'content' } },
  'POST /api/v1/business/content/:id/unpublish': { params: { id: 'content' } },
};
