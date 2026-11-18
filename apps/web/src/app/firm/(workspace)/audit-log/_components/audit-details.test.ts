import { describe, expect, it } from 'vitest';
import { detailLines, plainValue } from './audit-details';

// Audit Log Review 2, R03c: changes read "old → new", and null, "", false and 0 stay distinct.
describe('audit entry details', () => {
  it('keeps null, empty text, false and zero apart', () => {
    expect([null, '', false, 0, 'x', ['a']].map(plainValue)).toEqual([
      '(none)',
      '(empty)',
      'false',
      '0',
      'x',
      '["a"]',
    ]);
  });

  it('reads a changes map one field a line', () => {
    expect(
      detailLines({
        clientId: 'c-1',
        changes: {
          location: { from: null, to: '' },
          reminderSent: { from: true, to: false },
          bufferMinutes: { from: 0, to: 15 },
        },
      }),
    ).toEqual([
      { key: 'clientId', value: 'c-1' },
      { key: 'location', value: '(none) → (empty)' },
      { key: 'reminderSent', value: 'true → false' },
      { key: 'bufferMinutes', value: '0 → 15' },
    ]);
  });

  it('reads the catalog diff and a single { from, to } value', () => {
    expect(
      detailLines({
        fields: ['priceCents', 'pricingType'],
        from: { priceCents: null, pricingType: 'NONE' },
        to: { priceCents: 25000, pricingType: 'FIXED' },
        status: { from: 'OPEN', to: 'COMPLETED' },
      }),
    ).toEqual([
      { key: 'status', value: 'OPEN → COMPLETED' },
      { key: 'priceCents', value: '(none) → 25000' },
      { key: 'pricingType', value: 'NONE → FIXED' },
    ]);
  });

  it('reads a free-text change as "changed" (R03: never its text)', () => {
    expect(
      detailLines({
        fields: ['description', 'name'],
        changes: { description: 'changed', name: { from: 'A', to: 'B' } },
      }),
    ).toEqual([
      { key: 'fields', value: '["description","name"]' },
      { key: 'description', value: 'changed' },
      { key: 'name', value: 'A → B' },
    ]);
  });

  it('leaves a status `from` that is plain text as it is', () => {
    expect(detailLines({ from: 'OPEN', note: '' })).toEqual([
      { key: 'from', value: 'OPEN' },
      { key: 'note', value: '(empty)' },
    ]);
  });
});
