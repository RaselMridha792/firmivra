// A client's tax returns per year (firm side; the portal lists only the client's own).
import type { CaseModule } from '../world.js';

export const records: CaseModule['records'] = {
  /** Client X's 2025 individual return, in progress. */
  taxReturn: {
    clientPrivate: true,
    async create({ tx, businessId, get }) {
      const row = await tx.taxReturn.create({
        data: {
          businessId,
          clientId: await get('client'),
          taxYear: 2025,
          filingType: 'INDIVIDUAL',
        },
      });
      return row.id;
    },
  },
};

export const cases: CaseModule['cases'] = {
  'GET /api/v1/business/clients/:id/tax-returns': { params: { id: 'client' } },
  'POST /api/v1/business/clients/:id/tax-returns': {
    params: { id: 'client' },
    bodyIds: { engagementId: 'engagement', documentId: 'document' },
    body: { taxYear: 2024, filingType: 'BUSINESS' },
  },
  'PATCH /api/v1/business/tax-returns/:id': {
    params: { id: 'taxReturn' },
    bodyIds: { engagementId: 'engagement', documentId: 'document' },
    body: { formType: '1040' },
  },
  'DELETE /api/v1/business/tax-returns/:id': { params: { id: 'taxReturn' } },
};
