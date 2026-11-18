// The Client Portal module (firm workspace), by the client's id: the header, summary, pending
// actions, activity and login history (firm P's Owner 200; firm Q 404), and Lock and Unlock Portal
// Access (firm P's Owner locks and unlocks its client X; firm Q gets 404 and changes nothing).
// Settings > Client Portal > Features > Custom Tabs (CP-5d, CP-5e): a tab by its id, and the tags
// and clients a tab names.
import { randomUUID } from 'node:crypto';
import type { CaseModule } from '../world.js';

const client = { params: { id: 'client' } };
const short = () => randomUUID().slice(0, 8);

export const records: CaseModule['records'] = {
  /** A live tag of the firm (a custom tab's audience names it). */
  tag: {
    async create({ tx, businessId }) {
      const tag = await tx.tag.create({ data: { businessId, name: `Fake tag ${short()}` } });
      return tag.id;
    },
  },
  /**
   * A custom document tab for all business clients. The world's client X becomes a business
   * client, so their portal shows it (custom tabs show only in business portals).
   */
  portalCustomTab: {
    async create({ tx, businessId, get }) {
      const clientId = await get('client');
      await tx.client.update({ where: { id: clientId }, data: { accountType: 'BUSINESS' } });
      const tab = await tx.portalTab.create({
        data: {
          businessId,
          kind: 'CUSTOM',
          module: 'DOCUMENTS',
          label: `Fake custom tab ${short()}`,
          sortOrder: 6,
          audience: 'ALL',
        },
      });
      return tab.id;
    },
  },
};

/** A tab's targets: a tag audience may name a client too (it shows to both). */
const targets = { bodyIds: { tagIds: 'tag', clientIds: 'client' } };

export const cases: CaseModule['cases'] = {
  'GET /api/v1/business/client-portal/clients/:id': client,
  'GET /api/v1/business/client-portal/clients/:id/summary': client,
  'GET /api/v1/business/client-portal/clients/:id/pending-actions': client,
  'GET /api/v1/business/client-portal/clients/:id/activity': client,
  'GET /api/v1/business/client-portal/clients/:id/logins': client,
  'POST /api/v1/business/client-portal/clients/:id/lock': {
    params: { id: 'client' },
    body: { reason: 'Fake reason' },
  },
  'POST /api/v1/business/client-portal/clients/:id/unlock': client,
  'GET /api/v1/business/client-portal/clients/:id/visibility': client,
  'PUT /api/v1/business/client-portal/clients/:id/visibility': {
    params: { id: 'client' },
    body: { areas: { REPORTS: false } },
  },
  // Client X's login is ACTIVE: firm P deactivates it and gets it back.
  'POST /api/v1/business/client-portal/clients/:id/deactivate': client,
  // Not deactivated in this world: firm P's Owner gets the state's 409.
  'POST /api/v1/business/client-portal/clients/:id/reactivate': { ...client, expect: 409 },
  'POST /api/v1/business/client-portal/clients/:id/reset-access': client,
  'POST /api/v1/business/client-portal/clients/:id/mfa/reset': client,
  'GET /api/v1/business/client-portal/clients/:id/preview': client,
  'GET /api/v1/business/client-portal/clients/:id/documents/summary': client,
  'GET /api/v1/business/client-portal/clients/:id/forms/summary': client,
  // A new name each time: two live tabs never share one (409 DUPLICATE_LABEL).
  'POST /api/v1/business/settings/portal-tabs/custom': {
    params: {},
    body: () => ({ label: `Fake swept tab ${short()}`, module: 'DOCUMENTS', audience: 'TAGS' }),
    ...targets,
  },
  'PATCH /api/v1/business/settings/portal-tabs/custom/:id': {
    params: { id: 'portalCustomTab' },
    body: { audience: 'TAGS' },
    ...targets,
  },
  'POST /api/v1/business/settings/portal-tabs/custom/:id/archive': {
    params: { id: 'portalCustomTab' },
  },
};
