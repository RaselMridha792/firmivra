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

export function isFilled(f: SignerField, all: readonly SignerField[], s: Filled): boolean {
  switch (f.type) {
    case 'SIGNATURE':
      return !!s.adopted;
    case 'INITIALS':
      return !!s.adopted?.hasInitials;
    case 'DATE_SIGNED':
      return true;
    case 'ATTACHMENT':
      return !!s.attachments[f.id];
    case 'CHECKBOX':
      return s.values[f.id] === 'true';
    case 'RADIO':
      // One choice per group answers every option in it.
      return all.some((o) => o.type === 'RADIO' && sameGroup(o, f) && s.values[o.id] === 'true');
    default:
      return !!s.values[f.id]?.trim();
  }
}

export const sameGroup = (a: SignerField, b: SignerField) =>
  a.id === b.id || (!!a.groupKey && a.groupKey === b.groupKey);

/** Document order: page, then top to bottom, then left to right. */
export const byPosition = (a: SignerField, b: SignerField) =>
  a.pageIndex - b.pageIndex || a.y - b.y || a.x - b.x;

/** Required fields still to fill, in document order. */
export function missing(fields: readonly SignerField[], s: Filled): SignerField[] {
  return fields.filter((f) => f.required && !isFilled(f, fields, s)).sort(byPosition);
}

/** `finish`'s values: every field the signer fills themselves, trimmed. */
export function finishValues(fields: readonly SignerField[], s: Filled) {
  return fields
    .filter((f) => !SERVER_FILLED.has(f.type))
    .map((f) => ({ fieldId: f.id, value: (s.values[f.id] ?? '').trim() }));
}
