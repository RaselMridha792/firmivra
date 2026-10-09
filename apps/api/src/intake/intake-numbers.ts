import { createHash } from 'node:crypto';
import { HttpException, HttpStatus } from '@nestjs/common';
import { type IntakeAnswers, type IntakeFormDefinition, intakeFields } from '@firmivra/types';
import {
  type FieldEncryption,
  FieldEncryptionError,
} from '../field-encryption/field-encryption.service.js';

/**
 * SSN and EIN answers at rest (contract A: "the API stores them encrypted with the firm's KMS key
 * and only ever returns `{ last4 }`"). In `intake_submissions.answers` each one is stored as
 * `{ last4, sealed }`: `sealed` is the field-encryption blob (base64), bound to the firm, the
 * intake (not the version, so a new version keeps it) and the answer's path. The API never needs
 * the full number back: a screen sends an unchanged number as `{ last4 }`, which
 * `restoreMaskedNumbers` checks against `maskStoredNumbers(stored)` and `sealIntakeNumbers` then
 * swaps for the stored sealed value.
 */
export interface SealedNumber {
  last4: string;
  sealed: string;
}

type Values = Record<string, unknown>;
type Visit = (path: string, value: unknown, stored: unknown) => unknown | Promise<unknown>;

const isObject = (v: unknown): v is Values =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isSealed = (v: unknown): v is SealedNumber =>
  isObject(v) && typeof v['last4'] === 'string' && typeof v['sealed'] === 'string';
const isMasked = (v: unknown): v is { last4: string } =>
  isObject(v) && Object.keys(v).length === 1 && typeof v['last4'] === 'string';

/** Calls `visit` on every SSN and EIN answer (top level, and in group rows matched by row id). */
async function eachNumber(
  definition: IntakeFormDefinition,
  answers: Readonly<Values>,
  stored: Readonly<Values>,
  visit: Visit,
): Promise<Values> {
  const out: Values = { ...answers };
  for (const f of intakeFields(definition)) {
    if (!(f.key in out)) continue;
    if (f.type === 'ssn' || f.type === 'ein') {
      out[f.key] = await visit(f.key, out[f.key], stored[f.key]);
    } else if (f.type === 'group' && Array.isArray(out[f.key])) {
      const keys = f.fields.filter((s) => s.type === 'ssn' || s.type === 'ein').map((s) => s.key);
      if (keys.length === 0) continue;
      const before = Array.isArray(stored[f.key]) ? (stored[f.key] as unknown[]) : [];
      const rows: unknown[] = [];
      for (const row of out[f.key] as unknown[]) {
        if (!isObject(row)) {
          rows.push(row);
          continue;
        }
        const match = before.find((r) => isObject(r) && r['id'] === row['id']);
        const next: Values = { ...row };
        for (const key of keys) {
          if (!(key in row)) continue;
          const path = `${f.key}.${String(row['id'])}.${key}`;
          next[key] = await visit(path, row[key], isObject(match) ? match[key] : undefined);
        }
        rows.push(next);
      }
      out[f.key] = rows;
    }
  }
  return out;
}

/**
 * The field-encryption `field` for an answer path (`ssn`, `spouseSsn`, `dependents.<rowId>.ssn`).
 * Field names are lower snake case, so the path is bound by its hash: the same path always gives
 * the same name, and a blob moved to another path does not decrypt.
 */
export function numberField(path: string): string {
  return `answer_${createHash('sha256').update(path).digest('hex').slice(0, 32)}`;
}

/** 503 when the firm's key can't be used right now; never a value or an AWS detail. */
async function guarded<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (
      error instanceof FieldEncryptionError &&
      ['KEY_NOT_PROVISIONED', 'KMS_UNAVAILABLE', 'KEY_ACCESS_DENIED'].includes(error.code)
    ) {
      throw new HttpException(
        {
          code: 'ENCRYPTION_UNAVAILABLE',
          message: 'SSN and EIN answers cannot be saved right now. Try again later.',
        },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    throw error;
  }
}

/**
 * The most SSN and EIN answers one save may seal. Annual Tax, the form with the most, allows 102:
 * the SSN and the spouse's, plus one in each dependent row and each business row (50 rows each,
 * `INTAKE_LIMITS.maxRows`). Each seal is its own KMS call, so a save over this is refused before
 * any of them runs.
 */
