import { describe, expect, it } from 'vitest';
import {
  ANNUAL_TAX_FORM,
  fillIntakeText,
  INTAKE_FORMS,
  INTAKE_LIMITS,
  intakeFields,
  type IntakeField,
  type IntakeFormDefinition,
  IntakeFormDefinition as Definition,
} from '../../src/index.js';

/** The forms present (they arrive one PR at a time). */
const forms = Object.values(INTAKE_FORMS).filter((f): f is IntakeFormDefinition => !!f);
/** No invisible, direction-changing or line-separator characters in any text. */
const plainText = (value: unknown) => !/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(JSON.stringify(value));

describe('the built-in form definitions present', () => {
  it('each sits under its own key, is version 1 and passes the engine rules', () => {
    expect(INTAKE_FORMS.ANNUAL_TAX).toBe(ANNUAL_TAX_FORM);
    for (const [key, form] of Object.entries(INTAKE_FORMS)) {
      const parsed = Definition.safeParse(form);
      expect(parsed.error?.issues ?? [], key).toEqual([]);
      expect(form?.key).toBe(key);
      expect(form?.version).toBe(1);
    }
  });

  it('each ends with its review step, and carries no agreement of its own', () => {
    for (const form of forms) {
      expect(form.steps.at(-1)?.review, form.key).toBe(true);
      expect(form.steps.filter((s) => s.review)).toHaveLength(1);
      // The agreement and its acknowledgments are the firm's versioned agreements (R14).
      expect(form).not.toHaveProperty('agreement');
      expect(JSON.stringify(form)).not.toMatch(/agreeToTerms|Service Agreement/);
    }
  });

  it('each round-trips as JSON (what the database stores), with no invisible characters', () => {
    for (const form of forms) {
      expect(JSON.parse(JSON.stringify(form))).toEqual(form);
      expect(plainText(form), form.key).toBe(true);
    }
  });
});

describe('Annual Tax', () => {
  const annual = ANNUAL_TAX_FORM;
  const keys = intakeFields(annual).map((f) => f.key);

  it('has the four steps of the mockups and the contact fields Begin Online prefills', () => {
    expect(annual.steps.map((s) => s.key)).toEqual([
      'personal',
      'businessIncome',
      'documents',
      'review',
    ]);
    expect(keys).toEqual(expect.arrayContaining(['firstName', 'lastName', 'email', 'phone']));
    expect(keys).toContain('governmentId');
  });

  it('shows step 2 only for a business return, and spouse fields only when married', () => {
    expect(annual.steps[1]?.showIf).toEqual({
      field: 'returnTypes',
      includesAny: ['BUSINESS', 'BOTH'],
    });
    const spouse = annual.steps[0]?.sections.find((s) => s.key === 'spouse');
    expect(spouse?.showIf).toEqual({
      field: 'filingStatus',
      oneOf: ['MARRIED_FILING_JOINTLY', 'MARRIED_FILING_SEPARATELY'],
    });
  });
});

