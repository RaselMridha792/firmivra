import { describe, expect, it } from 'vitest';
import {
  AGREEMENT_ERRORS,
  AgreementErrorCode,
  AgreementOutdatedDetails,
  AgreementVersion,
  ApiRequestError,
  CreateAgreementRequest,
  CreateAgreementUploadRequest,
  createAgreementsClient,
  createMyIntakeAgreementsClient,
  createPublicAgreementsClient,
  createRequest,
  INTAKE_SIGNING_ERRORS,
  IntakeAgreementBlock,
  IntakeAgreementsQuery,
  IntakeSignatureInput,
  IntakeSignatureSummary,
  IntakeSigningErrorCode,
  MAX_SIGNED_AGREEMENTS,
  PublishAgreementVersionRequest,
  type UploadFileFacts,
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
const INT_MAX = 2_147_483_647;
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
const okPublish = (change: object) =>
  PublishAgreementVersionRequest.safeParse({ ...publish, ...change }).success;
const okSign = (change: object) =>
  IntakeSignatureInput.safeParse({ ...signature, ...change }).success;

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
    expect(okPublish({})).toBe(true);
    expect(okPublish({ bodyMarkdown: 'x'.repeat(100_000) })).toBe(true);
    expect(okPublish({ bodyMarkdown: 'Tab\there\r\nand ‎marks' })).toBe(true);
    expect(okPublish({ acknowledgments: [{ ...ack, text: 'Line one\nLine two' }] })).toBe(true);
    expect(okPublish({ expectedCurrentVersion: INT_MAX })).toBe(true);
    expect(okPublish({ effectiveDate: '2026-10-01' })).toBe(true);
    const bad = [
      { bodyMarkdown: '   ' },
      { title: '' },
      { title: 'x'.repeat(201) },
      { bodyMarkdown: 'x'.repeat(100_001) },
      { acknowledgments: [ack, ack] },
      { acknowledgments: [{ ...ack, key: 'Read' }] },
      { acknowledgments: [{ ...ack, key: 'a' }] },
      { acknowledgments: [{ ...ack, key: 'a'.repeat(41) }] },
      { acknowledgments: [{ ...ack, key: '1read' }] },
      { acknowledgments: [{ ...ack, label: '' }] },
      { acknowledgments: [{ ...ack, label: 'x'.repeat(121) }] },
      { acknowledgments: [{ ...ack, text: 'x'.repeat(2001) }] },
      { acknowledgments: Array.from({ length: 9 }, (_, n) => ({ ...ack, key: `k_${n}` })) },
      { acknowledgments: [{ ...ack, extra: true }] },
      { expectedCurrentVersion: 0 },
      { expectedCurrentVersion: 2 ** 31 },
      { pdfFileId: 'nope' },
      { effectiveDate: '2026-02-30' },
      { effectiveDate: 'October 1' },
    ];
    for (const change of bad) expect(okPublish(change)).toBe(false);
  });

  it('refuses characters the database cannot store or that disguise signed text', () => {
    const bad = [
      { title: 'A\u0000B' },
      { title: 'Two\nlines' },
      { title: 'Agree‮ment' },
      { bodyMarkdown: '# T\u0000x' },
      { bodyMarkdown: 'Fee: ‮05$' },
      { bodyMarkdown: 'Half \uDC00 emoji' },
      { bodyMarkdown: 'Isolate ⁦x⁩' },
      { acknowledgments: [{ ...ack, label: 'I\u0000agree' }] },
      { acknowledgments: [{ ...ack, label: 'I agree\n\n\nto pay $500' }] },
      { acknowledgments: [{ ...ack, label: 'I ‮agree' }] },
      { acknowledgments: [{ ...ack, text: 'ok\uDC00' }] },
      { acknowledgments: [{ ...ack, text: 'ok\u0000' }] },
    ];
    for (const change of bad) expect(okPublish(change)).toBe(false);
  });

  it('takes uploadFile() facts for a small PDF with a safe name', () => {
    const file: UploadFileFacts = {
      fileName: 'Agreement.pdf',
      contentType: 'application/pdf',
      sizeBytes: 48_213,
      sha256: sha,
    };
    expect(CreateAgreementUploadRequest.safeParse(file).success).toBe(true);
    const docx: UploadFileFacts = {
      ...file,
      fileName: 'Agreement.docx',
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    };
    expect(CreateAgreementUploadRequest.safeParse(docx).success).toBe(false);
    for (const change of [
      { fileName: 'Agreement.docx' },
      { fileName: '.pdf' },
      { fileName: '../Agreement.pdf' },
      { fileName: 'Agree‮ment.pdf' },
      { contentType: 'image/png' },
      { contentType: undefined },
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
    expect(okSign({})).toBe(true);
    expect(
      okSign({ acceptLegal: { termsVersion: 2, privacyVersion: 1 }, title: 'x'.repeat(100) }),
    ).toBe(true);
    const many = Array.from({ length: MAX_SIGNED_AGREEMENTS }, (_, n) => ({
      agreementId: id(n + 1),
      version: 1,
      bodySha256: sha,
    }));
    expect(okSign({ agreements: many })).toBe(true);
  });

  it('refuses a mismatch, no agreements, duplicates and unknown fields', () => {
    const bad = [
      { signer: { ...signature.signer, typedSignature: 'Someone Else' } },
      { signer: { ...signature.signer, method: 'DRAWN' } },
      { agreements: [] },
      { agreements: [signature.agreements[0], signature.agreements[0]] },
      { agreements: [{ ...signature.agreements[0], bodySha256: 'x' }] },
      { agreements: [{ ...signature.agreements[0], version: 2 ** 31 }] },
      {
        agreements: Array.from({ length: MAX_SIGNED_AGREEMENTS + 1 }, (_, n) => ({
          agreementId: id(n + 1),
          version: 1,
          bodySha256: sha,
        })),
      },
      { acknowledgments: [{ agreementId: id(1), key: 'x' }] },
      {
        acknowledgments: Array.from({ length: 81 }, (_, n) => ({
          agreementId: id(1),
          key: `k_${n}`,
        })),
      },
      { acceptLegal: { termsVersion: 0, privacyVersion: 1 } },
      { acceptLegal: { termsVersion: 1, privacyVersion: 2 ** 31 } },
      { acceptLegal: { termsVersion: 1 } },
      { signedAt: '2026-10-09T09:00:00Z' },
      { ip: '203.0.113.9' },
    ];
    for (const change of bad) expect(okSign(change)).toBe(false);
  });

  it('limits the title to the database’s 100 characters on one line', () => {
    expect(okSign({ title: null })).toBe(true);
    expect(okSign({ title: 'x'.repeat(101) })).toBe(false);
    expect(okSign({ title: '' })).toBe(false);
    expect(okSign({ title: 'Owner\nCEO' })).toBe(false);
  });

  it('ties each ticked box to a signed agreement, once', () => {
    const tick = signature.acknowledgments[0]!;
    expect(okSign({ acknowledgments: [tick, tick] })).toBe(false);
    expect(okSign({ acknowledgments: [{ agreementId: id(7), key: 'read_agreement' }] })).toBe(
      false,
    );
    expect(okSign({ acknowledgments: [] })).toBe(true);
  });
});

