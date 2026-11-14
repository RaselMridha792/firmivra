// Dashboard Review 2 "Tax season context" (R1): the firm's season around its today, from the two
// `MM-DD` days in its settings. In season, off season (the next one), across Jan 1, and none.
import { describe, expect, it } from 'vitest';
import { MonthDay, seasonOf } from '@firmivra/types';

describe('seasonOf', () => {
  it('is in season from the first day to the last, both included', () => {
    expect(seasonOf('01-15', '04-15', '2027-01-15')).toEqual({
      start: '2027-01-15',
      end: '2027-04-15',
      inSeason: true,
    });
    expect(seasonOf('01-15', '04-15', '2027-04-15')).toMatchObject({ inSeason: true });
  });

  it('off season gives the next season: later this year, or next year once it is over', () => {
    expect(seasonOf('01-15', '04-15', '2027-01-14')).toEqual({
      start: '2027-01-15',
      end: '2027-04-15',
      inSeason: false,
    });
    expect(seasonOf('01-15', '04-15', '2026-11-14')).toEqual({
      start: '2027-01-15',
      end: '2027-04-15',
      inSeason: false,
    });
  });

  it('a season across Jan 1 runs from one year into the next', () => {
    expect(seasonOf('12-01', '04-30', '2026-12-20')).toEqual({
      start: '2026-12-01',
      end: '2027-04-30',
      inSeason: true,
    });
    expect(seasonOf('12-01', '04-30', '2027-02-10')).toEqual({
      start: '2026-12-01',
      end: '2027-04-30',
      inSeason: true,
    });
    expect(seasonOf('12-01', '04-30', '2027-07-04')).toEqual({
      start: '2027-12-01',
      end: '2028-04-30',
      inSeason: false,
    });
  });

  it('is null while the firm has no season', () => {
    expect(seasonOf(null, null, '2026-11-14')).toBeNull();
    expect(seasonOf('01-15', null, '2026-11-14')).toBeNull();
  });
});

describe('MonthDay', () => {
  it('takes a day every year has, never Feb 29 or a day a month lacks', () => {
    for (const ok of ['01-01', '02-28', '04-30', '12-31']) expect(MonthDay.parse(ok)).toBe(ok);
    for (const bad of ['02-29', '02-30', '04-31', '13-01', '1-15', '01-1', '00-10'])
      expect(MonthDay.safeParse(bad).success, bad).toBe(false);
  });
});
