/** The tones an appointment colour is shown in: kit tokens, never the raw colour. */
export type ColourTone = 'blue' | 'green' | 'amber' | 'red' | 'purple' | 'grey';

export const TONE_NAMES: Record<ColourTone, string> = {
  blue: 'Blue',
  green: 'Green',
  amber: 'Amber',
  red: 'Red',
  purple: 'Purple',
  grey: 'Grey',
};

/** A small round swatch of the tone. */
export const TONE_DOTS: Record<ColourTone, string> = {
  blue: 'bg-action',
  green: 'bg-success',
  amber: 'bg-gold',
  red: 'bg-danger',
  purple: 'bg-purple',
  grey: 'bg-muted',
};

/**
 * The tone nearest an appointment's `#rrggbb` colour (the contract's data), by its hue; null when
 * the value is not a colour.
 */
export function colourTone(value: string | null | undefined): ColourTone | null {
  const m = /^#([0-9a-f]{6})$/i.exec(value ?? '');
  if (!m?.[1]) return null;
  const n = Number.parseInt(m[1], 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => c / 255) as [
    number,
    number,
    number,
  ];
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  if (d < 0.15) return 'grey';
  let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h = (h * 60 + 360) % 360;
  if (h < 20 || h >= 330) return 'red';
  if (h < 65) return 'amber';
  if (h < 170) return 'green';
  if (h < 255) return 'blue';
  return 'purple';
}