describe('the block', () => {
  const block = {
    ready: true,
    agreements: [
      {
        agreementId: id(1),
        scope: 'ALL_INTAKES',
        version: 2,
        title: 'Agreement',
        effectiveDate: null,
        publishedAt: '2026-10-06T09:00:00.000Z',
        bodyMarkdown: '# A',
        bodySha256: sha,
        acknowledgments: [{ ...ack, id: 'extra fields are ignored' }],
        pdf: { available: false, sha256: null, fileName: null, sizeBytes: null },
      },
    ],
    legal: { terms: { version: 2 }, privacy: { version: 1 } },
  };

  it('parses as a plain object, with both legal versions or none', () => {
    expect(IntakeAgreementBlock.safeParse(block).success).toBe(true);
    expect(AgreementOutdatedDetails.safeParse({ ...block, legal: null }).success).toBe(true);
    expect(
      IntakeAgreementBlock.safeParse({ ...block, legal: { terms: { version: 2 }, privacy: null } })
        .success,
    ).toBe(false);
  });

  it('is keyed by a Begin Online form', () => {
    expect(IntakeAgreementsQuery.safeParse({ form: 'BOOKKEEPING' }).success).toBe(true);
    for (const query of [{}, { form: 'OTHER' }, { form: 'bookkeeping' }, { serviceId: id(3) }]) {
      expect(IntakeAgreementsQuery.safeParse(query).success).toBe(false);
    }
    expect(IntakeAgreementsQuery.safeParse({ form: 'BOOKKEEPING', serviceId: id(3) }).success).toBe(
      false,
    );
  });

  it('describes a signature with its method and answers', () => {
    const summary = {
      id: id(1),
      printedName: 'Sam Sample',
      typedSignature: 'Sam Sample',
      method: 'TYPED',
      title: null,
      signedAt: '2026-10-06T09:00:00.000Z',
      agreements: [],
      acknowledgments: [],
      legal: { termsVersion: 1, privacyVersion: 1 },
      answersSha256: sha,
      evidenceSha256: sha,
      ip: null,
      userAgent: null,
    };
    expect(IntakeSignatureSummary.safeParse(summary).success).toBe(true);
    expect(IntakeSignatureSummary.safeParse({ ...summary, method: 'INK' }).success).toBe(false);
    expect(
      IntakeSignatureSummary.safeParse({
        ...summary,
        legal: { termsVersion: 0, privacyVersion: 1 },
      }).success,
    ).toBe(false);
  });

  it('reads a version response with plain acknowledgments', () => {
    const version = {
      agreementId: id(1),
      version: 1,
      title: 'A',
      effectiveDate: null,
      publishedAt: '2026-10-06T09:00:00.000Z',
      publishedBy: null,
      pdf: null,
      bodyMarkdown: '# A',
      bodySha256: sha,
      acknowledgments: [{ ...ack, id: 'x' }],
    };
    expect(AgreementVersion.safeParse(version).success).toBe(true);
  });
});

