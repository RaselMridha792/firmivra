import { describe, expect, it } from 'vitest';
// The Begin Online API's own wire shapes (src/begin-online/wire.ts) until it moves to contract B.
import {
  ANNUAL_TAX_FORM,
  BUSINESS_DEVELOPMENT_FORM,
  INTAKE_FORMS,
  PAYROLL_FORM,
} from '@firmivra/types';
import {
  BeginDraft,
  beginOnlineContact,
  beginOnlineCookie,
  beginOnlineTaxYear,
  CreateDraftUploadRequest,
  ResumeDraftRequest,
  SaveDraftStepRequest,
  StartDraftRequest,
} from '../../src/begin-online/wire.js';

const id = '0199b6a0-0000-7000-8000-000000000001';
const draft = {
  leadId: id,
  service: { id, kind: 'ANNUAL_TAX', name: 'Tax Preparation' },
  definition: ANNUAL_TAX_FORM,
  taxYear: 2026,
  answers: { firstName: 'Avery', ssn: { last4: '6789' } },
  savedSteps: ['personal'],
  draftExpiresAt: '2026-11-08T09:00:00.000Z',
  uploads: [],
};
const token = 'A'.repeat(42) + '_';

describe('Begin Online API wire shapes', () => {
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

  it('a resume token is complete and comes alone', () => {
    expect(ResumeDraftRequest.safeParse({ token }).success).toBe(true);
    expect(ResumeDraftRequest.safeParse({ token: token.slice(1) }).success).toBe(false);
    expect(ResumeDraftRequest.safeParse({ token, extra: 1 }).success).toBe(false);
  });

  it("an upload names its slot and fits R5's file rules", () => {
    const file = {
      slot: 'governmentId',
      fileName: 'id.pdf',
      contentType: 'application/pdf',
      sizeBytes: 100,
      sha256: 'a'.repeat(64),
    };
    expect(CreateDraftUploadRequest.safeParse(file).success).toBe(true);
    for (const bad of [
      { ...file, slot: 'Not a key' },
      { ...file, sizeBytes: 10 * 1024 * 1024 + 1 },
      { ...file, fileName: 'id.docx' },
      { ...file, contentType: 'text/html' },
      { ...file, leadId: id },
    ]) {
      expect(CreateDraftUploadRequest.safeParse(bad).success).toBe(false);
    }
  });
});
