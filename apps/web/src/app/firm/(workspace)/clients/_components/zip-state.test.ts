import { describe, expect, it } from 'vitest';
import { statesForZip, zipStateWarning } from './zip-state';

// Clients Review 2 (G10): the ZIP prefix table, a soft warning on a mismatch, and "can't verify"
// kept apart from an invalid ZIP. Synthetic addresses only.
describe('statesForZip', () => {
  it('names the state for a prefix, edge prefixes included', () => {
    expect(statesForZip('30043')).toEqual(['GA']);
    expect(statesForZip('39901')).toEqual(['GA']);
    expect(statesForZip('10001')).toEqual(['NY']);
    expect(statesForZip('00501')).toEqual(['NY']);
    expect(statesForZip('05501')).toEqual(['MA']);
    expect(statesForZip('20101')).toEqual(['VA']);
    expect(statesForZip('20001')).toEqual(['DC']);
    expect(statesForZip('73301')).toEqual(['TX']);
    expect(statesForZip('88510')).toEqual(['TX']);
    expect(statesForZip('96910')).toEqual(['GU', 'MP', 'AS']);
    expect(statesForZip('99501')).toEqual(['AK']);
  });

  it("is null for a prefix it doesn't know", () => {
    expect(statesForZip('00012')).toBeNull();
    expect(statesForZip('42801')).toBeNull();
    expect(statesForZip('abc12')).toBeNull();
  });
});

describe('zipStateWarning', () => {
  it('says nothing for a match, an unfinished ZIP or no state', () => {
    expect(zipStateWarning('30043', 'GA')).toBeUndefined();
    expect(zipStateWarning('30043-1234', 'ga')).toBeUndefined();
    expect(zipStateWarning('300', 'GA')).toBeUndefined();
    expect(zipStateWarning('30043', '')).toBeUndefined();
  });

  it('warns on a mismatch with the state the ZIP belongs to', () => {
    expect(zipStateWarning('10001', 'GA')).toBe(
      'ZIP code 10001 is usually in NY, not GA. Check the state and ZIP code; you can still save.',
    );
  });

  it("says it can't verify an unknown prefix, never that it is invalid", () => {
    expect(zipStateWarning('42801', 'KY')).toBe(
      "We can't verify ZIP code 42801. Check it before saving.",
    );
  });
});
