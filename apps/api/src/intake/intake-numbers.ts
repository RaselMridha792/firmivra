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
 * The answers as stored: each full number encrypted, each `{ last4 }` replaced by the stored
 * sealed value at the same path (run `restoreMaskedNumbers` against `maskStoredNumbers(stored)`
 * first, so a `{ last4 }` here always matches one). Call it BEFORE the write transaction: no KMS
 * call runs while a transaction holds a connection.
 */
export function sealIntakeNumbers(
  fe: FieldEncryption,
  where: { businessId: string; intakeId: string },
  definition: IntakeFormDefinition,
  answers: Readonly<Values>,
  stored: Readonly<Values>,
): Promise<Values> {
  return guarded(() =>
    eachNumber(definition, answers, stored, async (path, value, kept) => {
      if (typeof value === 'string') {
        const blob = await fe.encrypt(
          {
            businessId: where.businessId,
            table: 'intake_submissions',
            recordId: where.intakeId,
            field: path,
          },
          value,
        );
        return {
          last4: value.replace(/\D/g, '').slice(-4),
          sealed: Buffer.from(blob).toString('base64'),
        };
      }
      if (isMasked(value) && isSealed(kept) && kept.last4 === value.last4) return kept;
      return value;
    }),
  );
}

/** The stored answers as responses and `restoreMaskedNumbers` see them: numbers as `{ last4 }`. */
export async function maskStoredNumbers(
  definition: IntakeFormDefinition,
  stored: Readonly<Values>,
): Promise<IntakeAnswers> {
  const out = await eachNumber(definition, stored, stored, (_path, value) =>
    isSealed(value)
      ? { last4: value.last4 }
      : typeof value === 'string'
        ? { last4: value.slice(-4) }
        : value,
  );
  return out as IntakeAnswers;
}
