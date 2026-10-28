// Message threads between the firm and a client, firm side and portal side.
import type { CaseModule } from '../world.js';

export const records: CaseModule['records'] = {
  /** A New Message draft to client X, through the portal. */
  outboundMessage: {
    clientPrivate: true,
    async create({ tx, businessId, owner, get }) {
      const m = await tx.outboundMessage.create({
        data: {
          businessId,
          kind: 'DIRECT',
          channel: 'PORTAL',
          status: 'DRAFT',
          body: 'Fake message',
          createdByUserId: owner.id,
        },
      });
      await tx.outboundMessageRecipient.create({
        data: {
          businessId,
          outboundMessageId: m.id,
          channel: 'PORTAL',
          clientId: await get('client'),
        },
      });
      return m.id;
    },
  },
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
// New Message (R60): a fixed version, so a found message answers 409 STALE_VERSION.
const VERSION = '2026-01-01T00:00:00.000Z';
const outbound = { params: { id: 'outboundMessage' } };
const people = { bodyIds: { clientIds: 'client', leadIds: 'leadFollowUp' } };
const PH = '00000000-0000-4000-8000-000000000000';

export const cases: CaseModule['cases'] = {
  'GET /api/v1/business/clients/:id/message-threads': { params: { id: 'client' } },
  'POST /api/v1/business/clients/:id/message-threads': {
    params: { id: 'client' },
    // Not swept: `related.id`. It is stored as the thread's link and echoed, never looked up, so
    // it can't reach another firm's record (NOT_RECORDS in body-ids.ts). Check it if that changes.
    bodyIds: { engagementId: 'engagement' },
    body: { subject: 'Fake subject', body: 'Fake message' },
  },
  'POST /api/v1/business/outbound-messages/check': {
    params: {},
    ...people,
    body: { channel: 'PORTAL', clientIds: [PH], leadIds: [PH] },
  },
  'POST /api/v1/business/outbound-messages': {
    params: {},
    ...people,
    body: { channel: 'PORTAL', body: 'Fake message', clientIds: [PH], leadIds: [PH] },
  },
  'GET /api/v1/business/outbound-messages/:id': outbound,
  'PUT /api/v1/business/outbound-messages/:id': {
    ...outbound,
    ...people,
    body: { version: VERSION, channel: 'PORTAL', body: 'Fake', clientIds: [PH], leadIds: [PH] },
    expect: 409,
  },
  'POST /api/v1/business/outbound-messages/:id/send': {
    ...outbound,
    body: { version: VERSION },
    expect: 409,
  },
  'POST /api/v1/business/outbound-messages/:id/schedule': {
    ...outbound,
    body: { version: VERSION, scheduledFor: '2030-01-01T15:00:00.000Z' },
    expect: 409,
  },
  'POST /api/v1/business/outbound-messages/:id/cancel': {
    ...outbound,
    body: { version: VERSION },
    expect: 409,
  },
  'GET /api/v1/business/message-threads/:id': thread,
  'PATCH /api/v1/business/message-threads/:id': { ...thread, body: { repliesEnabled: false } },
  'POST /api/v1/business/message-threads/:id/messages': { ...thread, body: { body: 'Fake' } },
  'POST /api/v1/business/message-threads/:id/read': { ...thread, body: {} },
  // Found, but the thread's only message is the firm's own: nothing to mark unread.
  'POST /api/v1/business/message-threads/:id/unread': { ...thread, body: {}, expect: 409 },
  // Messages Settings (R60): the default assignee must be one of the firm's own members.
  'PATCH /api/v1/business/message-settings': {
    params: {},
    bodyIds: { defaultAssigneeUserId: 'adminUser' },
    body: { notifyUnread: true },
  },
  'GET /api/v1/portal/:firmSlug/me/messages/:id': thread,
  'POST /api/v1/portal/:firmSlug/me/messages/:id/messages': { ...thread, body: { body: 'Fake' } },
  'POST /api/v1/portal/:firmSlug/me/messages/:id/read': { ...thread, body: {} },
  'POST /api/v1/portal/:firmSlug/me/messages/:id/unread': { ...thread, body: {} },
};
