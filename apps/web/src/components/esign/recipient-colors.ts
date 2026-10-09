/**
 * The eight recipient colours (a recipient's `colorIndex`, 0 to 7), so the sender can tell whose
 * field is whose (spec section 7: colour and label). Each is a `--color-recipient-N` token from
 * packages/ui when it exists, else a mix of the existing tokens. Ordered so the first few, which
 * most requests use, are the furthest apart.
 */
const FALLBACKS = [
  'var(--color-platform-blue)',
  'var(--color-warning)',
  'color-mix(in srgb, var(--color-platform-blue) 50%, var(--color-danger))',
  'var(--color-platform-teal)',
  'color-mix(in srgb, var(--color-warning) 40%, var(--color-danger))',
  'var(--color-success)',
  'var(--color-platform-navy-raised)',
  'color-mix(in srgb, var(--color-platform-teal) 50%, var(--color-warning))',
] as const;

/** The recipient's ink: borders, labels, the field name. */
export function recipientColor(colorIndex: number): string {
  const i = ((colorIndex % 8) + 8) % 8;
  return `var(--color-recipient-${i}, ${FALLBACKS[i]})`;
}

/** The colour of fields the sender fills (no recipient): neutral, outside the eight. */
export const SENDER_COLOR = 'var(--color-recipient-sender, var(--color-muted))';

/** A light wash of a field colour for its fill, as strong as the design system's soft fills. */
export function washOf(colour: string): string {
  return `color-mix(in srgb, ${colour} 12%, transparent)`;
}
