/**
 * The eight recipient colours (a recipient's `colorIndex`, 0 to 7), so the sender can tell whose
 * field is whose (spec section 7: colour and label). Each is a `--color-recipient-N` token from
 * packages/ui when it exists, else a mix of the existing tokens.
 */
const FALLBACKS = [
  'var(--color-platform-blue)',
  'var(--color-platform-teal)',
  'var(--color-success)',
  'var(--color-warning)',
  'color-mix(in srgb, var(--color-platform-blue) 50%, var(--color-danger))',
  'var(--color-platform-navy-raised)',
  'color-mix(in srgb, var(--color-warning) 55%, var(--color-danger))',
  'var(--color-control-border)',
] as const;

/** The recipient's ink: borders, labels, the field name. */
export function recipientColor(colorIndex: number): string {
  const i = ((colorIndex % 8) + 8) % 8;
  return `var(--color-recipient-${i}, ${FALLBACKS[i]})`;
}

/** A light wash of the recipient's colour, for the field's fill. */
export function recipientWash(colorIndex: number): string {
  return `color-mix(in srgb, ${recipientColor(colorIndex)} 14%, transparent)`;
}
