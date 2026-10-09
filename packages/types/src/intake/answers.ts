import { z } from 'zod';
import { Email } from '../auth/schemas.js';
import { Phone } from '../client-auth/schemas.js';
import { CalendarDate } from '../clients/schemas.js';
import { text } from '../clients/text.js';
import {
  INTAKE_LIMITS,
  type IntakeCondition,
  type IntakeField,
  type IntakeFormDefinition,
  IntakeKey,
  type IntakeScalarField,
  intakeFields,
  intakeStepFields,
} from './definition.js';
import { ScanStatus } from '../db-enums.js';
import { INTAKE_FORMS } from './forms/index.js';
import { UsState } from './options.js';

// Answers: one flat map from field key to a typed value, checked against the definition by
// `checkIntakeAnswers` (the API runs it on every save and on submit; a screen can run it first to
// show the same messages). What each field type takes:
//   text, textarea           trimmed text within maxLength, no invisible or control characters
//   email, phone, zip        a string (stored lower-cased / as E.164 / as typed)
//   url                      one line of text; `example.com` is read as https://, stored as the
//                            normalised address, with no user name or password in it
//   date                     "YYYY-MM-DD", 1900 to 2100 (`past`: not after today); month
//                            "YYYY-MM", 1900 to 2100; year 1900 to 2100
//   number, currency         a whole number (currency in cents) within min and max
//   ssn, ein                 9 digits (dashes allowed), or `{ last4 }` (see "SSNs and EINs")
//   state                    a US_STATES code (an array of codes when `multiple`)
//   yesNo, checkbox          true or false
//   radio, select            one option's value; checkboxes: an array of option values
//   grid                     { rowKey: { columnKey: cents | "YYYY-MM-DD" | text } }
//   group                    an array of rows, each `{ id, ...subFieldAnswers }`: `id` is the
//                            screen's own (crypto.randomUUID()), unique in the group
//   upload                   { notAvailable, reason? }: the "I don't have this document" box (the
//                            files themselves are the draft's or intake's uploads for the slot)
//   info                     no answer
// `null`, '' and [] are "no answer". Saving a step replaces that step's answers: leave a field
// out (or send null) to clear it. Nothing is required until submit; on submit every shown required
// field must be answered, and the answers of hidden fields are dropped.
//
// SSNs and EINs: the API stores them encrypted with the firm's KMS key and only ever returns
// `{ last4 }` (`maskIntakeAnswers`), also inside group rows. A screen sends an unchanged number
// back as that `{ last4 }`: it must match the number stored at the same key (in a group, in the
// row with the same `id`), and the API keeps the stored number (`restoreMaskedNumbers`); any other
// `{ last4 }` is 400 VALIDATION_FAILED. The responses that carry answers (contract B) refuse a
// full SSN or EIN with `intakeNumbersMasked`, and with it any key outside the form and any group
// answer that is not a list of the group's rows (where a number could hide).
//
// Size: at most 500 answers, a group row at most 31 keys (its id and 30 fields), a grid at most
// 50 rows by 10 columns, counted before any value is read. `constructor` and `prototype` are
// never keys (and `__proto__` is not a key's shape).

const ROW_ID = /^[A-Za-z0-9_-]{1,64}$/;

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * An object with at most `max` keys, checked before its values are parsed. An own `__proto__` key
 * is refused here: a record schema would skip it without a word.
 */
const fewKeys = (max: number, message: string) =>
  z
    .custom<Record<string, unknown>>(
      (v) => isObject(v) && !Object.hasOwn(v, '__proto__'),
      'Not a valid key',
    )
    .refine((v) => Object.keys(v).length <= max, { message, abort: true });

/**
 * Value schemas, the same for requests and responses: the only fixed-shape objects (`{ last4 }`
 * and an upload's answer) are strict in responses too, since a plain object would drop a key next
 * to `last4` (where a full number could sit) before `intakeNumbersMasked` sees it.
 */
