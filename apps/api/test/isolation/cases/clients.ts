// Clients, their profile and tax years, and sign-ups waiting for the firm.
import type { CaseModule } from '../world.js';

export const records: CaseModule['records'] = {
  /** Client X: a client with a portal login. Each world has its own. */
  client: {
    clientPrivate: true,
    async create({ tx, businessId, person, setClient, set }) {
      const login = await person('client-x', 'CLIENT');
      const client = await tx.client.create({
        data: { businessId, displayName: 'Fake Client X', email: login.email },
      });
      await tx.clientAccount.create({
        data: {
          businessId,
          userId: login.id,
          clientId: client.id,
          email: login.email,
          status: 'ACTIVE',
        },
      });
      setClient(login);
      set('clientUser', login.id);
      return client.id;
    },
  },
  /** A sign-up the firm can approve: both contacts verified, no client yet. */
  pendingClientAccount: {
    async create({ tx, businessId, person }) {
      const login = await person('pending', 'CLIENT');
      const now = new Date();
      const account = await tx.clientAccount.create({
        data: {
          businessId,
          userId: login.id,
          email: login.email,
          emailVerifiedAt: now,
          phoneVerifiedAt: now,
        },
      });
      return account.id;
    },
  },
};

export const cases: CaseModule['cases'] = {
  'GET /api/v1/business/clients/:id': { params: { id: 'client' } },
  'GET /api/v1/business/clients/:id/tax-years': { params: { id: 'client' } },
  'GET /api/v1/business/clients/:id/tax-years/:year/history': { params: { id: 'client' } },
  'PATCH /api/v1/business/clients/:id': {
    params: { id: 'client' },
    body: { displayName: 'Fake renamed client' },
  },
  'POST /api/v1/business/clients/:id/archive': { params: { id: 'client' } },
  'POST /api/v1/business/clients/:id/restore': { params: { id: 'client' } },
  'PUT /api/v1/business/clients/:id/profile': {
    params: { id: 'client' },
    body: { preferredName: 'Fake' },
  },
  'PUT /api/v1/business/clients/:id/tax-years/:year': {
    params: { id: 'client' },
    body: ({ own }) => ({ taxStatusId: own.taxStatus }),
  },
  'POST /api/v1/client-sign-ups/:clientAccountId/approve': {
    params: { clientAccountId: 'pendingClientAccount' },
    body: {},
  },
  'POST /api/v1/client-sign-ups/:clientAccountId/decline': {
    params: { clientAccountId: 'pendingClientAccount' },
    body: {},
  },
};
