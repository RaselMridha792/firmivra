// R55: the Tasks module's date logic. "Overdue" is derived, never stored: an OPEN task is past due
// on an earlier date in the firm's time zone, or today with a due time that has gone by.
import { describe, expect, it } from 'vitest';
import { isOverdue } from '../../src/tasks/task-common.js';

const day = (s: string) => new Date(`${s}T00:00:00.000Z`);
const time = (s: string) => new Date(`1970-01-01T${s}:00.000Z`);
const task = (over: Partial<Parameters<typeof isOverdue>[0]> = {}) => ({
  status: 'OPEN',
  dueOn: day('2026-10-17'),
  dueTime: null,
  allDay: true,
  ...over,
});
/** 10:30 on 2026-10-17 in the firm. */
const TODAY = '2026-10-17';
const NOW = 10 * 60 + 30;

describe('isOverdue', () => {
  it('is past due on an earlier date, not on today or a later one', () => {
    expect(isOverdue(task({ dueOn: day('2026-10-16') }), TODAY, NOW)).toBe(true);
    expect(isOverdue(task({ dueOn: day('2020-01-01') }), TODAY, NOW)).toBe(true);
    expect(isOverdue(task({ dueOn: day('2026-10-17') }), TODAY, NOW)).toBe(false);
    expect(isOverdue(task({ dueOn: day('2026-10-18') }), TODAY, NOW)).toBe(false);
  });

  it('counts the due time on the day itself, the minute after it', () => {
    const timed = (t: string) => task({ allDay: false, dueTime: time(t) });
    expect(isOverdue(timed('10:29'), TODAY, NOW)).toBe(true);
    expect(isOverdue(timed('10:30'), TODAY, NOW)).toBe(false);
    expect(isOverdue(timed('17:00'), TODAY, NOW)).toBe(false);
    // An all-day task is due until the day ends.
    expect(isOverdue(task({ dueTime: time('08:00') }), TODAY, NOW)).toBe(false);
  });

  it('only an OPEN task with a date can be overdue', () => {
    for (const status of ['DONE', 'CANCELLED']) {
      expect(isOverdue(task({ status, dueOn: day('2020-01-01') }), TODAY, NOW)).toBe(false);
    }
    expect(isOverdue(task({ dueOn: null }), TODAY, NOW)).toBe(false);
  });
});
