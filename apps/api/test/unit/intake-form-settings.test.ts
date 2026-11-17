// Intake Forms Review 2 23-h: what the client's page gets of a form's settings. With Allow file
// uploads off, no upload question (a section left empty goes, a step left empty goes, never the
// review step); Show progress bar off hides the stepper. Built-in forms, synthetic only.
import { INTAKE_FORMS } from '@firmivra/types';
import { describe, expect, it } from 'vitest';
import { readDefinition, showsProgressBar } from '../../src/intake/intake-forms.js';

const tax = INTAKE_FORMS.ANNUAL_TAX!;
const fieldsOf = (d: ReturnType<typeof readDefinition>) =>
  d.steps.flatMap((s) => s.sections.flatMap((sec) => sec.fields));
const withSettings = (formSettings: Record<string, unknown> | undefined) => ({
  version: 3,
  definition: { ...tax, ...(formSettings ? { formSettings } : {}) },
});

describe('readDefinition and the form settings (23-h)', () => {
  it('keeps the upload questions unless Allow file uploads is off', () => {
    for (const settings of [undefined, {}, { allowFileUploads: true }]) {
      const d = readDefinition(withSettings(settings), 'ANNUAL_TAX');
      expect(fieldsOf(d).some((f) => f.type === 'upload')).toBe(true);
      expect(d).toMatchObject({ key: 'ANNUAL_TAX', version: 3 });
    }
  });

  it('with uploads off: no upload question, no empty section or step, the review step kept', () => {
    const d = readDefinition(withSettings({ allowFileUploads: false }), 'ANNUAL_TAX');
    expect(fieldsOf(d).filter((f) => f.type === 'upload')).toEqual([]);
    for (const step of d.steps) {
      if (!step.review) expect(step.sections.length).toBeGreaterThan(0);
      for (const section of step.sections) expect(section.fields.length).toBeGreaterThan(0);
    }
    expect(d.steps.at(-1)?.review).toBe(true);
    // Everything else stays: the same questions but the uploads.
    const all = fieldsOf(readDefinition(withSettings(undefined), 'ANNUAL_TAX'));
    expect(fieldsOf(d).map((f) => f.key)).toEqual(
      all.filter((f) => f.type !== 'upload').map((f) => f.key),
    );
  });

  it('shows the progress bar unless the form turned it off', () => {
    expect(showsProgressBar(tax)).toBe(true);
    expect(showsProgressBar(withSettings({ showProgressBar: true }).definition)).toBe(true);
    expect(showsProgressBar(withSettings({ showProgressBar: false }).definition)).toBe(false);
    expect(showsProgressBar(null)).toBe(true);
  });
});
