// Message threads between the firm and a client, firm side and portal side.
import type { CaseModule } from '../world.js';

export const records: CaseModule['records'] = {
  /** A thread with client X that the firm opened, with one message from the firm. */
  messageThread: {
    clientPrivate: true,
    async create({ tx, businessId, owner, get }) {
      const thread = await tx.messageThread.create({
        data: {
          businessId,
          clientId: await get('client'),
          subject: 'Fake subject',
          createdByUserId: owner.id,
        },
      });
      await tx.message.create({
        data: {
          businessId,
          threadId: thread.id,
          senderUserId: owner.id,
          direction: 'FIRM_TO_CLIENT',
          body: 'Fake message',
        },
      });
      return thread.id;
    },
  },
};

const thread = { params: { id: 'messageThread' } };

export const cases: CaseModule['cases'] = {
  'GET /api/v1/business/clients/:id/message-threads': { params: { id: 'client' } },
  'POST /api/v1/business/clients/:id/message-threads': {
    params: { id: 'client' },
    body: { subject: 'Fake subject', body: 'Fake message' },
  },
  'GET /api/v1/business/message-threads/:id': thread,
  'PATCH /api/v1/business/message-threads/:id': { ...thread, body: { repliesEnabled: false } },
  'POST /api/v1/business/message-threads/:id/messages': { ...thread, body: { body: 'Fake' } },
  'POST /api/v1/business/message-threads/:id/read': { ...thread, body: {} },
  // Found, but the thread's only message is the firm's own: nothing to mark unread.
  'POST /api/v1/business/message-threads/:id/unread': { ...thread, body: {}, expect: 409 },
  'GET /api/v1/portal/:firmSlug/me/messages/:id': thread,
  'POST /api/v1/portal/:firmSlug/me/messages/:id/messages': { ...thread, body: { body: 'Fake' } },
  'POST /api/v1/portal/:firmSlug/me/messages/:id/read': { ...thread, body: {} },
  'POST /api/v1/portal/:firmSlug/me/messages/:id/unread': { ...thread, body: {} },
};
