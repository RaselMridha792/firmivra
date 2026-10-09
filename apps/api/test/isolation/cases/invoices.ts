// Invoices to a client: the firm's invoice routes and the portal's own invoices.
import { randomUUID } from 'node:crypto';
import type { CaseModule, SeedContext } from '../world.js';

const day = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

async function openInvoice({ tx, businessId, get }: SeedContext): Promise<string> {
  const row = await tx.invoice.create({
    data: {
      businessId,
      clientId: await get('client'),
      number: `ISO-${randomUUID().slice(0, 8)}`,
      dueOn: new Date(`${day(30)}T00:00:00.000Z`),
    },
  });
  await tx.invoiceLine.create({
    data: { businessId, invoiceId: row.id, description: 'Fake service', unitAmountCents: 10_000 },
  });
  await tx.invoice.update({
    where: { id: row.id },
    data: { status: 'OPEN', issuedAt: new Date() },
  });
  return row.id;
}

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
  /** An open invoice of 100.00 to client X, sent today. */
  openInvoice: { clientPrivate: true, create: openInvoice },
};

export const cases: CaseModule['cases'] = {
  'POST /api/v1/business/invoices': {
    params: {},
    bodyIds: { clientId: 'client', engagementId: 'engagement' },
    body: { lines: [{ description: 'Fake service', unitAmountCents: 5_000 }], dueOn: day(20) },
  },
  'GET /api/v1/business/invoices/:id': { params: { id: 'invoice' } },
  'PUT /api/v1/business/invoices/:id': {
    params: { id: 'invoice' },
    bodyIds: { engagementId: 'engagement' },
    body: { lines: [{ description: 'Fake service', unitAmountCents: 5_000 }], dueOn: day(20) },
  },
  // Found, but a draft with no lines has nothing to pay.
  'POST /api/v1/business/invoices/:id/send': { params: { id: 'invoice' }, expect: 409 },
  'GET /api/v1/portal/:firmSlug/me/invoices/:id': { params: { id: 'openInvoice' } },
};
