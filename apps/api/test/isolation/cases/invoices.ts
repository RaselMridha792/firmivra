// Invoices to a client: the firm's invoice routes.
import { randomUUID } from 'node:crypto';
import type { CaseModule } from '../world.js';

const day = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

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
  'PUT /api/v1/business/invoices/:id': {
    params: { id: 'invoice' },
    body: { lines: [{ description: 'Fake service', unitAmountCents: 5_000 }], dueOn: day(20) },
  },
};
