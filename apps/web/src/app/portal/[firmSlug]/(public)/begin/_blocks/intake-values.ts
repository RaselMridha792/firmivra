import {
  checkIntakeAnswers,
  type IntakeAnswers,
  type IntakeAnswerValue,
  type IntakeField,
  type IntakeFormDefinition,
  type IntakeIssue,
  type IntakeScalarField,
  type IntakeStep,
  type IntakeUpload,
  intakeConditionHolds,
  intakeStepFields,
  intakeUploadCounts,
  type MaskedNumber,
  type ScanStatus,
} from '@firmivra/types';

// What the screen holds for each answer while the person types, and the conversion to and from
// the answers the API takes (packages/types/src/intake/answers.ts). Inputs hold text ("1,234.50"
// for a currency); numbers become cents only when a step is saved or checked.

export type ScreenScalar = string | string[] | boolean | null | MaskedNumber;
export type ScreenRow = { id: string } & Record<string, ScreenScalar>;
export type ScreenGrid = Record<string, Record<string, string>>;
export interface ScreenUpload {
  notAvailable: boolean;
  reason: string;
}
export type ScreenValue = ScreenScalar | ScreenRow[] | ScreenGrid | ScreenUpload;
export type ScreenValues = Record<string, ScreenValue>;

export const isMasked = (v: unknown): v is MaskedNumber =>
  typeof v === 'object' && v !== null && !Array.isArray(v) && 'last4' in v;

/** Text typed into a currency input as cents; null when it is not an amount. */
export function toCents(text: string): number | null {
  const clean = text.replace(/[$,\s]/g, '');
  if (!/^-?\d+(\.\d{0,2})?$/.test(clean)) return null;
  return Math.round(Number(clean) * 100);
}
const fromCents = (cents: number) => (cents / 100).toFixed(2);

export const formatCents = (cents: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);

function scalarToScreen(f: IntakeScalarField, v: IntakeAnswerValue | undefined): ScreenScalar {
  if (v === undefined || v === null) return f.type === 'yesNo' ? null : emptyScalar(f);
  if (f.type === 'currency' && typeof v === 'number') return fromCents(v);
  if ((f.type === 'number' || f.type === 'year') && typeof v === 'number') return String(v);
  if (isMasked(v)) return { last4: v.last4 };
  if (typeof v === 'string' || typeof v === 'boolean') return v;
  if (Array.isArray(v) && v.every((x) => typeof x === 'string')) return v as string[];
  return emptyScalar(f);
}

function emptyScalar(f: IntakeScalarField): ScreenScalar {
  if (f.type === 'checkboxes' || (f.type === 'state' && f.multiple)) return [];
  if (f.type === 'checkbox') return false;
  if (f.type === 'yesNo') return null;
  if (f.type === 'radio' && f.defaultValue) return f.defaultValue;
  return '';
}

export const newRowId = () => crypto.randomUUID();

export function emptyRow(fields: readonly IntakeScalarField[]): ScreenRow {
  const row: ScreenRow = { id: newRowId() };
  for (const sub of fields) row[sub.key] = emptyScalar(sub);
  return row;
}

/** One field's screen value from its stored answer (or empty). */
export function toScreen(f: IntakeField, v: IntakeAnswerValue | undefined): ScreenValue {
  switch (f.type) {
    case 'info':
      return null;
    case 'upload': {
      const u = v as { notAvailable?: boolean; reason?: string | null } | undefined;
      return { notAvailable: u?.notAvailable ?? false, reason: u?.reason ?? '' };
    }
    case 'grid': {
      const stored = (v ?? {}) as Record<string, Record<string, unknown> | null>;
      const out: ScreenGrid = {};
      for (const row of f.rows) {
        out[row.key] = {};
        for (const col of f.columns) {
          const cell = stored[row.key]?.[col.key];
          out[row.key]![col.key] =
            typeof cell === 'number' ? fromCents(cell) : typeof cell === 'string' ? cell : '';
        }
      }
      return out;
    }
    case 'group': {
      const rows = Array.isArray(v) ? (v as Record<string, IntakeAnswerValue>[]) : [];
      const screen = rows.map((stored) => {
        const row: ScreenRow = { id: typeof stored['id'] === 'string' ? stored['id'] : newRowId() };
        for (const sub of f.fields) row[sub.key] = scalarToScreen(sub, stored[sub.key]);
        return row;
      });
      while (screen.length < f.minItems) screen.push(emptyRow(f.fields));
      return screen;
    }
    default:
      return scalarToScreen(f, v);
  }
}

/** Screen values for every field of the form, from the answers saved so far. */
export function screenValues(definition: IntakeFormDefinition, answers: IntakeAnswers) {
  const out: ScreenValues = {};
  for (const step of definition.steps) {
    for (const f of intakeStepFields(step)) out[f.key] = toScreen(f, answers[f.key]);
  }
  return out;
}