function answersSchema() {
  const Masked = z.strictObject({ last4: z.string().regex(/^\d{4}$/) });
  const Upload = z.strictObject({
    notAvailable: z.boolean(),
    reason: z.string().max(INTAKE_LIMITS.maxReason).nullable().optional(),
  });
  const Scalar = z.union([
    z.string().max(INTAKE_LIMITS.maxText),
    z.number(),
    z.boolean(),
    z.null(),
  ]);
  const Codes = z.array(z.string().max(64)).max(100);
  const Row = fewKeys(INTAKE_LIMITS.maxRowKeys, 'Too many answers in a row').pipe(
    z
      .record(IntakeKey, z.union([Scalar, Codes, Masked]))
      .refine((row) => typeof row['id'] === 'string' && ROW_ID.test(row['id']), {
        message: 'Each row needs an id',
        path: ['id'],
      }),
  );
  const Cell = z.union([z.number(), z.string().max(1000), z.null()]);
  const Grid = fewKeys(INTAKE_LIMITS.maxGridRows, 'Too many rows in a table').pipe(
    z.record(
      IntakeKey,
      z.union([
        z.null(),
        fewKeys(INTAKE_LIMITS.maxGridColumns, 'Too many columns in a table').pipe(
          z.record(IntakeKey, Cell),
        ),
      ]),
    ),
  );
  const Value = z.union([
    Scalar,
    Codes,
    z.array(Row).max(INTAKE_LIMITS.maxRows),
    Masked,
    Upload,
    Grid,
  ]);
  return fewKeys(INTAKE_LIMITS.maxAnswers, 'Too many answers').pipe(z.record(IntakeKey, Value));
}

/** Answers as the API returns them (SSNs and EINs as `{ last4 }`). */
export const IntakeAnswers = answersSchema();
export type IntakeAnswers = z.infer<typeof IntakeAnswers>;
export type IntakeAnswerValue = IntakeAnswers[string];
/** Answers in a request: the same values; `{ last4 }` sent back keeps the stored number. */
export const IntakeAnswersInput = answersSchema();
export type IntakeAnswersInput = z.input<typeof IntakeAnswersInput>;

/** An SSN or EIN as the API returns it. */
export interface MaskedNumber {
  last4: string;
}
/** An upload field's answer. */
export interface UploadAnswer {
  notAvailable: boolean;
  reason?: string | null;
}

/** One problem with one answer: where it is, and what to tell the person. */
export const IntakeIssue = z.object({
  /** The step the field is on (for the stepper and the review page's Edit links). */
  step: z.string(),
  /** `[field]`, `[group, rowIndex, subField]` or `[grid, row, column]`. */
  path: z.array(z.union([z.string(), z.number()])),
  /** The field's label (it may hold `{taxYear}` or `{firmName}`). */
  label: z.string(),
  message: z.string(),
});
export type IntakeIssue = z.infer<typeof IntakeIssue>;

/** `error.details` of a submit's 400 VALIDATION_FAILED: every problem found. */
export const IntakeValidationDetails = z.object({ issues: z.array(IntakeIssue) });
export type IntakeValidationDetails = z.infer<typeof IntakeValidationDetails>;

export type IntakeCheckOptions =
  /** One step's answers, as autosave sends them: types and limits only, nothing required. */
  | { mode: 'save'; step: string; today?: string }
  /**
   * The whole form, as submit sees it. `uploads`: how many usable files each upload slot has
   * (`intakeUploadCounts`: only clean files and files still being scanned count).
   */
  | { mode: 'submit'; uploads?: Readonly<Record<string, number>>; today?: string };

export interface IntakeCheckResult {
  /** The answers cleaned up (trimmed, normalised, empty ones left out; on submit hidden ones too). */
  answers: IntakeAnswers;
  issues: IntakeIssue[];
}

type Values = Record<string, unknown>;
type Path = (string | number)[];
interface Found {
  value?: IntakeAnswerValue;
  problems: { path: Path; label: string; message: string }[];
}

const isEmpty = (v: unknown) =>
  v === undefined ||
  v === null ||
  (typeof v === 'string' && v.trim() === '') ||
  (Array.isArray(v) && v.length === 0);

const isMasked = (v: unknown): v is MaskedNumber =>
  isObject(v) &&
  Object.keys(v).length === 1 &&
  typeof v['last4'] === 'string' &&
  /^\d{4}$/.test(v['last4']);

