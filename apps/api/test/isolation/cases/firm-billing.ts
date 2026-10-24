// Settings > Billing: the firm's own Firmivra invoices (R60). A firm reads only its own issued
// invoices (R0's firm-read policy); another firm's id is 404, a draft too.
import type { CaseModule } from '../world.js';

export const records: CaseModule['records'] = {
  /** An invoice Firmivra issued to firm P (made as a draft, then sent, as the database asks). */
  platformInvoice: {
    async create({ tx, businessId, owner }) {
      const { id } = await tx.platformInvoice.create({
        data: {
          businessId,
          invoiceDate: new Date('2026-10-01T00:00:00Z'),
          dueDate: new Date('2026-10-31T00:00:00Z'),
          billToName: 'Fake Billing Contact',
          billToEmail: 'billing@isolation.test',
          subtotalCents: 9_900,
          createdByUserId: owner.id,
        },
        select: { id: true },
      });
      await tx.platformInvoice.update({ where: { id }, data: { status: 'SENT' } });
      return id;
    },
  },
};

export const cases: CaseModule['cases'] = {
  'GET /api/v1/business/billing/invoices/:id': { params: { id: 'platformInvoice' } },
  'GET /api/v1/business/billing/invoices/:id/pdf': { params: { id: 'platformInvoice' } },
};
