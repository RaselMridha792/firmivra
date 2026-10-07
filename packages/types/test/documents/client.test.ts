import { describe, expect, it } from 'vitest';
import {
  ApiRequestError,
  createDocumentsClient,
  createMyDocumentsClient,
  createRequest,
  DocumentErrorCode,
  FirmDocument,
  MyDocument,
  UPLOAD_LIMITS,
  UploadContentType,
} from '../../src/index.js';

function fakeFetch(status: number, body: unknown) {
  const calls: { url: string; method: string; body: unknown }[] = [];
  const fn = (async (url: string, init: RequestInit) => {
    calls.push({
      url,
      method: init.method ?? 'GET',
      body: init.body === undefined ? undefined : JSON.parse(init.body as string),
    });
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const id = '0199b6a0-0000-7000-8000-000000000001';
const at = '2026-10-07T09:00:00.000Z';
const request = (fn: typeof fetch) => createRequest({ baseUrl: '/api/v1', fetch: fn });
const facts = {
  fileName: 'W-2_2025.pdf',
  contentType: 'application/pdf' as const,
  sizeBytes: 182_400,
  sha256: 'a'.repeat(64),
};

async function rejection(promise: Promise<unknown>) {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ApiRequestError);
  return error as ApiRequestError;
}

describe('api.documents (firm)', () => {
  it('calls every route with its method and body', async () => {
    const { fn, calls } = fakeFetch(500, {});
    const api = createDocumentsClient(request(fn));
    for (const call of [
      () => api.list(id, { direction: 'INTERNAL', search: ' w-2 ' }),
      () => api.get(id),
      () => api.createUpload(id, { serviceId: id, ...facts }),
      () => api.confirmUpload({ uploadToken: 'token' }),
      () => api.download(id),
      () => api.categories(),
      () => api.requests(id, { status: 'SUBMITTED' }),
      () => api.createRequest(id, { serviceId: id, title: 'W-2 from your employer', dueOn: '' }),
      () => api.acceptRequest(id),
      () => api.rejectRequest(id, { reason: 'Page 2 is missing' }),
      () => api.cancelRequest(id),
    ]) {
      await call().catch(() => undefined);
    }
    expect(calls.map((c) => [`${c.method} ${c.url}`, c.body])).toEqual([
      [
        `GET /api/v1/business/clients/${id}/documents?direction=INTERNAL&search=w-2&limit=25`,
        undefined,
      ],
      [`GET /api/v1/business/documents/${id}`, undefined],
      [
        `POST /api/v1/business/clients/${id}/documents/uploads`,
        { serviceId: id, shareWithClient: false, ...facts },
      ],
      ['POST /api/v1/business/documents/uploads/confirm', { uploadToken: 'token' }],
      [`GET /api/v1/business/documents/${id}/download`, undefined],
      ['GET /api/v1/business/document-categories', undefined],
      [`GET /api/v1/business/clients/${id}/document-requests?status=SUBMITTED`, undefined],
      [
        `POST /api/v1/business/clients/${id}/document-requests`,
        { serviceId: id, title: 'W-2 from your employer', dueOn: null },
      ],
      [`POST /api/v1/business/document-requests/${id}/accept`, {}],
      [`POST /api/v1/business/document-requests/${id}/reject`, { reason: 'Page 2 is missing' }],
      [`POST /api/v1/business/document-requests/${id}/cancel`, {}],
    ]);
  });

  it.each([
    ['a type that is not allowed', { contentType: 'application/zip' }],
    ['a file over 10 MB', { sizeBytes: UPLOAD_LIMITS.maxBytes + 1 }],
    ['an empty file', { sizeBytes: 0 }],
    ['a checksum that is not SHA-256 hex', { sha256: 'ABC' }],
    ['an unknown field', { businessId: id }],
  ])('refuses an upload with %s before sending', async (_, change) => {
    const { fn, calls } = fakeFetch(200, {});
    const api = createDocumentsClient(request(fn));
    const body = { serviceId: id, ...facts, ...change } as Parameters<typeof api.createUpload>[1];
    expect((await rejection(api.createUpload(id, body))).code).toBe('VALIDATION_FAILED');
    expect(calls).toHaveLength(0);
  });

  it('refuses a bad id or an empty reason before sending', async () => {
    const { fn, calls } = fakeFetch(200, {});
    const api = createDocumentsClient(request(fn));
    for (const call of [
      () => api.get('../clients'),
      () => api.list('x'),
      () => api.rejectRequest(id, { reason: ' ' }),
    ]) {
      expect((await rejection(call())).code).toBe('VALIDATION_FAILED');
    }
    expect(calls).toHaveLength(0);
  });

  it('passes the API error code through', async () => {
    const { fn } = fakeFetch(409, { error: { code: 'SCAN_PENDING', message: 'Still checking' } });
    const error = await rejection(createDocumentsClient(request(fn)).download(id));
    expect([error.status, error.code]).toEqual([409, 'SCAN_PENDING']);
  });
});

describe('api.myDocuments(slug) (portal)', () => {
  it("calls the client's own routes under the firm's portal", async () => {
    const { fn, calls } = fakeFetch(500, {});
    const api = createMyDocumentsClient(request(fn), 'lvp');
    for (const call of [
      () => api.list(),
      () => api.list({ source: 'FIRM', taxYear: 2025, sort: 'name' }),
      () => api.uploadTargets(),
      () => api.createUpload({ serviceId: id, requestId: id, ...facts }),
      () => api.confirmUpload({ uploadToken: 'token' }),
      () => api.download(id),
      () => api.categories(),
      () => api.requests(),
      () => api.notAvailable(id, { reason: 'We had none this year' }),
    ]) {
      await call().catch(() => undefined);
    }
    const me = '/api/v1/portal/lvp/me';
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      `GET ${me}/documents?source=MINE&sort=newest&limit=25`,
      `GET ${me}/documents?source=FIRM&taxYear=2025&sort=name&limit=25`,
      `GET ${me}/documents/upload-targets`,
      `POST ${me}/documents/uploads`,
      `POST ${me}/documents/uploads/confirm`,
      `GET ${me}/documents/${id}/download`,
      `GET ${me}/document-categories`,
      `GET ${me}/document-requests`,
      `POST ${me}/document-requests/${id}/not-available`,
    ]);
  });

  it('refuses a bad firm address before building a path', async () => {
    const { fn, calls } = fakeFetch(200, {});
    const error = await rejection(createMyDocumentsClient(request(fn), '../lvp').list());
    expect(error.code).toBe('VALIDATION_FAILED');
    expect(calls).toHaveLength(0);
  });

  it('has no INTERNAL source and drops fields it does not know', () => {
    const doc = {
      id,
      source: 'MINE',
      service: { id, title: '2025 Personal Tax' },
      category: null,
      requestId: null,
      fileName: 'W-2_2025.pdf',
      contentType: 'application/pdf',
      sizeBytes: 1,
      taxYear: 2025,
      status: 'READY',
      uploadedAt: at,
    };
    expect(MyDocument.safeParse({ ...doc, source: 'INTERNAL' }).success).toBe(false);
    expect(MyDocument.parse({ ...doc, addedLater: 1 })).not.toHaveProperty('addedLater');
  });

  it.each([
    ['a right-to-left override', 'invoice‮fdp.exe'],
    ['a zero-width space', 'w2​.pdf'],
    ['a line separator', 'w2 .pdf'],
    ['a path', '../../x.pdf'],
    ['a backslash', 'a\\b.pdf'],
    ['no ending', 'CON'],
    ['an ending of another type', 'evil.html'],
    ['a second ending', 'x.pdf.exe'],
    ['only the ending', '.pdf'],
  ])('refuses a file name with %s', async (_, fileName) => {
    const { fn, calls } = fakeFetch(200, {});
    const api = createMyDocumentsClient(request(fn), 'lvp');
    const error = await rejection(api.createUpload({ serviceId: id, ...facts, fileName }));
    expect(error.code).toBe('VALIDATION_FAILED');
    expect(calls).toHaveLength(0);
  });

  it('takes a name whose ending fits its type, in any case', async () => {
    const { fn, calls } = fakeFetch(500, {});
    const api = createMyDocumentsClient(request(fn), 'lvp');
    await api.createUpload({ serviceId: id, ...facts, fileName: ' Scan.PDF ' }).catch(() => 0);
    await api
      .createUpload({ serviceId: id, ...facts, contentType: 'image/jpeg', fileName: 'id.JPEG' })
      .catch(() => 0);
    expect(calls.map((c) => (c.body as { fileName: string }).fileName)).toEqual([
      'Scan.PDF',
      'id.JPEG',
    ]);
  });

  it('keeps the upload types and the picker endings together', () => {
    expect(UploadContentType.options).toEqual(Object.keys(UPLOAD_LIMITS.types));
  });
});

