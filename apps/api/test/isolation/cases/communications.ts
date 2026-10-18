// Communications (R55): segments and lists, and consent. A write case runs in a fresh world, so one
// record serves them all.
import { randomUUID } from 'node:crypto';
import type { CaseModule } from '../world.js';

const BASE = '/api/v1/business/communications';
const tag = () => randomUUID().slice(0, 8);
/** A fixed update time, so a change can send the version (etag) without reading it. */
const STAMP = new Date('2026-01-01T00:00:00.000Z');
const ETAG = STAMP.toISOString();
const PLACEHOLDER = randomUUID();

export const records: CaseModule['records'] = {
  /** A saved list holding the world's client. */
  communicationSegment: {
    async create({ tx, businessId, owner, get }) {
      const row = await tx.communicationSegment.create({
        data: {
          businessId,
          name: `Fake list ${tag()}`,
          type: 'STATIC',
          audience: 'BOTH',
          ownerUserId: owner.id,
          updatedAt: STAMP,
        },
      });
      await tx.communicationSegmentMember.create({
        data: { businessId, segmentId: row.id, clientId: await get('client') },
      });
      return row.id;
    },
  },
};

export const cases: CaseModule['cases'] = {
  [`GET ${BASE}/segments/:id`]: { params: { id: 'communicationSegment' } },
  [`PATCH ${BASE}/segments/:id`]: {
    params: { id: 'communicationSegment' },
    body: { etag: ETAG, description: 'Fake description' },
  },
  [`GET ${BASE}/segments/:id/members`]: { params: { id: 'communicationSegment' } },
  [`PUT ${BASE}/segments/:id/members`]: {
    params: { id: 'communicationSegment' },
    bodyIds: { clientIds: 'client', leadIds: 'lead' },
    body: { etag: ETAG, clientIds: [PLACEHOLDER], leadIds: [PLACEHOLDER] },
  },
  [`POST ${BASE}/segments/:id/duplicate`]: { params: { id: 'communicationSegment' } },
  [`POST ${BASE}/segments/:id/archive`]: { params: { id: 'communicationSegment' } },
  [`POST ${BASE}/segments/:id/restore`]: { params: { id: 'communicationSegment' } },
  [`POST ${BASE}/segments`]: {
    params: {},
    bodyIds: { clientIds: 'client', leadIds: 'lead' },
    body: () => ({
      name: `Fake new list ${tag()}`,
      type: 'STATIC',
      audience: 'BOTH',
      clientIds: [PLACEHOLDER],
      leadIds: [PLACEHOLDER],
    }),
  },
  [`PUT ${BASE}/consent`]: {
    params: {},
    bodyIds: { clientId: 'client' },
    body: { clientId: PLACEHOLDER, channel: 'EMAIL', status: 'OPTED_OUT' },
  },
};
