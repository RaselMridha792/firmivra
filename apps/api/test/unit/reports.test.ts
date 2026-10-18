// R55: the Reports engine and its helpers, which need no database: date ranges in the firm's
// zone and their comparisons, filter evaluation, definition checks, the one computation behind the
// cards, chart and table, the CSV, and when a schedule next runs.
import { describe, expect, it } from 'vitest';
import {
  checkDefinition,
  comparisonOf,
  compute,
  conditionShapeOk,
  matches,
  presetBounds,
  rangeOf,
  type DateSpec,
  type Filters,
} from '../../src/reports/engine.js';
import {
  SYSTEM_REPORTS,
  camel,
  snake,
  safeFileName,
  toRow,
  toView,
} from '../../src/reports/reports.common.js';
import { toCsv } from '../../src/reports/reports-export.service.js';
import { describeSchedule, nextRun, zonedInstant } from '../../src/reports/schedule-math.js';
import { SOURCES, type Row, sourceOf } from '../../src/reports/sources.js';

const TZ = 'America/New_York';

describe('date ranges', () => {
  it('resolve each preset in the firm’s calendar', () => {
    const today = '2026-10-17';
    expect(presetBounds('today', today)).toEqual({ from: today, to: today });
    expect(presetBounds('last_7_days', today)).toEqual({ from: '2026-10-11', to: today });
    expect(presetBounds('last_30_days', today)).toEqual({ from: '2026-09-18', to: today });
    expect(presetBounds('this_month', today)).toEqual({ from: '2026-10-01', to: today });
    expect(presetBounds('last_month', today)).toEqual({ from: '2026-09-01', to: '2026-09-30' });
    expect(presetBounds('this_quarter', today)).toEqual({ from: '2026-10-01', to: today });
    expect(presetBounds('last_quarter', today)).toEqual({ from: '2026-07-01', to: '2026-09-30' });
    expect(presetBounds('this_year', today)).toEqual({ from: '2026-01-01', to: today });
    expect(presetBounds('last_year', today)).toEqual({ from: '2025-01-01', to: '2025-12-31' });
    // January: last month is December, last quarter is Q4 of the year before.
    expect(presetBounds('last_month', '2026-01-10')).toEqual({
      from: '2025-12-01',
      to: '2025-12-31',
    });
    expect(presetBounds('last_quarter', '2026-02-10')).toEqual({
      from: '2025-10-01',
      to: '2025-12-31',
    });
  });

  it('the day is the firm’s day, not UTC', () => {
    // 01:30 UTC on Oct 18 is still Oct 17 in New York.
    const range = rangeOf(
      { rule: 'ROLLING', preset: 'today' },
      TZ,
      new Date('2026-10-18T01:30:00Z'),
    );
    expect(range).toMatchObject({ from: '2026-10-17', to: '2026-10-17', label: 'Today' });
  });

  it('compare to the previous period and the same period last year', () => {
    const spec: DateSpec = { rule: 'ROLLING', preset: 'last_month' };
    const range = rangeOf(spec, TZ, new Date('2026-10-17T12:00:00Z'));
    expect(comparisonOf(range, spec, 'PREVIOUS_PERIOD')).toMatchObject({
      from: '2026-08-01',
      to: '2026-08-31',
    });
    expect(comparisonOf(range, spec, 'SAME_PERIOD_LAST_YEAR')).toMatchObject({
      from: '2025-09-01',
      to: '2025-09-30',
    });
    expect(comparisonOf(range, spec, 'NONE')).toBeNull();
    const fixed: DateSpec = { rule: 'FIXED', from: '2026-03-01', to: '2026-03-10' };
    const r2 = rangeOf(fixed, TZ);
    expect(comparisonOf(r2, fixed, 'PREVIOUS_PERIOD')).toMatchObject({
      from: '2026-02-19',
      to: '2026-02-28',
    });
    const year: DateSpec = { rule: 'ROLLING', preset: 'this_year' };
    const r3 = rangeOf(year, TZ, new Date('2026-10-17T12:00:00Z'));
    expect(comparisonOf(r3, year, 'PREVIOUS_PERIOD')).toMatchObject({
      from: '2025-01-01',
      to: '2025-10-17',
    });
  });
});

