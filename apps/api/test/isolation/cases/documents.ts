// A client's documents: records, downloads and uploads.
import { createHash, randomUUID } from 'node:crypto';
import type { CaseModule, RecordDef } from '../world.js';

/** A clean file the firm shared with client X on one of their engagements. */
const sharedFile = (engagement: string): RecordDef => ({
  clientPrivate: true,
  async create({ tx, businessId, get }) {
    const tag = randomUUID();
    const row = await tx.document.create({
      data: {
        businessId,
        clientId: await get('client'),
        engagementId: await get(engagement),
        direction: 'FIRM_TO_CLIENT',
        fileName: 'fake.pdf',
        contentType: 'application/pdf',
        sizeBytes: 100,
        sha256: createHash('sha256').update(tag).digest('hex'),
        s3Key: `tenant/${businessId}/iso/${tag}/fake.pdf`,
      },
    });
    // As the scanner would: a clean file can be downloaded.
    await tx.document.update({
      where: { id: row.id },
      data: { scanStatus: 'CLEAN', scannedAt: new Date() },
    });
    return row.id;
  },
});

const fileFacts = {
  fileName: 'fake.pdf',
  contentType: 'application/pdf',
  sizeBytes: 1000,
  sha256: createHash('sha256').update('fake').digest('hex'),
};

export const records: CaseModule['records'] = {
  document: sharedFile('engagement'),
  /** A file on client X's bookkeeping workspace, for its reports. */
  workspaceDocument: sharedFile('workspace'),
  documentCategory: {
    async create({ tx, businessId }) {
      const name = `Fake category ${randomUUID().slice(0, 8)}`;
      return (await tx.documentCategory.create({ data: { businessId, name } })).id;
    },
  },
};

export const cases: CaseModule['cases'] = {
  'GET /api/v1/portal/:firmSlug/me/documents/:id': { params: { id: 'document' } },
  // No file store in tests: found, then 503.
  'GET /api/v1/portal/:firmSlug/me/documents/:id/download': {
    params: { id: 'document' },
    expect: 503,
  },
  'GET /api/v1/business/clients/:clientId/documents': { params: { clientId: 'client' } },
  'GET /api/v1/business/documents/:id': { params: { id: 'document' } },
  // No file store in tests: found, then 503.
  'GET /api/v1/business/documents/:id/download': { params: { id: 'document' }, expect: 503 },
  'POST /api/v1/business/clients/:clientId/documents/uploads': {
    params: { clientId: 'client' },
    // The upload's serviceId is the client's engagement (storage/document-records.ts).
    bodyIds: { serviceId: 'engagement', categoryId: 'documentCategory' },
    body: fileFacts,
  },
  'POST /api/v1/portal/:firmSlug/me/documents/uploads': {
    params: {},
    bodyIds: {
      serviceId: 'engagement',
      requestId: 'documentRequest',
      categoryId: 'documentCategory',
    },
    body: fileFacts,
  },
  // POST .../documents/uploads/confirm (firm and portal) take no record id: the uploadToken is
  // sealed, and confirm refuses one made for another firm, member or login (UPLOAD_EXPIRED; the
  // documents e2e tests cover it). It needs a stored file, which the tests have no store for.
};