/** True when the condition holds for these answers (a missing answer never matches). */
export function intakeConditionHolds(
  condition: IntakeCondition | undefined,
  values: Readonly<Values>,
): boolean {
  if (!condition) return true;
  const value = values[condition.field];
  if ('equals' in condition) return value === condition.equals;
  if ('oneOf' in condition) return typeof value === 'string' && condition.oneOf.includes(value);
  return (
    Array.isArray(value) &&
    value.some((v) => typeof v === 'string' && condition.includesAny.includes(v))
  );
}

/**
 * The keys of the steps and top-level fields shown for these answers: what the screen renders and
 * what submit checks. A field is hidden when its step, its section or its own condition is; a
 * condition reading a hidden field does not hold.
 */
export function shownIntakeKeys(
  definition: IntakeFormDefinition,
  answers: Readonly<Values>,
): { steps: Set<string>; fields: Set<string> } {
  const shown: Values = {};
  const steps = new Set<string>();
  const fields = new Set<string>();
  for (const step of definition.steps) {
    if (!intakeConditionHolds(step.showIf, shown)) continue;
    steps.add(step.key);
    for (const section of step.sections) {
      if (!intakeConditionHolds(section.showIf, shown)) continue;
      for (const f of section.fields) {
        if (!intakeConditionHolds(f.showIf, shown)) continue;
        fields.add(f.key);
        shown[f.key] = answers[f.key];
      }
    }
  }
  return { steps, fields };
}

/**
 * The scan statuses a file counts with toward a required slot on submit: clean, or still being
 * scanned (the firm sees the scan result before it uses the file). An infected file, or one the
 * scan could not read, never answers a required slot. An allow-list, so a new status counts only
 * once it is added here.
 */
export const COUNTED_UPLOAD_STATUSES: readonly ScanStatus[] = ['CLEAN', 'PENDING'];

/**
 * How many files count for each slot on submit (see COUNTED_UPLOAD_STATUSES). For the file
 * limits every file counts, whatever its status.
 */
export function intakeUploadCounts(
  uploads: readonly { slot: string; status: ScanStatus }[],
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const u of uploads) {
    if (COUNTED_UPLOAD_STATUSES.includes(u.status)) counts[u.slot] = (counts[u.slot] ?? 0) + 1;
  }
  return counts;
}

/**
 * The files a submit takes out of the form: every file whose slot is not a shown upload field.
 * That is a slot the answers hide (a spouse's ID after the filing status changed to Single), a
 * slot the form no longer has, or a key that is not an upload field.
 */
export function hiddenSlotUploads<T extends { slot: string }>(
  definition: IntakeFormDefinition,
  answers: Readonly<Values>,
  uploads: readonly T[],
): T[] {
  const { fields } = shownIntakeKeys(definition, answers);
  const slots = new Set(
    intakeFields(definition)
      .filter((f) => f.type === 'upload' && fields.has(f.key))
      .map((f) => f.key),
  );
  return uploads.filter((u) => !slots.has(u.slot));
}

// ---------- SSNs and EINs ----------
const isSensitive = (f: { type: string }) => f.type === 'ssn' || f.type === 'ein';
const last4Of = (v: unknown) =>
  typeof v === 'string' ? v.replace(/\D/g, '').slice(-4) : isMasked(v) ? v.last4 : undefined;
const masked = (v: unknown) => (typeof v === 'string' ? { last4: last4Of(v) ?? '' } : v);

/** Each group row of `value` with `change` applied to its SSN and EIN answers. */
function mapRows(
  f: Extract<IntakeField, { type: 'group' }>,
  value: unknown,
  change: (sub: string, v: unknown, row: Record<string, unknown>) => unknown,
) {
  if (!Array.isArray(value)) return value;
  const keys = f.fields.filter(isSensitive).map((s) => s.key);
  return value.map((row: unknown) => {
    if (!isObject(row)) return row;
    const out: Record<string, unknown> = { ...row };
    for (const key of keys) if (key in row) out[key] = change(key, row[key], row);
    return out;
  });
}

/**
 * The answers as the API returns them: every SSN and EIN as `{ last4 }`, at the top level and in
 * group rows. Other answers are unchanged.
 */
