// Document requests: the firm asks a client for a file; the client answers in the portal.
import type { CaseModule } from '../world.js';

export const records: CaseModule['records'] = {
  /** An open request to client X on their annual return. */
  documentRequest: {
    clientPrivate: true,
    async create({ tx, businessId, owner, get }) {
      const row = await tx.documentRequest.create({
        data: {
          businessId,
          clientId: await get('client'),
          engagementId: await get('engagement'),
          title: 'Fake W-2',
          requestedByUserId: owner.id,
        },
      });
      return row.id;
    },
  },
};

const request = { params: { id: 'documentRequest' } };

export const cases: CaseModule['cases'] = {
  'GET /api/v1/business/clients/:clientId/document-requests': { params: { clientId: 'client' } },
  'POST /api/v1/business/clients/:clientId/document-requests': {
    params: { clientId: 'client' },
    // The request's serviceId is the client's engagement, as for uploads.
    bodyIds: { serviceId: 'engagement', categoryId: 'documentCategory' },
    body: { title: 'Fake 1099' },
  },
  // Found, but nothing was uploaded for it yet, so there is nothing to accept or reject.
  'POST /api/v1/business/document-requests/:id/accept': { ...request, body: {}, expect: 409 },
  'POST /api/v1/business/document-requests/:id/reject': {
    ...request,
    body: { reason: 'Fake: the page is cut off' },
    expect: 409,
  },
  'POST /api/v1/business/document-requests/:id/cancel': { ...request, body: {} },
  'POST /api/v1/portal/:firmSlug/me/document-requests/:id/not-available': {
    ...request,
    body: { reason: 'Fake: I never got one' },
  },
};
