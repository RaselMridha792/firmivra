import { CHANGED, isFreeTextKey, redactMetadata } from './audit-values.js';

/**
 * Audit Log Review 2, R03 (the lead's DECISIONS.md, "Audit Log" 2): one before/after for every
 * update that is audited, instead of the names of the fields a request sent. Only fields whose
 * value really changed are listed, each as `{ from, to }`:
 * - dates as ISO text, decimals as text; null stays null, so null, "", false and 0 stay distinct;
 * - free text (notes, messages, descriptions, bodies; or a site's own `text` fields) and any long
 *   value are "changed", never their text;
 * - secrets never appear and tax ids keep their last 4 (`redactMetadata`, the same rules
 *   AuditService applies to every row).
 * Spread the result into the row's metadata: `{ ...auditChanges(current, updated, { fields }) }`.
 */

export type AuditValue = string | number | boolean | null | AuditValue[];
export type AuditChange = { from: AuditValue; to: AuditValue } | typeof CHANGED;

/** A type, not an interface, so it spreads into or stands as an audit row's metadata. */
export type AuditChanges = {
  /** The fields that changed, sorted. */
  fields: string[];
  changes: Record<string, AuditChange>;
};

export interface AuditChangesOptions {
  /** The fields to compare (e.g. the request's keys); left out, every field of `after`. */
  fields?: readonly string[];
  /** More fields of free text than the shared list knows (written as "changed"). */
  text?: readonly string[];
  /** Fields never listed (a version or an etag). */
  skip?: readonly string[];
}

/** Longer than this (as JSON), a value is "changed" rather than written out. */
const MAX_VALUE = 200;

/** A value as the log keeps it; undefined for one the log cannot show plainly. */
function plain(value: unknown): AuditValue | undefined {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : String(value);
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) {
    const items = value.map(plain);
    return items.every((v) => v !== undefined) ? (items as AuditValue[]) : undefined;
  }
  // Prisma's Decimal and other value objects print themselves.
  if (typeof value === 'object' && 'toFixed' in value && typeof value.toString === 'function') {
    return value.toString();
  }
  return undefined;
}

/** The comparable form of a value: JSON of its plain form (objects by their JSON). */
const same = (a: unknown, b: unknown) =>
  JSON.stringify(plain(a) ?? a) === JSON.stringify(plain(b) ?? b);

export function auditChanges(
  before: Readonly<Record<string, unknown>>,
  after: Readonly<Record<string, unknown>>,
  options: AuditChangesOptions = {},
): AuditChanges {
  const skip = new Set(options.skip ?? []);
  const text = new Set(options.text ?? []);
  const fields = [...new Set(options.fields ?? Object.keys(after))]
    .filter((f) => !skip.has(f) && after[f] !== undefined && !same(before[f], after[f]))
    .sort();
  const changes: Record<string, AuditChange> = {};
  for (const field of fields) {
    const from = plain(before[field]);
    const to = plain(after[field]);
    const long = (v: AuditValue | undefined) =>
      v === undefined || JSON.stringify(v).length > MAX_VALUE;
    changes[field] =
      isFreeTextKey(field) || text.has(field) || long(from) || long(to)
        ? CHANGED
        : { from: from as AuditValue, to: to as AuditValue };
  }
  return { fields, changes: redactMetadata(changes) };
}
