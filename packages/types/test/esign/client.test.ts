import { describe, expect, it } from 'vitest';
import {
  ApiRequestError,
  createEsignClient,
  createMySignaturesClient,
  createRequest,
  CreateEsignUploadBody,
  ESIGN_COUNTERS,
  ESIGN_ERRORS,
  ESIGN_MERGE_LABELS,
  ESIGN_STATUS_LABELS,
  EsignErrorCode,
  EsignMergeKey,
  EsignRequestStatus,
  PutField,
  PutFieldsBody,
  PutPagePlanBody,
  PutRecipient,
  PutRecipientsBody,
  UpdateEsignRequestBody,
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

const id = '0199b6e0-0000-7000-8000-000000000001';
const other = '0199b6e0-0000-7000-8000-000000000002';
const request = (fn: typeof fetch) => createRequest({ baseUrl: '/api/v1', fetch: fn });
const facts = {
  fileName: 'Engagement letter.pdf',
  contentType: 'application/pdf' as const,
  sizeBytes: 182_400,
  sha256: 'a'.repeat(64),
};
const box = { pageIndex: 0, x: 0.1, y: 0.1, w: 0.3, h: 0.05 };

async function rejection(promise: Promise<unknown>) {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ApiRequestError);
  return error as ApiRequestError;
}

describe('api.esign', () => {
  it('calls every route with its method and body', async () => {
    const { fn, calls } = fakeFetch(500, {});
    const api = createEsignClient(request(fn));
    const page = { documentId: other, page: 0, rotation: 0 as const };
    for (const call of [
      () => api.status(),
      () => api.list({ status: 'SENT', quickFilter: 'MY_REQUESTS', q: ' smith ' }),
      () => api.summary(),
      () => api.get(id),
      () => api.create({ title: 'Engagement letter', clientId: other }),
      () => api.update(id, { internalNote: '' }),
      () => api.discard(id),
      () => api.createUpload(id, facts),
      () => api.confirmUpload(id, { uploadToken: 'token' }),
      () => api.addFromVault(id, { documentId: other }),
      () => api.removeDocument(id, other),
      () => api.putPagePlan(id, { pages: [page] }),
      () => api.putRecipients(id, { recipients: [] }),
      () => api.putFields(id, { fields: [] }),
      () => api.mergeValues(id),
      () => api.readiness(id),
      () => api.send(id, { confirm: true }),
      () => api.remind(id),
      () => api.void(id, { reason: 'Wrong client' }),
      () => api.correctRecipient(id, other, { email: 'New@Example.test' }),
      () => api.replace(id, { reason: 'New fee' }),
      () => api.resendCopy(id),
      () => api.download(id, 'final'),
      () => api.events(id),
    ]) {
      await call().catch(() => undefined);
    }
    const r = `/api/v1/esign/requests/${id}`;
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      'GET /api/v1/esign/status',
      'GET /api/v1/esign/requests?status=SENT&quickFilter=MY_REQUESTS&q=smith&limit=25',
      'GET /api/v1/esign/requests/summary',
      `GET ${r}`,
      'POST /api/v1/esign/requests',
      `PATCH ${r}`,
      `DELETE ${r}`,
      `POST ${r}/documents/uploads`,
      `POST ${r}/documents/uploads/confirm`,
      `POST ${r}/documents/from-vault`,
      `DELETE ${r}/documents/${other}`,
      `PUT ${r}/page-plan`,
      `PUT ${r}/recipients`,
      `PUT ${r}/fields`,
      `GET ${r}/merge-values`,
      `GET ${r}/readiness`,
      `POST ${r}/send`,
      `POST ${r}/remind`,
      `POST ${r}/void`,
      `POST ${r}/recipients/${other}/correct`,
      `POST ${r}/replace`,
      `POST ${r}/resend-copy`,
      `GET ${r}/download?file=final`,
      `GET ${r}/events`,
    ]);
    expect(calls[4]!.body).toEqual({ title: 'Engagement letter', source: 'TAB', clientId: other });
    expect(calls[5]!.body).toEqual({ internalNote: null });
    expect(calls[19]!.body).toEqual({ email: 'new@example.test' });
    expect(api.documentContentUrl(id, other)).toBe(`${r}/documents/${other}/content`);
  });

  it('refuses bad input before sending, as the API would', async () => {
    const { fn, calls } = fakeFetch(200, {});
    const api = createEsignClient(request(fn));
    for (const p of [
      api.get('not-a-uuid'),
      api.create({ title: '   ' }),
      api.update(id, {}),
      api.list({ limit: 500 }),
      api.createUpload(id, { ...facts, fileName: 'letter.docx' }),
      api.void(id, { reason: '' }),
      api.download(id, 'everything' as 'final'),
    ]) {
      const e = await rejection(p);
      expect([e.status, e.code]).toEqual([400, 'VALIDATION_FAILED']);
    }
    expect(calls).toEqual([]);
  });

  it('refuses an Excel or Word file from uploadFile() with FILE_TYPE_NOT_ALLOWED', async () => {
    const { fn, calls } = fakeFetch(200, {});
    const docx = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' as const;
    const e = await rejection(
      createEsignClient(request(fn)).createUpload(id, {
        ...facts,
        fileName: 'a.docx',
        contentType: docx,
      }),
    );
    expect([e.status, e.code]).toEqual([400, 'FILE_TYPE_NOT_ALLOWED']);
    expect(calls).toEqual([]);
  });

  it('builds the content address on the given base URL', () => {
    const api = createEsignClient(request(fakeFetch(200, {}).fn), 'http://localhost:4000/api/v1');
    expect(api.documentContentUrl(id, other)).toBe(
      `http://localhost:4000/api/v1/esign/requests/${id}/documents/${other}/content`,
    );
  });

  it('turns API errors into ApiRequestError with the code', async () => {
    const { fn } = fakeFetch(403, {
      error: { code: 'MODULE_OFF', message: 'Off', requestId: 'r1' },
    });
    const e = await rejection(createEsignClient(request(fn)).summary());
    expect([e.status, e.code]).toEqual([403, 'MODULE_OFF']);
  });
});

