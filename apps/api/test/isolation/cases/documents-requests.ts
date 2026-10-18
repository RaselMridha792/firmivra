// The Documents module part 2 (R55): sharing, request packets and their items, templates.
import { randomUUID } from 'node:crypto';
import type { CaseModule } from '../world.js';

const PLACEHOLDER = randomUUID();

export const records: CaseModule['records'] = {
  /**
   * Client X's request (packet), a complete draft the Owner made: due date, message and one item
   * (`requestPacketItem`), so it can be sent.
   */
  requestPacket: {
    clientPrivate: true,
    async create({ tx, businessId, owner, get, set }) {
      const clientId = await get('client');
      const engagementId = await get('engagement');
      const packet = await tx.documentRequestPacket.create({
        data: {
          businessId,
          clientId,
          engagementId,
          title: 'Fake 2025 documents',
          dueOn: new Date(Date.now() + 10 * 86_400_000),
          messageSubject: 'Fake subject',
          messageBody: 'Fake message',
          requestedByUserId: owner.id,
        },
      });
      const item = await tx.documentRequest.create({
        data: {
          businessId,
          clientId,
          engagementId,
          packetId: packet.id,
          title: 'Fake W-2',
          requestedByUserId: owner.id,
        },
      });
      set('requestPacketItem', item.id);
      return packet.id;
    },
  },
  /** requestPacket's item (`staffMembership`'s pattern in team.ts). */
  requestPacketItem: {
    clientPrivate: true,
    async create({ get }) {
      await get('requestPacket');
      return get('requestPacketItem');
    },
  },
  /** A firm request type with one item. */
  requestTemplate: {
    async create({ tx, businessId }) {
      const t = await tx.documentRequestTemplate.create({
        data: { businessId, name: `Fake type ${randomUUID().slice(0, 8)}` },
      });
      await tx.documentRequestTemplateItem.create({
        data: { businessId, templateId: t.id, title: 'Fake W-2' },
      });
      return t.id;
    },
  },
  /** A live grant of the world's shared document to an Admin of the firm. */
  documentShare: {
    clientPrivate: true,
    async create({ tx, businessId, owner, get }) {
      const share = await tx.documentShare.create({
        data: {
          businessId,
          documentId: await get('document'),
          recipientKind: 'MEMBER',
          memberUserId: await get('adminUser'),
          grantedByUserId: owner.id,
        },
      });
      return share.id;
    },
  },
};

const packet = { id: 'requestPacket' };

export const cases: CaseModule['cases'] = {
  // Sharing.
  'GET /api/v1/business/documents/:id/access': { params: { id: 'document' } },
  'POST /api/v1/business/documents/:id/shares': {
    params: { id: 'document' },
    bodyIds: { 'recipient.clientAccountId': 'esignLogin', 'recipient.userId': 'adminUser' },
    body: { recipient: { kind: 'CLIENT', clientAccountId: PLACEHOLDER } },
  },
  'PATCH /api/v1/business/documents/:id/shares/:shareId': {
    params: { id: 'document', shareId: 'documentShare' },
    body: { canUpload: true },
  },
  'POST /api/v1/business/documents/:id/shares/:shareId/revoke': {
    params: { id: 'document', shareId: 'documentShare' },
  },

  // Request packets.
  'POST /api/v1/business/document-request-packets': {
    params: {},
    bodyIds: {
      clientId: 'client',
      serviceId: 'engagement',
      templateId: 'requestTemplate',
      assignedUserId: 'adminUser',
      'recipient.userId': 'adminUser',
      'items.categoryId': 'documentCategory',
    },
    body: () => ({
      idempotencyKey: randomUUID(),
      title: 'Fake request',
      recipient: { kind: 'CLIENT' },
      items: [{ title: 'Fake item', categoryId: PLACEHOLDER }],
    }),
  },
  'POST /api/v1/business/document-request-packets/bulk': {
    params: {},
    bodyIds: { ids: 'requestPacket', assignedUserId: 'adminUser' },
    body: { action: 'ASSIGN', ids: [PLACEHOLDER], assignedUserId: PLACEHOLDER },
  },
  'GET /api/v1/business/document-request-packets/:id': { params: packet },
  'PATCH /api/v1/business/document-request-packets/:id': {
    params: packet,
    bodyIds: { assignedUserId: 'adminUser' },
    body: { assignedUserId: PLACEHOLDER },
  },
  'POST /api/v1/business/document-request-packets/:id/send': { params: packet },
  // A draft is not sent yet: found, then refused (409).
  'POST /api/v1/business/document-request-packets/:id/resend': { params: packet, expect: 409 },
  'POST /api/v1/business/document-request-packets/:id/remind': { params: packet, expect: 409 },
  'POST /api/v1/business/document-request-packets/:id/complete': { params: packet, expect: 409 },
  'POST /api/v1/business/document-request-packets/:id/cancel': { params: packet },
  'POST /api/v1/business/document-request-packets/:id/items': {
    params: packet,
    bodyIds: { categoryId: 'documentCategory' },
    body: { title: 'Fake item', categoryId: PLACEHOLDER },
  },
  'PATCH /api/v1/business/document-request-packets/:id/items/:itemId': {
    params: { id: 'requestPacket', itemId: 'requestPacketItem' },
    bodyIds: { categoryId: 'documentCategory' },
    body: { categoryId: PLACEHOLDER },
  },
  'DELETE /api/v1/business/document-request-packets/:id/items/:itemId': {
    params: { id: 'requestPacket', itemId: 'requestPacketItem' },
  },
  'POST /api/v1/business/document-request-packets/:id/items/reorder': {
    params: packet,
    bodyIds: { ids: 'requestPacketItem' },
    body: { ids: [PLACEHOLDER] },
  },

  // Templates.
  'POST /api/v1/business/document-request-templates': {
    params: {},
    bodyIds: { 'items.categoryId': 'documentCategory' },
    body: {
      name: 'Fake new type',
      owner: 'FIRM',
      items: [{ title: 'Fake item', categoryId: PLACEHOLDER }],
    },
  },
  'PATCH /api/v1/business/document-request-templates/:id': {
    params: { id: 'requestTemplate' },
    bodyIds: { 'items.categoryId': 'documentCategory' },
    body: { items: [{ title: 'Fake item', categoryId: PLACEHOLDER }] },
  },
  'POST /api/v1/business/document-request-templates/:id/archive': {
    params: { id: 'requestTemplate' },
  },
};
