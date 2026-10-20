// The firm-wide Documents contract (R55): schemas and the paths `api.documentLibrary` calls.
import { describe, expect, it } from 'vitest';
import {
  ApiRequestError,
  BulkDocumentsRequest,
  CreateLibraryUploadRequest,
  CreateRequestPacketRequest,
  createDocumentLibraryClient,
  createRequest,
  LibraryQuery,
  ReviewDocumentRequest,
  UpdateLibraryDocumentRequest,
  UpdateRequestPacketRequest,
} from '../../src/index.js';

const ID = '0199b6a0-0000-7000-8000-000000000001';
const ID2 = '0199b6a0-0000-7000-8000-000000000002';
const SHA = 'a'.repeat(64);

function fakeFetch(status: number, body: unknown) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
  return { fn, calls };
}
const client = (fn: typeof fetch) =>
  createDocumentLibraryClient(createRequest({ baseUrl: '/api/v1', fetch: fn }));

const upload = {
  clientId: ID,
  serviceId: ID2,
  fileName: 'w2-2025.pdf',
  contentType: 'application/pdf',
  sizeBytes: 1200,
  sha256: SHA,
};

describe('library schemas', () => {
  it('defaults the list to live documents, newest first, 10 a page', () => {
    expect(LibraryQuery.parse({})).toMatchObject({
      scope: 'active',
      sort: 'newest',
      page: 1,
      pageSize: 10,
    });
    expect(LibraryQuery.safeParse({ folderId: 'firm' }).success).toBe(true);
    expect(LibraryQuery.safeParse({ folderId: 'other' }).success).toBe(false);
    expect(LibraryQuery.safeParse({ pageSize: 101 }).success).toBe(false);
  });

  it('uploads need a client and service, a fitting name, and sharing to notify', () => {
    expect(CreateLibraryUploadRequest.parse(upload)).toMatchObject({
      shareWithClient: false,
      notifyClient: false,
    });
    expect(CreateLibraryUploadRequest.safeParse({ ...upload, fileName: 'w2.docx' }).success).toBe(
      false,
    );
    expect(CreateLibraryUploadRequest.safeParse({ ...upload, notifyClient: true }).success).toBe(
      false,
    );
    expect(
      CreateLibraryUploadRequest.safeParse({ ...upload, shareWithClient: true, notifyClient: true })
        .success,
    ).toBe(true);
    expect(
      CreateLibraryUploadRequest.safeParse({ ...upload, tags: Array(21).fill('x') }).success,
    ).toBe(false);
    const { serviceId: _s, ...noService } = upload;
    expect(CreateLibraryUploadRequest.safeParse(noService).success).toBe(false);
  });

  it('edits need a change; a replacement request needs a reason', () => {
    expect(UpdateLibraryDocumentRequest.safeParse({}).success).toBe(false);
    expect(UpdateLibraryDocumentRequest.safeParse({ folderId: null }).success).toBe(true);
    expect(ReviewDocumentRequest.safeParse({ action: 'REQUEST_REPLACEMENT' }).success).toBe(false);
    expect(
      ReviewDocumentRequest.safeParse({ action: 'REQUEST_REPLACEMENT', reason: 'Blurry' }).success,
    ).toBe(true);
    expect(BulkDocumentsRequest.safeParse({ action: 'ARCHIVE', ids: [] }).success).toBe(false);
  });

  it('a request is a client draft by default; updates need a change', () => {
    expect(
      CreateRequestPacketRequest.parse({ idempotencyKey: ID, clientId: ID2, title: 'Tax docs' }),
    ).toMatchObject({ recipient: { kind: 'CLIENT' }, send: false });
    expect(
      CreateRequestPacketRequest.safeParse({
        idempotencyKey: ID,
        clientId: ID2,
        title: 'x',
        reminderDaysBefore: 31,
      }).success,
    ).toBe(false);
    expect(UpdateRequestPacketRequest.safeParse({}).success).toBe(false);
  });
});

describe('api.documentLibrary', () => {
  it('calls the firm-wide routes', async () => {
    const { fn, calls } = fakeFetch(200, { items: [], total: 0, page: 2, pageSize: 25 });
    await client(fn).list({ scope: 'trash', page: 2, pageSize: 25 });
    expect(calls[0]?.url).toBe(
      '/api/v1/business/documents?scope=trash&sort=newest&page=2&pageSize=25',
    );
    await client(fn).requests({ tab: 'overdue' });
    expect(calls[1]?.url).toBe(
      '/api/v1/business/document-request-packets?tab=overdue&sort=due&page=1&pageSize=10',
    );
  });

  it('sends parsed bodies to the right paths', async () => {
    const { fn, calls } = fakeFetch(200, { ok: true });
    await client(fn).revokeShare(ID, ID2);
    expect(calls[0]?.url).toBe(`/api/v1/business/documents/${ID}/shares/${ID2}/revoke`);
    expect(calls[0]?.init.method).toBe('POST');
    await client(fn).deleteFolder(ID);
    expect(calls[1]).toMatchObject({
      url: `/api/v1/business/document-folders/${ID}`,
      init: { method: 'DELETE' },
    });
  });

  it('refuses bad input before anything is sent', async () => {
    const { fn, calls } = fakeFetch(200, {});
    await expect(client(fn).get('nope')).rejects.toBeInstanceOf(ApiRequestError);
    await expect(client(fn).update(ID, {})).rejects.toBeInstanceOf(ApiRequestError);
    expect(calls).toHaveLength(0);
  });
});