describe('api.mySignatures', () => {
  it('reads the portal status on the firm path', async () => {
    const { fn, calls } = fakeFetch(200, { enabled: true });
    expect(await createMySignaturesClient(request(fn), 'lvp').status()).toEqual({ enabled: true });
    expect(calls[0]!.url).toBe('/api/v1/portal/lvp/signatures/status');
  });
});

describe('esign schemas', () => {
  it('keeps uploads to PDF, JPG and PNG with a fitting name', () => {
    expect(CreateEsignUploadBody.safeParse(facts).success).toBe(true);
    expect(
      CreateEsignUploadBody.safeParse({ ...facts, fileName: 'scan.PNG', contentType: 'image/png' })
        .success,
    ).toBe(true);
    expect(
      CreateEsignUploadBody.safeParse({ ...facts, contentType: 'application/msword' }).success,
    ).toBe(false);
    expect(CreateEsignUploadBody.safeParse({ ...facts, fileName: 'a.png' }).success).toBe(false);
    expect(CreateEsignUploadBody.safeParse({ ...facts, sizeBytes: 11 * 1024 * 1024 }).success).toBe(
      false,
    );
  });

  it('checks fields: on the page, signer-only types, sender values, choices', () => {
    const ok = (f: object) => PutField.safeParse(f).success;
    expect(ok({ ...box, recipientId: id, type: 'SIGNATURE' })).toBe(true);
    expect(ok({ ...box, recipientId: null, type: 'SIGNATURE' })).toBe(false);
    expect(ok({ ...box, recipientId: null, type: 'TEXT', mergeKey: 'CLIENT_FULL_NAME' })).toBe(
      true,
    );
    expect(ok({ ...box, recipientId: null, type: 'TEXT' })).toBe(false);
    expect(ok({ ...box, recipientId: id, type: 'TEXT', value: 'x' })).toBe(false);
    expect(ok({ ...box, x: 0.8, recipientId: id, type: 'TEXT' })).toBe(false);
    expect(ok({ ...box, recipientId: id, type: 'DROPDOWN' })).toBe(false);
    expect(ok({ ...box, recipientId: id, type: 'DROPDOWN', options: ['A', 'B'] })).toBe(true);
    expect(ok({ ...box, recipientId: id, type: 'RADIO', options: ['Yes'] })).toBe(false);
    expect(ok({ ...box, recipientId: id, type: 'RADIO', options: ['Yes'], groupKey: 'g1' })).toBe(
      true,
    );
    expect(ok({ ...box, recipientId: id, type: 'TEXT', mergeKey: 'SSN' })).toBe(false);
  });

  it('checks recipients: who they are, portal delivery, access codes, custom roles', () => {
    const ok = (r: object) => PutRecipient.safeParse(r).success;
    const ext = { type: 'EXTERNAL', name: 'Pat Partner', email: 'pat@example.test' };
    const login = { type: 'CLIENT_LOGIN', clientAccountId: id };
    expect(ok({ role: 'CLIENT', routingOrder: 1, who: login, delivery: 'PORTAL' })).toBe(true);
    expect(ok({ role: 'SPOUSE', routingOrder: 1, who: ext, delivery: 'PORTAL' })).toBe(false);
    expect(ok({ role: 'CUSTOM', routingOrder: 1, who: ext })).toBe(false);
    expect(ok({ role: 'CUSTOM', roleLabel: 'Trustee', routingOrder: 1, who: ext })).toBe(true);
    expect(ok({ role: 'CLIENT', routingOrder: 1, who: ext, authMethod: 'ACCESS_CODE' })).toBe(
      false,
    );
    expect(ok({ id, role: 'CLIENT', routingOrder: 1, who: ext, authMethod: 'ACCESS_CODE' })).toBe(
      true,
    );
    expect(ok({ role: 'CLIENT', routingOrder: 1, who: { ...ext, email: 'nope' } })).toBe(false);
    const tidy = PutRecipient.parse({
      role: 'CLIENT',
      routingOrder: 1,
      who: { ...ext, email: ' Pat@Example.TEST ', phone: '(404) 555-0100' },
    });
    expect(tidy.who).toMatchObject({ email: 'pat@example.test', phone: '+14045550100' });
    expect(
      ok({ role: 'CLIENT', routingOrder: 1, who: { ...login, email: 'pat@example.test' } }),
    ).toBe(false);
    expect(ok({ role: 'CLIENT', routingOrder: 1, who: ext, authMethod: 'PORTAL_SESSION' })).toBe(
      false,
    );
  });

  it('refuses a page twice in the plan, and an empty update', () => {
    const page = { documentId: id, page: 0, rotation: 90 };
    expect(PutPagePlanBody.safeParse({ pages: [page] }).success).toBe(true);
    expect(PutPagePlanBody.safeParse({ pages: [page, page] }).success).toBe(false);
    expect(PutPagePlanBody.safeParse({ pages: [{ ...page, rotation: 45 }] }).success).toBe(false);
    expect(UpdateEsignRequestBody.safeParse({}).success).toBe(false);
    const signer = { id, role: 'CLIENT', routingOrder: 1, who: { type: 'STAFF', userId: id } };
    expect(PutRecipientsBody.safeParse({ recipients: [signer, signer] }).success).toBe(false);
    const f = { ...box, id, recipientId: id, type: 'SIGNATURE' };
    expect(PutFieldsBody.safeParse({ fields: [f, f] }).success).toBe(false);
    expect(PutFieldsBody.safeParse({ fields: [f, { ...f, id: undefined }] }).success).toBe(true);
    expect(UpdateEsignRequestBody.safeParse({ businessId: id }).success).toBe(false);
  });

  it('has words for every error, status and merge field', () => {
    expect(Object.keys(ESIGN_ERRORS).sort()).toEqual([...EsignErrorCode.options].sort());
    expect(Object.keys(ESIGN_STATUS_LABELS).sort()).toEqual([...EsignRequestStatus.options].sort());
    expect(Object.keys(ESIGN_MERGE_LABELS)).toEqual(EsignMergeKey.options);
    expect(EsignMergeKey.options).toHaveLength(17);
    expect(ESIGN_COUNTERS).toHaveLength(9);
  });
});