describe('the definition rules', () => {
  const base = ANNUAL_TAX_FORM;
  const withField = (field: IntakeField) => ({
    ...base,
    steps: [
      {
        ...base.steps[0]!,
        sections: [{ key: 'extra', title: 'Extra', fields: [field] }, ...base.steps[0]!.sections],
      },
      ...base.steps.slice(1),
    ],
  });
  const passes = (definition: unknown) => Definition.safeParse(definition).success;

  it('refuses a repeated key, a condition on a later or unknown field, and a bad option', () => {
    const text = { key: 'firstName', type: 'text', label: 'x', required: false, maxLength: 10 };
    expect(passes(withField(text as IntakeField))).toBe(false);
    const later = { ...text, key: 'early', showIf: { field: 'armedForces', equals: true } };
    expect(passes(withField(later as IntakeField))).toBe(false);
    const unknown = { ...text, key: 'early', showIf: { field: 'nowhere', equals: true } };
    expect(passes(withField(unknown as IntakeField))).toBe(false);
    const radio = {
      key: 'pick',
      type: 'radio',
      label: 'x',
      required: false,
      options: [
        { value: 'A', label: 'A' },
        { value: 'A', label: 'B' },
      ],
    };
    expect(passes(withField(radio as IntakeField))).toBe(false);
  });

  it('refuses a review step that is not last, and keys that are not camelCase or are reserved', () => {
    const steps = [...base.steps];
    steps[0] = { ...steps[0]!, review: true };
    expect(passes({ ...base, steps })).toBe(false);
    for (const key of ['Bad-Key', 'constructor', 'prototype', '__proto__']) {
      const field = { key, type: 'yesNo', label: 'x', required: false };
      expect([key, passes(withField(field as IntakeField))]).toEqual([key, false]);
    }
  });

  it('caps a form at 200 fields, counting the fields of its groups', () => {
    const yesNo = (key: string) => ({ key, type: 'yesNo', label: key, required: false });
    const section = (key: string, from: number, count: number) => ({
      key,
      title: key,
      fields: Array.from({ length: count }, (_, i) => yesNo(`f${String(from + i)}`)),
    });
    const group = (count: number) => ({
      key: 'rows',
      type: 'group',
      label: 'Rows',
      required: false,
      minItems: 0,
      maxItems: 2,
      itemLabel: 'Row',
      addLabel: 'Add',
      fields: Array.from({ length: count }, (_, i) => yesNo(`g${String(i)}`)),
    });
    const form = (second: number, groupFields = 0) => ({
      ...base,
      steps: [
        {
          key: 'one',
          title: 'One',
          review: false,
          sections: [section('a', 0, 100), section('b', 100, second)],
        },
        {
          key: 'review',
          title: 'Review',
          review: true,
          sections: [
            {
              key: 'c',
              title: 'C',
              fields: [groupFields ? group(groupFields) : yesNo('last')],
            },
          ],
        },
      ],
    });
    expect(INTAKE_LIMITS.maxFields).toBe(200);
    expect(passes(form(99))).toBe(true);
    expect(passes(form(100))).toBe(false);
    // A group and its own fields: 100 + 90 + 1 + 9 = 200, then 201.
    expect(passes(form(90, 9))).toBe(true);
    expect(passes(form(90, 10))).toBe(false);
    expect(Definition.safeParse(form(100)).error?.issues[0]?.message).toBe(
      'A form has at most 200 fields',
    );
  });

  it('bounds labels at 300 characters, help and texts at 500, option labels at 200', () => {
    const long = (n: number) => 'x'.repeat(n);
    const text = { key: 'extra', type: 'text', label: 'x', required: false, maxLength: 10 };
    expect(passes(withField({ ...text, label: long(300) } as IntakeField))).toBe(true);
    expect(passes(withField({ ...text, label: long(301) } as IntakeField))).toBe(false);
    expect(passes(withField({ ...text, help: long(500) } as IntakeField))).toBe(true);
    expect(passes(withField({ ...text, help: long(501) } as IntakeField))).toBe(false);
    const info = { key: 'extra', type: 'info', label: 'x', required: false };
    expect(passes(withField({ ...info, text: long(500) } as IntakeField))).toBe(true);
    expect(passes(withField({ ...info, text: long(501) } as IntakeField))).toBe(false);
    const radio = (label: string) => ({
      key: 'extra',
      type: 'radio',
      label: 'x',
      required: false,
      options: [
        { value: 'A', label },
        { value: 'B', label: 'B' },
      ],
    });
    expect(passes(withField(radio(long(200)) as IntakeField))).toBe(true);
    expect(passes(withField(radio(long(201)) as IntakeField))).toBe(false);
    expect(passes({ ...base, title: long(301) })).toBe(false);
  });

  it('fills {taxYear} and {firmName}, and leaves a missing one as it is', () => {
    expect(fillIntakeText('Income in {taxYear} at {firmName}', { taxYear: 2026 })).toBe(
      'Income in 2026 at {firmName}',
    );
    expect(fillIntakeText('How did you hear about {firmName}?', { firmName: 'LVP' })).toBe(
      'How did you hear about LVP?',
    );
  });
});