export function maskIntakeAnswers(
  definition: IntakeFormDefinition,
  answers: Readonly<Values>,
): IntakeAnswers {
  const out: Values = { ...answers };
  for (const f of intakeFields(definition)) {
    if (!(f.key in out)) continue;
    if (isSensitive(f)) out[f.key] = masked(out[f.key]);
    else if (f.type === 'group') out[f.key] = mapRows(f, out[f.key], (_k, v) => masked(v));
  }
  return out as IntakeAnswers;
}

/** Exactly `{ last4: "dddd" }`: one own key (none hidden, no symbol), a plain object. */
const isExactlyMasked = (v: unknown): v is MaskedNumber =>
  isObject(v) &&
  Object.getPrototypeOf(v) === Object.prototype &&
  Reflect.ownKeys(v).length === 1 &&
  isMasked(v);

/** A plain object whose own keys are all strings and all in `allowed`. */
const onlyKeys = (v: unknown, allowed: (key: string) => boolean): v is Record<string, unknown> =>
  isObject(v) &&
  Object.getPrototypeOf(v) === Object.prototype &&
  Reflect.ownKeys(v).every((k) => typeof k === 'string' && allowed(k));

const isPlainScalar = (v: unknown) =>
  typeof v === 'string' || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v));

/**
 * The keys an SSN or EIN may sit at, in `definitions` together: top-level keys, and per group key
 * the sub-field keys.
 */
function sensitiveKeys(definitions: readonly IntakeFormDefinition[]) {
  const top = new Set<string>();
  const sub = new Map<string, Set<string>>();
  for (const definition of definitions) {
    for (const f of intakeFields(definition)) {
      if (isSensitive(f)) top.add(f.key);
      if (f.type !== 'group') continue;
      const keys = sub.get(f.key) ?? new Set<string>();
      for (const s of f.fields) if (isSensitive(s)) keys.add(s.key);
      sub.set(f.key, keys);
    }
  }
  return { top, sub };
}

/**
 * True when the answers cannot hold a full SSN or EIN: what a response must hold. It fails
 * closed: an SSN or EIN answer must be null, left out, or exactly `{ last4 }` with 4 digits
 * (not a string in any spelling, not a number, not a list, not an object with another key next
 * to `last4`), at the top level and in group rows. A key counts as an SSN or EIN when the
 * definition says so, or when the built-in form of the same kind (INTAKE_FORMS) does, so a wrong
 * definition can't hide one. Nothing may sit where this check can't see: every key is a field of
 * the form (keys match exactly, case included), and every answer has its type's shape (a group a
 * list of rows holding only a row id and the group's own fields; a grid rows of cells; an upload
 * `{ notAvailable, reason }`; a choice list strings; anything else one plain value). Cleaned and
 * masked answers (`checkIntakeAnswers`, `maskIntakeAnswers`) always pass; an API bug, or answers
 * kept from another version of the form, do not. Used by MyIntake, BeginDraft and LeadIntake, so
 * a full number never reaches a screen.
 */
export function intakeNumbersMasked(
  definition: IntakeFormDefinition,
  answers: Readonly<Values>,
): boolean {
  const builtIn = INTAKE_FORMS[definition.key];
  const sensitive = sensitiveKeys(builtIn ? [definition, builtIn] : [definition]);
  const fields = new Map(intakeFields(definition).map((f) => [f.key, f]));
  const empty = (v: unknown) => v === undefined || v === null;
  /** One answer of a field that is not a group, by its type's shape. */
  const valueSafe = (f: IntakeField, v: unknown, isNumber: boolean): boolean => {
    if (empty(v)) return true;
    if (isNumber || isSensitive(f)) return isExactlyMasked(v);
    switch (f.type) {
      case 'info':
        return false;
      case 'upload':
        return (
          onlyKeys(v, (k) => k === 'notAvailable' || k === 'reason') &&
          typeof v['notAvailable'] === 'boolean' &&
          (empty(v['reason']) || typeof v['reason'] === 'string')
        );
      case 'grid':
        return (
          onlyKeys(v, () => true) &&
          Object.values(v).every(
            (cells) =>
              empty(cells) ||
              (onlyKeys(cells, () => true) &&
                Object.values(cells).every(
                  (cell) => empty(cell) || typeof cell === 'string' || typeof cell === 'number',
                )),
          )
        );
      case 'checkboxes':
      case 'state':
        return (
          isPlainScalar(v) || (Array.isArray(v) && v.every((code) => typeof code === 'string'))
        );
      default:
        return isPlainScalar(v);
    }
  };
  return Object.entries(answers).every(([key, value]) => {
    const f = fields.get(key);
    if (f === undefined) return false;
    if (f.type !== 'group' || sensitive.top.has(key)) {
      return valueSafe(f, value, sensitive.top.has(key));
    }
    if (empty(value)) return true;
    if (!Array.isArray(value)) return false;
    const subs = new Map<string, IntakeField>(f.fields.map((s) => [s.key, s]));
    const numbers = sensitive.sub.get(key) ?? new Set<string>();
    return value.every(
      (row: unknown) =>
        onlyKeys(row, (k) => k === 'id' || subs.has(k)) &&
        typeof row['id'] === 'string' &&
        ROW_ID.test(row['id']) &&
        Object.entries(row).every(([k, v]) => {
          if (k === 'id') return true;
          const sub = subs.get(k);
          return sub !== undefined && valueSafe(sub, v, numbers.has(k));
        }),
    );
  });
}

