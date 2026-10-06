import { describe, it, expect } from 'vitest';
import { validateTaxOrder } from '../../src/tax-statuses/tax-statuses.service.js';
describe('tax status order invariants', () => {
  const rows = [
    { id: 'a', archivedAt: null },
    { id: 'b', archivedAt: null },
    { id: 'old', archivedAt: new Date() },
  ];
  it('rejects foreign, incomplete, duplicate and archived definitions', () => {
    for (const ids of [['a', 'foreign'], ['a'], ['a', 'a'], ['a', 'b', 'old']])
      expect(() => validateTaxOrder(ids, rows)).toThrow();
  });
  it('accepts exactly the active status permutation', () =>
    expect(() => validateTaxOrder(['b', 'a'], rows)).not.toThrow());
});
