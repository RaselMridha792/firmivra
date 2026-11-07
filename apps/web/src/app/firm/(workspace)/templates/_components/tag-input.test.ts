import { describe, expect, it } from 'vitest';
import { withTyped } from './tag-input';

describe('withTyped (TP-Y03)', () => {
  it('adds the typed tag, trimmed, once in any case', () => {
    expect(withTyped(['Tax'], '  Reminder ')).toEqual(['Tax', 'Reminder']);
    expect(withTyped(['Tax'], 'tax')).toEqual(['Tax']);
    expect(withTyped(['Tax'], '   ')).toEqual(['Tax']);
  });

  it('keeps at most 20 tags', () => {
    const twenty = Array.from({ length: 20 }, (_, i) => `T${i}`);
    expect(withTyped(twenty, 'More')).toEqual(twenty);
  });
});
