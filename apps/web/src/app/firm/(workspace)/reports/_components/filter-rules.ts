import type {
  ReportField,
  ReportFieldType,
  ReportFilterCondition,
  ReportFilterOp,
} from '@firmivra/types';

// RP-F02, F09, F10 (Octavia's Reports review, Oct 28): the rules of one report filter, shared by
// the builder and More Filters. The operators come from the field's type, as the API takes them;
// money is typed in dollars and sent in cents; a value that does not fit is caught here, in its own
// field, before it reaches the report.

export type FilterField = Pick<ReportField, 'key' | 'label' | 'type' | 'options'>;

/** A filter as typed: the boxes' text, turned into a condition only when it fits. */
export interface FilterDraft {
  field: string;
  op: string;
  value: string;
  /** BETWEEN's second value. */
  to: string;
  /** IS_ANY_OF and IS_NONE_OF. */
  values: string[];
}

type Op = { value: ReportFilterOp; label: string };
const EMPTY: Op[] = [
  { value: 'IS_EMPTY', label: 'Is Empty' },
  { value: 'IS_NOT_EMPTY', label: 'Is Not Empty' },
];
const NUMERIC: Op[] = [
  { value: 'EQUALS', label: 'Equals' },
  { value: 'NOT_EQUALS', label: 'Not Equals' },
  { value: 'GREATER_THAN', label: 'Greater Than' },
  { value: 'LESS_THAN', label: 'Less Than' },
  { value: 'BETWEEN', label: 'Between' },
  ...EMPTY,
];
const DATES: Op[] = [
  { value: 'ON', label: 'On' },
  { value: 'BEFORE', label: 'Before' },
  { value: 'AFTER', label: 'After' },
  { value: 'BETWEEN', label: 'Between' },
  { value: 'RELATIVE', label: 'In the Range' },
  ...EMPTY,
];

/** The operators each field type takes (`OPS` in the reports engine), the most used first. */
export const OPS: Record<ReportFieldType, Op[]> = {
  TEXT: [
    { value: 'CONTAINS', label: 'Contains' },
    { value: 'EQUALS', label: 'Equals' },
    { value: 'NOT_EQUALS', label: 'Not Equals' },
    { value: 'NOT_CONTAINS', label: 'Does Not Contain' },
    { value: 'STARTS_WITH', label: 'Starts With' },
    ...EMPTY,
  ],
  NUMBER: NUMERIC,
  MONEY: NUMERIC,
  PERCENT: NUMERIC,
  DATE: DATES,
  DATETIME: DATES,
  STATUS: [
    { value: 'IS', label: 'Is' },
    { value: 'IS_NOT', label: 'Is Not' },
    { value: 'IS_ANY_OF', label: 'Is Any Of' },
    { value: 'IS_NONE_OF', label: 'Is None Of' },
    ...EMPTY,
  ],
  BOOLEAN: [
    { value: 'IS', label: 'Is' },
    { value: 'IS_NOT', label: 'Is Not' },
  ],
};

export const NO_VALUE = new Set(['IS_EMPTY', 'IS_NOT_EMPTY']);
export const isNumeric = (t: ReportFieldType) => t === 'NUMBER' || t === 'MONEY' || t === 'PERCENT';
export const isDate = (t: ReportFieldType) => t === 'DATE' || t === 'DATETIME';
export const isList = (op: string) => op === 'IS_ANY_OF' || op === 'IS_NONE_OF';

/** A new filter on a field, with the first operator its type takes. */
export const newDraft = (f: FilterField): FilterDraft => ({
  field: f.key,
  op: OPS[f.type][0]!.value,
  value: '',
  to: '',
  values: [],
});

/** The draft on another field: its operator kept when the new type takes it, the values cleared. */
export const onField = (d: FilterDraft, f: FilterField): FilterDraft => ({
  ...newDraft(f),
  ...(OPS[f.type].some((o) => o.value === d.op) ? { op: d.op } : {}),
});

