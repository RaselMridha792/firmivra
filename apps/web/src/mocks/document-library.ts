import {
  ApiRequestError,
  DocumentFolder,
  type DocumentLibraryClient,
  type DocumentsClient,
} from '@firmivra/types';
import { mockDelay } from '../lib/mock';

// Synthetic folders and the upload step of the firm's document library (R55 contract,
// `api.documentLibrary`) for mock mode. Uploads go through the documents mock (`api.documents`),
// so the confirm step and the library page see the same files. The methods no screen uses yet
// answer 501 until their screen (Frames 2 to 6 of the Documents design) arrives.

const at = '2026-10-01T15:00:00.000Z';
const folderId = (n: number) => `0199d2b0-6a00-7000-8000-${String(n).padStart(12, '0')}`;

/** The design's configurable categories under Client Documents, and the firm's own folder. */
export function documentFolderFixtures(): DocumentFolder[] {
  const folder = (
    n: number,
    name: string,
    scope: DocumentFolder['scope'],
    parent: number | null,
    color: DocumentFolder['color'],
  ): DocumentFolder =>
    DocumentFolder.parse({
      id: folderId(n),
      name,
      description: null,
      parentId: parent === null ? null : folderId(parent),
      scope,
      color,
      sortOrder: n,
      requireExpiryDate: false,
      remindBeforeExpiry: false,
      allowClientUploads: scope === 'CLIENT',
      notifyStaffOnUpload: true,
      defaultClientAccess: 'NONE',
      documentCount: 0,
      subfolderCount: 0,
      createdAt: at,
      updatedAt: at,
    });
  const children = [
    'Tax Returns',
    'Bookkeeping',
    'Payroll',
    'Advisory',
    'Business Formation',
    'Licenses & Credentials',
    'Contracts & Agreements',
    'Marketing & Misc',
  ];
  return [
    { ...folder(1, 'Client Documents', 'CLIENT', null, 'YELLOW'), subfolderCount: children.length },
    ...children.map((name, i) => folder(i + 2, name, 'CLIENT', 1, 'BLUE')),
    folder(20, 'Firm Documents', 'FIRM', null, 'GRAY'),
  ];
}

const notInMock = async (): Promise<never> => {
  await mockDelay();
  throw new ApiRequestError(501, 'NOT_IMPLEMENTED', 'Not in the mock yet');
};

export function createDocumentLibraryMock(options: {
  documents: DocumentsClient;
  empty?: boolean;
}): DocumentLibraryClient {
  const folders = options.empty ? [] : documentFolderFixtures();
  return {
    list: notInMock,
    summary: notInMock,
    get: notInMock,
    /** Through the documents mock, so `api.documents.confirmUpload` finds the ticket. */
    createUpload: async (body) =>
      options.documents.createUpload(body.clientId, {
        serviceId: body.serviceId,
        categoryId: body.categoryId ?? null,
        taxYear: body.taxYear ?? null,
        shareWithClient: body.shareWithClient ?? false,
        fileName: body.fileName,
        contentType: body.contentType,
        sizeBytes: body.sizeBytes,
        sha256: body.sha256,
      }),
    update: notInMock,
    review: notInMock,
    archive: notInMock,
    restore: notInMock,
    trash: notInMock,
    untrash: notInMock,
    versions: notInMock,
    activity: notInMock,
    preview: notInMock,
    bulk: notInMock,
    access: notInMock,
    share: notInMock,
    updateShare: notInMock,
    revokeShare: notInMock,
    accessHistory: notInMock,
    folders: async () => {
      await mockDelay();
      return structuredClone(folders);
    },
    createFolder: notInMock,
    updateFolder: notInMock,
    deleteFolder: notInMock,
    reorderFolders: notInMock,
    createCategory: notInMock,
    updateCategory: notInMock,
    requests: notInMock,
    requestSummary: notInMock,
    request: notInMock,
    createRequest: notInMock,
    updateRequest: notInMock,
    sendRequest: notInMock,
    resendRequest: notInMock,
    remindRequest: notInMock,
    completeRequest: notInMock,
    cancelRequest: notInMock,
    bulkRequests: notInMock,
    addItem: notInMock,
    updateItem: notInMock,
    removeItem: notInMock,
    reorderItems: notInMock,
    templates: notInMock,
    createTemplate: notInMock,
    updateTemplate: notInMock,
    archiveTemplate: notInMock,
    settings: notInMock,
    updateSettings: notInMock,
  };
}
