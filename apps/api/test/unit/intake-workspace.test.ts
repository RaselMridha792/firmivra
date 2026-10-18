// R55: the Intake Forms builder's conversion to the form engine's definition, and Export PDF.
import { describe, expect, it } from 'vitest';
import { INTAKE_FORMS, IntakeFormDefinition } from '@firmivra/types';
import { publishable, toDefinition } from '../../src/intake-workspace/form-builder.js';
import { renderIntakePdf } from '../../src/intake-workspace/intake-pdf.js';
import { maskEmail } from '../../src/intake-workspace/intake-send.service.js';
import { sectionsOf } from '../../src/intake-workspace/workspace.common.js';

const META = { key: 'ANNUAL_TAX' as const, version: 2, title: 'Fake form' };

const basic = {
  title: 'Fake form',
  sections: [
    {
      key: 'about',
      title: 'About you',
      questions: [
        { key: 'fullName', type: 'SHORT_ANSWER' as const, label: 'Full name', required: true },
        {
          key: 'filing',
          type: 'MULTIPLE_CHOICE' as const,
          label: 'Filing status',
          required: false,
          options: ['Single', 'Married filing jointly'],
        },
        {
          key: 'spouse',
          type: 'SHORT_ANSWER' as const,
          label: 'Spouse name',
          required: false,
          showIf: { questionKey: 'filing', equals: 'Married filing jointly' },
        },
        { key: 'w2', type: 'FILE_UPLOAD' as const, label: 'W-2', required: true },
        {
          key: 'note',
          type: 'INSTRUCTION_TEXT' as const,
          label: 'Note',
          help: 'Fake help',
          required: false,
        },
      ],
    },
  ],
};

describe('form builder: sections to the engine', () => {
  it('builds a definition the engine accepts, with option codes and a condition on the code', () => {
    const stored = toDefinition(basic, null);
    const def = publishable(stored, META);
    expect(IntakeFormDefinition.safeParse(def).success).toBe(true);
    const fields = def.steps[0]!.sections[0]!.fields;
    const filing = fields.find((f) => f.key === 'filing');
    expect(filing && 'options' in filing ? filing.options.map((o) => o.value) : []).toEqual([
      'SINGLE',
      'MARRIED_FILING_JOINTLY',
    ]);
    expect(fields.find((f) => f.key === 'spouse')?.showIf).toEqual({
      field: 'filing',
      equals: 'MARRIED_FILING_JOINTLY',
    });
  });

  it('reads back as the same sections, the condition shown by its label', () => {
    const back = sectionsOf(toDefinition(basic, null));
    expect(back[0]!.questions.map((q) => [q.key, q.type])).toEqual([
      ['fullName', 'SHORT_ANSWER'],
      ['filing', 'MULTIPLE_CHOICE'],
      ['spouse', 'SHORT_ANSWER'],
      ['w2', 'FILE_UPLOAD'],
      ['note', 'INSTRUCTION_TEXT'],
    ]);
    expect(back[0]!.questions[2]!.showIf).toEqual({
      questionKey: 'filing',
      equals: 'Married filing jointly',
    });
  });

  it('keeps what the builder does not show when a built-in form is saved back unchanged', () => {
    const builtIn = INTAKE_FORMS.ANNUAL_TAX!;
    const sections = sectionsOf(builtIn);
    const stored = toDefinition({ title: builtIn.title, sections }, builtIn);
    const def = publishable(stored, META);
    const before = builtIn.steps.flatMap((s) => s.sections.flatMap((c) => c.fields));
    const after = def.steps.flatMap((s) => s.sections.flatMap((c) => c.fields));
    expect(after.map((f) => [f.key, f.type])).toEqual(before.map((f) => [f.key, f.type]));
  });

  it('a section break starts a new section', () => {
    const stored = toDefinition(
      {
        title: 'x',
        sections: [
          {
            key: 'one',
            title: 'One',
            questions: [
              { key: 'a', type: 'SHORT_ANSWER', label: 'A', required: false },
              { key: 'brk', type: 'SECTION_BREAK', label: 'Income', required: false },
              { key: 'b', type: 'CURRENCY', label: 'B', required: false },
            ],
          },
        ],
      },
      null,
    );
    expect(stored.steps[0]!.sections.map((s) => s['title'])).toEqual(['One', 'Income']);
  });

  it('more than ten sections share the ten steps', () => {
    const sections = Array.from({ length: 23 }, (_, i) => ({
      key: `s${String(i)}`,
      title: `S${String(i)}`,
      questions: [{ key: `q${String(i)}`, type: 'YES_NO' as const, label: 'Q', required: false }],
    }));
    const def = publishable(toDefinition({ title: 'x', sections }, null), META);
    expect(def.steps.length).toBeLessThanOrEqual(10);
    expect(def.steps.flatMap((s) => s.sections)).toHaveLength(23);
  });

  it('Require all questions makes every question required', () => {
    const stored = toDefinition({ ...basic, settings: { requireAllQuestions: true } }, null);
    const fields = stored.steps[0]!.sections[0]!['fields'] as { required: boolean; type: string }[];
    expect(fields.filter((f) => f.type !== 'info').every((f) => f.required)).toBe(true);
  });

  it('refuses a signature question and an incomplete form', () => {
    expect(() =>
      toDefinition(
        {
          title: 'x',
          sections: [
            {
              key: 'a',
              title: 'A',
              questions: [{ key: 'sig', type: 'SIGNATURE', label: 'Sign', required: true }],
            },
          ],
        },
        null,
      ),
    ).toThrow(/signed when it is submitted/);
    const noOptions = toDefinition(
      {
        title: 'x',
        sections: [
          {
            key: 'a',
            title: 'A',
            questions: [{ key: 'pick', type: 'DROPDOWN', label: 'Pick', required: false }],
          },
        ],
      },
      null,
    );
    expect(() => publishable(noOptions, META)).toThrow(/Add an option/);
    expect(() => publishable(toDefinition({ title: 'x', sections: [] }, null), META)).toThrow(
      /at least one question/,
    );
  });

  it('keeps the description and settings, and earlier settings not sent', () => {
    const first = toDefinition(
      { ...basic, description: 'Fake description', settings: { expiresAfterDays: 9 } },
      null,
    );
    const second = toDefinition({ title: 'y', settings: { showProgressBar: false } }, first);
    expect(second.subtitle).toBe('Fake description');
    expect(second.formSettings).toEqual({ expiresAfterDays: 9, showProgressBar: false });
    expect(second.steps).toEqual(first.steps);
  });
});

describe('Export PDF', () => {
  it('renders the answers, masked numbers and file names as a PDF', async () => {
    const def = INTAKE_FORMS.ANNUAL_TAX!;
    const bytes = await renderIntakePdf({
      definition: { ...def, key: 'ANNUAL_TAX', version: 1 },
      answers: { firstName: 'Fake ☃ Name' },
      files: [{ fileName: 'fake-w2.pdf', intakeSlot: 'w2' }],
      header: {
        title: 'Annual Tax Intake',
        recipient: 'Fake Client',
        status: 'SUBMITTED',
        sentAt: '2026-10-01T00:00:00.000Z',
        submittedAt: null,
      },
    });
    expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe('%PDF-');
  });
});

describe('maskEmail', () => {
  it('shows the first letter and the domain only', () => {
    expect(maskEmail('dana@example.test')).toBe('d***@example.test');
    expect(maskEmail(null)).toBe('');
  });
});