describe('filters', () => {
  const clients = sourceOf('clients')!;
  const fields = new Map(clients.fields.map((f) => [f.key, f]));
  const row = (cells: Row['cells']): Row => ({ id: 'r', cells, links: [] });
  const f = (over: Partial<Filters>): Filters => ({
    logic: 'AND',
    conditions: [],
    groups: [],
    ...over,
  });
  const test = (r: Row, filters: Filters) => matches(r, filters, fields, '2026-10-17');

  it('evaluate by type: text, status, date, empty', () => {
    const r = row({
      name: 'Jamie Sample',
      status: 'ACTIVE',
      createdOn: '2026-10-01',
      source: null,
    });
    expect(test(r, f({ conditions: [{ field: 'name', op: 'CONTAINS', value: 'sample' }] }))).toBe(
      true,
    );
    expect(test(r, f({ conditions: [{ field: 'name', op: 'STARTS_WITH', value: 'sam' }] }))).toBe(
      false,
    );
    expect(
      test(r, f({ conditions: [{ field: 'name', op: 'NOT_CONTAINS', value: 'riley' }] })),
    ).toBe(true);
    expect(
      test(r, f({ conditions: [{ field: 'status', op: 'IS_ANY_OF', value: ['NEW', 'ACTIVE'] }] })),
    ).toBe(true);
    expect(
      test(r, f({ conditions: [{ field: 'status', op: 'IS_NONE_OF', value: ['ACTIVE'] }] })),
    ).toBe(false);
    expect(
      test(
        r,
        f({
          conditions: [
            { field: 'createdOn', op: 'BETWEEN', value: { from: '2026-09-01', to: '2026-10-05' } },
          ],
        }),
      ),
    ).toBe(true);
    expect(
      test(r, f({ conditions: [{ field: 'createdOn', op: 'AFTER', value: '2026-10-01' }] })),
    ).toBe(false);
    expect(
      test(r, f({ conditions: [{ field: 'createdOn', op: 'RELATIVE', value: 'this_month' }] })),
    ).toBe(true);
    expect(test(r, f({ conditions: [{ field: 'source', op: 'IS_EMPTY' }] }))).toBe(true);
  });

  it('combine by AND, OR and inner groups', () => {
    const r = row({ name: 'Jamie', status: 'NEW' });
    const a = { field: 'name', op: 'EQUALS', value: 'jamie' } as const;
    const b = { field: 'status', op: 'IS', value: 'ACTIVE' } as const;
    expect(test(r, f({ conditions: [a, b] }))).toBe(false);
    expect(test(r, f({ logic: 'OR', conditions: [a, b] }))).toBe(true);
    expect(
      test(
        r,
        f({
          conditions: [a],
          groups: [{ logic: 'OR', conditions: [b, { field: 'status', op: 'IS', value: 'NEW' }] }],
        }),
      ),
    ).toBe(true);
    expect(test(r, f({ conditions: [a], groups: [{ logic: 'AND', conditions: [b] }] }))).toBe(
      false,
    );
    expect(test(r, f({}))).toBe(true);
    // A condition on an unknown field matches nothing: a typo never selects everything.
    expect(test(r, f({ conditions: [{ field: 'nope', op: 'EQUALS', value: 'x' }] }))).toBe(false);
  });

  it('values must fit the operator', () => {
    expect(
      conditionShapeOk('NUMBER', { field: 'a', op: 'BETWEEN', value: { from: 1, to: 5 } }),
    ).toBe(true);
    expect(conditionShapeOk('NUMBER', { field: 'a', op: 'BETWEEN', value: 5 })).toBe(false);
    expect(conditionShapeOk('STATUS', { field: 'a', op: 'IS_ANY_OF', value: [] })).toBe(false);
    expect(conditionShapeOk('TEXT', { field: 'a', op: 'IS_EMPTY' })).toBe(true);
    expect(conditionShapeOk('DATE', { field: 'a', op: 'ON', value: 'yesterday' })).toBe(false);
    expect(conditionShapeOk('DATE', { field: 'a', op: 'RELATIVE', value: 'last_30_days' })).toBe(
      true,
    );
    expect(conditionShapeOk('BOOLEAN', { field: 'a', op: 'IS', value: true })).toBe(true);
  });
});

