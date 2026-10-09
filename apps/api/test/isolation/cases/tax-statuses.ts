// The firm's own tax statuses.
import { randomUUID } from 'node:crypto';
import type { CaseModule } from '../world.js';

export const records: CaseModule['records'] = {
  taxStatus: {
    async create({ tx, businessId }) {
      const row = await tx.taxStatus.create({
        data: { businessId, name: `Fake status ${randomUUID().slice(0, 8)}` },
      });
      return row.id;
    },
  },
};

export const cases: CaseModule['cases'] = {
  'PATCH /api/v1/business/tax-statuses/:id': {
    params: { id: 'taxStatus' },
    body: { name: 'Fake renamed status' },
  },
  'POST /api/v1/business/tax-statuses/:id/archive': { params: { id: 'taxStatus' } },
};
