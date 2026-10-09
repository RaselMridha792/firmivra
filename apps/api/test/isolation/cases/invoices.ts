// Invoices to a client.
import { randomUUID } from 'node:crypto';
import type { CaseModule } from '../world.js';

export const records: CaseModule['records'] = {
  /** A draft invoice to client X. */
  invoice: {
    clientPrivate: true,
    async create({ tx, businessId, get }) {
      const row = await tx.invoice.create({
        data: {
          businessId,
          clientId: await get('client'),
          number: `ISO-${randomUUID().slice(0, 8)}`,
        },
      });
      return row.id;
    },
  },
};

export const cases: CaseModule['cases'] = {
  'GET /api/v1/business/invoices/:id': { params: { id: 'invoice' } },
};