describe('agreement errors', () => {
  it('has user text for every code', () => {
    for (const code of AgreementErrorCode.options) {
      expect(AGREEMENT_ERRORS[code].length).toBeGreaterThan(10);
    }
    for (const code of IntakeSigningErrorCode.options) {
      expect(INTAKE_SIGNING_ERRORS[code].length).toBeGreaterThan(10);
    }
  });

  it('keeps PDF_REQUIRED firm-side and uses the capture’s wording', () => {
    expect(IntakeSigningErrorCode.options).not.toContain('PDF_REQUIRED');
    expect(AgreementErrorCode.options).toContain('SERVICE_AGREEMENT_LIMIT');
    expect(INTAKE_SIGNING_ERRORS.SIGNATURE_MISMATCH).toBe('Type your name exactly as printed.');
  });
});

describe('agreements clients', () => {
  it('calls the firm routes and refuses bad input before sending', async () => {
    const { fn, calls } = fakeFetch(200, { items: [] });
    const client = createAgreementsClient(createRequest({ baseUrl: '/api/v1', fetch: fn }));
    await expect(client.list()).resolves.toEqual({ items: [] });
    expect(calls[0]?.url).toBe('/api/v1/business/agreements');
    const refused = [
      client.getVersion('not-a-uuid', 1),
      client.getVersion(id(1), 0),
      client.getVersion(id(1), 2 ** 31),
      client.create({ scope: 'SERVICE' }),
      client.publish(id(1), { ...publish, title: '' }),
      client.publish('x', publish),
      client.createUpload({ fileName: 'a.docx', sizeBytes: 1, sha256: sha } as never),
      client.file('x'),
      client.download('x'),
    ];
    for (const call of refused) await expect(call).rejects.toBeInstanceOf(ApiRequestError);
    expect(calls).toHaveLength(1);
  });

  it('sends uploadFile() facts for a PDF', async () => {
    const ticket = {
      uploadToken: 't',
      url: 'https://s3.test/x',
      method: 'PUT',
      headers: {},
      expiresAt: '2026-10-06T09:05:00.000Z',
    };
    const { fn, calls } = fakeFetch(201, ticket);
    const client = createAgreementsClient(createRequest({ baseUrl: '/api/v1', fetch: fn }));
    const facts: UploadFileFacts = {
      fileName: 'agreement.pdf',
      contentType: 'application/pdf',
      sizeBytes: 1000,
      sha256: sha,
    };
    await client.createUpload(facts);
    expect(calls[0]?.url).toBe('/api/v1/business/agreements/files/uploads');
  });

  it('reads the Begin Online block by form with a lower-cased slug', async () => {
    const block = { ready: false, agreements: [], legal: null };
    expect(IntakeAgreementBlock.parse(block)).toEqual(block);
    const { fn, calls } = fakeFetch(200, block);
    const client = createPublicAgreementsClient(
      createRequest({ baseUrl: '/api/v1', fetch: fn }),
      'LVP',
    );
    await client.block({ form: 'BOOKKEEPING' });
    expect(calls[0]?.url).toBe('/api/v1/portal/lvp/intake-agreements?form=BOOKKEEPING');
    await expect(client.block({ form: 'OTHER' } as never)).rejects.toBeInstanceOf(ApiRequestError);
    await expect(client.block({ serviceId: id(3) } as never)).rejects.toBeInstanceOf(
      ApiRequestError,
    );
    await expect(client.downloadPdf('x', 1)).rejects.toBeInstanceOf(ApiRequestError);
    await expect(client.downloadPdf(id(1), 0)).rejects.toBeInstanceOf(ApiRequestError);
    expect(calls).toHaveLength(1);
  });

  it('reads a portal intake’s block from the signed-in route', async () => {
    const block = { ready: true, agreements: [], legal: null };
    const { fn, calls } = fakeFetch(200, block);
    const client = createMyIntakeAgreementsClient(
      createRequest({ baseUrl: '/api/v1', fetch: fn }),
      'lvp',
    );
    await client.block(id(5));
    expect(calls[0]?.url).toBe(`/api/v1/portal/lvp/me/intakes/${id(5)}/agreements`);
    await expect(client.block('nope')).rejects.toBeInstanceOf(ApiRequestError);
    expect(calls).toHaveLength(1);
  });
});