describe('definitions', () => {
  const clients = sourceOf('clients')!;
  const d = (over: object = {}) => ({
    columns: ['name', 'status'],
    filters: { logic: 'AND' as const, conditions: [], groups: [] },
    groupBy: null,
    sortBy: null,
    showTotals: false,
    showPercentage: false,
    compareTo: 'NONE' as const,
    ...over,
  });

  it('are checked against the source: fields, grouping, sorting, operators, totals', () => {
    expect(checkDefinition(d(), clients, true).problems).toEqual([]);
    expect(checkDefinition(d({ columns: ['nope'] }), clients, true).problems[0]).toMatchObject({
      path: 'columns.0',
    });
    expect(checkDefinition(d({ groupBy: 'createdOn' }), clients, true).problems[0]).toMatchObject({
      path: 'groupBy',
    });
    expect(checkDefinition(d({ sortBy: 'nope' }), clients, true).problems[0]).toMatchObject({
      path: 'sortBy',
    });
    expect(checkDefinition(d({ showTotals: true }), clients, true).problems[0]).toMatchObject({
      path: 'showTotals',
    });
    const bad = checkDefinition(
      d({
        filters: {
          logic: 'AND',
          conditions: [
            { field: 'status', op: 'CONTAINS', value: 'x' },
            { field: 'status', op: 'IS', value: 'MARTIAN' },
          ],
          groups: [],
        },
      }),
      clients,
      true,
    );
    expect(bad.problems.map((p) => p.path)).toEqual([
      'filters.conditions.0.op',
      'filters.conditions.1.value',
    ]);
  });

  it('a sensitive field is forbidden to those who may not see it, not merely unknown', () => {
    const r = checkDefinition(d({ columns: ['name', 'email'] }), clients, false);
    expect(r.forbidden).toEqual(['email']);
    expect(r.problems).toEqual([]);
    expect(checkDefinition(d({ columns: ['name', 'email'] }), clients, true).forbidden).toEqual([]);
  });

  it('every built-in report is valid against its own source', () => {
    for (const s of SYSTEM_REPORTS) {
      const source = sourceOf(s.dataSource)!;
      expect(source.category, s.key).toBe(s.category);
      const { problems } = checkDefinition(
        { ...s.definition, filters: s.definition.filters as Filters },
        source,
        true,
      );
      expect(problems, s.key).toEqual([]);
      expect(s.key).toMatch(/^[a-z][a-z0-9_]{0,59}$/);
    }
  });

  it('are stored as the database wants: snake_case names, filters in an array, no pie', () => {
    expect(snake('assignedTo')).toBe('assigned_to');
    expect(camel('created_on')).toBe('createdOn');
    const view = {
      category: 'CLIENT' as const,
      dataSource: 'clients',
      columns: ['name', 'assignedTo'],
      filters: {
        logic: 'OR' as const,
        conditions: [{ field: 'status', op: 'IS' as const, value: 'ACTIVE' }],
        groups: [],
      },
      groupBy: 'accountType',
      sortBy: 'createdOn',
      sortDescending: true,
      showTotals: true,
      showPercentage: false,
      compareTo: 'PREVIOUS_PERIOD' as const,
      date: { rule: 'FIXED' as const, from: '2026-01-01', to: '2026-02-01' },
      chartType: 'PIE' as const,
      showDataLabels: false,
      includeTaxRevenue: false,
    };
    const row = toRow(view);
    expect(row).toMatchObject({
      columns: ['name', 'assigned_to'],
      groupBy: 'account_type',
      sortBy: 'created_on',
      chartType: 'donut',
      includeComparison: true,
      compareTo: 'previous_period',
      dateRule: 'FIXED',
      datePreset: null,
    });
    expect(Array.isArray(row.filters)).toBe(true);
    const back = toView({ ...row, filters: row.filters as unknown } as never);
    expect(back).toMatchObject({
      columns: ['name', 'assignedTo'],
      groupBy: 'accountType',
      sortBy: 'createdOn',
      compareTo: 'PREVIOUS_PERIOD',
      chartType: 'DONUT',
      date: view.date,
    });
    expect(back.filters.conditions).toHaveLength(1);
    expect(safeFileName('Q3 Revenue: <script>', '2026-07-01', '2026-09-30', 'csv')).toBe(
      'Q3-Revenue-script_2026-07-01_2026-09-30.csv',
    );
  });

  it('the catalog lists lower-case field names the database accepts', () => {
    for (const s of SOURCES) {
      for (const f of s.fields) {
        expect(snake(f.key), `${s.key}.${f.key}`).toMatch(/^[a-z][a-z0-9_.]{0,79}$/);
        expect(snake(f.key)).not.toMatch(/ssn|social|password|token|secret|account_number|routing/);
        expect(camel(snake(f.key))).toBe(f.key);
      }
      expect(
        s.fields.some((f) => f.key === s.dateField && (f.type === 'DATE' || f.type === 'DATETIME')),
      ).toBe(true);
      expect(s.defaultColumns.every((k) => s.fields.some((f) => f.key === k))).toBe(true);
    }
  });
});

