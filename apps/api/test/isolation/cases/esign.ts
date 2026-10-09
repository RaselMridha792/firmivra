// Firm Sign requests (R13). The esign tables and the module switch arrive with r0_esign: until
// then Firm Sign is off for every firm, so firm P's own Owner gets 403 MODULE_OFF (the module
// guard answers before any record is looked up) and the records below are ids with no row.
// Once r0_esign lands, `create` writes real rows and `expect` goes.
import { randomUUID } from 'node:crypto';
import type { CaseModule } from '../world.js';

const MODULE_OFF = 403;

export const records: CaseModule['records'] = {
  /** A Firm Sign request of firm P (no row until r0_esign). */
  esignRequest: {
    clientPrivate: true,
    create: () => Promise.resolve(randomUUID()),
  },
  /** One of that request's files (no row until r0_esign). */
  esignDocument: {
    clientPrivate: true,
    create: () => Promise.resolve(randomUUID()),
  },
};

const request = { params: { id: 'esignRequest' }, expect: MODULE_OFF };
const document = {
  params: { id: 'esignRequest', documentId: 'esignDocument' },
  expect: MODULE_OFF,
};

export const cases: CaseModule['cases'] = {
  'GET /api/v1/esign/requests/:id': request,
  'PATCH /api/v1/esign/requests/:id': { ...request, body: { title: 'Fake letter' } },
  'DELETE /api/v1/esign/requests/:id': request,
  'PUT /api/v1/esign/requests/:id/page-plan': {
    ...request,
    body: { pages: [{ documentId: randomUUID(), page: 0, rotation: 0 }] },
  },
  'PUT /api/v1/esign/requests/:id/recipients': { ...request, body: { recipients: [] } },
  'PUT /api/v1/esign/requests/:id/fields': { ...request, body: { fields: [] } },
  'GET /api/v1/esign/requests/:id/merge-values': request,
  'GET /api/v1/esign/requests/:id/readiness': request,
  'POST /api/v1/esign/requests/:id/documents/uploads': {
    ...request,
    body: {
      fileName: 'letter.pdf',
      contentType: 'application/pdf',
      sizeBytes: 1000,
      sha256: '0'.repeat(64),
    },
  },
  'POST /api/v1/esign/requests/:id/documents/uploads/confirm': {
    ...request,
    body: { uploadToken: 'fake-upload-token' },
  },
  'POST /api/v1/esign/requests/:id/documents/from-vault': {
    ...request,
    body: { documentId: randomUUID() },
  },
  'DELETE /api/v1/esign/requests/:id/documents/:documentId': document,
  'GET /api/v1/esign/requests/:id/documents/:documentId/content': document,
};
