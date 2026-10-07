import { describe, expect, it } from 'vitest';
import { checkOrder } from '../../src/tax-statuses/tax-statuses.service.js';

const rows = [
  { id: 'a', archivedAt: null },
  { id: 'b', archivedAt: null },
  { id: 'old', archivedAt: new Date('2026-10-01T00:00:00Z') },
];
const status = (fn: () => void) => {
  try {
    fn();
    return 'ok';
  } catch (e) {
    return (e as { getStatus: () => number }).getStatus();
  }
};

describe('checkOrder', () => {
  it('accepts every active status exactly once, in any order', () => {
    expect(status(() => checkOrder(['b', 'a'], rows))).toBe('ok');
  });

  it('is 404 for an unknown id before anything else', () => {
    expect(status(() => checkOrder(['a', 'zzz'], rows))).toBe(404);
  });

  it('is 409 when an active status is missing, repeated, or an archived one is named', () => {
    expect(status(() => checkOrder(['a'], rows))).toBe(409);
    expect(status(() => checkOrder(['a', 'a'], rows))).toBe(409);
    expect(status(() => checkOrder(['a', 'b', 'old'], rows))).toBe(409);
  });
});