export const MAX_SEALED_NUMBERS_PER_SAVE = 120;
/** Seals run at most this many at a time. */
const SEAL_CONCURRENCY = 4;

/**
 * The last four digits. Assumes a normalized full number (9 digits, as the answer schema checks
 * an SSN or EIN): a shorter value gives fewer digits.
 */
const last4Of = (value: string): string => value.replace(/\D/g, '').slice(-4);

/** Runs `work` on each item, at most `limit` at a time; results in item order. */
async function pool<T, R>(items: T[], limit: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const lane = async (): Promise<void> => {
    while (next < items.length) {
      const i = next++;
      out[i] = await work(items[i] as T);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane));
  return out;
}

/**
 * The answers as stored: each full number encrypted, each `{ last4 }` replaced by the stored
 * sealed value at the same path (run `restoreMaskedNumbers` against `maskStoredNumbers(stored)`
 * first, so a `{ last4 }` here always matches one). Fails closed: a `{ last4 }` with no sealed
 * value of the same last four (an older plain stored number of the same last four is sealed now),
 * or any other shape, throws rather than losing the number. Call it BEFORE the write transaction:
 * no KMS call runs while a transaction holds a connection.
 */
export async function sealIntakeNumbers(
  fe: FieldEncryption,
  where: { businessId: string; intakeId: string },
  definition: IntakeFormDefinition,
  answers: Readonly<Values>,
  stored: Readonly<Values>,
): Promise<Values> {
  // First pass: each number to seal becomes a placeholder; nothing is encrypted yet.
  const jobs: { path: string; value: string; slot: object }[] = [];
  const toSeal = (path: string, value: string): object => {
    const slot = {};
    jobs.push({ path, value, slot });
    return slot;
  };
  const planned = await eachNumber(definition, answers, stored, (path, value, kept) => {
    if (value === null || value === undefined) return value;
    if (typeof value === 'string') return toSeal(path, value);
    if (isMasked(value)) {
      if (isSealed(kept) && kept.last4 === value.last4) return kept;
      if (typeof kept === 'string' && last4Of(kept) === value.last4) return toSeal(path, kept);
    }
    throw new Error(`Intake answer ${path} is not a number, a stored { last4 } or null`);
  });
  if (jobs.length === 0) return planned;
  if (jobs.length > MAX_SEALED_NUMBERS_PER_SAVE) {
    throw new HttpException(
      {
        code: 'TOO_MANY_NUMBERS',
        message: `One save can hold at most ${MAX_SEALED_NUMBERS_PER_SAVE} new SSN and EIN answers.`,
      },
      HttpStatus.BAD_REQUEST,
    );
  }
  const sealed = await guarded(() =>
    pool(jobs, SEAL_CONCURRENCY, async ({ path, value }): Promise<SealedNumber> => {
      const blob = await fe.encrypt(
        {
          businessId: where.businessId,
          table: 'intake_submissions',
          recordId: where.intakeId,
          field: numberField(path),
        },
        value,
      );
      return { last4: last4Of(value), sealed: Buffer.from(blob).toString('base64') };
    }),
  );
  // Second pass: each placeholder swapped for its sealed value.
  const bySlot = new Map<unknown, SealedNumber>(
    jobs.map((j, i) => [j.slot, sealed[i] as SealedNumber]),
  );
  return eachNumber(definition, planned, stored, (_path, value) => bySlot.get(value) ?? value);
}

/** Drops `sealed` from every object in the answers, at any depth. */
function stripSealed(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripSealed);
  if (!isObject(value)) return value;
  const out: Values = {};
  for (const [k, v] of Object.entries(value)) if (k !== 'sealed') out[k] = stripSealed(v);
  return out;
}

/**
 * The stored answers as responses and `restoreMaskedNumbers` see them: numbers as `{ last4 }`.
 * Fails closed: a sealed value under a key this definition does not list as a number (another
 * form version, a changed field type) still loses its blob.
 */
export async function maskStoredNumbers(
  definition: IntakeFormDefinition,
  stored: Readonly<Values>,
): Promise<IntakeAnswers> {
  const out = await eachNumber(definition, stored, stored, (_path, value) =>
    isSealed(value)
      ? { last4: value.last4 }
      : typeof value === 'string'
        ? { last4: last4Of(value) }
        : value,
  );
  return stripSealed(out) as IntakeAnswers;
}
