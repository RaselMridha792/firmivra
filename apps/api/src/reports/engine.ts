import type {
  ReportChart,
  ReportCompareTo,
  ReportDatePreset,
  ReportDefinitionView,
  ReportField,
  ReportFieldType,
  ReportFilterChip,
  ReportFilterOp,
  ReportInsight,
  ReportKpi,
  ReportRange,
  ReportTableColumn,
  ReportTableRow,
} from '@firmivra/types';
import type { Cell, Row, SourceDef } from './sources.js';

// The reporting engine: date ranges in the firm's time zone, filter evaluation, and the one
// computation every KPI card, chart, table, export and schedule goes through. It is pure: rows
// in, a result out, so the same definition over the same rows always gives the same numbers. A
// metric with no data is 0, null or left out as its definition says; nothing is invented.

// ---------- Days and ranges ----------

const MS_DAY = 86_400_000;
const utc = (day: string) => new Date(`${day}T00:00:00.000Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);
export const addDays = (day: string, n: number) => iso(new Date(utc(day).getTime() + n * MS_DAY));
const daysBetween = (a: string, b: string) =>
  Math.round((utc(b).getTime() - utc(a).getTime()) / MS_DAY);
const monthStart = (day: string) => `${day.slice(0, 7)}-01`;
const addMonths = (day: string, n: number) => {
  const d = utc(monthStart(day));
  d.setUTCMonth(d.getUTCMonth() + n);
  return iso(d);
};
const endOfMonth = (monthFirst: string) => addDays(addMonths(monthFirst, 1), -1);
const quarterStart = (day: string) => {
  const m = Number(day.slice(5, 7));
  const first = Math.floor((m - 1) / 3) * 3 + 1;
  return `${day.slice(0, 4)}-${String(first).padStart(2, '0')}-01`;
};

const FORMAT = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'UTC',
});
const fmt = (day: string) => FORMAT.format(utc(day));

export const todayIn = (timezone: string, now = new Date()) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);

const PRESET_LABELS: Record<ReportDatePreset, string> = {
  today: 'Today',
  last_7_days: 'Last 7 Days',
  last_30_days: 'Last 30 Days',
  this_month: 'This Month',
  last_month: 'Last Month',
  this_quarter: 'This Quarter',
  last_quarter: 'Last Quarter',
  this_year: 'This Year',
  last_year: 'Last Year',
};

export function presetBounds(
  preset: ReportDatePreset,
  today: string,
): { from: string; to: string } {
  switch (preset) {
    case 'today':
      return { from: today, to: today };
    case 'last_7_days':
      return { from: addDays(today, -6), to: today };
    case 'last_30_days':
      return { from: addDays(today, -29), to: today };
    case 'this_month':
      return { from: monthStart(today), to: today };
    case 'last_month': {
      const first = addMonths(today, -1);
      return { from: first, to: endOfMonth(first) };
    }
    case 'this_quarter':
      return { from: quarterStart(today), to: today };
    case 'last_quarter': {
      const first = addMonths(quarterStart(today), -3);
      return { from: first, to: endOfMonth(addMonths(first, 2)) };
    }
    case 'this_year':
      return { from: `${today.slice(0, 4)}-01-01`, to: today };
    case 'last_year': {
      const y = Number(today.slice(0, 4)) - 1;
      return { from: `${y}-01-01`, to: `${y}-12-31` };
    }
  }
}

export type DateSpec =
  { rule: 'ROLLING'; preset: ReportDatePreset } | { rule: 'FIXED'; from: string; to: string };

export function rangeOf(spec: DateSpec, timezone: string, now = new Date()): ReportRange {
  const today = todayIn(timezone, now);
  if (spec.rule === 'ROLLING') {
    const b = presetBounds(spec.preset, today);
    return { ...b, timezone, label: PRESET_LABELS[spec.preset] };
  }
  return { from: spec.from, to: spec.to, timezone, label: `${fmt(spec.from)} – ${fmt(spec.to)}` };
}

/** The comparison range, or null when none applies (NONE, or an unbounded or unsuitable range). */
export function comparisonOf(
  range: ReportRange,
  spec: DateSpec,
  compareTo: ReportCompareTo,
): ReportRange | null {
  if (compareTo === 'NONE') return null;
  if (compareTo === 'SAME_PERIOD_LAST_YEAR') {
    const back = (d: string) => {
      const dt = utc(d);
      dt.setUTCFullYear(dt.getUTCFullYear() - 1);
      // Feb 29 has no day a year earlier: the 28th.
      return iso(dt) === d.replace(/^\d{4}/, String(Number(d.slice(0, 4)) - 1))
        ? iso(dt)
        : iso(new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), 0)));
    };
    const from = back(range.from);
    const to = back(range.to);
    return { from, to, timezone: range.timezone, label: `${fmt(from)} – ${fmt(to)}` };
  }
  // PREVIOUS_PERIOD: the calendar unit before for month, quarter and year presets, else the same length before.
  let from: string;
  let to: string;
  const preset = spec.rule === 'ROLLING' ? spec.preset : null;
  if (preset === 'this_month' || preset === 'last_month') {
    from = addMonths(range.from, -1);
    to =
      preset === 'last_month'
        ? endOfMonth(from)
        : addDays(
            from,
            Math.min(daysBetween(range.from, range.to), daysBetween(from, endOfMonth(from))),
          );
  } else if (preset === 'this_quarter' || preset === 'last_quarter') {
    from = addMonths(range.from, -3);
    to =
      preset === 'last_quarter'
        ? endOfMonth(addMonths(from, 2))
        : addDays(
            from,
            Math.min(
              daysBetween(range.from, range.to),
              daysBetween(from, endOfMonth(addMonths(from, 2))),
            ),
          );
  } else if (preset === 'this_year' || preset === 'last_year') {
    const y = Number(range.from.slice(0, 4)) - 1;
    from = `${y}-01-01`;
    to = preset === 'last_year' ? `${y}-12-31` : `${y}${range.to.slice(4)}`;
  } else {
    const length = daysBetween(range.from, range.to) + 1;
    to = addDays(range.from, -1);
    from = addDays(to, -(length - 1));
  }
  return { from, to, timezone: range.timezone, label: `${fmt(from)} – ${fmt(to)}` };
}

// ---------- Filters ----------

export interface Condition {
  field: string;
  op: ReportFilterOp;
  value?: string | number | boolean | string[] | { from: string | number; to: string | number };
}
export interface Filters {
  logic: 'AND' | 'OR';
  conditions: Condition[];
  groups: { logic: 'AND' | 'OR'; conditions: Condition[] }[];
}

/** The operators each field type takes. */
export const OPS: Record<ReportFieldType, readonly string[]> = {
  TEXT: [
    'EQUALS',
    'NOT_EQUALS',
    'CONTAINS',
    'NOT_CONTAINS',
    'STARTS_WITH',
    'IS_EMPTY',
    'IS_NOT_EMPTY',
  ],
  NUMBER: [
    'EQUALS',
    'NOT_EQUALS',
    'GREATER_THAN',
    'LESS_THAN',
    'BETWEEN',
    'IS_EMPTY',
    'IS_NOT_EMPTY',
  ],
  MONEY: [
    'EQUALS',
    'NOT_EQUALS',
    'GREATER_THAN',
    'LESS_THAN',
    'BETWEEN',
    'IS_EMPTY',
    'IS_NOT_EMPTY',
  ],
  PERCENT: [
    'EQUALS',
    'NOT_EQUALS',
    'GREATER_THAN',
    'LESS_THAN',
    'BETWEEN',
    'IS_EMPTY',
    'IS_NOT_EMPTY',
  ],
  DATE: ['ON', 'BEFORE', 'AFTER', 'BETWEEN', 'RELATIVE', 'IS_EMPTY', 'IS_NOT_EMPTY'],
  DATETIME: ['ON', 'BEFORE', 'AFTER', 'BETWEEN', 'RELATIVE', 'IS_EMPTY', 'IS_NOT_EMPTY'],
  STATUS: ['IS', 'IS_NOT', 'IS_ANY_OF', 'IS_NONE_OF', 'IS_EMPTY', 'IS_NOT_EMPTY'],
  BOOLEAN: ['IS', 'IS_NOT'],
};

const NO_VALUE = new Set(['IS_EMPTY', 'IS_NOT_EMPTY']);
const isEmpty = (v: Cell) => v === null || v === '';
const str = (v: unknown) => String(v ?? '').toLowerCase();
const num = (v: unknown) => (typeof v === 'number' ? v : Number(v));
const pair = (v: unknown): [unknown, unknown] | null =>
  v && typeof v === 'object' && !Array.isArray(v) && 'from' in v && 'to' in v
    ? [(v as { from: unknown }).from, (v as { to: unknown }).to]
    : null;

/** Whether a condition's value is present and of the right shape for its operator and type. */
export function conditionShapeOk(type: ReportFieldType, c: Condition): boolean {
  if (NO_VALUE.has(c.op)) return true;
  if (c.value === undefined) return false;
  if (c.op === 'BETWEEN') {
    const p = pair(c.value);
    return (
      !!p &&
      (type === 'DATE' || type === 'DATETIME'
        ? typeof p[0] === 'string' && typeof p[1] === 'string'
        : !Number.isNaN(num(p[0])) && !Number.isNaN(num(p[1])))
    );
  }
  if (c.op === 'IS_ANY_OF' || c.op === 'IS_NONE_OF')
    return Array.isArray(c.value) && c.value.length > 0;
  if (c.op === 'RELATIVE') return typeof c.value === 'string' && c.value in PRESET_LABELS;
  if (type === 'NUMBER' || type === 'MONEY' || type === 'PERCENT')
    return !Number.isNaN(num(c.value));
  if (type === 'BOOLEAN') return typeof c.value === 'boolean';
  if (type === 'DATE' || type === 'DATETIME')
    return typeof c.value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(c.value);
  return typeof c.value === 'string' || typeof c.value === 'number';
}

function matchOne(cell: Cell, f: ReportField, c: Condition, today: string): boolean {
  const empty = isEmpty(cell);
  switch (c.op) {
    case 'IS_EMPTY':
      return empty;
    case 'IS_NOT_EMPTY':
      return !empty;
    case 'EQUALS':
      return f.type === 'TEXT' ? str(cell) === str(c.value) : !empty && num(cell) === num(c.value);
    case 'NOT_EQUALS':
      return f.type === 'TEXT' ? str(cell) !== str(c.value) : empty || num(cell) !== num(c.value);
    case 'CONTAINS':
      return !empty && str(cell).includes(str(c.value));
    case 'NOT_CONTAINS':
      return empty || !str(cell).includes(str(c.value));
    case 'STARTS_WITH':
      return !empty && str(cell).startsWith(str(c.value));
    case 'GREATER_THAN':
      return !empty && num(cell) > num(c.value);
    case 'LESS_THAN':
      return !empty && num(cell) < num(c.value);
    case 'BETWEEN': {
      const p = pair(c.value);
      if (!p || empty) return false;
      if (f.type === 'DATE' || f.type === 'DATETIME')
        return (
          String(cell) >= String(p[0]).slice(0, 10) && String(cell) <= String(p[1]).slice(0, 10)
        );
      return num(cell) >= num(p[0]) && num(cell) <= num(p[1]);
    }
    case 'ON':
      return !empty && String(cell).slice(0, 10) === String(c.value).slice(0, 10);
    case 'BEFORE':
      return !empty && String(cell).slice(0, 10) < String(c.value).slice(0, 10);
    case 'AFTER':
      return !empty && String(cell).slice(0, 10) > String(c.value).slice(0, 10);
    case 'RELATIVE': {
      if (empty) return false;
      const b = presetBounds(c.value as ReportDatePreset, today);
      return String(cell) >= b.from && String(cell) <= b.to;
    }
    case 'IS':
      return f.type === 'BOOLEAN' ? cell === c.value : cell === c.value;
    case 'IS_NOT':
      return cell !== c.value;
    case 'IS_ANY_OF':
      return !empty && (c.value as unknown[]).map(String).includes(String(cell));
    case 'IS_NONE_OF':
      return empty || !(c.value as unknown[]).map(String).includes(String(cell));
    default:
      return false;
  }
}

export function matches(
  row: Row,
  filters: Filters,
  fields: Map<string, ReportField>,
  today: string,
): boolean {
  const test = (c: Condition) => {
    const f = fields.get(c.field);
    return f ? matchOne(row.cells[c.field] ?? null, f, c, today) : false;
  };
  const combine = (logic: 'AND' | 'OR', results: boolean[]) =>
    results.length === 0 ? true : logic === 'AND' ? results.every(Boolean) : results.some(Boolean);
  const top = combine(filters.logic, filters.conditions.map(test));
  // Inner groups each combine by their own logic, then join the top level's logic.
  const groups = filters.groups.map((g) => combine(g.logic, g.conditions.map(test)));
  if (groups.length === 0) return top;
  const parts = [...(filters.conditions.length ? [top] : []), ...groups];
  return combine(filters.logic, parts);
}

/** The filters as chips for the detail view. */
export function chipsOf(filters: Filters, fields: Map<string, ReportField>): ReportFilterChip[] {
  const text = (c: Condition) => {
    if (NO_VALUE.has(c.op)) return c.op === 'IS_EMPTY' ? 'is empty' : 'is not empty';
    const op = c.op.toLowerCase().replace(/_/g, ' ');
    const v = pair(c.value)
      ? `${String((c.value as { from: unknown }).from)} and ${String((c.value as { to: unknown }).to)}`
      : Array.isArray(c.value)
        ? c.value.join(', ')
        : String(c.value);
    return `${op} ${v}`;
  };
  return [...filters.conditions, ...filters.groups.flatMap((g) => g.conditions)].map((c) => ({
    field: c.field,
    label: fields.get(c.field)?.label ?? c.field,
    value: text(c),
  }));
}

// ---------- Validation ----------

export interface DefinitionLike {
  columns: string[];
  filters: Filters;
  groupBy: string | null;
  sortBy: string | null;
  showTotals: boolean;
  showPercentage: boolean;
  compareTo: ReportCompareTo;
}

export interface Problem {
  path: string;
  message: string;
}

/**
 * What the data source does not allow in a definition: unknown, not groupable, not sortable or not
 * filterable fields, an operator or value the field's type does not take, totals or percentages
 * with nothing to total, comparison on a source without it. `forbidden` are fields of the source
 * the caller may not see (sensitive ones): a different answer (403), so the screen can say so.
 */
export function checkDefinition(
  d: DefinitionLike,
  source: SourceDef,
  canSeeSensitive: boolean,
): { problems: Problem[]; forbidden: string[] } {
  const problems: Problem[] = [];
  const forbidden: string[] = [];
  const fields = new Map(source.fields.map((f) => [f.key, f]));
  const known = (key: string, path: string) => {
    const f = fields.get(key);
    if (!f) {
      problems.push({ path, message: `“${key}” is not a field of ${source.label}` });
      return null;
    }
    if (f.sensitive && !canSeeSensitive) {
      forbidden.push(key);
      return null;
    }
    return f;
  };
  d.columns.forEach((k, i) => known(k, `columns.${i}`));
  if (d.groupBy) {
    const f = known(d.groupBy, 'groupBy');
    if (f && !f.groupable)
      problems.push({ path: 'groupBy', message: `${f.label} cannot be grouped` });
  }
  if (d.sortBy) {
    const f = known(d.sortBy, 'sortBy');
    if (f && !f.sortable) problems.push({ path: 'sortBy', message: `${f.label} cannot be sorted` });
  }
  const conditions = [
    ...d.filters.conditions.map((c, i) => [c, `filters.conditions.${i}`] as const),
    ...d.filters.groups.flatMap((g, gi) =>
      g.conditions.map((c, i) => [c, `filters.groups.${gi}.conditions.${i}`] as const),
    ),
  ];
  for (const [c, path] of conditions) {
    const f = known(c.field, `${path}.field`);
    if (!f) continue;
    if (!f.filterable)
      problems.push({ path: `${path}.field`, message: `${f.label} cannot be filtered` });
    else if (!OPS[f.type].includes(c.op))
      problems.push({
        path: `${path}.op`,
        message: `${f.label} does not take “${c.op.toLowerCase().replace(/_/g, ' ')}”`,
      });
    else if (!conditionShapeOk(f.type, c))
      problems.push({ path: `${path}.value`, message: `Enter a valid value for ${f.label}` });
    else if (
      f.type === 'STATUS' &&
      f.options.length > 0 &&
      (c.op === 'IS' || c.op === 'IS_NOT' || c.op === 'IS_ANY_OF' || c.op === 'IS_NONE_OF')
    ) {
      const values = Array.isArray(c.value) ? c.value.map(String) : [String(c.value)];
      const bad = values.find((v) => !f.options.some((o) => o.value === v));
      if (bad)
        problems.push({ path: `${path}.value`, message: `“${bad}” is not a value of ${f.label}` });
    }
  }
  const aggregatable = d.columns.some((k) => fields.get(k)?.aggregatable) || d.groupBy !== null;
  if ((d.showTotals || d.showPercentage) && !aggregatable) {
    problems.push({
      path: d.showTotals ? 'showTotals' : 'showPercentage',
      message: 'Choose a number or money column to total',
    });
  }
  if (d.compareTo !== 'NONE' && !source.supportsComparison) {
    problems.push({ path: 'compareTo', message: `${source.label} cannot be compared` });
  }
  return { problems, forbidden };
}

// ---------- The computation ----------

export interface ComputeInput {
  source: SourceDef;
  def: ReportDefinitionView;
  rows: Row[];
  /** Rows of the comparison period, already loaded and not yet range-filtered. */
  compareRows: Row[] | null;
  range: ReportRange;
  comparisonRange: ReportRange | null;
  /** All must match: the definition's, then the "More Filters" panel's and the quick filters'. */
  filters: Filters[];
  /** The caller's search (name-ish text columns) and sort override. */
  search: string | undefined;
  sort: { field: string; descending: boolean } | undefined;
  includeTax: boolean;
  page: number;
  pageSize: number;
  preview: boolean;
  /** Hidden columns are left out of the table (an export). */
  hiddenColumns?: string[];
}

export interface Computed {
  kpis: ReportKpi[];
  chart: ReportChart | null;
  breakdown: ReportChart | null;
  columns: ReportTableColumn[];
  rows: ReportTableRow[];
  totals: Record<string, number> | null;
  total: number;
  insights: Pick<ReportInsight, 'key' | 'message' | 'metric' | 'value' | 'threshold'>[];
  notices: string[];
  /** All rows of the table (for an export), after filter, group and sort. */
  all: ReportTableRow[];
}

const inRange = (cells: Record<string, Cell>, dateField: string, range: ReportRange) => {
  const d = cells[dateField];
  return typeof d === 'string' && d >= range.from && d <= range.to;
};

function prepare(
  source: SourceDef,
  rows: Row[],
  range: ReportRange,
  filters: Filters[],
  today: string,
  includeTax: boolean,
): Row[] {
  const fields = new Map(source.fields.map((f) => [f.key, f]));
  return rows
    .filter((r) => inRange(r.cells, source.dateField, range))
    .filter((r) => filters.every((f) => matches(r, f, fields, today)))
    .map((r) =>
      source.supportsTaxToggle && !includeTax && typeof r.cells.total === 'number'
        ? {
            ...r,
            cells: {
              ...r.cells,
              total: r.cells.total - (typeof r.cells.tax === 'number' ? r.cells.tax : 0),
            },
          }
        : r,
    );
}

const sum = (rows: Row[], key: string) =>
  rows.reduce((n, r) => n + (typeof r.cells[key] === 'number' ? (r.cells[key] as number) : 0), 0);

const pct = (n: number, d: number) =>
  d === 0 ? null : Math.round(((n - d) / Math.abs(d)) * 1000) / 10;

function buckets(range: ReportRange): {
  keys: string[];
  of: (day: string) => string;
  label: (key: string) => string;
} {
  const days = daysBetween(range.from, range.to) + 1;
  if (days <= 31) {
    const keys = Array.from({ length: days }, (_, i) => addDays(range.from, i));
    return { keys, of: (d) => d, label: (k) => fmt(k) };
  }
  if (days <= 120) {
    // Weeks starting Monday.
    const monday = (d: string) => addDays(d, -((utc(d).getUTCDay() + 6) % 7));
    const keys: string[] = [];
    for (let d = monday(range.from); d <= range.to; d = addDays(d, 7)) keys.push(d);
    return { keys, of: monday, label: (k) => `Week of ${fmt(k)}` };
  }
  const keys: string[] = [];
  for (let d = monthStart(range.from); d <= range.to; d = addMonths(d, 1)) keys.push(d);
  return {
    keys,
    of: monthStart,
    label: (k) =>
      new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(
        utc(k),
      ),
  };
}

export function compute(input: ComputeInput): Computed {
  const { source, def } = input;
  const fields = new Map(source.fields.map((f) => [f.key, f]));
  const today = todayIn(input.range.timezone);
  const rows = prepare(source, input.rows, input.range, input.filters, today, input.includeTax);
  const previous =
    input.compareRows && input.comparisonRange
      ? prepare(
          source,
          input.compareRows,
          input.comparisonRange,
          input.filters,
          today,
          input.includeTax,
        )
      : null;
  const notices: string[] = [];
  if (source.supportsTaxToggle && !input.includeTax) notices.push('Amounts exclude tax.');
  if (def.compareTo !== 'NONE' && !previous)
    notices.push('Comparison is not available for this report.');

  // The measure: the first number or money column chosen (or the source's first), else the count.
  const measureField = [...def.columns, ...source.defaultColumns]
    .map((k) => fields.get(k))
    .find((f) => f?.aggregatable);
  const measure = (list: Row[]) => (measureField ? sum(list, measureField.key) : list.length);

  // KPIs: the count, and the sums of up to three number or money columns.
  const kpis: ReportKpi[] = [];
  const kpi = (
    key: string,
    label: string,
    type: ReportFieldType,
    value: number,
    prev: number | null,
    definition: string | null,
  ): ReportKpi => ({
    key,
    label,
    type,
    value,
    previous: prev,
    deltaPercent: prev === null ? null : pct(value, prev),
    definition,
  });
  kpis.push(
    kpi(
      'count',
      `Total ${source.label}`,
      'NUMBER',
      rows.length,
      previous ? previous.length : null,
      `Rows of ${source.label} in the range that match the filters.`,
    ),
  );
  for (const f of def.columns
    .map((k) => fields.get(k))
    .filter((x): x is ReportField => !!x && x.aggregatable)
    .slice(0, 3)) {
    kpis.push(
      kpi(
        f.key,
        `Total ${f.label}`,
        f.type,
        sum(rows, f.key),
        previous ? sum(previous, f.key) : null,
        null,
      ),
    );
  }

  // The time chart over the range, the main series and the comparison aligned by position.
  const b = buckets(input.range);
  const series = (list: Row[], range: ReportRange, comparison: boolean) => {
    const bk = buckets(range);
    const values = new Map<string, number>(bk.keys.map((k) => [k, 0]));
    for (const r of list) {
      const d = r.cells[source.dateField];
      if (typeof d !== 'string') continue;
      const key = bk.of(d);
      if (!values.has(key)) continue;
      values.set(
        key,
        (values.get(key) ?? 0) +
          (measureField
            ? typeof r.cells[measureField.key] === 'number'
              ? (r.cells[measureField.key] as number)
              : 0
            : 1),
      );
    }
    return {
      key: comparison ? 'comparison' : 'measure',
      label: `${measureField ? measureField.label : source.label}${comparison ? ' (comparison)' : ''}`,
      comparison,
      values: bk.keys.map((k) => values.get(k) ?? 0),
    };
  };
  const main = series(rows, input.range, false);
  const chartSeries = [main];
  if (previous && input.comparisonRange) {
    const comp = series(previous, input.comparisonRange, true);
    // Align lengths (ranges of different spans): pad with null so each position compares.
    const length = Math.max(main.values.length, comp.values.length);
    chartSeries[0] = {
      ...main,
      values: [...main.values, ...Array<number>(length - main.values.length).fill(0)],
    };
    chartSeries.push({
      ...comp,
      values: [...comp.values, ...Array<number>(length - comp.values.length).fill(0)],
    });
  }
  const chart: ReportChart = {
    type: def.chartType === 'AUTO' ? 'LINE' : def.chartType,
    labels: b.keys.map(b.label),
    series: chartSeries.map((s) => ({ ...s, values: s.values })),
    money: measureField?.type === 'MONEY',
  };

  // The breakdown: by the grouping, else the first status field.
  const breakdownField =
    (def.groupBy ? fields.get(def.groupBy) : null) ??
    def.columns.map((k) => fields.get(k)).find((f) => f?.type === 'STATUS') ??
    source.fields.find((f) => f.type === 'STATUS') ??
    null;
  let breakdown: ReportChart | null = null;
  if (breakdownField) {
    const counts = new Map<string, number>();
    for (const r of rows) {
      const v = r.cells[breakdownField.key];
      const label = v === null || v === '' ? 'Unknown' : String(v);
      counts.set(
        label,
        (counts.get(label) ?? 0) +
          (measureField && breakdownField.key === def.groupBy
            ? typeof r.cells[measureField.key] === 'number'
              ? (r.cells[measureField.key] as number)
              : 0
            : 1),
      );
    }
    const entries = [...counts.entries()].sort((a, c) => c[1] - a[1]).slice(0, 12);
    breakdown = {
      type: 'DONUT',
      labels: entries.map(([k]) => k),
      series: [
        {
          key: 'breakdown',
          label: breakdownField.label,
          comparison: false,
          values: entries.map(([, v]) => v),
        },
      ],
      money: measureField?.type === 'MONEY' && breakdownField.key === def.groupBy,
    };
  }

  // The table: detail rows, or the groups.
  const needle = input.search?.toLowerCase();
  const searchable = source.fields
    .filter((f) => f.type === 'TEXT' && !f.sensitive)
    .map((f) => f.key);
  const searched = needle
    ? rows.filter((r) =>
        searchable.some((k) =>
          String(r.cells[k] ?? '')
            .toLowerCase()
            .includes(needle),
        ),
      )
    : rows;
  const sortField = input.sort?.field ?? def.sortBy;
  const descending = input.sort ? input.sort.descending : def.sortDescending;

  let columns: ReportTableColumn[];
  let all: ReportTableRow[];
  let totals: Record<string, number> | null = null;
  const hidden = new Set((input.hiddenColumns ?? []).filter((k) => !fields.get(k)?.locked));

  if (def.groupBy) {
    const gf = fields.get(def.groupBy)!;
    const sums = def.columns
      .map((k) => fields.get(k))
      .filter((f): f is ReportField => !!f && f.aggregatable && f.key !== def.groupBy);
    const groups = new Map<string, Row[]>();
    for (const r of searched) {
      const v = r.cells[def.groupBy];
      const key = v === null || v === '' ? 'Unknown' : String(v);
      groups.set(key, [...(groups.get(key) ?? []), r]);
    }
    const grand = {
      count: searched.length,
      ...Object.fromEntries(sums.map((f) => [f.key, sum(searched, f.key)])),
    } as Record<string, number>;
    columns = [
      { key: def.groupBy, label: gf.label, type: gf.type, locked: true, sortable: true },
      { key: 'count', label: 'Count', type: 'NUMBER', locked: false, sortable: true },
      ...sums.map((f) => ({
        key: f.key,
        label: f.label,
        type: f.type,
        locked: false,
        sortable: true,
      })),
      ...(def.showPercentage
        ? [
            {
              key: 'countPct',
              label: 'Count %',
              type: 'PERCENT' as const,
              locked: false,
              sortable: true,
            },
            ...sums.map((f) => ({
              key: `${f.key}Pct`,
              label: `${f.label} %`,
              type: 'PERCENT' as const,
              locked: false,
              sortable: true,
            })),
          ]
        : []),
    ];
    all = [...groups.entries()].map(([key, list]) => {
      const cells: Record<string, Cell> = { [def.groupBy!]: key, count: list.length };
      for (const f of sums) cells[f.key] = sum(list, f.key);
      if (def.showPercentage) {
        cells.countPct = grand.count ? Math.round((list.length / grand.count) * 1000) / 10 : null;
        for (const f of sums)
          cells[`${f.key}Pct`] = grand[f.key]
            ? Math.round(((cells[f.key] as number) / grand[f.key]!) * 1000) / 10
            : null;
      }
      return { cells, links: [] };
    });
    const sortKey = sortField && columns.some((c) => c.key === sortField) ? sortField : 'count';
    const dir = sortField && columns.some((c) => c.key === sortField) ? descending : true;
    all.sort(
      (a, c) =>
        cmp(a.cells[sortKey] ?? null, c.cells[sortKey] ?? null, dir) ||
        cmp(a.cells[def.groupBy!] ?? null, c.cells[def.groupBy!] ?? null, false),
    );
    if (def.showTotals) totals = grand;
  } else {
    const shown = def.columns.filter((k) => fields.has(k) && !hidden.has(k));
    columns = shown.map((k) => {
      const f = fields.get(k)!;
      return { key: k, label: f.label, type: f.type, locked: f.locked, sortable: f.sortable };
    });
    const sorted = [...searched];
    if (sortField && fields.get(sortField)?.sortable)
      sorted.sort((a, c) =>
        cmp(a.cells[sortField] ?? null, c.cells[sortField] ?? null, descending),
      );
    all = sorted.map((r) => ({
      cells: Object.fromEntries(shown.map((k) => [k, r.cells[k] ?? null])),
      links: r.links,
    }));
    if (def.showTotals) {
      totals = Object.fromEntries(
        shown.filter((k) => fields.get(k)?.aggregatable).map((k) => [k, sum(searched, k)]),
      );
      if (Object.keys(totals).length === 0) totals = null;
    }
  }

  const start = (input.page - 1) * input.pageSize;
  const limit = input.preview ? Math.min(input.pageSize, 10) : input.pageSize;
  const pageRows = all.slice(start, start + limit);

  // Insights: only from the numbers in front of us, only when there is something to compare.
  const insights: Computed['insights'] = [];
  if (previous) {
    const now = measure(rows);
    const before = measure(previous);
    const change = pct(now, before);
    if (change !== null && Math.abs(change) >= 10) {
      const what = measureField ? `${measureField.label}` : source.label;
      insights.push({
        key: 'change_vs_comparison',
        message: `${what} is ${change > 0 ? 'up' : 'down'} ${Math.abs(change)}% against the comparison period.`,
        metric: measureField?.key ?? 'count',
        value: change,
        threshold: '10%',
      });
    }
  }

  return {
    kpis,
    chart,
    breakdown,
    columns,
    rows: pageRows,
    totals,
    total: all.length,
    insights,
    notices,
    all,
  };
}

function cmp(a: Cell, b: Cell, descending: boolean): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  const r =
    typeof a === 'number' && typeof b === 'number'
      ? a - b
      : String(a).localeCompare(String(b), 'en', { numeric: true, sensitivity: 'base' });
  return descending ? -r : r;
}

/** A definition's days of data needed: the range and its comparison, for loading rows once. */
export const spanOf = (range: ReportRange, comparison: ReportRange | null) => ({
  from: comparison && comparison.from < range.from ? comparison.from : range.from,
  to: comparison && comparison.to > range.to ? comparison.to : range.to,
});
