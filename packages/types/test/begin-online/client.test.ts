import { describe, expect, it } from 'vitest';
import {
  ANNUAL_TAX_FORM,
  BEGIN_ONLINE_ERRORS,
  BEGIN_ONLINE_FORM_ORDER,
  BEGIN_ONLINE_LIMITS,
  BEGIN_ONLINE_SERVICES,
  BeginDraft,
  BeginOnlineErrorCode,
  BeginOnlineForm,
  beginOnlineFormOfPath,
  beginOnlinePrefill,
  createBeginOnlineClient,
  createRequest,
  INTAKE_FORMS,
  IntakeFormKey,
  resumeTokenFromHash,
  StartBeginDraftRequest,
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

const id = '0199b6a9-0000-7000-8000-000000000001';
const at = '2026-10-08T09:00:00.000Z';
const token = 'A'.repeat(40) + '_-9';
const begin = (fn: typeof fetch, slug = 'lvp') =>
  createBeginOnlineClient(createRequest({ baseUrl: '/api/v1', fetch: fn }), slug);
/** A Begin Online signature: one agreement, and the Terms and Privacy the block's legal named. */
const signature = {
  agreements: [
    { agreementId: '0199b6a5-0001-7000-8000-000000000001', version: 3, bodySha256: 'c'.repeat(64) },
  ],
  acknowledgments: [],
  acceptLegal: { termsVersion: 2, privacyVersion: 1 },
  signer: {
    printedName: 'Avery Example',
    method: 'TYPED' as const,
    typedSignature: 'Avery Example',
  },
};
const facts = {
  fileName: 'W-2_2025.pdf',
  contentType: 'application/pdf' as const,
  sizeBytes: 182_400,
  sha256: 'a'.repeat(64),
};
const draft = {
  form: 'ANNUAL_TAX',
  version: 1,
  title: 'Annual Tax Intake Form',
  definition: ANNUAL_TAX_FORM,
  taxYear: 2026,
  contact: { firstName: 'Avery', lastName: 'Example', email: 'avery@lvp.test', phone: null },
  answers: { firstName: 'Avery', lastName: 'Example', email: 'avery@lvp.test' },
  uploads: [],
  savedSteps: [],
  expiresAt: '2026-11-07T09:00:00.000Z',
  updatedAt: at,
};

describe('api.beginOnline(firmSlug)', () => {
  it('calls every route on the firm portal, by the service page path', async () => {
    const { fn, calls } = fakeFetch(500, {});
    const api = begin(fn, 'LVP');
    for (const call of [
      () => api.forms(),
      () => api.form('QUARTERLY_TAX'),
      () =>
        api.start('ANNUAL_TAX', {
          firstName: 'Avery',
          lastName: 'Example',
          email: 'Avery@LVP.test',
        }),
      () => api.get('BUSINESS_DEVELOPMENT'),
      () => api.saveStep('TAX_PLANNING', 'profile', { answers: { fullName: 'Avery Example' } }),
      () => api.emailResumeLink({ email: 'avery@lvp.test' }),
      () => api.resume({ token }),
      () => api.uploads('BOOKKEEPING'),
      () => api.createUpload('BOOKKEEPING', { slot: 'einDocument', ...facts }),
      () => api.confirmUpload('BOOKKEEPING', { uploadToken: 'token' }),
      () => api.removeUpload('BOOKKEEPING', id),
      () => api.submit('PAYROLL', { answers: { additionalInformation: 'Thanks' }, signature }),
    ]) {
      await call().catch(() => undefined);
    }
    const base = '/api/v1/portal/lvp/begin';
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      `GET ${base}/forms`,
      `GET ${base}/forms/quarterly-tax`,
      `POST ${base}/annual-tax/draft`,
      `GET ${base}/business-development/draft`,
      `PUT ${base}/tax-planning/draft/steps/profile`,
      `POST ${base}/resume-link`,
      `POST ${base}/resume`,
      `GET ${base}/bookkeeping/draft/uploads`,
      `POST ${base}/bookkeeping/draft/uploads`,
      `POST ${base}/bookkeeping/draft/uploads/confirm`,
      `DELETE ${base}/bookkeeping/draft/uploads/${id}`,
      `POST ${base}/payroll/draft/submit`,
    ]);
    // The email is stored lower-case; an empty phone is no phone.
    expect(calls[2]?.body).toEqual({
      firstName: 'Avery',
      lastName: 'Example',
      email: 'avery@lvp.test',
    });
    // The resume token travels in the body only, never in a URL.
    expect(calls[6]?.body).toEqual({ token });
    expect(calls.some((c) => c.url.includes(token))).toBe(false);
    expect(calls[11]?.body).toEqual({ answers: { additionalInformation: 'Thanks' }, signature });
  });

  it('rejects bad input before sending anything', async () => {
    const { fn, calls } = fakeFetch(200, draft);
    const api = begin(fn);
    for (const call of [
      () => api.form('OTHER' as never),
      () => api.start('ANNUAL_TAX', { firstName: '', lastName: 'Example', email: 'a@lvp.test' }),
      () => api.start('ANNUAL_TAX', { firstName: 'A', lastName: 'B', email: 'not-an-email' }),
      () =>
        api.start('ANNUAL_TAX', {
          firstName: 'A',
          lastName: 'B',
          email: 'a@lvp.test',
          ssn: '1',
        } as never),
      () => api.saveStep('ANNUAL_TAX', 'Personal Step', { answers: {} }),
      () => api.resume({ token: 'short' }),
      () => api.emailResumeLink({ email: '' }),
      () => api.createUpload('ANNUAL_TAX', { slot: 'governmentId', ...facts, fileName: 'W-2.png' }),
      () => api.submit('ANNUAL_TAX', { answers: {}, signature, leadId: id } as never),
      () => api.submit('ANNUAL_TAX', { answers: {} } as never),
      () => begin(fn, 'a b').forms(),
    ]) {
      await expect(call()).rejects.toMatchObject({ status: 400, code: 'VALIDATION_FAILED' });
    }
    expect(calls).toEqual([]);
  });

  it('refuses a draft with a full SSN or EIN, at the top level or in a group row', () => {
    const masked = { ...draft, answers: { ...draft.answers, ssn: { last4: '3456' } } };
    expect(BeginDraft.safeParse(masked).success).toBe(true);
    expect(BeginDraft.safeParse({ ...masked, answers: { ssn: '900123456' } }).success).toBe(false);
    const row = { dependents: [{ id: 'd1', firstName: 'Riley', ssn: '900654321' }] };
    expect(BeginDraft.safeParse({ ...masked, answers: row }).success).toBe(false);
    const business = { businesses: [{ id: 'b1', ein: '12-3456789' }] };
    expect(BeginDraft.safeParse({ ...masked, answers: business }).success).toBe(false);
  });

  it('refuses a draft whose answers have a key or a group row the form does not have', () => {
    const parses = (answers: Record<string, unknown>) =>
      BeginDraft.safeParse({ ...draft, answers: { ...draft.answers, ...answers } }).success;
    expect(parses({})).toBe(true);
    expect(parses({ dependents: { r1: { ssn: '123456789' } } })).toBe(false);
    expect(parses({ dependents: '123-45-6789' })).toBe(false);
    expect(parses({ oldSsn: '123-45-6789' })).toBe(false);
    expect(parses({ dependents: [{ id: 'r1', taxId: '123456789' }] })).toBe(false);
  });

  it("prefills the form's contact fields, each only when it fits its field", () => {
    const contact = { firstName: 'Avery', lastName: 'Example', email: 'avery@lvp.test' };
    expect(beginOnlinePrefill(ANNUAL_TAX_FORM, { ...contact, phone: '+14045550147' })).toEqual({
      ...contact,
      phone: '+14045550147',
    });
    const quarterly = INTAKE_FORMS.QUARTERLY_TAX!;
    expect(beginOnlinePrefill(quarterly, { ...contact, phone: null })).toEqual({
      fullName: 'Avery Example',
      email: 'avery@lvp.test',
    });
    // Two names of 100 characters join to 201, over the field's 200: left out, not refused later.
    const long = { ...contact, firstName: 'A'.repeat(100), lastName: 'B'.repeat(100) };
    expect(beginOnlinePrefill(quarterly, long)).toEqual({ email: 'avery@lvp.test' });
  });

  it('parses a draft without the form carrying an agreement; phone is optional', () => {
    const parsed = BeginDraft.parse({ ...draft, agreementText: '## A form agreement' });
    expect(parsed.contact.email).toBe('avery@lvp.test');
    expect(parsed).not.toHaveProperty('agreementText');
    expect(BeginOnlineForm.parse({ ...draft, agreementText: 'x' })).not.toHaveProperty(
      'agreementText',
    );
    expect(
      StartBeginDraftRequest.parse({
        firstName: 'A',
        lastName: 'B',
        email: 'a@lvp.test',
        phone: '',
      }),
    ).toEqual({ firstName: 'A', lastName: 'B', email: 'a@lvp.test', phone: null });
  });

  it('reads the token from the link fragment only when it is a whole token', () => {
    expect(resumeTokenFromHash(`#token=${token}`)).toBe(token);
    expect(resumeTokenFromHash(`token=${token}`)).toBe(token);
    expect(resumeTokenFromHash('#token=abc')).toBeNull();
    expect(resumeTokenFromHash('')).toBeNull();
  });

  it("lists the services in the page's order, not IntakeFormKey's", () => {
    expect(BEGIN_ONLINE_FORM_ORDER).toEqual([
      'ANNUAL_TAX',
      'BOOKKEEPING',
      'PAYROLL',
      'BUSINESS_DEVELOPMENT',
      'QUARTERLY_TAX',
      'TAX_PLANNING',
    ]);
    expect([...BEGIN_ONLINE_FORM_ORDER].sort()).toEqual([...IntakeFormKey.options].sort());
  });

  it('maps every service to a unique page path and back; a message for every code', () => {
    const paths = IntakeFormKey.options.map((key) => BEGIN_ONLINE_SERVICES[key].path);
    expect(new Set(paths).size).toBe(6);
    for (const key of IntakeFormKey.options) {
      expect(beginOnlineFormOfPath(BEGIN_ONLINE_SERVICES[key].path)).toBe(key);
    }
    expect(beginOnlineFormOfPath('resume')).toBeNull();
    expect(Object.keys(BEGIN_ONLINE_ERRORS).sort()).toEqual(
      [...BeginOnlineErrorCode.options].sort(),
    );
    expect(BeginOnlineErrorCode.options).toContain('TERMS_OUTDATED');
    expect(BEGIN_ONLINE_LIMITS).toEqual({ draftDays: 30, maxDraftDays: 90 });
  });
});
