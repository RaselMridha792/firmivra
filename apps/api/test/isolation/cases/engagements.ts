// Engagements (a client's services) and the portal's services page.
import type { CaseModule } from '../world.js';

export const records: CaseModule['records'] = {
  /** The firm's annual tax service (the world's own one). */
  service: {
    create: ({ own }) => Promise.resolve(own.service),
  },
  /** Client X's annual tax return engagement. */
  engagement: {
    clientPrivate: true,
    async create({ tx, businessId, own, get }) {
      const row = await tx.engagement.create({
        data: {
          businessId,
          clientId: await get('client'),
          serviceId: own.service,
          title: 'Fake 2025 return',
          taxYear: 2025,
        },
      });
      return row.id;
    },
  },
  /** Client X's bookkeeping engagement: recurring, with a workspace and reports. */
  workspace: {
    clientPrivate: true,
    async create({ tx, businessId, own, get }) {
      const row = await tx.engagement.create({
        data: {
          businessId,
          clientId: await get('client'),
          serviceId: own.bookkeeping,
          title: 'Fake books',
          billingInterval: 'MONTHLY',
        },
      });
      return row.id;
    },
  },
};

export const cases: CaseModule['cases'] = {
  'GET /api/v1/business/clients/:id/engagements': { params: { id: 'client' } },
  'POST /api/v1/business/clients/:id/engagements': {
    params: { id: 'client' },
    bodyIds: { serviceId: 'service', assignedUserId: 'staffUser' },
    body: { title: 'Fake engagement', taxYear: 2024 },
  },
  'GET /api/v1/business/engagements/:id': { params: { id: 'engagement' } },
  'GET /api/v1/business/engagements/:id/history': { params: { id: 'engagement' } },
  'PATCH /api/v1/business/engagements/:id': {
    params: { id: 'engagement' },
    bodyIds: { assignedUserId: 'staffUser' },
    body: { title: 'Fake renamed engagement' },
  },
  'POST /api/v1/business/engagements/:id/cancel': {
    params: { id: 'engagement' },
    body: { reason: 'Fake reason' },
  },
  'POST /api/v1/business/engagements/:id/complete': { params: { id: 'engagement' } },
  // Found, but only a cancelled engagement can be reactivated.
  'POST /api/v1/business/engagements/:id/reactivate': { params: { id: 'engagement' }, expect: 409 },
  'POST /api/v1/portal/:firmSlug/me/services/:id/cancel-request': {
    params: { id: 'workspace' },
    body: { reason: 'Fake reason' },
  },
};
