import { describe, expect, it } from 'vitest';
import {
  ANNUAL_TAX_FORM,
  ApiRequestError,
  BeginOnlineErrorCode,
  BOOKKEEPING_FORM,
  createMyIntakesClient,
  createRequest,
  INTAKE_AGREEMENT_ERRORS,
  INTAKE_CARDS,
  INTAKE_ERRORS,
  INTAKE_STATUS_LABELS,
  INTAKE_UPLOAD_STATUS,
  IntakeAgreementErrorCode,
  IntakeAgreementOutdatedDetails,
  IntakeErrorCode,
  IntakeStatus,
  intakeUploadCounts,
  MyIntake,
  ScanStatus,
  SubmitIntakeRequest,
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

/** A right-to-left override, written by code so the source stays plain ASCII. */
const RLO = String.fromCharCode(0x202e);
const id = '0199b6a8-0000-7000-8000-000000000001';
const at = '2026-10-08T09:00:00.000Z';
const intakes = (fn: typeof fetch, slug = 'lvp') =>
  createMyIntakesClient(createRequest({ baseUrl: '/api/v1', fetch: fn }), slug);
const facts = {
  fileName: 'Drivers_License.pdf',
  contentType: 'application/pdf' as const,
  sizeBytes: 120_000,
  sha256: 'b'.repeat(64),
};
const intake = {
  id,
  form: 'ANNUAL_TAX',
  title: 'Annual Tax Intake Form',
  service: { id, title: '2025 Personal Tax' },
  status: 'IN_PROGRESS',
  dueOn: '2026-10-31',
  version: 1,
  submittedAt: null,
  correction: null,
  updatedAt: at,
  definition: ANNUAL_TAX_FORM,
  taxYear: 2025,
  answers: {
    firstName: 'Avery',
    ssn: { last4: '3456' },
    spouseSsn: null,
    dependents: [{ id: 'd1', firstName: 'Riley', ssn: { last4: '4321' } }],
    businesses: [{ id: 'b1', legalName: 'Example LLC', ein: { last4: '6789' } }],
  },
  uploads: [],
  savedSteps: ['personal'],
  signature: null,
  canEdit: true,
  canSubmit: true,
};

describe('api.myIntakes(firmSlug)', () => {
  it("calls every route of the client's own intakes", async () => {
    const { fn, calls } = fakeFetch(500, {});
    const api = intakes(fn, ' LVP ');
    for (const call of [
      () => api.list(),
      () => api.get(id),
      () => api.saveStep(id, 'personal', { answers: { firstName: 'Avery', middleName: null } }),
      () => api.submit(id, { answers: { paymentPreference: 'PAY_AFTER' } }),
      () => api.createUpload(id, { slot: 'governmentId', ...facts }),
      () => api.confirmUpload(id, { uploadToken: 'token' }),
      () => api.removeUpload(id, id),
    ]) {
      await call().catch(() => undefined);
    }
    const base = `/api/v1/portal/lvp/me/intakes`;
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      `GET ${base}`,
      `GET ${base}/${id}`,
      `PUT ${base}/${id}/steps/personal`,
      `POST ${base}/${id}/submit`,
      `POST ${base}/${id}/uploads`,
      `POST ${base}/${id}/uploads/confirm`,
      `DELETE ${base}/${id}/uploads/${id}`,
    ]);
    expect(calls[3]?.body).toEqual({ answers: { paymentPreference: 'PAY_AFTER' } });
    expect(calls[6]?.body).toBeUndefined();
  });

  it('rejects bad input before sending anything', async () => {
    const { fn, calls } = fakeFetch(200, intake);
    const api = intakes(fn);
    for (const call of [
      () => api.get('not-a-uuid'),
      () => api.saveStep(id, '../steps', { answers: {} }),
      () => api.saveStep(id, 'personal', { answers: { 'not a key': 1 } }),
      () => api.saveStep(id, 'personal', { answers: {}, businessId: id } as never),
      () => api.submit(id, { answers: {}, businessId: id } as never),
      () => api.submit(id, { answers: { comments: 1 }, agreementText: 'x' } as never),
      () => api.saveStep(id, 'personal', { answers: { ssn: { last4: '12345' } } }),
      () => api.createUpload(id, { slot: 'governmentId', ...facts, fileName: 'id.exe' }),
      () => api.createUpload(id, { slot: 'governmentId', ...facts, fileName: `id${RLO}fdp.pdf` }),
      () => api.createUpload(id, { slot: 'governmentId', ...facts, sizeBytes: 11 * 1024 * 1024 }),
      () => api.createUpload(id, { slot: 'Not A Key', ...facts }),
      () => api.removeUpload(id, 'nope'),
      () => intakes(fn, '../admin').list(),
    ]) {
      await expect(call()).rejects.toMatchObject({ status: 400, code: 'VALIDATION_FAILED' });
    }
    expect(calls).toEqual([]);
  });

  it('parses an intake with its definition and masked numbers, and no agreement text', async () => {
    const { fn } = fakeFetch(200, { ...intake, agreementText: '## A form agreement' });
    const got = await intakes(fn).get(id);
    expect(got.definition.key).toBe('ANNUAL_TAX');
    expect(got.answers['ssn']).toEqual({ last4: '3456' });
    // The agreements to sign come from the firm (R14), never with the form.
    expect(got).not.toHaveProperty('agreementText');
    expect(MyIntake.safeParse({ ...intake, status: 'DONE' }).success).toBe(false);
  });

  it('a full SSN or EIN never reaches the screen: at the top level or in a group row', async () => {
    const parses = (answers: Record<string, unknown>) =>
      MyIntake.safeParse({ ...intake, answers: { ...intake.answers, ...answers } }).success;
    expect(parses({})).toBe(true);
    expect(parses({ ssn: '900123456' })).toBe(false);
    expect(parses({ spouseSsn: '900-65-4321' })).toBe(false);
    expect(parses({ dependents: [{ id: 'd1', ssn: '900-65-4321' }] })).toBe(false);
    expect(parses({ businesses: [{ id: 'b1', ein: '12-3456789' }] })).toBe(false);
    const issue = MyIntake.safeParse({ ...intake, answers: { ssn: '900123456' } }).error?.issues;
    expect(issue?.[0]).toMatchObject({
      path: ['answers'],
      message: 'A full SSN or EIN, or an answer outside the form, was returned',
    });
    const { fn } = fakeFetch(200, { ...intake, answers: { ssn: '900123456' } });
    await expect(intakes(fn).get(id)).rejects.toThrow();
  });

  it('nor in a place the definition does not type: a key or row key outside the form', () => {
    const parses = (answers: Record<string, unknown>) =>
      MyIntake.safeParse({ ...intake, answers: { ...intake.answers, ...answers } }).success;
    expect(parses({ dependents: { r1: { ssn: '123456789' } } })).toBe(false);
    expect(parses({ dependents: '123-45-6789' })).toBe(false);
    expect(parses({ oldSsn: '123-45-6789' })).toBe(false);
    expect(parses({ dependents: [{ id: 'r1', taxId: '123456789' }] })).toBe(false);
  });

  it('checks the numbers by the form: an EIN of Bookkeeping, as its definition says', () => {
    const bookkeeping = { ...intake, form: 'BOOKKEEPING', definition: BOOKKEEPING_FORM };
    expect(
      MyIntake.safeParse({ ...bookkeeping, answers: { ein: { last4: '0002' } } }).success,
    ).toBe(true);
    expect(MyIntake.safeParse({ ...bookkeeping, answers: { ein: '123456789' } }).success).toBe(
      false,
    );
  });

  it('turns an API error into ApiRequestError with its code', async () => {
    const { fn } = fakeFetch(409, { error: { code: 'INTAKE_LOCKED', message: 'Locked' } });
    const error = await intakes(fn)
      .saveStep(id, 'personal', { answers: {} })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiRequestError);
    expect(error).toMatchObject({ status: 409, code: 'INTAKE_LOCKED' });
    const { fn: outdated } = fakeFetch(409, {
      error: { code: 'AGREEMENT_OUTDATED', message: 'Outdated', details: { agreements: [] } },
    });
    await expect(intakes(outdated).submit(id, {})).rejects.toMatchObject({
      status: 409,
      code: 'AGREEMENT_OUTDATED',
    });
  });
});

