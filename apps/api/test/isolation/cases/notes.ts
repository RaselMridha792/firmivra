// The firm's internal notes on a client (never shown in the portal).
import type { CaseModule } from '../world.js';

/** B32: the shared note's version, as the member previewed it (no other case edits that note). */
const STAMP = new Date('2026-01-01T00:00:00.000Z');

export const records: CaseModule['records'] = {
  /** Firm P's Owner's note on client X. */
  note: {
    clientPrivate: true,
    async create({ tx, businessId, owner, get }) {
      const row = await tx.note.create({
        data: {
          businessId,
          clientId: await get('client'),
          body: 'Fake note',
          authorUserId: owner.id,
        },
      });
      return row.id;
    },
  },
  /** Firm P's Owner's note on client X, for Share with Client only: its version stays STAMP. */
  sharedNote: {
    clientPrivate: true,
    async create({ tx, businessId, owner, get }) {
      const row = await tx.note.create({
        data: {
          businessId,
          clientId: await get('client'),
          body: 'Fake note to share',
          authorUserId: owner.id,
          updatedAt: STAMP,
        },
      });
      return row.id;
    },
  },
};

export const cases: CaseModule['cases'] = {
  'GET /api/v1/business/clients/:id/notes': { params: { id: 'client' } },
  'POST /api/v1/business/clients/:id/notes': {
    params: { id: 'client' },
    // Review 2 (N04): the record the note is about.
    bodyIds: { engagementId: 'engagement', 'related.id': 'task' },
    body: { body: 'Fake note', related: { kind: 'task', id: '' } },
  },
  'PATCH /api/v1/business/notes/:id': { params: { id: 'note' }, body: { body: 'Fake edit' } },
  'DELETE /api/v1/business/notes/:id': { params: { id: 'note' } },
  // B32: Share with Client sends the note's text as a portal message.
  'POST /api/v1/business/notes/:id/share': {
    params: { id: 'sharedNote' },
    body: { updatedAt: STAMP.toISOString() },
  },
};
