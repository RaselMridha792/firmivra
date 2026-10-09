import { describe, expect, it } from 'vitest';
import {
  ApiRequestError,
  createEsignClient,
  createMySignaturesClient,
  createRequest,
  createSigningClient,
  ESIGN_ERRORS,
  EsignErrorCode,
  SignerAdoptBody,
  SignerFinishBody,
  SignerSessionBody,
  UpdateEsignSettingsBody,
  UseEsignTemplateBody,
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
const token = 'A'.repeat(43);
const request = (fn: typeof fetch) => createRequest({ baseUrl: '/api/v1', fetch: fn });
const png = 'iVBORw0KGgoAAAANSUhEUg==';
const typed = {
  printedName: 'Jamie Sample',
  method: 'TYPED' as const,
  typedSignature: 'jamie  sample',
};

async function rejection(promise: Promise<unknown>) {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ApiRequestError);
  return error as ApiRequestError;
}

describe('api.signing(slug)', () => {
  it('calls every signer route on the firm’s path', async () => {
    const { fn, calls } = fakeFetch(500, {});
    const api = createSigningClient(request(fn), 'LVP');
    for (const call of [
      () => api.session(token),
      () => api.state(),
      () => api.end(),
      () => api.sendCode(),
      () => api.verifyCode({ code: '123456' }),
      () => api.verifyAccessCode({ code: 'MOCK1234' }),
      () => api.consent(),
      () => api.acceptConsent({ versionId: id, agree: true }),
      () => api.envelope(),
      () => api.adopt({ signature: typed }),
      () => api.finish({ values: [{ fieldId: id, value: 'Owner' }] }),
      () => api.decline({ reason: 'Wrong fee' }),
      () =>
        api.createAttachmentUpload({
          fieldId: id,
          fileName: 'id.png',
          contentType: 'image/png',
          sizeBytes: 1000,
          sha256: 'a'.repeat(64),
        }),
      () => api.confirmAttachment({ fieldId: id, uploadToken: 't' }),
      () => api.copy(),
      () => api.downloadCopy('certificate'),
    ]) {
      await call().catch(() => undefined);
    }
    const s = '/api/v1/portal/lvp/sign';
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      `POST ${s}/session`,
      `GET ${s}/state`,
      `POST ${s}/session/end`,
      `POST ${s}/code/send`,
      `POST ${s}/code/verify`,
      `POST ${s}/access-code`,
      `GET ${s}/consent`,
      `POST ${s}/consent`,
      `GET ${s}/envelope`,
      `POST ${s}/adopt`,
      `POST ${s}/finish`,
      `POST ${s}/decline`,
      `POST ${s}/attachments/uploads`,
      `POST ${s}/attachments/uploads/confirm`,
      `GET ${s}/copy`,
      `GET ${s}/copy/download?file=certificate`,
    ]);
    expect(calls[0]!.body).toEqual({ token });
    expect(api.packetUrl()).toBe(`${s}/packet`);
  });

  it('refuses bad input before sending', async () => {
    const { fn, calls } = fakeFetch(200, {});
    const api = createSigningClient(request(fn), 'lvp');
    for (const p of [
      api.session('short'),
      api.verifyCode({ code: '12345' }),
      api.acceptConsent({ versionId: id, agree: false as true }),
      api.adopt({ signature: { ...typed, typedSignature: 'Someone Else' } }),
      api.adopt({ signature: { printedName: 'Jamie', method: 'DRAWN', imagePng: 'R0lGOD' } }),
      api.finish({
        values: [
          { fieldId: id, value: 'a' },
          { fieldId: id, value: 'b' },
        ],
      }),
      api.createAttachmentUpload({
        fieldId: id,
        fileName: 'id.docx',
        contentType: 'image/png',
        sizeBytes: 1000,
        sha256: 'a'.repeat(64),
      }),
      api.downloadCopy('original' as 'final'),
    ]) {
      const e = await rejection(p);
      expect([e.status, e.code]).toEqual([400, 'VALIDATION_FAILED']);
    }
    await expect(
      Promise.resolve().then(() => createSigningClient(request(fn), 'Bad Slug!').state()),
    ).rejects.toBeInstanceOf(ApiRequestError);
    expect(calls).toEqual([]);
  });

  it('takes typed, drawn and uploaded signatures and initials', () => {
    expect(SignerAdoptBody.safeParse({ signature: typed }).success).toBe(true);
    expect(
      SignerAdoptBody.safeParse({
        signature: { printedName: 'Zoë Ångström', method: 'DRAWN', imagePng: png },
        initials: { method: 'TYPED', text: 'ZÅ' },
      }).success,
    ).toBe(true);
    expect(
      SignerAdoptBody.safeParse({
        signature: { printedName: 'Jamie', method: 'UPLOADED', imagePng: png },
        initials: { method: 'UPLOADED', imagePng: png },
      }).success,
    ).toBe(true);
    const tooBig = png + 'A'.repeat(300_000);
    expect(
      SignerAdoptBody.safeParse({
        signature: { printedName: 'Jamie', method: 'DRAWN', imagePng: tooBig },
      }).success,
    ).toBe(false);
    expect(
      SignerAdoptBody.safeParse({ signature: typed, initials: { method: 'TYPED', text: 'J S' } })
        .success,
    ).toBe(false);
  });

  it('checks the token and finish values', () => {
    expect(SignerSessionBody.safeParse({ token: `${'a'.repeat(42)}=` }).success).toBe(false);
    expect(SignerSessionBody.safeParse({ token: `${'a-_'.repeat(14)}b` }).success).toBe(true);
    expect(SignerFinishBody.safeParse({ values: [] }).success).toBe(true);
    expect(
      SignerFinishBody.safeParse({ values: [{ fieldId: id, value: 'x'.repeat(1001) }] }).success,
    ).toBe(false);
  });
});

