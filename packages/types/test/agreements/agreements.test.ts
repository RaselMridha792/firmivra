import { describe, expect, it } from 'vitest';
import {
  AGREEMENT_ERRORS,
  AgreementErrorCode,
  ApiRequestError,
  CreateAgreementRequest,
  CreateAgreementUploadRequest,
  createAgreementsClient,
  createPublicAgreementsClient,
  createRequest,
  IntakeAgreementBlock,
  IntakeSignatureInput,
  PublishAgreementVersionRequest,
} from '../../src/index.js';

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

const id = (n: number) => `0199b6a5-0000-7000-8000-${String(n).padStart(12, '0')}`;
const sha = 'a'.repeat(64);
const ack = { key: 'read_agreement', label: 'I read it', text: 'I have read it.', required: true };
const publish = {
  expectedCurrentVersion: null,
  title: 'Client Intake Agreement (sample)',
  bodyMarkdown: '# Sample\n\nNot legal text.',
  acknowledgments: [ack],
  pdfFileId: id(9),
};
const signature = {
  agreements: [{ agreementId: id(1), version: 2, bodySha256: sha }],
  acknowledgments: [{ agreementId: id(1), key: 'read_agreement' }],
  signer: { printedName: 'Sam Sample', method: 'TYPED', typedSignature: 'sam  sample' },
};

describe('agreement requests', () => {
  it('ties the scope to a service', () => {
    expect(CreateAgreementRequest.safeParse({ scope: 'ALL_INTAKES' }).success).toBe(true);
    expect(CreateAgreementRequest.safeParse({ scope: 'SERVICE', serviceId: id(3) }).success).toBe(
      true,
    );
    expect(CreateAgreementRequest.safeParse({ scope: 'SERVICE' }).success).toBe(false);
    expect(
      CreateAgreementRequest.safeParse({ scope: 'ALL_INTAKES', serviceId: id(3) }).success,
    ).toBe(false);
    expect(
      CreateAgreementRequest.safeParse({ scope: 'ALL_INTAKES', businessId: id(4) }).success,
    ).toBe(false);
  });

  it('checks a version: text, keys and at most 8 acknowledgments', () => {
    expect(PublishAgreementVersionRequest.safeParse(publish).success).toBe(true);
    const bad = [
      { bodyMarkdown: '   ' },
      { title: '' },
      { title: 'x'.repeat(201) },
      { bodyMarkdown: 'x'.repeat(100_001) },
      { acknowledgments: [ack, ack] },
      { acknowledgments: [{ ...ack, key: 'Read' }] },
      { acknowledgments: Array.from({ length: 9 }, (_, n) => ({ ...ack, key: `k_${n}` })) },
      { acknowledgments: [{ ...ack, extra: true }] },
      { expectedCurrentVersion: 0 },
      { pdfFileId: 'nope' },
    ];
    for (const change of bad) {
      expect(PublishAgreementVersionRequest.safeParse({ ...publish, ...change }).success).toBe(
        false,
      );
    }
  });

  it('takes only small PDFs with a safe name', () => {
    const file = { fileName: 'Agreement.pdf', sizeBytes: 48_213, sha256: sha };
    expect(CreateAgreementUploadRequest.safeParse(file).success).toBe(true);
    for (const change of [
      { fileName: 'Agreement.docx' },
      { fileName: '.pdf' },
      { fileName: '../Agreement.pdf' },
      { fileName: 'Agree‮ment.pdf' },
      { sizeBytes: 0 },
      { sizeBytes: 10 * 1024 * 1024 + 1 },
      { sha256: 'ABC' },
    ]) {
      expect(CreateAgreementUploadRequest.safeParse({ ...file, ...change }).success).toBe(false);
    }
  });
});

describe('IntakeSignatureInput', () => {
  it('accepts a typed signature that matches the printed name', () => {
    expect(IntakeSignatureInput.safeParse(signature).success).toBe(true);
    expect(
      IntakeSignatureInput.safeParse({
        ...signature,
        acceptLegal: { termsVersion: 2, privacyVersion: 1 },
        title: 'Owner',
      }).success,
    ).toBe(true);
  });

  it('refuses a mismatch, no agreements, duplicates and unknown fields', () => {
    const bad = [
      { signer: { ...signature.signer, typedSignature: 'Someone Else' } },
      { signer: { ...signature.signer, method: 'DRAWN' } },
      { agreements: [] },
      { agreements: [signature.agreements[0], signature.agreements[0]] },
      { agreements: [{ ...signature.agreements[0], bodySha256: 'x' }] },
      { acknowledgments: [{ agreementId: id(1), key: 'x' }] },
      { signedAt: '2026-10-09T09:00:00Z' },
      { ip: '203.0.113.9' },
    ];
    for (const change of bad) {
      expect(IntakeSignatureInput.safeParse({ ...signature, ...change }).success).toBe(false);
    }
  });
});

describe('agreement errors', () => {
  it('has user text for every code', () => {
    for (const code of AgreementErrorCode.options) {
      expect(AGREEMENT_ERRORS[code].length).toBeGreaterThan(10);
    }
  });
});

describe('agreements clients', () => {
  it('calls the firm routes and refuses bad input before sending', async () => {
    const { fn, calls } = fakeFetch(200, { items: [] });
    const client = createAgreementsClient(createRequest({ baseUrl: '/api/v1', fetch: fn }));
    await expect(client.list()).resolves.toEqual({ items: [] });
    expect(calls[0]?.url).toBe('/api/v1/business/agreements');
    await expect(client.getVersion('not-a-uuid', 1)).rejects.toBeInstanceOf(ApiRequestError);
    await expect(client.getVersion(id(1), 0)).rejects.toBeInstanceOf(ApiRequestError);
    expect(calls).toHaveLength(1);
  });

  it('reads the public block with the service and a lower-cased slug', async () => {
    const block = { ready: false, agreements: [], legal: { terms: null, privacy: null } };
    expect(IntakeAgreementBlock.parse(block)).toEqual(block);
    const { fn, calls } = fakeFetch(200, block);
    const client = createPublicAgreementsClient(
      createRequest({ baseUrl: '/api/v1', fetch: fn }),
      'LVP',
    );
    await client.block({ serviceId: id(3) });
    expect(calls[0]?.url).toBe(`/api/v1/portal/lvp/intake-agreements?serviceId=${id(3)}`);
    await expect(client.block({ serviceId: 'x' } as never)).rejects.toBeInstanceOf(ApiRequestError);
  });
});