describe('the computation', () => {
  const invoices = sourceOf('invoices_payments')!;
  const range = { from: '2026-10-01', to: '2026-10-31', timezone: TZ, label: 'x' };
  const mk = (
    id: string,
    issuedOn: string,
    total: number,
    tax: number,
    status = 'OPEN',
    client = 'A',
  ): Row => ({
    id,
    cells: {
      number: id,
      client,
      status,
      total,
      tax,
      subtotal: total - tax,
      issuedOn,
      dueOn: null,
      paidOn: null,
      daysOverdue: null,
      assignedTo: null,
    },
    links: [],
  });
  const rows = [
    mk('1', '2026-10-02', 11_000, 1_000),
    mk('2', '2026-10-15', 22_000, 2_000, 'PAID', 'B'),
    mk('3', '2026-09-20', 99_000, 9_000),
  ];
  const def = (over: object = {}) => ({
    category: 'FINANCIAL' as const,
    dataSource: 'invoices_payments',
    columns: ['number', 'client', 'total'],
    filters: { logic: 'AND' as const, conditions: [], groups: [] },
    groupBy: null,
    sortBy: null,
    sortDescending: false,
    showTotals: true,
    showPercentage: false,
    compareTo: 'NONE' as const,
    date: { rule: 'FIXED' as const, from: range.from, to: range.to },
    chartType: 'AUTO' as const,
    showDataLabels: false,
    includeTaxRevenue: false,
    ...over,
  });
  const input = (over: object = {}) => ({
    source: invoices,
    def: def(),
    rows,
    compareRows: null,
    range,
    comparisonRange: null,
    filters: [def().filters],
    search: undefined,
    sort: undefined,
    includeTax: false,
    page: 1,
    pageSize: 25,
    preview: false,
    ...over,
  });

  it('counts only the range, and the KPIs, chart and table agree', () => {
    const c = compute(input() as never);
    // Tax is left out: 10,000 + 20,000.
    expect(c.total).toBe(2);
    expect(c.totals).toEqual({ total: 30_000 });
    expect(c.kpis.find((k) => k.key === 'total')?.value).toBe(30_000);
    expect(c.kpis[0]).toMatchObject({ key: 'count', value: 2 });
    expect(c.chart?.series[0]?.values.reduce<number>((a, b) => a + (b ?? 0), 0)).toBe(30_000);
    expect(c.chart?.labels).toHaveLength(31);
    expect(c.notices).toContain('Amounts exclude tax.');
    const withTax = compute(input({ includeTax: true }) as never);
    expect(withTax.totals).toEqual({ total: 33_000 });
    expect(withTax.notices).not.toContain('Amounts exclude tax.');
  });

  it('groups, adds percentages that total 100, and sorts', () => {
    const c = compute(
      input({ def: def({ groupBy: 'status', showPercentage: true, columns: ['total'] }) }) as never,
    );
    expect(c.columns.map((x) => x.key)).toEqual([
      'status',
      'count',
      'total',
      'countPct',
      'totalPct',
    ]);
    expect(c.all.map((r) => r.cells.status)).toEqual(['OPEN', 'PAID']);
    expect(c.all.reduce((n, r) => n + (r.cells.totalPct as number), 0)).toBeCloseTo(100, 0);
    const sorted = compute(input({ sort: { field: 'total', descending: true } }) as never);
    expect(sorted.all.map((r) => r.cells.number)).toEqual(['2', '1']);
    const searched = compute(input({ search: 'b' }) as never);
    expect(searched.all).toHaveLength(1);
  });

  it('compares with the other period and says so in an insight only when it moved enough', () => {
    const prev = [mk('p1', '2026-09-05', 10_000, 0)];
    const cmp = { from: '2026-09-01', to: '2026-09-30', timezone: TZ, label: 'y' };
    const c = compute(
      input({
        def: def({ compareTo: 'PREVIOUS_PERIOD' }),
        compareRows: prev,
        comparisonRange: cmp,
      }) as never,
    );
    expect(c.kpis.find((k) => k.key === 'total')).toMatchObject({
      value: 30_000,
      previous: 10_000,
      deltaPercent: 200,
    });
    expect(c.chart?.series).toHaveLength(2);
    expect(c.insights[0]).toMatchObject({ key: 'change_vs_comparison', value: 200 });
    const flat = compute(
      input({
        def: def({ compareTo: 'PREVIOUS_PERIOD' }),
        compareRows: [mk('q', '2026-09-05', 30_000, 0)],
        comparisonRange: cmp,
      }) as never,
    );
    expect(flat.insights).toEqual([]);
    // A comparison that was asked for but not possible is a notice, never a made-up number.
    expect(
      compute(input({ def: def({ compareTo: 'PREVIOUS_PERIOD' }) }) as never).notices.join(' '),
    ).toMatch(/Comparison is not available/);
  });

  it('pages and previews', () => {
    const many = Array.from({ length: 30 }, (_, i) => mk(String(i), '2026-10-10', 1_000, 0));
    const page = compute(input({ rows: many, page: 2, pageSize: 10 }) as never);
    expect(page.total).toBe(30);
    expect(page.rows).toHaveLength(10);
    const preview = compute(input({ rows: many, pageSize: 25, preview: true }) as never);
    expect(preview.rows).toHaveLength(10);
  });
});