/**
 * Puts the stored numbers back where cleaned answers (`checkIntakeAnswers`) send `{ last4 }`.
 * `stored` is what the API holds (full numbers, decrypted; a mock holds `{ last4 }`). A `{ last4 }`
 * must match the number stored at the same key (in a group, in the row with the same id);
 * otherwise it is an issue (400 VALIDATION_FAILED).
 */
export function restoreMaskedNumbers(
  definition: IntakeFormDefinition,
  answers: IntakeAnswers,
  stored: Readonly<Values>,
): IntakeCheckResult {
  const issues: IntakeIssue[] = [];
  const stepOf = new Map<string, string>();
  for (const step of definition.steps) {
    for (const f of intakeStepFields(step)) stepOf.set(f.key, step.key);
  }
  const restore = (v: unknown, kept: unknown, path: Path, label: string) => {
    if (!isMasked(v)) return v;
    if (kept === undefined || kept === null || last4Of(kept) !== v.last4) {
      issues.push({
        step: stepOf.get(String(path[0])) ?? '',
        path,
        label,
        message: 'Enter the full number again',
      });
      return v;
    }
    return kept;
  };
  const out: Values = { ...answers };
  for (const f of intakeFields(definition)) {
    if (!(f.key in out)) continue;
    if (isSensitive(f)) {
      out[f.key] = restore(out[f.key], stored[f.key], [f.key], f.label);
    } else if (f.type === 'group') {
      const before = Array.isArray(stored[f.key]) ? (stored[f.key] as unknown[]) : [];
      const rows = Array.isArray(out[f.key]) ? (out[f.key] as unknown[]) : [];
      out[f.key] = mapRows(f, out[f.key], (key, v, row) => {
        const match = before.find((r) => isObject(r) && r['id'] === row['id']);
        const index = rows.indexOf(row);
        const sub = f.fields.find((s) => s.key === key);
        return restore(
          v,
          isObject(match) ? match[key] : undefined,
          [f.key, index, key],
          sub?.label ?? key,
        );
      });
    }
  }
  return { answers: out as IntakeAnswers, issues };
}

// ---------- Checking ----------
const digits9 = (message: string) =>
  z
    .string()
    .transform((s) => s.replace(/[\s-]/g, ''))
    .pipe(z.string().regex(/^\d{9}$/, message));
