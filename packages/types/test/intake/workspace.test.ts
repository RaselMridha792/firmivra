import { describe, expect, it } from 'vitest';
import {
  createIntakeFormsClient,
  createRequest,
  INTAKE_FILE_SIZE_CHOICES,
  INTAKE_MAX_FILE_SIZE_MB,
  SaveIntakeFormRequest,
  SendIntakeFormRequest,
  UpdateIntakeSettingsRequest,
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

const id = '0199c0d0-0a00-7000-8000-000000000001';
const client = (fn: typeof fetch) =>
  createIntakeFormsClient(createRequest({ baseUrl: '/api/v1', fetch: fn }));

describe('api.intakeForms', () => {
  it('lists a status tab', async () => {
    const { fn, calls } = fakeFetch(200, { items: [], total: 0, page: 1, pageSize: 8 });
    await client(fn).list({ tab: 'submitted', search: 'tax' });
    expect(calls[0]?.url).toBe(
      '/api/v1/business/intakes?tab=submitted&search=tax&page=1&pageSize=8',
    );
  });

  it('sends to a client, a lead or a new contact, with safe defaults', () => {
    const base = {
      idempotencyKey: '0199c0d0-1111-7000-8000-000000000001',
      formId: id,
      channel: 'EMAIL' as const,
      subject: 'Your Personal Tax Intake Form',
      message: 'Please complete it.',
    };
    const parsed = SendIntakeFormRequest.parse({ ...base, recipient: { kind: 'CLIENT', id } });
    expect(parsed).toMatchObject({ allowSaveAndContinue: true, sendMeCopy: false });
    const contact = { kind: 'NEW_CONTACT', name: 'Pat', email: 'pat@example.test' };
    expect(SendIntakeFormRequest.safeParse({ ...base, recipient: contact }).success).toBe(true);
    expect(
      SendIntakeFormRequest.safeParse({ ...base, recipient: { kind: 'CLIENT' } }).success,
    ).toBe(false);
  });

  it('builds sections of questions with valid keys', () => {
    const question = { key: 'fullName', type: 'SHORT_ANSWER', label: 'Full name' };
    const form = (key: string) => ({
      name: 'Personal Tax Intake Form',
      category: 'PERSONAL_TAX',
      sections: [
        { key: 'personal', title: 'Personal Information', questions: [{ ...question, key }] },
      ],
    });
    expect(
      SaveIntakeFormRequest.parse(form('fullName')).sections?.[0]?.questions[0]?.required,
    ).toBe(false);
    expect(SaveIntakeFormRequest.safeParse(form('__proto__')).success).toBe(false);
  });

  it('keeps encryption on: settings have no switch for it', () => {
    const off = { version: 'v1', security: { encryptedUploads: false } };
    expect(UpdateIntakeSettingsRequest.safeParse(off).success).toBe(false);
    const size = { version: 'v1', security: { maxFileSizeMb: 20 } };
    expect(UpdateIntakeSettingsRequest.safeParse(size).success).toBe(true);
  });

  it("offers 2, 5, 10, 50 and 100 MB per file (I10); the contract still takes a firm's older size", () => {
    expect(INTAKE_FILE_SIZE_CHOICES).toEqual([2, 5, 10, 50, 100]);
    expect(Math.max(...INTAKE_FILE_SIZE_CHOICES)).toBe(INTAKE_MAX_FILE_SIZE_MB);
    const save = (maxFileSizeMb: number) =>
      UpdateIntakeSettingsRequest.safeParse({ version: 'v1', security: { maxFileSizeMb } }).success;
    // A saved 25 MB is sent back as it is; the API decides which sizes a change may take.
    for (const mb of [...INTAKE_FILE_SIZE_CHOICES, 25]) expect(save(mb)).toBe(true);
    for (const mb of [0, 2.5, INTAKE_MAX_FILE_SIZE_MB + 1]) expect(save(mb)).toBe(false);
  });

  it('marks reviewed through R11 complete and reads R11 answers', async () => {
    const { fn, calls } = fakeFetch(500, {});
    await client(fn)
      .markReviewed(id)
      .catch(() => undefined);
    await client(fn)
      .responses(id)
      .catch(() => undefined);
    expect(calls.map((c) => c.url)).toEqual([
      `/api/v1/business/intakes/${id}/complete`,
      `/api/v1/business/intakes/${id}`,
    ]);
  });
});
