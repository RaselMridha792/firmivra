import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { FIELD_HELP, PROPOSED_HELP } from './field-help';

// B14: the helper text is Octavia's, word for word (§6 and §7 of her review of Oct 25), never
// invented. Each one must appear in the converted review as written.

const review = readFileSync(
  fileURLToPath(
    new URL(
      '../../../../../../../../docs/specs/review-2026-10-25/business-advisory--developer-feedback.md',
      import.meta.url,
    ),
  ),
  'utf8',
).replace(/\s+/g, ' ');

describe('Business Advisory helper text', () => {
  it.each(Object.entries(FIELD_HELP))('%s is the approved copy', (_field, text) => {
    expect(review).toContain(text);
  });

  it.each(Object.entries(PROPOSED_HELP))('%s is the proposed copy', (_field, text) => {
    expect(review).toContain(text);
  });

  it('keeps the proposed recommendation copy apart from the approved copy', () => {
    const approved = new Set<string>(Object.values(FIELD_HELP));
    expect(Object.values(PROPOSED_HELP).some((t) => approved.has(t))).toBe(false);
    expect(Object.keys(FIELD_HELP)).toHaveLength(18);
    expect(Object.keys(PROPOSED_HELP)).toHaveLength(6);
  });
});