describe('api.mySignatures(slug)', () => {
  it('lists, starts signing and downloads under /me/signatures', async () => {
    const { fn, calls } = fakeFetch(500, {});
    const api = createMySignaturesClient(request(fn), 'lvp');
    for (const call of [
      () => api.status(),
      () => api.list(),
      () => api.list({ tab: 'SIGNED' }),
      () => api.startSigning(id),
      () => api.download(id, 'final'),
    ]) {
      await call().catch(() => undefined);
    }
    const m = '/api/v1/portal/lvp/me/signatures';
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      `GET ${m}/status`,
      `GET ${m}?tab=PENDING`,
      `GET ${m}?tab=SIGNED`,
      `POST ${m}/${id}/session`,
      `GET ${m}/${id}/download?file=final`,
    ]);
  });
});

describe('api.esign settings and templates', () => {
  it('calls every route', async () => {
    const { fn, calls } = fakeFetch(500, {});
    const api = createEsignClient(request(fn));
    for (const call of [
      () => api.settings.get(),
      () => api.settings.update({ expiryDays: 14, emailMessage: '' }),
      () => api.settings.consentVersions(),
      () => api.settings.publishConsent({ bodyMarkdown: 'Consent text' }),
      () => api.settings.updateMyProfile({ jobTitle: 'Senior Preparer' }),
      () => api.templates.list({ q: 'letter' }),
      () => api.templates.get(id),
      () => api.templates.update(id, { visibility: 'PRIVATE' }),
      () => api.templates.archive(id),
      () => api.templates.use(id, { clientId: other }),
      () => api.saveAsTemplate(id, { name: 'Engagement letter' }),
    ]) {
      await call().catch(() => undefined);
    }
    const t = `/api/v1/esign/templates/${id}`;
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      'GET /api/v1/esign/settings',
      'PUT /api/v1/esign/settings',
      'GET /api/v1/esign/settings/consent-versions',
      'POST /api/v1/esign/settings/consent-versions',
      'PUT /api/v1/esign/me/profile',
      'GET /api/v1/esign/templates?q=letter&archived=false',
      `GET ${t}`,
      `PATCH ${t}`,
      `POST ${t}/archive`,
      `POST ${t}/use`,
      `POST /api/v1/esign/requests/${id}/save-as-template`,
    ]);
    expect(calls[1]!.body).toEqual({ expiryDays: 14, emailMessage: null });
    expect(calls[9]!.body).toEqual({ clientId: other, roles: [] });
    expect(calls[10]!.body).toEqual({
      name: 'Engagement letter',
      visibility: 'PRIVATE',
      keepSenderValues: false,
    });
  });

  it('checks settings and template bodies', () => {
    expect(UpdateEsignSettingsBody.safeParse({}).success).toBe(false);
    expect(UpdateEsignSettingsBody.safeParse({ expiryDays: 0 }).success).toBe(false);
    expect(UseEsignTemplateBody.safeParse({ engagementId: id }).success).toBe(false);
    expect(
      UseEsignTemplateBody.safeParse({
        roles: [
          { key: 'witness', who: { type: 'EXTERNAL', name: 'Pat', email: 'pat@example.test' } },
          { key: 'witness', who: { type: 'STAFF', userId: id } },
        ],
      }).success,
    ).toBe(false);
  });

  it('has words for every error code', () => {
    for (const code of EsignErrorCode.options) expect(ESIGN_ERRORS[code]).toBeTruthy();
  });
});
