// The firm-wide Documents library (R55): a document by id, the upload and bulk bodies, folders,
// types and settings.
import { createHash, randomUUID } from 'node:crypto';
import type { CaseModule, RecordDef } from '../world.js';

const PLACEHOLDER = randomUUID();

const folder = (parent?: string): RecordDef => ({
  async create({ tx, businessId, get }) {
    const row = await tx.documentFolder.create({
      data: {
        businessId,
        name: `Fake folder ${randomUUID().slice(0, 8)}`,
        parentId: parent ? await get(parent) : null,
      },
    });
    return row.id;
  },
});

export const records: CaseModule['records'] = {
  /** A live CLIENT folder at the top of the firm's tree. */
  libraryFolder: folder(),
  /** Its only subfolder (the reorder case sends it). */
  libraryFolderChild: folder('libraryFolder'),
  /** Another top folder, empty (moved and deleted). */
  libraryFolderOther: folder(),
};

export const cases: CaseModule['cases'] = {
  'GET /api/v1/business/documents/:id/details': { params: { id: 'document' } },
  'GET /api/v1/business/documents/:id/versions': { params: { id: 'document' } },
  'GET /api/v1/business/documents/:id/activity': { params: { id: 'document' } },
  'GET /api/v1/business/documents/:id/access-history': { params: { id: 'document' } },
  // No file store in tests: found, then 503.
  'GET /api/v1/business/documents/:id/preview': { params: { id: 'document' }, expect: 503 },
  'PATCH /api/v1/business/documents/:id': {
    params: { id: 'document' },
    bodyIds: {
      folderId: 'libraryFolder',
      categoryId: 'documentCategory',
      reviewerUserId: 'adminUser',
    },
    body: { folderId: PLACEHOLDER, categoryId: PLACEHOLDER, reviewerUserId: PLACEHOLDER },
  },
  'POST /api/v1/business/documents/:id/review': {
    params: { id: 'document' },
    body: { action: 'START' },
  },
  'POST /api/v1/business/documents/:id/archive': { params: { id: 'document' } },
  'POST /api/v1/business/documents/:id/restore': { params: { id: 'document' } },
  'POST /api/v1/business/documents/:id/trash': { params: { id: 'document' } },
  'POST /api/v1/business/documents/:id/untrash': { params: { id: 'document' } },
  'POST /api/v1/business/documents/uploads': {
    params: {},
    bodyIds: {
      clientId: 'client',
      // The world's document is a shared file of the client's engagement: its new version.
      serviceId: 'engagement',
      replacesId: 'document',
      categoryId: 'documentCategory',
      folderId: 'libraryFolder',
      reviewerUserId: 'adminUser',
      requestId: 'documentRequest',
    },
    body: {
      fileName: 'fake.pdf',
      contentType: 'application/pdf',
      sizeBytes: 1000,
      sha256: createHash('sha256').update('fake').digest('hex'),
      shareWithClient: true,
    },
  },
  'POST /api/v1/business/documents/bulk': {
    params: {},
    // One case per route: MOVE carries the ids and a folder. RECLASSIFY's category and
    // ASSIGN_REVIEWER's reviewer are refused for another firm in documents-library.e2e.
    bodyIds: { ids: 'document', folderId: 'libraryFolder' },
    body: { action: 'MOVE', ids: [PLACEHOLDER], folderId: PLACEHOLDER },
  },

  'POST /api/v1/business/document-folders': {
    params: {},
    bodyIds: { parentId: 'libraryFolder' },
    body: { name: 'Fake new folder', parentId: PLACEHOLDER },
  },
  'PATCH /api/v1/business/document-folders/:id': {
    params: { id: 'libraryFolderOther' },
    bodyIds: { parentId: 'libraryFolder' },
    body: { parentId: PLACEHOLDER },
  },
  'DELETE /api/v1/business/document-folders/:id': { params: { id: 'libraryFolderOther' } },
  'POST /api/v1/business/document-folders/reorder': {
    params: {},
    bodyIds: { parentId: 'libraryFolder', ids: 'libraryFolderChild' },
    body: { parentId: PLACEHOLDER, ids: [PLACEHOLDER] },
  },
  'PATCH /api/v1/business/document-categories/:id': {
    params: { id: 'documentCategory' },
    body: { retentionYears: 9 },
  },
  'PATCH /api/v1/business/document-settings': {
    params: {},
    bodyIds: { defaultReviewerUserId: 'adminUser' },
    body: { defaultReviewerUserId: PLACEHOLDER },
  },
};