const withScheme = (s: string) => (/^https?:\/\//i.test(s) ? s : `https://${s}`);
/** One line of text (the text rule), then an http(s) address on a domain, normalised. */
const Website = text(2048)
  .transform(withScheme)
  .pipe(
    z
      .url({
        protocol: /^https?$/,
        hostname: z.regexes.domain,
        normalize: true,
        error: 'Enter a valid website',
      })
      .max(2048, 'Use at most 2048 characters')
      .refine((url) => {
        const { username, password } = new URL(url);
        return username === '' && password === '';
      }, 'Enter a web address without a user name'),
  );
const Zip = z
  .string()
  .trim()
  .regex(/^\d{5}(?:-\d{4})?$/, 'Enter a valid ZIP code');
const inYears = (year: number) => year >= 1900 && year <= 2100;
/** A calendar date from 1900 to 2100. */
const IntakeDate = CalendarDate.refine(
  (d) => inYears(Number(d.slice(0, 4))),
  'Enter a date between 1900 and 2100',
);
const Month = z
  .string()
  .trim()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Enter a month and year')
  .refine((m) => inYears(Number(m.slice(0, 4))), 'Enter a year between 1900 and 2100');
const whole = (min: number, max: number) =>
  z
    .number('Enter a number')
    .int('Enter a whole number')
    .min(min, `Enter at least ${String(min)}`)
    .max(max, `Enter at most ${String(max)}`);
const cents = (min: number, max: number) =>
  z
    .number('Enter an amount')
    .int('Enter the amount in cents')
    .min(min, min === 0 ? 'Enter a positive amount' : 'The amount is too small')
    .max(max, 'The amount is too large');
const CHOOSE = 'Choose one of the options';

/** The value schema of one field. */
function scalarSchema(f: IntakeScalarField, today: string): z.ZodType {
  switch (f.type) {
    case 'text':
      return text(f.maxLength);
    case 'textarea':
      return text(f.maxLength, 'many');
    case 'email':
      return Email;
    case 'phone':
      return Phone;
    case 'url':
      return Website;
    case 'date':
      return f.past
        ? IntakeDate.refine((d) => d <= today, 'The date cannot be in the future')
        : IntakeDate;
    case 'month':
      return Month;
    case 'year':
      return whole(1900, 2100);
    case 'number':
      return whole(f.min, f.max);
    case 'currency':
      return cents(f.min, f.max);
    case 'ssn':
      return digits9('Enter the 9-digit SSN');
    case 'ein':
      return digits9('Enter the 9-digit EIN');
    case 'zip':
      return Zip;
    case 'state':
      return f.multiple
        ? z
            .array(UsState, 'Choose the states')
            .max(60)
            .transform((list) => [...new Set(list)])
        : UsState;
    case 'yesNo':
    case 'checkbox':
      return z.boolean('Answer yes or no');
    case 'radio':
    case 'select':
      return z.enum(f.options.map((o) => o.value) as [string, ...string[]], CHOOSE);
    case 'checkboxes':
      return z
        .array(z.enum(f.options.map((o) => o.value) as [string, ...string[]], CHOOSE), CHOOSE)
        .max(f.options.length)
        .transform((list) => [...new Set(list)]);
  }
}

const first = (error: z.ZodError) => error.issues[0]?.message ?? 'Check this answer';

function checkScalar(f: IntakeScalarField, raw: unknown, path: Path, today: string): Found {
  if (isEmpty(raw)) return { problems: [] };
  if (isSensitive(f) && isMasked(raw)) {
    return { value: { last4: raw.last4 }, problems: [] };
  }
  const result = scalarSchema(f, today).safeParse(raw);
  if (!result.success) {
    return { problems: [{ path, label: f.label, message: first(result.error) }] };
  }
  const value = result.data as IntakeAnswerValue;
  return isEmpty(value) ? { problems: [] } : { value, problems: [] };
}

function checkGrid(f: Extract<IntakeField, { type: 'grid' }>, raw: unknown, path: Path): Found {
  if (isEmpty(raw)) return { problems: [] };
  if (!isObject(raw)) return { problems: [{ path, label: f.label, message: 'Check this table' }] };
  const problems: Found['problems'] = [];
  const out: Record<string, Record<string, number | string>> = {};
  for (const [rowKey, rowRaw] of Object.entries(raw)) {
    const row = f.rows.find((r) => r.key === rowKey);
    if (!row || !(isObject(rowRaw) || rowRaw === null)) {
      problems.push({
        path: [...path, rowKey],
        label: f.label,
        message: 'Not a row of this table',
      });
      continue;
    }
    for (const [colKey, cell] of Object.entries(rowRaw ?? {})) {
      const col = f.columns.find((c) => c.key === colKey);
      const cellPath = [...path, rowKey, colKey];
      const label = `${f.label}: ${row.label}`;
      if (!col) {
        problems.push({ path: cellPath, label, message: 'Not a column of this table' });
        continue;
      }
      if (isEmpty(cell)) continue;
      const schema =
        col.type === 'currency'
          ? cents(0, INTAKE_LIMITS.maxCents)
          : col.type === 'date'
            ? IntakeDate
            : text(col.maxLength ?? 200);
      const result = schema.safeParse(cell);
      if (!result.success) {
        problems.push({ path: cellPath, label, message: first(result.error) });
        continue;
      }
      (out[rowKey] ??= {})[colKey] = result.data as number | string;
    }
  }
  return Object.keys(out).length ? { value: out, problems } : { problems };
}

function checkGroup(
  f: Extract<IntakeField, { type: 'group' }>,
  raw: unknown,
  path: Path,
  options: IntakeCheckOptions,
  today: string,
): Found {
  if (isEmpty(raw)) return { problems: [] };
  if (!Array.isArray(raw)) {
    return { problems: [{ path, label: f.label, message: 'Check this list' }] };
  }
  if (raw.length > f.maxItems) {
    return {
      problems: [{ path, label: f.label, message: `Add at most ${String(f.maxItems)}` }],
    };
  }
  const problems: Found['problems'] = [];
  const rows: Record<string, unknown>[] = [];
  const ids = new Set<string>();
  raw.forEach((rowRaw: unknown, index) => {
    const rowPath = [...path, index];
    const id = isObject(rowRaw) ? rowRaw['id'] : undefined;
    if (!isObject(rowRaw) || typeof id !== 'string' || !ROW_ID.test(id) || ids.has(id)) {
      problems.push({ path: rowPath, label: f.label, message: 'Each row needs its own id' });
      return;
    }
    ids.add(id);
    const row: Record<string, unknown> = { id };
    for (const key of Object.keys(rowRaw)) {
      if (key !== 'id' && !f.fields.some((s) => s.key === key)) {
        problems.push({ path: [...rowPath, key], label: f.label, message: 'Not a question here' });
      }
    }
    for (const sub of f.fields) {
      // On submit a sub-field hidden by its row's answers is dropped, unchecked.
      if (options.mode === 'submit' && !intakeConditionHolds(sub.showIf, row)) continue;
      const subPath = [...rowPath, sub.key];
      const found = checkScalar(sub, rowRaw[sub.key], subPath, today);
      problems.push(...found.problems);
      if (found.value !== undefined) row[sub.key] = found.value;
      // On submit a shown sub-field is checked as a top-level field is: answered when required, a
      // required checkbox ticked, at least `minItems` choices ticked.
      if (options.mode === 'submit' && found.problems.length === 0) {
        problems.push(...completeness(sub, found.value, subPath, {}));
      }
    }
    rows.push(row);
  });
  return rows.length ? { value: rows as IntakeAnswerValue, problems } : { problems };
}

function checkUpload(f: Extract<IntakeField, { type: 'upload' }>, raw: unknown, path: Path): Found {
  if (isEmpty(raw)) return { problems: [] };
  const problem = (message: string): Found => ({ problems: [{ path, label: f.label, message }] });
  if (!isObject(raw) || typeof raw['notAvailable'] !== 'boolean') {
    return problem('Check this answer');
  }
  if (!raw['notAvailable']) return { problems: [] };
  if (!f.notAvailable) return problem("This document can't be marked as unavailable");
  if (isEmpty(raw['reason'])) return { value: { notAvailable: true, reason: null }, problems: [] };
  const reason = text(INTAKE_LIMITS.maxReason, 'many').safeParse(raw['reason']);
  if (!reason.success) return problem(first(reason.error));
  return { value: { notAvailable: true, reason: reason.data }, problems: [] };
}

function checkAny(
  f: IntakeField,
  raw: unknown,
  path: Path,
  options: IntakeCheckOptions,
  today: string,
): Found {
  switch (f.type) {
    case 'grid':
      return checkGrid(f, raw, path);
    case 'group':
      return checkGroup(f, raw, path, options, today);
    case 'upload':
      return checkUpload(f, raw, path);
    case 'info':
      return isEmpty(raw)
        ? { problems: [] }
        : { problems: [{ path, label: f.label, message: 'This takes no answer' }] };
    default:
      return checkScalar(f, raw, path, today);
  }
}

function requiredProblem(f: IntakeField, path: Path) {
  const message =
    f.type === 'checkbox'
      ? 'Tick this box to continue'
      : f.type === 'checkboxes'
        ? 'Choose at least one'
        : f.type === 'upload'
          ? "Upload a file or tell us why you don't have it"
          : f.type === 'group'
            ? `Add at least one ${f.itemLabel.toLowerCase()}`
            : 'This is required';
  return { path, label: f.label, message };
}

/** Submit-only rules: required answers, enough choices, rows and files, a reason when needed. */
function completeness(
  f: IntakeField,
  value: IntakeAnswerValue | undefined,
  path: Path,
  uploads: Readonly<Record<string, number>>,
) {
  if (f.type === 'upload') {
    const answer = value as UploadAnswer | undefined;
    if (answer?.notAvailable && !answer.reason) {
      return [{ path, label: f.label, message: "Tell us why you don't have this document" }];
    }
    const files = uploads[f.key] ?? 0;
    return f.required && files === 0 && !answer?.notAvailable ? [requiredProblem(f, path)] : [];
  }
  if (!f.required) return [];
  if (value === undefined || (f.type === 'checkbox' && value !== true)) {
    return [requiredProblem(f, path)];
  }
  if (f.type === 'checkboxes' && Array.isArray(value) && value.length < (f.minItems ?? 1)) {
    return [{ path, label: f.label, message: `Choose at least ${String(f.minItems ?? 1)}` }];
  }
  if (f.type === 'group' && Array.isArray(value) && value.length < Math.max(f.minItems, 1)) {
    return [{ path, label: f.label, message: `Add at least ${String(Math.max(f.minItems, 1))}` }];
  }
  return [];
}

/** Today's date in UTC, YYYY-MM-DD (the same rule as R10's dates of birth). */
const todayUtc = () => new Date().toISOString().slice(0, 10);

/**
 * Checks answers against a definition and cleans them up. `save`: one step's answers (unknown
 * keys, wrong types, values over the limits and refused characters are problems; nothing is
 * required). `submit`: the whole form; also every shown required field, enough choices, rows and
 * files, and a reason for each "I don't have this document"; hidden answers are dropped. The API
 * answers 400 VALIDATION_FAILED when `issues` is not empty (on submit with `details: { issues }`).
 * A `{ last4 }` passes here; `restoreMaskedNumbers` then checks it against the stored number.
 */
export function checkIntakeAnswers(
  definition: IntakeFormDefinition,
  answers: Readonly<Values>,
  options: IntakeCheckOptions,
): IntakeCheckResult {
  const today = options.today ?? todayUtc();
  const issues: IntakeIssue[] = [];
  const out: Record<string, IntakeAnswerValue> = {};

  if (options.mode === 'save') {
    const step = definition.steps.find((s) => s.key === options.step);
    if (!step) {
      return {
        answers: {},
        issues: [{ step: options.step, path: [], label: '', message: 'Not a step of this form' }],
      };
    }
    const fields = intakeStepFields(step);
    for (const key of Object.keys(answers)) {
      if (!fields.some((f) => f.key === key)) {
        issues.push({ step: step.key, path: [key], label: key, message: 'Not a question here' });
      }
    }
    // In the form's order, so the messages read top to bottom.
    for (const f of fields) {
      if (!Object.hasOwn(answers, f.key)) continue;
      const found = checkAny(f, answers[f.key], [f.key], options, today);
      issues.push(...found.problems.map((p) => ({ step: step.key, ...p })));
      if (found.value !== undefined) out[f.key] = found.value;
    }
    return { answers: out, issues };
  }

  const uploads = options.uploads ?? {};
  const known = new Set(intakeFields(definition).map((f) => f.key));
  for (const key of Object.keys(answers)) {
    if (!known.has(key)) {
      issues.push({ step: '', path: [key], label: key, message: 'Not a question here' });
    }
  }
  const { fields: shown } = shownIntakeKeys(definition, answers);
  for (const step of definition.steps) {
    for (const f of intakeStepFields(step)) {
      if (!shown.has(f.key)) continue;
      const found = checkAny(f, answers[f.key], [f.key], options, today);
      issues.push(...found.problems.map((p) => ({ step: step.key, ...p })));
      if (found.problems.length) continue;
      if (found.value !== undefined) out[f.key] = found.value;
      issues.push(
        ...completeness(f, found.value, [f.key], uploads).map((p) => ({ step: step.key, ...p })),
      );
    }
  }
  return { answers: out, issues };
}