describe('Excel and Word files (both sides)', () => {
  const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  const clients = (fn: typeof fetch) => {
    const firm = createDocumentsClient(request(fn));
    const portal = createMyDocumentsClient(request(fn), 'lvp');
    return {
      createUpload: (change: Record<string, unknown>) => [
        firm.createUpload(id, { serviceId: id, ...facts, ...change } as never),
        portal.createUpload({ serviceId: id, ...facts, ...change } as never),
      ],
      confirmUpload: () => [
        firm.confirmUpload({ uploadToken: 'token' }),
        portal.confirmUpload({ uploadToken: 'token' }),
      ],
    };
  };

  it.each([
    ['an .xlsx', XLSX, 'Rental_Income_2025.xlsx'],
    ['a .docx', DOCX, 'Office_Lease.docx'],
    ['an ending in capitals', XLSX, 'BUDGET.XLSX'],
  ])('sends %s upload with its type', async (_, contentType, fileName) => {
    const { fn, calls } = fakeFetch(500, {});
    await Promise.allSettled(clients(fn).createUpload({ contentType, fileName }));
    expect(calls.map((c) => (c.body as { contentType: string }).contentType)).toEqual([
      contentType,
      contentType,
    ]);
  });

  it.each([
    ['.xls', 'application/vnd.ms-excel', 'Budget.xls'],
    ['.xlsm', 'application/vnd.ms-excel.sheet.macroEnabled.12', 'Budget.xlsm'],
    ['.doc', 'application/msword', 'Letter.doc'],
    ['.docm', 'application/vnd.ms-word.document.macroEnabled.12', 'Letter.docm'],
    ['.csv', 'text/csv', 'Transactions.csv'],
  ])('refuses a %s file by its type before sending', async (_, contentType, fileName) => {
    const { fn, calls } = fakeFetch(200, {});
    const errors = await Promise.all(
      clients(fn).createUpload({ contentType, fileName }).map(rejection),
    );
    expect(errors.map((e) => [e.code, e.message])).toEqual([
      ['VALIDATION_FAILED', 'Upload a PDF, JPG, PNG, Excel (.xlsx) or Word (.docx) file'],
      ['VALIDATION_FAILED', 'Upload a PDF, JPG, PNG, Excel (.xlsx) or Word (.docx) file'],
    ]);
    expect(calls).toHaveLength(0);
  });

  it.each([
    ['an .xlsm name', XLSX, 'Budget.xlsm', '.xlsx'],
    ['an .xls name', XLSX, 'Budget.xls', '.xlsx'],
    ['a .csv name', XLSX, 'Transactions.csv', '.xlsx'],
    ['a .docm name', DOCX, 'Letter.docm', '.docx'],
    ['a .doc name', DOCX, 'Letter.doc', '.docx'],
    ['an .xlsx name', DOCX, 'Budget.xlsx', '.docx'],
  ])('refuses %s declared as %s before sending', async (_, contentType, fileName, ending) => {
    const { fn, calls } = fakeFetch(200, {});
    const errors = await Promise.all(
      clients(fn).createUpload({ contentType, fileName }).map(rejection),
    );
    expect(errors.map((e) => [e.code, e.message])).toEqual([
      ['VALIDATION_FAILED', `The file name must end in ${ending}`],
      ['VALIDATION_FAILED', `The file name must end in ${ending}`],
    ]);
    expect(calls).toHaveLength(0);
  });

  it.each(['FILE_PASSWORD_PROTECTED', 'FILE_HAS_MACROS', 'UPLOAD_MISMATCH'])(
    'passes %s from confirm through',
    async (code) => {
      expect(DocumentErrorCode.options).toContain(code);
      const { fn } = fakeFetch(409, { error: { code, message: 'Refused' } });
      const errors = await Promise.all(clients(fn).confirmUpload().map(rejection));
      expect(errors.map((e) => [e.status, e.code])).toEqual([
        [409, code],
        [409, code],
      ]);
    },
  );

  it('parses Excel and Word documents for the firm, and BLOCKED ones for the portal', () => {
    const firmDoc = {
      id,
      clientId: id,
      service: { id, title: '2025 Personal Tax' },
      category: null,
      requestId: null,
      direction: 'CLIENT_TO_FIRM',
      fileName: 'Rental_Income_2025.xlsx',
      contentType: XLSX,
      sizeBytes: 48_640,
      taxYear: 2025,
      scanStatus: 'CLEAN',
      uploadedBy: { name: 'Jamie Sample', byClient: true },
      createdAt: at,
    };
    expect(FirmDocument.parse(firmDoc).contentType).toBe(XLSX);
    const failed = { ...firmDoc, fileName: 'Office_Lease.docx', contentType: DOCX };
    expect(FirmDocument.parse({ ...failed, scanStatus: 'FAILED' }).scanStatus).toBe('FAILED');
    const mine = {
      id,
      source: 'MINE',
      service: firmDoc.service,
      category: null,
      requestId: null,
      fileName: failed.fileName,
      contentType: DOCX,
      sizeBytes: 1,
      taxYear: 2025,
      status: 'BLOCKED',
      uploadedAt: at,
    };
    expect(MyDocument.parse(mine).status).toBe('BLOCKED');
    expect(MyDocument.safeParse({ ...mine, status: 'FAILED' }).success).toBe(false);
  });
});