describe('the CSV', () => {
  it('quotes every cell, writes money as dollars, totals last, and defuses formulas', () => {
    const csv = toCsv({
      columns: [
        { key: 'name', label: 'Client "Name"', type: 'TEXT', locked: true, sortable: true },
        { key: 'total', label: 'Total', type: 'MONEY', locked: false, sortable: true },
      ],
      all: [
        { cells: { name: '=SUM(A1)', total: 12_345 }, links: [] },
        { cells: { name: '+cmd', total: null }, links: [] },
        { cells: { name: 'Fine, "ok"', total: 0 }, links: [] },
      ],
      totals: { total: 12_345 },
    }).toString('utf8');
    expect(csv.startsWith('﻿"Client ""Name""","Total"\r\n')).toBe(true);
    expect(csv).toContain(`"'=SUM(A1)","123.45"`);
    expect(csv).toContain(`"'+cmd",""`);
    expect(csv).toContain('"Fine, ""ok""","0.00"');
    expect(csv.trim().split('\r\n').at(-1)).toBe('"Total","123.45"');
  });
});

describe('schedules', () => {
  it('turn a wall-clock time in the zone into the right instant, either side of daylight saving', () => {
    expect(zonedInstant('2026-01-15', '08:00', TZ).toISOString()).toBe('2026-01-15T13:00:00.000Z');
    expect(zonedInstant('2026-07-15', '08:00', TZ).toISOString()).toBe('2026-07-15T12:00:00.000Z');
    expect(zonedInstant('2026-03-08', '09:00', TZ).toISOString()).toBe('2026-03-08T13:00:00.000Z');
  });

  it('find the next run for each frequency', () => {
    const after = new Date('2026-10-17T16:00:00Z');
    const base = { weekday: null, dayOfMonth: null, monthOfYear: null, runTime: '08:00' };
    expect(nextRun({ ...base, frequency: 'DAILY' }, TZ, after).toISOString()).toBe(
      '2026-10-18T12:00:00.000Z',
    );
    // Saturday Oct 17: the next Monday is Oct 19.
    expect(nextRun({ ...base, frequency: 'WEEKLY', weekday: 1 }, TZ, after).toISOString()).toBe(
      '2026-10-19T12:00:00.000Z',
    );
    expect(nextRun({ ...base, frequency: 'MONTHLY', dayOfMonth: 1 }, TZ, after).toISOString()).toBe(
      '2026-11-01T13:00:00.000Z',
    );
    // A day past the month's end is its last day.
    expect(
      nextRun(
        { ...base, frequency: 'MONTHLY', dayOfMonth: 31 },
        TZ,
        new Date('2026-11-05T00:00:00Z'),
      ).toISOString(),
    ).toBe('2026-11-30T13:00:00.000Z');
    expect(
      nextRun({ ...base, frequency: 'QUARTERLY', dayOfMonth: 15 }, TZ, after).toISOString(),
    ).toBe('2027-01-15T13:00:00.000Z');
    expect(
      nextRun(
        { ...base, frequency: 'ANNUAL', monthOfYear: 3, dayOfMonth: 31 },
        TZ,
        after,
      ).toISOString(),
    ).toBe('2027-03-31T12:00:00.000Z');
    // Today's run time already passed: tomorrow's.
    expect(
      nextRun({ ...base, frequency: 'DAILY' }, TZ, new Date('2026-10-17T12:30:00Z')).toISOString(),
    ).toBe('2026-10-18T12:00:00.000Z');
    expect(
      nextRun({ ...base, frequency: 'DAILY' }, TZ, new Date('2026-10-17T11:30:00Z')).toISOString(),
    ).toBe('2026-10-17T12:00:00.000Z');
  });

  it('describe themselves in words', () => {
    const base = { weekday: null, dayOfMonth: null, monthOfYear: null };
    expect(describeSchedule({ ...base, frequency: 'DAILY', runTime: '00:05' })).toBe(
      'Every day at 12:05 AM',
    );
    expect(describeSchedule({ ...base, frequency: 'WEEKLY', weekday: 5, runTime: '17:30' })).toBe(
      'Every Friday at 5:30 PM',
    );
    expect(
      describeSchedule({ ...base, frequency: 'MONTHLY', dayOfMonth: 22, runTime: '08:00' }),
    ).toBe('Monthly on the 22nd at 8:00 AM');
    expect(
      describeSchedule({
        ...base,
        frequency: 'ANNUAL',
        monthOfYear: 12,
        dayOfMonth: 31,
        runTime: '12:00',
      }),
    ).toBe('Every year on December 31 at 12:00 PM');
  });
});