describe('the submit body and its errors', () => {
  it('takes the review answers; the signature joins with R14 (until then no other key)', () => {
    expect(SubmitIntakeRequest.parse({})).toEqual({});
    expect(SubmitIntakeRequest.safeParse({ signature: { fullName: 'Avery' } }).success).toBe(false);
  });

  it('has a message for every code, the agreement codes in both modules', () => {
    expect(Object.keys(INTAKE_ERRORS).sort()).toEqual([...IntakeErrorCode.options].sort());
    expect(Object.keys(INTAKE_AGREEMENT_ERRORS).sort()).toEqual(
      [...IntakeAgreementErrorCode.options].sort(),
    );
    expect(IntakeAgreementErrorCode.options).toEqual([
      'NO_INTAKE_AGREEMENT',
      'AGREEMENT_OUTDATED',
      'ACKNOWLEDGMENT_REQUIRED',
      'SIGNATURE_MISMATCH',
      'PDF_REQUIRED',
    ]);
    for (const code of IntakeAgreementErrorCode.options) {
      expect(IntakeErrorCode.options).toContain(code);
      expect(BeginOnlineErrorCode.options).toContain(code);
    }
  });

  it("describes AGREEMENT_OUTDATED's details: each agreement's id, version and hashes", () => {
    const current = {
      agreementId: '0199b6aa-0000-7000-8000-000000000001',
      versionId: '0199b6ab-0000-7000-8000-000000000002',
      version: 2,
      bodySha256: 'c'.repeat(64),
      pdfSha256: null,
    };
    expect(IntakeAgreementOutdatedDetails.parse({ agreements: [current] }).agreements).toEqual([
      current,
    ]);
    expect(
      IntakeAgreementOutdatedDetails.safeParse({
        agreements: [{ ...current, bodySha256: 'not a hash' }],
      }).success,
    ).toBe(false);
  });
});

