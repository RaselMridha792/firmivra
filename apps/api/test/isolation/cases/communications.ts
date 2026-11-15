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
  /** An email draft holding one file. */
  communicationWithFile: {
    async create({ tx, businessId, owner }) {
      const row = await tx.communication.create({
        data: {
          businessId,
          channel: 'EMAIL',
          name: `Fake campaign with file ${tag()}`,
          createdByUserId: owner.id,
          attachments: [
            {
              id: randomUUID(),
              fileName: 'fake.pdf',
              contentType: 'application/pdf',
              sizeBytes: 100,
              s3Key: `tenant/${businessId}/communications/${randomUUID()}`,
            },
          ],
        },
      });
      return row.id;
    },
  },
  /** The file's id. */
  communicationFile: {
    async create({ tx, businessId, get }) {
      const row = await tx.communication.findFirstOrThrow({
        where: { businessId, id: await get('communicationWithFile') },
        select: { attachments: true },
      });
      return (row.attachments as { id: string }[])[0]!.id;
    },
  },
  /** An active email template, for a draft to take a snapshot of. */
  communicationTemplate: {
    async create({ tx, businessId, owner }) {
      const row = await tx.messageTemplate.create({
        data: {
          businessId,
          kind: 'EMAIL',
          name: `Fake template ${tag()}`,
          subject: 'Fake subject',
          body: '<p>Fake body</p>',
          status: 'ACTIVE',
          ownerUserId: owner.id,
        },
      });
      return row.id;
    },
  },
  /** An email draft of the firm. */
  communication: {
    async create({ tx, businessId, owner }) {
      const row = await tx.communication.create({
        data: {
          businessId,
          channel: 'EMAIL',
          name: `Fake campaign ${tag()}`,
          subject: 'Fake subject',
          body: '<p>Fake body</p>',
          createdByUserId: owner.id,
          updatedAt: STAMP,
        },
      });
      return row.id;
    },
  },
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
  /** C26: an announcement published to client X, live in their portal. */
  portalAnnouncement: {
    clientPrivate: true,
    async create({ tx, businessId, owner, get }) {
      const c = await tx.communication.create({
        data: {
          businessId,
          channel: 'ANNOUNCEMENT',
          name: `Fake announcement ${tag()}`,
          body: '<p>Fake news.</p>',
          status: 'SENDING',
          createdByUserId: owner.id,
          startedAt: STAMP,
          selectedCount: 1,
          autoExcludedCount: 0,
          manualExcludedCount: 0,
          finalCount: 1,
        },
      });
      // Recipients are added while it is sending.
      await tx.communicationRecipient.create({
        data: {
          businessId,
          communicationId: c.id,
          clientId: await get('client'),
          status: 'DELIVERED',
          addressMask: '***-portal',
        },
      });
      await tx.communication.update({
        where: { id: c.id },
        data: { status: 'SENT', sentAt: STAMP },
      });
      return c.id;
    },
  },
};

