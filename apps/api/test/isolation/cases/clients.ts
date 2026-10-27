// Clients, their profile and tax years, and sign-ups waiting for the firm.
import { randomUUID } from 'node:crypto';
import type { CaseModule } from '../world.js';

/** Replaced by each case's real ids (bodyIds). */
const PLACEHOLDER = randomUUID();

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
  /** A client record approve can link the sign-up to: the same email, no login yet. */
  linkableClient: {
    async create({ tx, businessId, get }) {
      const account = await tx.clientAccount.findUniqueOrThrow({
        where: { id: await get('pendingClientAccount') },
      });
      const client = await tx.client.create({
        data: { businessId, displayName: 'Fake linkable client', email: account.email },
      });
      return client.id;
    },
  },
};

export const cases: CaseModule['cases'] = {
  'POST /api/v1/business/clients': {
    params: {},
    bodyIds: { assignedUserId: 'staffUser' },
    body: { displayName: 'Fake new client' },
  },
  // R1: the bulk change names clients and an assignee in its body (firm Q naming firm P's is 404).
  'POST /api/v1/business/clients/bulk': {
    params: {},
    bodyIds: { clientIds: 'client', assignedUserId: 'staffUser' },
    body: { action: 'ASSIGN', clientIds: [PLACEHOLDER], assignedUserId: PLACEHOLDER },
  },
  'GET /api/v1/business/clients/:id': { params: { id: 'client' } },
  'GET /api/v1/business/clients/:id/tax-years': { params: { id: 'client' } },
  'GET /api/v1/business/clients/:id/tags': { params: { id: 'client' } },
  'PUT /api/v1/business/clients/:id/tags': {
    params: { id: 'client' },
    body: { tags: ['Fake tag'] },
  },
  'GET /api/v1/business/clients/:id/tax-years/:year/history': { params: { id: 'client' } },
  'PATCH /api/v1/business/clients/:id': {
    params: { id: 'client' },
    bodyIds: { assignedUserId: 'staffUser' },
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
    bodyIds: { taxStatusId: 'taxStatus' },
  },
  'GET /api/v1/client-sign-ups/:clientAccountId': {
    params: { clientAccountId: 'pendingClientAccount' },
  },
  // Every Sign-ups write names the version it read and its own key: a fresh key per call.
  'POST /api/v1/client-sign-ups/:clientAccountId/approve': {
    params: { clientAccountId: 'pendingClientAccount' },
    body: () => ({ version: 1, idempotencyKey: randomUUID() }),
    bodyIds: { clientId: 'linkableClient' },
  },
  'POST /api/v1/client-sign-ups/:clientAccountId/decline': {
    params: { clientAccountId: 'pendingClientAccount' },
    body: () => ({ version: 1, idempotencyKey: randomUUID() }),
  },
  // Resolve Existing Account (D2): another firm's request or record is never reached. With no
  // checks recorded and no phone match in the fixtures, the firm's own call answers 409
  // (CHECKS_REQUIRED, NOT_A_CANDIDATE): reached, and refused for the right reason.
  'POST /api/v1/client-sign-ups/:clientAccountId/checks': {
    params: { clientAccountId: 'pendingClientAccount' },
    body: {
      contactRef: 'CLIENT_EMAIL',
      callOutcome: 'REACHED',
      identityResult: 'VERIFIED',
      permissionScope: 'BOTH',
    },
    bodyIds: { candidateClientId: 'linkableClient' },
  },
  'POST /api/v1/client-sign-ups/:clientAccountId/link': {
    params: { clientAccountId: 'pendingClientAccount' },
    body: () => ({ version: 1, idempotencyKey: randomUUID() }),
    bodyIds: { candidateClientId: 'linkableClient' },
    expect: 409,
  },
  'POST /api/v1/client-sign-ups/:clientAccountId/restore-access': {
    params: { clientAccountId: 'pendingClientAccount' },
    body: () => ({ version: 1, idempotencyKey: randomUUID() }),
    bodyIds: { candidateClientId: 'linkableClient' },
    expect: 409,
  },
  'POST /api/v1/client-sign-ups/:clientAccountId/not-a-match': {
    params: { clientAccountId: 'pendingClientAccount' },
    body: () => ({ version: 1, idempotencyKey: randomUUID(), reason: 'Fake reason' }),
    expect: 409,
  },
  'POST /api/v1/client-sign-ups/:clientAccountId/keep-pending': {
    params: { clientAccountId: 'pendingClientAccount' },
    body: () => ({ idempotencyKey: randomUUID() }),
  },
};