describe('uploads', () => {
  it('shows every scan status as CHECKING, READY or BLOCKED, never INFECTED', () => {
    expect(Object.keys(INTAKE_UPLOAD_STATUS).sort()).toEqual([...ScanStatus.options].sort());
    expect(INTAKE_UPLOAD_STATUS.INFECTED).toBe('BLOCKED');
    expect(INTAKE_UPLOAD_STATUS.FAILED).toBe('BLOCKED');
  });

  it('counts a CHECKING or READY file toward a slot, never a BLOCKED one', () => {
    const files = ScanStatus.options.map((status) => ({ slot: 'governmentId', status }));
    expect(intakeUploadCounts(files)).toEqual({ governmentId: 2 });
    expect(
      files
        .filter((f) => INTAKE_UPLOAD_STATUS[f.status] !== 'BLOCKED')
        .map((f) => f.status)
        .sort(),
    ).toEqual(['CLEAN', 'PENDING']);
  });
});

describe('the Intake Forms tab', () => {
  it('has a label for every status and a form for every card but one', () => {
    expect(Object.keys(INTAKE_STATUS_LABELS).sort()).toEqual([...IntakeStatus.options].sort());
    expect(INTAKE_CARDS).toHaveLength(7);
    expect(INTAKE_CARDS.filter((c) => c.forms.length === 0).map((c) => c.key)).toEqual([
      'OTHER_TAX',
    ]);
  });
});
