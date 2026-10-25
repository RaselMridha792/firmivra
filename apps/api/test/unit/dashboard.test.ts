// The dashboard's calculations (R30): the periods (C1), the money by bar and service, and the tasks due.
import { describe, expect, it } from 'vitest';
import type { Task } from '@firmivra/types';
import {
  bucketsOf,
  dueTasks,
  rangeOf,
  revenueOf,
  revenueRangeOf,
} from '../../src/dashboard/dashboard-math.js';

const BOOKS = '00000000-0000-7000-8000-000000000001';
const TAX = '00000000-0000-7000-8000-000000000002';

const YEAR = { period: 'YEAR' as const, from: '2026-01-01', to: '2026-10-25' };
const row = (day: string, serviceId: string | null, name: string | null, cents: number) => ({
  day,
  serviceId,
  name,
  cents,
});

describe('revenueOf', () => {
  it('puts each day in its month for a year, the months to come at zero, and totals the bars', () => {
    const r = revenueOf(
      [
        row('2026-01-05', BOOKS, 'Bookkeeping', 10_000),
        row('2026-03-31', TAX, 'Personal Tax', 25_000),
        row('2026-03-01', BOOKS, 'Bookkeeping', 5_000),
        row('2026-10-25', null, null, 1_000),
      ],
      YEAR,
      null,
    );
    expect(r.buckets.map((b) => b.cents)).toEqual([
      10_000, 0, 30_000, 0, 0, 0, 0, 0, 0, 1_000, 0, 0,
    ]);
    expect(r.buckets[1]).toEqual({ from: '2026-02-01', to: '2026-02-28', cents: 0 });
    expect(r.totalCents).toBe(41_000);
  });

  it('merges a service across bars, largest first, invoices with no engagement as null', () => {
    const r = revenueOf(
      [
        row('2026-02-02', BOOKS, 'Bookkeeping', 4_000),
        row('2026-05-02', null, null, 2_000),
        row('2026-06-02', BOOKS, 'Bookkeeping', 4_000),
        row('2026-06-03', TAX, 'Personal Tax', 7_000),
      ],
      YEAR,
      null,
    );
    expect(r.byService).toEqual([
      { serviceId: BOOKS, name: 'Bookkeeping', cents: 8_000 },
      { serviceId: TAX, name: 'Personal Tax', cents: 7_000 },
      { serviceId: null, name: null, cents: 2_000 },
    ]);
  });

  it('subtracts refunds, and leaves a service at or below zero out of the breakdown', () => {
    const r = revenueOf(
      [
        row('2026-04-10', BOOKS, 'Bookkeeping', 3_000),
        row('2026-05-10', BOOKS, 'Bookkeeping', -3_000),
        row('2026-05-11', TAX, 'Personal Tax', 1_000),
      ],
      YEAR,
      null,
    );
    expect(r.buckets.slice(3, 5).map((b) => b.cents)).toEqual([3_000, -2_000]);
    expect(r.totalCents).toBe(1_000);
    expect(r.byService).toEqual([{ serviceId: TAX, name: 'Personal Tax', cents: 1_000 }]);
  });

  it('is zero bars and no services for a firm with no money yet, and passes the span before', () => {
    const r = revenueOf([], YEAR, null);
    expect(r).toMatchObject({ totalCents: 0, previousCents: null, byService: [] });
    expect(r.buckets).toHaveLength(12);
    expect(revenueOf([], YEAR, 12_345).previousCents).toBe(12_345);
  });

  it('cuts a month by day, a quarter by month and a Custom range by its length', () => {
    const month = revenueOf(
      [row('2026-10-03', null, null, 500)],
      {
        period: 'MONTH',
        from: '2026-10-01',
        to: '2026-10-25',
      },
      null,
    );
    expect(month.buckets).toHaveLength(25);
    expect(month.buckets[2]).toEqual({ from: '2026-10-03', to: '2026-10-03', cents: 500 });
    const quarter = revenueOf(
      [],
      { period: 'QUARTER', from: '2026-10-01', to: '2026-10-25' },
      null,
    );
    expect(quarter.buckets).toEqual([{ from: '2026-10-01', to: '2026-10-25', cents: 0 }]);
    expect(bucketsOf('2026-01-15', '2026-03-10', 'auto')).toHaveLength(55);
    expect(bucketsOf('2026-01-15', '2026-04-10', 'auto')).toEqual([
      { from: '2026-01-15', to: '2026-01-31' },
      { from: '2026-02-01', to: '2026-02-28' },
      { from: '2026-03-01', to: '2026-03-31' },
      { from: '2026-04-01', to: '2026-04-10' },
    ]);
  });
});

