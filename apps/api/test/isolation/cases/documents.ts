// A client's documents: records, downloads and uploads.
import { createHash, randomUUID } from 'node:crypto';
import type { CaseModule } from '../world.js';

export const records: CaseModule['records'] = {
  /** A clean file the firm shared with client X. */
  document: {
    clientPrivate: true,
    async create({ tx, businessId, get }) {
      const tag = randomUUID();
      const row = await tx.document.create({
        data: {
          businessId,
          clientId: await get('client'),
          engagementId: await get('engagement'),
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
    bodyRecords: ['engagement'],
    body: ({ rec }) => ({
      serviceId: rec.engagement,
      fileName: 'fake.pdf',
      contentType: 'application/pdf',
      sizeBytes: 1000,
      sha256: createHash('sha256').update('fake').digest('hex'),
    }),
  },
};
