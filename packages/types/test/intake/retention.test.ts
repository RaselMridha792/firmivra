import { describe, expect, it } from 'vitest';
import {
  retentionAllowsRemoval,
  retentionDateWords,
  retentionHold,
  retentionHoldMessage,
  retentionYearsAfter,
} from '../../src/index.js';

// Intake Forms Review Two 14b: the dates the RetentionGuard keeps to and the Security panel shows.
describe('retentionYearsAfter', () => {
  it('counts whole calendar years from the completion day (UTC), dropping the time', () => {
    expect(retentionYearsAfter(new Date('2026-11-15T23:59:59Z'), 7)).toBe('2033-11-15');
    expect(retentionYearsAfter(new Date('2026-01-01T00:00:00Z'), 1)).toBe('2027-01-01');
    expect(retentionYearsAfter(new Date('2026-06-30T12:00:00Z'), 30)).toBe('2056-06-30');
  });

  it('moves a leap day to March 1 in a year without one, and keeps it in a leap year', () => {
    expect(retentionYearsAfter(new Date('2024-02-29T10:00:00Z'), 1)).toBe('2025-03-01');
    expect(retentionYearsAfter(new Date('2024-02-29T10:00:00Z'), 4)).toBe('2028-02-29');
  });
});

describe('retentionHold', () => {
  it('holds nothing when the category has no minimum', () => {
    expect(retentionHold(null, new Date('2020-01-01T00:00:00Z'))).toEqual({ kind: 'NONE' });
    expect(retentionHold(null, null)).toEqual({ kind: 'NONE' });
  });

  it('keeps a record whose job is not completed, or that has none', () => {
    expect(retentionHold(7, null)).toEqual({ kind: 'OPEN' });
    expect(retentionHold(7, 'not a date')).toEqual({ kind: 'OPEN' });
  });

  it('keeps a completed job’s record until the completion day plus the years', () => {
    expect(retentionHold(7, '2026-11-15T08:00:00.000Z')).toEqual({
      kind: 'UNTIL',
      until: '2033-11-15',
    });
  });
});

describe('retentionAllowsRemoval', () => {
  const hold = retentionHold(7, new Date('2026-11-15T08:00:00Z'));
  it('refuses inside the minimum and allows from its last day on', () => {
    expect(retentionAllowsRemoval(hold, '2026-11-15')).toBe(false);
    expect(retentionAllowsRemoval(hold, '2033-11-14')).toBe(false);
    expect(retentionAllowsRemoval(hold, '2033-11-15')).toBe(true);
    expect(retentionAllowsRemoval(hold, '2040-01-01')).toBe(true);
  });

  it('never allows an open record, and always allows one no minimum holds', () => {
    expect(retentionAllowsRemoval({ kind: 'OPEN' }, '2999-12-31')).toBe(false);
    expect(retentionAllowsRemoval({ kind: 'NONE' }, '2026-11-15')).toBe(true);
  });
});

describe('retentionHoldMessage', () => {
  it('says until when, or that the job is not completed, in plain words', () => {
    expect(retentionHoldMessage(retentionHold(7, new Date('2026-11-15T08:00:00Z')))).toBe(
      'Kept until Nov 15, 2033 under your retention policy',
    );
    expect(retentionHoldMessage({ kind: 'OPEN' })).toBe('Kept: its job isn’t completed yet');
    expect(retentionHoldMessage({ kind: 'NONE' })).toBeNull();
    expect(retentionDateWords('2028-02-29')).toBe('Feb 29, 2028');
  });
});