const PRESET_KEYS = new Set([
  'today',
  'last_7_days',
  'last_30_days',
  'this_month',
  'last_month',
  'this_quarter',
  'last_quarter',
  'this_year',
  'last_year',
]);
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** A typed number in the field's unit: dollars become cents; "$1,250.50" and "15%" are read. */
export function amountOf(type: ReportFieldType, text: string): number | null {
  const t = text.trim().replace(/,/g, '').replace(/^\$/, '').replace(/%$/, '');
  if (type === 'MONEY') {
    if (!/^-?\d+(\.\d{1,2})?$/.test(t)) return null;
    return Math.round(Number(t) * 100);
  }
  return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : null;
}

/** What is wrong with a draft, in the words shown under its value; null when it fits. */
export function draftProblem(f: FilterField | undefined, d: FilterDraft): string | null {
  if (!f) return 'Choose a field.';
  if (!OPS[f.type].some((o) => o.value === d.op)) return `Choose how to compare ${f.label}.`;
  if (NO_VALUE.has(d.op)) return null;
  if (isNumeric(f.type)) {
    const what =
      f.type === 'MONEY'
        ? 'an amount in dollars, like 500 or 500.50'
        : f.type === 'PERCENT'
          ? 'a percentage, like 15'
          : 'a number, like 500';
    const a = amountOf(f.type, d.value);
    if (a === null) return `Enter ${what}.`;
    if (d.op === 'BETWEEN') {
      const b = amountOf(f.type, d.to);
      if (b === null) return `Enter ${what} in both boxes.`;
      if (a > b) return 'The first value must not be above the second.';
    }
    return null;
  }
  if (isDate(f.type)) {
    if (d.op === 'RELATIVE') return PRESET_KEYS.has(d.value) ? null : 'Choose a date range.';
    if (!DAY.test(d.value)) return d.op === 'BETWEEN' ? 'Choose both dates.' : 'Choose a date.';
    if (d.op === 'BETWEEN') {
      if (!DAY.test(d.to)) return 'Choose both dates.';
      if (d.value > d.to) return 'The start date must be on or before the end date.';
    }
    return null;
  }
  if (f.type === 'STATUS') {
    if (isList(d.op)) return d.values.length ? null : 'Choose at least one.';
    return d.value ? null : 'Choose a value.';
  }
  if (f.type === 'BOOLEAN')
    return d.value === 'true' || d.value === 'false' ? null : 'Choose Yes or No.';
  if (!d.value.trim()) return 'Enter some text.';
  return d.value.trim().length > 200 ? 'Use 200 characters or fewer.' : null;
}

/** The condition the API takes for a draft that fits (check `draftProblem` first). */
export function toCondition(f: FilterField, d: FilterDraft): ReportFilterCondition {
  const op = d.op as ReportFilterOp;
  if (NO_VALUE.has(op)) return { field: f.key, op };
  if (isNumeric(f.type)) {
    const from = amountOf(f.type, d.value)!;
    return op === 'BETWEEN'
      ? { field: f.key, op, value: { from, to: amountOf(f.type, d.to)! } }
      : { field: f.key, op, value: from };
  }
  if (isDate(f.type) && op === 'BETWEEN')
    return { field: f.key, op, value: { from: d.value, to: d.to } };
  if (isList(op)) return { field: f.key, op, value: d.values };
  if (f.type === 'BOOLEAN') return { field: f.key, op, value: d.value === 'true' };
  return { field: f.key, op, value: f.type === 'TEXT' ? d.value.trim() : d.value };
}

/** The drafts that fit as conditions, and each draft's problem by its position. */
export function conditionsOf(
  fields: readonly FilterField[],
  drafts: readonly FilterDraft[],
): { conditions: ReportFilterCondition[]; problems: (string | null)[] } {
  const problems = drafts.map((d) =>
    draftProblem(
      fields.find((f) => f.key === d.field),
      d,
    ),
  );
  const conditions = drafts.flatMap((d, i) => {
    const f = fields.find((x) => x.key === d.field);
    return f && !problems[i] ? [toCondition(f, d)] : [];
  });
  return { conditions, problems };
}
