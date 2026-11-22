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
  /**
   * More fields of free text than the shared list knows (written as "changed"); 'all' for a
   * record whose every value stays out of the log (a message's content, pay, an IP allowlist):
   * the fields that changed are named, their values never written.
   */
  text?: readonly string[] | 'all';
  /**
   * Fields of the firm's own configuration text (a rule's or a deadline's description) whose old
   * and new words are written, up to the length cap below (longer: "changed"). Never for a note,
   * a message or anything about a client: Audit Log Review 2, R03.
   */
  quote?: readonly string[];
  /** More fields never listed (who and when saved, `version` and `etag` never are). */
  skip?: readonly string[];
}

/** Who and when a record was saved, and its concurrency token: never a field change. */
const BOOKKEEPING = ['updatedByUserId', 'updatedAt', 'createdAt', 'version', 'etag'];

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
  beforeRow: object,
  afterRow: object,
  options: AuditChangesOptions = {},
): AuditChanges {
  // Any record: a database row, a settings object, the values written.
  const before = beforeRow as Readonly<Record<string, unknown>>;
  const after = afterRow as Readonly<Record<string, unknown>>;
  const skip = new Set([...BOOKKEEPING, ...(options.skip ?? [])]);
  const allText = options.text === 'all';
  const text = new Set(options.text === 'all' ? [] : (options.text ?? []));
  const quote = new Set(options.quote ?? []);
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
      allText ||
      (isFreeTextKey(field) && !quote.has(field)) ||
      text.has(field) ||
      long(from) ||
      long(to)
        ? CHANGED
        : { from: from as AuditValue, to: to as AuditValue };
  }
  return { fields, changes: redactMetadata(changes) };
}
