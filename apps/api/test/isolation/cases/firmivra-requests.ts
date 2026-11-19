// Settings > Requests from Firmivra (SA-FRM-F06, R60): the Owner's view of Firmivra's requests for
// information about the firm, and their answers with files. A request is a Support ticket
// Firmivra made (source Internal), so the records are made where Firmivra makes them: in
// platform scope, on a short client of their own (the firm's scope may only raise Portal tickets
// and write under the acting member's name). Another firm's request id, or a file of it, is 404.
import { createHash, randomUUID } from 'node:crypto';
import { createPrismaClient, runInScope, type TxClient } from '@firmivra/db';
import { TEST_CLIENT_OPTIONS, testDatabaseUrls } from '@firmivra/db/testing';
import type { CaseModule } from '../world.js';

async function asPlatform<T>(fn: (tx: TxClient) => Promise<T>): Promise<T> {
  const owner = createPrismaClient(testDatabaseUrls('test_api').owner, TEST_CLIENT_OPTIONS);
  try {
    return await runInScope(owner, { kind: 'platform' }, fn);
  } finally {
    await owner.$disconnect();
  }
}

const fileFacts = {
  fileName: 'fake-licence.pdf',
  contentType: 'application/pdf',
  sizeBytes: 1000,
  sha256: createHash('sha256').update('fake').digest('hex'),
};

export const records: CaseModule['records'] = {
  /** Firmivra's request to firm P's Owner, waiting for their answer. */
  firmivraRequest: {
    async create({ businessId, owner }) {
      return asPlatform(async (tx) => {
        const category = await tx.supportCategory.findFirstOrThrow({ select: { id: true } });
        const priority = await tx.supportPriority.findFirstOrThrow({ select: { id: true } });
        const { id } = await tx.supportTicket.create({
          data: {
            businessId,
            contactUserId: owner.id,
            subject: 'Information request: Fake licence',
            description: 'Fake: please send your current licence.',
            categoryId: category.id,
            priorityId: priority.id,
            source: 'INTERNAL',
            createdByUserId: owner.id,
          },
          select: { id: true },
        });
        // The database starts every ticket Open.
        await tx.supportTicket.update({ where: { id }, data: { status: 'WAITING_ON_CUSTOMER' } });
        return id;
      });
    },
  },
  /** A file on firm P's answer to that request (not scanned yet). */
  firmivraRequestFile: {
    async create({ businessId, owner, get }) {
      const ticketId = await get('firmivraRequest');
      return asPlatform(async (tx) => {
        const message = await tx.supportTicketMessage.create({
          data: {
            businessId,
            ticketId,
            authorUserId: owner.id,
            authorSide: 'CUSTOMER',
            body: 'Fake answer',
          },
          select: { id: true },
        });
        const { id } = await tx.supportTicketAttachment.create({
          data: {
            businessId,
            ticketId,
            messageId: message.id,
            uploadedByUserId: owner.id,
            ...fileFacts,
            s3Key: `tenant/${businessId}/support/${randomUUID()}`,
          },
          select: { id: true },
        });
        return id;
      });
    },
  },
};

const BASE = '/api/v1/business/firmivra-requests';

export const cases: CaseModule['cases'] = {
  [`GET ${BASE}/:id`]: { params: { id: 'firmivraRequest' } },
  [`POST ${BASE}/:id/uploads`]: { params: { id: 'firmivraRequest' }, body: fileFacts },
  [`POST ${BASE}/:id/replies`]: {
    params: { id: 'firmivraRequest' },
    body: () => ({ requestId: randomUUID(), body: 'Fake answer', uploadTokens: [] }),
  },
  // Found, but the file is still waiting for its scan: 409 SCAN_PENDING.
  [`GET ${BASE}/:id/files/:fileId`]: {
    params: { id: 'firmivraRequest', fileId: 'firmivraRequestFile' },
    expect: 409,
  },
};
