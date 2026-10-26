import { describe, expect, it } from 'vitest';
import { atText, cleanTag, reviewMoves } from './details-parts';

describe('reviewMoves', () => {
  it('offers every move that changes the status, and none in Trash', () => {
    expect(reviewMoves({ reviewStatus: 'NEEDS_REVIEW', trashedAt: null })).toMatchObject({
      moves: [{ action: 'START' }, { action: 'VERIFY' }, { action: 'COMPLETE' }],
      replace: true,
    });
    const done = reviewMoves({ reviewStatus: 'COMPLETED', trashedAt: null });
    expect(done.moves.map((m) => m.action)).toEqual(['START', 'VERIFY']);
    expect(reviewMoves({ reviewStatus: 'REPLACEMENT_REQUESTED', trashedAt: null }).replace).toBe(
      false,
    );
    expect(reviewMoves({ reviewStatus: null, trashedAt: '2026-10-01T00:00:00.000Z' })).toEqual({
      moves: [],
      replace: false,
    });
  });
});

it('writes the time as the design does, and tags as the API keeps them', () => {
  expect(atText('2026-09-02T16:15:00')).toBe('Sep 2, 2026 at 4:15 PM');
  expect(cleanTag('  Tax   Return ')).toBe('Tax Return');
});
