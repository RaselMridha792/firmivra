// Bookkeeping workspaces and their reports, firm side and portal side.
import type { CaseModule } from '../world.js';

export const records: CaseModule['records'] = {
  report: {
    clientPrivate: true,
    async create({ tx, businessId, get }) {
      const row = await tx.engagementReport.create({
        data: {
          businessId,
          engagementId: await get('workspace'),
          kind: 'REPORT',
          title: 'Fake report',
        },
      });
      return row.id;
    },
  },
};

export const cases: CaseModule['cases'] = {
  'GET /api/v1/business/workspaces/:engagementId': { params: { engagementId: 'workspace' } },
  'GET /api/v1/business/workspaces/:engagementId/reports': {
    params: { engagementId: 'workspace' },
  },
  'POST /api/v1/business/workspaces/:engagementId/reports': {
    params: { engagementId: 'workspace' },
    bodyIds: { documentId: 'workspaceDocument' },
    body: { kind: 'REPORT', title: 'Fake report' },
  },
  'PATCH /api/v1/business/reports/:id': {
    params: { id: 'report' },
    bodyIds: { documentId: 'workspaceDocument' },
    body: { title: 'Fake renamed report' },
  },
  'DELETE /api/v1/business/reports/:id': { params: { id: 'report' } },
  'POST /api/v1/business/reports/:id/publish': { params: { id: 'report' } },
  'POST /api/v1/business/reports/:id/unpublish': { params: { id: 'report' } },
  'GET /api/v1/portal/:firmSlug/me/services/:engagementId/reports': {
    params: { engagementId: 'workspace' },
  },
};