// Octavia's review of Oct 25, C1 and K8: each period and its equivalent elapsed period before.
describe('rangeOf', () => {
  const at = (period: Parameters<typeof rangeOf>[0], today: string) => {
    const r = rangeOf(period, today);
    return [r.from, r.to, r.previousFrom, r.previousTo];
  };
  it('runs the current periods to today and compares the same elapsed days before', () => {
    expect(at('TODAY', '2026-10-25')).toEqual([
      '2026-10-25',
      '2026-10-25',
      '2026-10-24',
      '2026-10-24',
    ]);
    // Sunday Oct 25: the week from Monday Oct 19.
    expect(at('THIS_WEEK', '2026-10-25')).toEqual([
      '2026-10-19',
      '2026-10-25',
      '2026-10-12',
      '2026-10-18',
    ]);
    expect(at('THIS_MONTH', '2026-10-25')).toEqual([
      '2026-10-01',
      '2026-10-25',
      '2026-09-01',
      '2026-09-25',
    ]);
    expect(at('THIS_QUARTER', '2026-11-15')).toEqual([
      '2026-10-01',
      '2026-11-15',
      '2026-07-01',
      '2026-08-15',
    ]);
    expect(at('THIS_YEAR', '2026-10-25')).toEqual([
      '2026-01-01',
      '2026-10-25',
      '2025-01-01',
      '2025-10-25',
    ]);
  });

  it('clamps to a shorter month, and crosses into the year before', () => {
    expect(at('THIS_MONTH', '2026-03-31')).toEqual([
      '2026-03-01',
      '2026-03-31',
      '2026-02-01',
      '2026-02-28',
    ]);
    expect(at('THIS_MONTH', '2026-01-15')).toEqual([
      '2026-01-01',
      '2026-01-15',
      '2025-12-01',
      '2025-12-15',
    ]);
    expect(at('THIS_YEAR', '2028-02-29')).toEqual([
      '2028-01-01',
      '2028-02-29',
      '2027-01-01',
      '2027-02-28',
    ]);
    // 91 days into Q2 is more than Q1 holds: the quarter before ends on its own last day.
    expect(at('THIS_QUARTER', '2026-06-30')[3]).toBe('2026-03-31');
    expect(at('THIS_QUARTER', '2026-02-10')).toEqual([
      '2026-01-01',
      '2026-02-10',
      '2025-10-01',
      '2025-11-10',
    ]);
  });

  it('takes Last Month and Last Year whole, and compares them with the whole period before', () => {
    expect(at('LAST_MONTH', '2026-03-31')).toEqual([
      '2026-02-01',
      '2026-02-28',
      '2026-01-01',
      '2026-01-31',
    ]);
    expect(at('LAST_MONTH', '2026-01-10')).toEqual([
      '2025-12-01',
      '2025-12-31',
      '2025-11-01',
      '2025-11-30',
    ]);
    expect(at('LAST_YEAR', '2026-10-25')).toEqual([
      '2025-01-01',
      '2025-12-31',
      '2024-01-01',
      '2024-12-31',
    ]);
  });

  it('compares a Custom range with the same number of days just before it', () => {
    const r = rangeOf('CUSTOM', '2026-10-25', { from: '2026-10-10', to: '2026-10-19' });
    expect([r.from, r.to, r.previousFrom, r.previousTo]).toEqual([
      '2026-10-10',
      '2026-10-19',
      '2026-09-30',
      '2026-10-09',
    ]);
  });

  it('gives Revenue Overview a whole earlier year, and this year to date', () => {
    expect(revenueRangeOf('YEAR', '2026-10-25', { year: 2024 })).toMatchObject({
      from: '2024-01-01',
      to: '2024-12-31',
      previousFrom: '2023-01-01',
      previousTo: '2023-12-31',
    });
    expect(revenueRangeOf('YEAR', '2026-10-25')).toMatchObject({
      from: '2026-01-01',
      to: '2026-10-25',
    });
  });
});

describe('dueTasks', () => {
  const task = (n: number, dueOn: string | null, status: Task['status'] = 'OPEN') =>
    ({
      id: `id-${n}`,
      title: `Task ${n}`,
      client: { id: BOOKS, displayName: 'Fake' },
      dueOn,
      status,
    }) as Task;

  it('keeps open tasks with a due date, in the order given, at most five', () => {
    const tasks = [task(1, '2026-10-14'), task(2, null), task(3, '2026-10-15', 'DONE')];
    tasks.push(...[4, 5, 6, 7, 8].map((n) => task(n, `2026-10-2${n}`)));
    expect(dueTasks(tasks, new Map()).map((t) => t.title)).toEqual([
      'Task 1',
      'Task 4',
      'Task 5',
      'Task 6',
      'Task 7',
    ]);
    expect(dueTasks(tasks, new Map())[0]).toEqual({
      id: 'id-1',
      title: 'Task 1',
      dueOn: '2026-10-14',
      priority: 'MEDIUM',
      client: { id: BOOKS, displayName: 'Fake' },
    });
  });

  // R1: each task carries its priority (the design's pills); MEDIUM, the column's default, if unknown.
  it('gives each task its priority from the lookup', () => {
    const tasks = [task(1, '2026-10-14'), task(2, '2026-10-15')];
    const priorities = new Map([['id-1', 'HIGH' as const]]);
    expect(dueTasks(tasks, priorities).map((t) => t.priority)).toEqual(['HIGH', 'MEDIUM']);
  });
});
