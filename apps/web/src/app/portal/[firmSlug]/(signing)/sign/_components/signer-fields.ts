import type { SignerField } from '@firmivra/types';

/** Field types the server fills (stamped or uploaded): never sent in `finish`. */
const SERVER_FILLED = new Set<SignerField['type']>([
  'SIGNATURE',
  'INITIALS',
  'DATE_SIGNED',
  'ATTACHMENT',
]);

/** The signer's work in progress: typed values, and the uploaded attachments' names. */
export interface Filled {
  values: Record<string, string>;
  attachments: Record<string, string>;
  /** The API has their signature (and initials, when adopted with it). */
  adopted: { hasInitials: boolean } | null;
}

/** What the envelope already holds: suggestions (their name, email) and anything saved. */
export function startValues(fields: readonly SignerField[]): Filled['values'] {
  return Object.fromEntries(
    fields
      .filter((f) => !SERVER_FILLED.has(f.type))
      .map((f) => [f.id, f.value ?? (f.type === 'CHECKBOX' || f.type === 'RADIO' ? 'false' : '')]),
  );
}

/** A RADIO option's group: options sharing a groupKey are one choice. */
export const groupOf = (f: SignerField) => f.groupKey ?? f.id;

/** Which fields count as filled, worked out once per render (a radio group in one pass). */
export function filledIds(fields: readonly SignerField[], s: Filled): Set<string> {
  const answered = new Set(
    fields.filter((f) => f.type === 'RADIO' && s.values[f.id] === 'true').map(groupOf),
  );
  const out = new Set<string>();
  for (const f of fields) {
    let filled: boolean;
    switch (f.type) {
      case 'SIGNATURE':
        filled = !!s.adopted;
        break;
      case 'INITIALS':
        filled = !!s.adopted?.hasInitials;
        break;
      case 'DATE_SIGNED':
        filled = true;
        break;
      case 'ATTACHMENT':
        filled = !!s.attachments[f.id];
        break;
      case 'CHECKBOX':
        filled = s.values[f.id] === 'true';
        break;
      case 'RADIO':
        // One choice answers every option in the group.
        filled = answered.has(groupOf(f));
        break;
      default:
        filled = !!s.values[f.id]?.trim();
    }
    if (filled) out.add(f.id);
  }
  return out;
}

/** Document order: page, then top to bottom, then left to right. */
export const byPosition = (a: SignerField, b: SignerField) =>
  a.pageIndex - b.pageIndex || a.y - b.y || a.x - b.x;

/**
 * What the signer still has to fill, in document order, each radio group once (its first
 * option): the required ones, or with `optional` the others.
 */
export function toFill(
  ordered: readonly SignerField[],
  filled: Set<string>,
  optional = false,
): SignerField[] {
  const groups = new Set<string>();
  return ordered.filter((f) => {
    if (f.required === optional || filled.has(f.id)) return false;
    if (f.type !== 'RADIO') return true;
    if (groups.has(groupOf(f))) return false;
    groups.add(groupOf(f));
    return true;
  });
}

/** The required items the progress counts: each radio group once, never the stamped date. */
export function requiredCount(fields: readonly SignerField[]): number {
  const groups = new Set<string>();
  return fields.filter((f) => {
    if (!f.required || f.type === 'DATE_SIGNED') return false;
    if (f.type !== 'RADIO') return true;
    if (groups.has(groupOf(f))) return false;
    groups.add(groupOf(f));
    return true;
  }).length;
}

/** `finish`'s values: every field the signer fills themselves, trimmed. */
export function finishValues(fields: readonly SignerField[], s: Filled) {
  return fields
    .filter((f) => !SERVER_FILLED.has(f.type))
    .map((f) => ({ fieldId: f.id, value: (s.values[f.id] ?? '').trim() }));
}
