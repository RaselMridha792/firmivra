import { describe, expect, it } from 'vitest';
import {
  ANNUAL_TAX_FORM,
  BeginDraft,
  beginOnlineContact,
  beginOnlineCookie,
  beginOnlineTaxYear,
  BUSINESS_DEVELOPMENT_FORM,
  createBeginOnlineClient,
  createRequest,
  INTAKE_FORMS,
  PAYROLL_FORM,
  SaveDraftStepRequest,
  StartDraftRequest,
} from '../../src/index.js';

function fakeFetch(body: unknown) {
  const calls: { url: string; method: string; body: unknown }[] = [];
  const fn = (async (url: string, init: RequestInit) => {
    calls.push({
      url,
      method: init.method ?? 'GET',
      body: init.body === undefined ? undefined : JSON.parse(init.body as string),
    });
    return new Response(JSON.stringify(body), { status: 200 });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const id = '0199b6a0-0000-7000-8000-000000000001';
const draft = {
  leadId: id,
  service: { id, kind: 'ANNUAL_TAX', name: 'Tax Preparation' },
  definition: ANNUAL_TAX_FORM,
  taxYear: 2026,
  answers: { firstName: 'Avery', ssn: { last4: '6789' } },
  savedSteps: ['personal'],
  draftExpiresAt: '2026-11-08T09:00:00.000Z',
};

describe('Begin Online contract', () => {
  it('a draft never carries a full SSN or EIN', () => {
    expect(BeginDraft.safeParse(draft).success).toBe(true);
    const full = { ...draft, answers: { ...draft.answers, ssn: '123456789' } };
    expect(BeginDraft.safeParse(full).success).toBe(false);
  });

  it('requests are strict and take only keys and answers', () => {
    const start = { serviceId: id, step: 'personal', answers: { firstName: 'Avery' } };
    expect(StartDraftRequest.safeParse(start).success).toBe(true);
    expect(StartDraftRequest.safeParse({ ...start, businessId: id }).success).toBe(false);
    expect(StartDraftRequest.safeParse({ ...start, step: 'Not a key' }).success).toBe(false);
    expect(StartDraftRequest.safeParse({ ...start, serviceId: 'x' }).success).toBe(false);
    expect(
      SaveDraftStepRequest.safeParse({ answers: JSON.parse('{"__proto__":{"x":1}}') }).success,
    ).toBe(false);
  });

  it('reads the contact from the first step of every built-in form', () => {
    for (const definition of Object.values(INTAKE_FORMS)) {
      const { issues } = beginOnlineContact(definition, {});
      const keys = definition.steps[0]!.sections.flatMap((s) => s.fields.map((f) => f.key));
      const names = keys.includes('fullName') ? ['fullName'] : ['firstName', 'lastName'];
      expect(issues.map((i) => i.path[0]).sort()).toEqual(['email', 'phone', ...names].sort());
      expect(issues.every((i) => i.step === definition.steps[0]?.key)).toBe(true);
    }
    const payroll = beginOnlineContact(PAYROLL_FORM, {
      fullName: '  Avery  Jordan Sample ',
      email: 'a@example.com',
      phone: '+17705550100',
    });
    expect(payroll).toEqual({
      issues: [],
      contact: {
        firstName: 'Avery Jordan',
        lastName: 'Sample',
        email: 'a@example.com',
        phone: '+17705550100',
      },
    });
    const one = beginOnlineContact(PAYROLL_FORM, {
      fullName: 'Avery',
      email: 'a@x.co',
      phone: '1',
    });
    expect(one.issues.map((i) => i.message)).toEqual(['Enter your first and last name']);
  });

  it('fixes a tax year only for tax services', () => {
    expect(beginOnlineTaxYear(ANNUAL_TAX_FORM, '2026-10-09')).toBe(2026);
    expect(beginOnlineTaxYear(BUSINESS_DEVELOPMENT_FORM, '2026-10-09')).toBeNull();
  });

  it('names the cookie per firm, on the Begin Online routes only', () => {
    expect(beginOnlineCookie('LVP')).toEqual({
      name: 'fv_bo_lvp',
      path: '/api/v1/portal/lvp/begin-online',
    });
  });

  it('calls the routes under the firm slug', async () => {
    const { fn, calls } = fakeFetch(draft);
    const api = createBeginOnlineClient(createRequest({ baseUrl: '/api/v1', fetch: fn }), 'lvp');
    await api.current();
    await api.saveStep('personal', { answers: {} });
    await api.startDraft({ serviceId: id, step: 'personal', answers: {} });
    await expect(api.saveStep('../x', { answers: {} })).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      'GET /api/v1/portal/lvp/begin-online/drafts/current',
      'PUT /api/v1/portal/lvp/begin-online/drafts/current/steps/personal',
      'POST /api/v1/portal/lvp/begin-online/drafts',
    ]);
  });
});