function scalarToAnswer(f: IntakeScalarField, v: ScreenValue | undefined): unknown {
  if (v === undefined || v === null) return null;
  if (isMasked(v)) return v;
  if (typeof v === 'string') {
    const text = v.trim();
    if (text === '') return null;
    if (f.type === 'currency') return toCents(text) ?? text;
    if (f.type === 'number' || f.type === 'year') return /^-?\d+$/.test(text) ? Number(text) : text;
    if (f.type === 'ssn' || f.type === 'ein') return text.replace(/\D/g, '');
    return v;
  }
  if (Array.isArray(v)) return v.length ? v : null;
  if (typeof v === 'boolean') return f.type === 'checkbox' && !v ? null : v;
  return null;
}

/** One field's answer as the API takes it (`null` is "no answer"). */
export function toAnswer(f: IntakeField, v: ScreenValue | undefined): unknown {
  switch (f.type) {
    case 'info':
      return undefined;
    case 'upload': {
      const u = v as ScreenUpload | undefined;
      if (!u?.notAvailable) return null;
      return { notAvailable: true, reason: u.reason.trim() || null };
    }
    case 'grid': {
      const grid = (v ?? {}) as ScreenGrid;
      const out: Record<string, Record<string, unknown>> = {};
      for (const row of f.rows) {
        const cells: Record<string, unknown> = {};
        for (const col of f.columns) {
          const text = (grid[row.key]?.[col.key] ?? '').trim();
          if (text === '') continue;
          cells[col.key] = col.type === 'currency' ? (toCents(text) ?? text) : text;
        }
        if (Object.keys(cells).length) out[row.key] = cells;
      }
      return Object.keys(out).length ? out : null;
    }
    case 'group': {
      const rows = Array.isArray(v) ? (v as ScreenRow[]) : [];
      const out = rows.map((row) => {
        const answer: Record<string, unknown> = { id: row.id };
        for (const sub of f.fields) {
          // A row's field its own answers hide is not sent (a leftover would fail the save).
          if (!intakeConditionHolds(sub.showIf, row)) continue;
          const value = scalarToAnswer(sub, row[sub.key]);
          if (value !== null) answer[sub.key] = value;
        }
        return answer;
      });
      return out.length ? out : null;
    }
    default:
      return scalarToAnswer(f, v);
  }
}

/**
 * A step's answers for a save: every field of the step (null clears it). With `shown`, a field
 * the answers hide is sent as null, so a leftover (a spouse's part SSN) never blocks the save.
 */
export function stepAnswers(
  step: IntakeStep,
  values: ScreenValues,
  shown?: ReadonlySet<string>,
): IntakeAnswers {
  const out: Record<string, unknown> = {};
  for (const f of intakeStepFields(step)) {
    if (shown && !shown.has(f.key)) {
      if (f.type !== 'info') out[f.key] = null;
      continue;
    }
    const v = toAnswer(f, values[f.key]);
    if (v !== undefined) out[f.key] = v;
  }
  return out as IntakeAnswers;
}

/** Every answer of the form, for the condition checks and the submit check. */
export function allAnswers(definition: IntakeFormDefinition, values: ScreenValues) {
  const out: Record<string, unknown> = {};
  for (const step of definition.steps) Object.assign(out, stepAnswers(step, values));
  return out as IntakeAnswers;
}

const SCAN_OF: Record<IntakeUpload['status'], ScanStatus> = {
  CHECKING: 'PENDING',
  READY: 'CLEAN',
  BLOCKED: 'INFECTED',
};

/** The problems the submit would find on this step (required fields, formats). */
export function stepIssues(
  definition: IntakeFormDefinition,
  step: IntakeStep,
  values: ScreenValues,
  uploads: readonly IntakeUpload[],
): IntakeIssue[] {
  const counts = intakeUploadCounts(
    uploads.map((u) => ({ slot: u.slot, status: SCAN_OF[u.status] })),
  );
  const { issues } = checkIntakeAnswers(definition, allAnswers(definition, values), {
    mode: 'submit',
    uploads: counts,
    today: localToday(),
  });
  return issues.filter((issue) => issue.step === step.key);
}

/** The problems a save of this step would find (formats and limits; nothing is required). */
export function saveIssues(
  definition: IntakeFormDefinition,
  step: IntakeStep,
  values: ScreenValues,
  shown: ReadonlySet<string>,
): IntakeIssue[] {
  return checkIntakeAnswers(definition, stepAnswers(step, values, shown), {
    mode: 'save',
    step: step.key,
    today: localToday(),
  }).issues;
}

/** Today's date where the person is (toISOString would give tomorrow late in the US evening). */
export function localToday(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** The message for a field (or a cell or row inside it), keyed by its path. */
export const issueKey = (path: readonly (string | number)[]) => path.join('.');
