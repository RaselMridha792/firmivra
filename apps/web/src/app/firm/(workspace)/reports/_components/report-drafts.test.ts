import { describe, expect, it } from 'vitest';
import { NEW_DRAFT, draftFrom, pack, unpack } from './report-drafts';

describe('the builder draft in the address (RP-F14, F05, Octavia Oct 28)', () => {
  it('comes back exactly, names with any letter included', () => {
    const draft = {
      ...NEW_DRAFT,
      name: 'Café “Q4” revenue',
      sourceKey: 'invoices_payments',
      columns: ['number', 'client', 'total'],
      fixed: { from: '2026-10-24', to: '2026-10-26' },
      conds: [{ field: 'total', op: 'GREATER_THAN', value: '500', to: '', values: [] }],
      groupBy: 'status',
      totals: true,
    };
    const text = pack(draft);
    expect(text).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(draftFrom(text)).toEqual(draft);
  });

  it('starts new from an address it cannot use, and keeps only what fits', () => {
    expect(draftFrom(null)).toEqual(NEW_DRAFT);
    expect(draftFrom('not base64!')).toEqual(NEW_DRAFT);
    expect(draftFrom(pack('a string'))).toEqual(NEW_DRAFT);
    const odd = draftFrom(
      pack({ name: 7, columns: ['a', 3], fixed: { from: 'x', to: 'y' }, desc: 'yes' }),
    );
    expect(odd).toMatchObject({ name: 'Custom Report', columns: ['a'], desc: true });
    expect(odd.fixed).toBeUndefined();
    expect(unpack(pack({ big: 'x'.repeat(10_000) }))).toBeNull();
  });
});
