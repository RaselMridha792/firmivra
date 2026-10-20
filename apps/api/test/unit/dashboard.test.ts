// The dashboard's calculations (R30): the year's money by month and service, and the tasks due.
import { describe, expect, it } from 'vitest';
import type { Task } from '@firmivra/types';
import { completedIn, dueTasks, revenueOf } from '../../src/dashboard/dashboard-math.js';

const BOOKS = '00000000-0000-7000-8000-000000000001';
const TAX = '00000000-0000-7000-8000-000000000002';

describe('revenueOf', () => {
  it('puts each month in its place and totals the months', () => {
    const r = revenueOf(
      [
        { month: 1, serviceId: BOOKS, name: 'Bookkeeping', cents: 10_000 },
        { month: 3, serviceId: TAX, name: 'Personal Tax', cents: 25_000 },
        { month: 3, serviceId: BOOKS, name: 'Bookkeeping', cents: 5_000 },
        { month: 12, serviceId: null, name: null, cents: 1_000 },
      ],
      2026,
      null,
    );
    expect(r.year).toBe(2026);
    expect(r.byMonthCents).toEqual([10_000, 0, 30_000, 0, 0, 0, 0, 0, 0, 0, 0, 1_000]);
    expect(r.totalCents).toBe(41_000);
  });

  it('merges a service across months, largest first, invoices with no engagement as null', () => {
    const r = revenueOf(
      [
        { month: 2, serviceId: BOOKS, name: 'Bookkeeping', cents: 4_000 },
        { month: 5, serviceId: null, name: null, cents: 2_000 },
        { month: 6, serviceId: BOOKS, name: 'Bookkeeping', cents: 4_000 },
        { month: 6, serviceId: TAX, name: 'Personal Tax', cents: 7_000 },
      ],
      2026,
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
        { month: 4, serviceId: BOOKS, name: 'Bookkeeping', cents: 3_000 },
        { month: 5, serviceId: BOOKS, name: 'Bookkeeping', cents: -3_000 },
        { month: 5, serviceId: TAX, name: 'Personal Tax', cents: 1_000 },
      ],
      2026,
      null,
    );
    expect(r.byMonthCents.slice(3, 5)).toEqual([3_000, -2_000]);
    expect(r.totalCents).toBe(1_000);
    expect(r.byService).toEqual([{ serviceId: TAX, name: 'Personal Tax', cents: 1_000 }]);
  });

  it('is twelve zeros and no services for a firm with no money yet', () => {
    const r = revenueOf([], 2026, null);
    expect(r).toEqual({
      year: 2026,
      totalCents: 0,
      previousYearCents: null,
      byMonthCents: Array(12).fill(0),
      byService: [],
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

describe('revenueOf: last year (R1)', () => {
  it('passes the year before through for "vs last year", or null when there was none', () => {
    expect(revenueOf([], 2026, 12_345).previousYearCents).toBe(12_345);
    expect(revenueOf([], 2026, null).previousYearCents).toBeNull();
  });
});

describe('completedIn (R1)', () => {
  const counts = { thisMonth: 4, lastMonth: 7, thisYear: 30 };
  it("picks the pipeline's Completed count for each period", () => {
    expect(completedIn('THIS_MONTH', counts)).toBe(4);
    expect(completedIn('LAST_MONTH', counts)).toBe(7);
    expect(completedIn('THIS_YEAR', counts)).toBe(30);
  });
});