export const cases: CaseModule['cases'] = {
  [`GET ${BASE}/:id`]: { params: { id: 'communication' } },
  [`PATCH ${BASE}/:id`]: {
    params: { id: 'communication' },
    body: { etag: ETAG, name: 'Fake renamed campaign' },
  },
  [`POST ${BASE}`]: {
    params: {},
    bodyIds: { templateId: 'communicationTemplate' },
    body: { channel: 'EMAIL', templateId: PLACEHOLDER },
    // Leads row 14: Firmivra Mail is every firm's email channel, so the draft starts.
  },
  [`GET ${BASE}/:id/audience`]: { params: { id: 'communication' } },
  [`PUT ${BASE}/:id/audience`]: {
    params: { id: 'communication' },
    bodyIds: {
      segmentIds: 'communicationSegment',
      clientIds: 'client',
      leadIds: 'lead',
      excludeClientIds: 'client',
      excludeLeadIds: 'lead',
    },
    body: {
      etag: ETAG,
      segmentIds: [PLACEHOLDER],
      clientIds: [PLACEHOLDER],
      leadIds: [PLACEHOLDER],
      excludeClientIds: [PLACEHOLDER],
      excludeLeadIds: [PLACEHOLDER],
    },
  },
  [`POST ${BASE}/audience/select-all`]: {
    params: {},
    bodyIds: { communicationId: 'communication', serviceId: 'service' },
    body: { communicationId: PLACEHOLDER, serviceId: PLACEHOLDER },
  },
  [`GET ${BASE}/:id/review`]: { params: { id: 'communication' } },
  // The world's campaign is not ready to go (Firmivra Mail is there since Leads row 14, the
  // campaign has no audience): sending and scheduling are refused the same way for P's own people
  // (409), and refused as not found for anyone else.
  [`POST ${BASE}/:id/send`]: {
    params: { id: 'communication' },
    body: () => ({ idempotencyKey: randomUUID(), etag: ETAG }),
    expect: 409,
  },
  [`POST ${BASE}/:id/schedule`]: {
    params: { id: 'communication' },
    body: () => ({
      idempotencyKey: randomUUID(),
      etag: ETAG,
      scheduledFor: new Date(Date.now() + 86_400_000).toISOString(),
    }),
    expect: 409,
  },
  [`POST ${BASE}/:id/reschedule`]: {
    params: { id: 'communication' },
    body: () => ({
      etag: ETAG,
      scheduledFor: new Date(Date.now() + 86_400_000).toISOString(),
    }),
    expect: 409,
  },
  [`POST ${BASE}/:id/cancel`]: { params: { id: 'communication' }, body: {} },
  [`POST ${BASE}/:id/pause`]: { params: { id: 'communication' }, expect: 409 },
  [`POST ${BASE}/:id/resume`]: { params: { id: 'communication' }, expect: 409 },
  [`POST ${BASE}/:id/archive`]: { params: { id: 'communication' } },
  [`POST ${BASE}/:id/restore`]: { params: { id: 'communication' } },
  // Leads row 14: copied as a draft through Firmivra Mail.
  [`POST ${BASE}/:id/duplicate`]: { params: { id: 'communication' } },
  [`POST ${BASE}/:id/use-template`]: {
    params: { id: 'communication' },
    bodyIds: { templateId: 'communicationTemplate' },
    body: { etag: ETAG, templateId: PLACEHOLDER },
  },
  [`POST ${BASE}/:id/preview`]: {
    params: { id: 'communication' },
    bodyIds: { clientId: 'client', leadId: 'lead' },
    body: { clientId: PLACEHOLDER, leadId: PLACEHOLDER },
  },
  [`GET ${BASE}/:id/results`]: { params: { id: 'communication' } },
  [`GET ${BASE}/:id/recipients`]: { params: { id: 'communication' } },
  [`GET ${BASE}/:id/activity`]: { params: { id: 'communication' } },
  // A draft has not gone out: nothing to export, resend or follow up yet (409 for P's own people).
  [`POST ${BASE}/:id/export`]: { params: { id: 'communication' }, body: {}, expect: 409 },
  [`POST ${BASE}/:id/resend-failed`]: { params: { id: 'communication' }, expect: 409 },
  [`POST ${BASE}/:id/follow-up`]: {
    params: { id: 'communication' },
    body: { group: 'FAILED' },
    expect: 409,
  },
  [`POST ${BASE}/:id/expire`]: { params: { id: 'communication' }, expect: 409 },
  // No email provider is connected in the world: a test cannot be sent (409 for P's own people).
  [`POST ${BASE}/:id/test-send`]: { params: { id: 'communication' }, body: {}, expect: 409 },
  [`POST ${BASE}/:id/save-as-template`]: {
    params: { id: 'communication' },
    bodyIds: { categoryId: 'templateCategory' },
    body: () => ({ name: `Fake saved template ${tag()}`, categoryId: PLACEHOLDER }),
  },
  [`POST ${BASE}/:id/attachments/uploads`]: {
    params: { id: 'communication' },
    body: {
      fileName: 'fake.pdf',
      contentType: 'application/pdf',
      sizeBytes: 100,
      sha256: 'a'.repeat(64),
    },
  },
  [`DELETE ${BASE}/:id/attachments/:attachmentId`]: {
    params: { id: 'communicationWithFile', attachmentId: 'communicationFile' },
  },
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
  // C26: the client opened an announcement published to them.
  'POST /api/v1/portal/:firmSlug/me/announcements/:id/opened': {
    params: { id: 'portalAnnouncement' },
    body: {},
  },
};
