// Message threads between the firm and a client, firm side and portal side.
import { randomUUID } from 'node:crypto';
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
  /**
   * MSG-F12: a New Message draft to client X with one file (still being scanned), and the delivery
   * that reached X's portal message (as a sent one links it).
   */
  outboundFileMessage: {
    clientPrivate: true,
    async create({ tx, businessId, owner, get }) {
      const clientId = await get('client');
      const threadId = await get('messageThread');
      const message = await tx.message.findFirstOrThrow({
        where: { businessId, threadId },
        select: { id: true },
      });
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
      await tx.outboundMessageFile.create({
        data: {
          businessId,
          outboundMessageId: m.id,
          fileName: 'Fake.pdf',
          contentType: 'application/pdf',
          sizeBytes: 100,
          sha256: '0'.repeat(64),
          s3Key: `tenant/${businessId}/messages/${randomUUID()}`,
          uploadedByUserId: owner.id,
        },
      });
      await tx.outboundMessageRecipient.create({
        data: {
          businessId,
          outboundMessageId: m.id,
          channel: 'PORTAL',
          clientId,
          messageId: message.id,
        },
      });
      return m.id;
    },
  },
  /** That draft's file. */
  outboundMessageFile: {
    clientPrivate: true,
    async create({ tx, businessId, get }) {
      const outboundMessageId = await get('outboundFileMessage');
      const f = await tx.outboundMessageFile.findFirstOrThrow({
        where: { businessId, outboundMessageId },
        select: { id: true },
      });
      return f.id;
    },
  },
  /** A lead's own thread (Messages' Leads tab), with the firm's email to the lead. */
  leadMessageThread: {
    async create({ tx, businessId, owner, get }) {
      const thread = await tx.messageThread.create({
        data: {
          businessId,
          leadId: await get('leadFollowUp'),
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
// MSG-F13, F16: Related To (one of client X's records) and Assign Staff (a member).
const withTemplate = {
  bodyIds: {
    clientIds: 'client',
    leadIds: 'leadFollowUp',
    templateId: 'communicationTemplate',
    'related.id': 'documentRequest',
    assignedUserId: 'adminUser',
  },
};
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
    ...withTemplate,
    body: {
      channel: 'PORTAL',
      body: 'Fake message',
      templateId: PH,
      related: { type: 'document_request', id: PH },
      assignedUserId: PH,
      clientIds: [PH],
      leadIds: [PH],
    },
  },
  'GET /api/v1/business/outbound-messages/:id': outbound,
  // MSG-F12: New Message's files. The confirm's token is not one, so a found message is 410; a
  // file still being scanned does not open (409).
  'POST /api/v1/business/outbound-messages/:id/files/uploads': {
    ...outbound,
    body: {
      fileName: 'Fake.pdf',
      contentType: 'application/pdf',
      sizeBytes: 100,
      sha256: 'a'.repeat(64),
    },
  },
  'POST /api/v1/business/outbound-messages/:id/files/uploads/confirm': {
    ...outbound,
    body: { uploadToken: 'fake-token' },
    expect: 410,
  },
  'DELETE /api/v1/business/outbound-messages/:id/files/:fileId': {
    params: { id: 'outboundFileMessage', fileId: 'outboundMessageFile' },
  },
  'GET /api/v1/business/message-files/:id/download': {
    params: { id: 'outboundMessageFile' },
    expect: 409,
  },
  'GET /api/v1/business/outbound-messages/:id/review': outbound,
  'PUT /api/v1/business/outbound-messages/:id': {
    ...outbound,
    ...withTemplate,
    body: {
      version: VERSION,
      channel: 'PORTAL',
      body: 'Fake',
      templateId: PH,
      related: { type: 'document_request', id: PH },
      assignedUserId: PH,
      clientIds: [PH],
      leadIds: [PH],
    },
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
  // The Leads tab: a lead's own threads.
  'GET /api/v1/business/lead-message-threads/:id': { params: { id: 'leadMessageThread' } },
  // A text: off until the firm turns texts on, so the found thread answers 409
  // PROVIDER_UNAVAILABLE everywhere, and nothing is sent.
  'POST /api/v1/business/lead-message-threads/:id/messages': {
    params: { id: 'leadMessageThread' },
    body: { body: 'Fake', channel: 'SMS' },
    expect: 409,
  },
  'GET /api/v1/business/message-threads/:id': thread,
  'PATCH /api/v1/business/message-threads/:id': { ...thread, body: { repliesEnabled: false } },
  // MSG-F12: the reply's files are the thread client's own documents.
  'POST /api/v1/business/message-threads/:id/messages': {
    ...thread,
    bodyIds: { documentIds: 'document' },
    body: { body: 'Fake', documentIds: [PH] },
  },
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
  'GET /api/v1/portal/:firmSlug/me/messages/files/:fileId/download': {
    params: { fileId: 'outboundMessageFile' },
    expect: 409,
  },
  'POST /api/v1/portal/:firmSlug/me/messages/:id/messages': { ...thread, body: { body: 'Fake' } },
  'POST /api/v1/portal/:firmSlug/me/messages/:id/read': { ...thread, body: {} },
  'POST /api/v1/portal/:firmSlug/me/messages/:id/unread': { ...thread, body: {} },
};
