import type { IntakeFormDetail } from '@firmivra/types';
import { describe, expect, it } from 'vitest';
import { blankQuestion, checkDraft, fromDetail } from './builder-draft';

/**
 * A saved form as the builder gets it: a State list the engine fills (a dropdown with no choices)
 * and, at the end of the section, a grid (shown as a section break).
 */
const saved = {
  id: '0199c0d0-0f00-7000-8000-000000000001',
  name: 'Annual Tax intake',
  category: 'PERSONAL_TAX',
  service: { id: '0199c0d0-5e00-7000-8000-000000000001', name: 'Individual Tax' },
  description: null,
  isTemplate: true,
  custom: false,
  status: 'PUBLISHED',
  questionCount: 3,
  usageCount: 0,
  lastUsedAt: null,
  updatedAt: '2026-10-23T09:00:00.000Z',
  owner: null,
  internalNotes: null,
  sections: [
    {
      key: 'wages',
      title: 'Wages',
      description: null,
      questions: [
        { key: 'employer', type: 'SHORT_ANSWER', label: 'Employer', help: null, required: true },
        { key: 'state', type: 'DROPDOWN', label: 'State', help: null, required: true },
        { key: 'w2Grid', type: 'SECTION_BREAK', label: 'W-2 forms', help: null, required: false },
      ],
    },
  ],
  settings: {
    requireAllQuestions: false,
    allowFileUploads: true,
    requireSignature: true,
    showProgressBar: true,
    expiresAfterDays: 14,
    successMessage: null,
  },
  version: 1,
  publishedAt: '2026-10-23T09:00:00.000Z',
} satisfies IntakeFormDetail;

describe('checkDraft on Publish (I3)', () => {
  it('takes the fields the builder cannot edit as they are: a grid at the end, a State list', () => {
    const draft = fromDetail(saved);
    const [employer, state, grid] = draft.sections[0]?.questions ?? [];
    expect(employer?.stored).toBeUndefined();
    expect(state).toMatchObject({ type: 'DROPDOWN', options: [], stored: true });
    expect(grid).toMatchObject({ type: 'SECTION_BREAK', stored: true });
    expect(checkDraft(draft, true)).toEqual({});
  });

  it('still asks for choices on a dropdown made in the builder', () => {
    const draft = fromDetail(saved);
    const added = { ...blankQuestion('DROPDOWN', 'Filing status'), options: [] };
    draft.sections[0]?.questions.splice(1, 0, added);
    expect(checkDraft(draft, true)).toEqual({
      [`question:${added.key}`]: 'Add at least one choice',
    });
  });

  it('still asks for a question after a section break added in the builder', () => {
    const draft = fromDetail(saved);
    const added = blankQuestion('SECTION_BREAK', 'More wages');
    draft.sections[0]?.questions.push(added);
    expect(added.stored).toBeUndefined();
    expect(checkDraft(draft, true)).toEqual({
      [`question:${added.key}`]: 'Add a question after this section break, or remove the break',
    });
    // A stored grid after the added break is the new part's content.
    draft.sections[0]?.questions.push({ ...added, key: 'w2Grid2', stored: true });
    expect(checkDraft(draft, true)).toEqual({});
  });
});
