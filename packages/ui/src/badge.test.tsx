import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Badge, type BadgeTone } from './index';

// Every tone, so a new one is checked too (a missing key fails the typecheck).
const TONES: Record<BadgeTone, true> = {
  info: true,
  success: true,
  warning: true,
  danger: true,
  neutral: true,
  purple: true,
  teal: true,
  navy: true,
};

const css = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');
/** A colour token's own hex value in the theme (`--color-teal: #006d70;`). */
const hexOf = (token: string) =>
  new RegExp(`--color-${token}:\\s*(#[0-9a-f]{6});`, 'i').exec(css)?.[1];

const luminance = (hex: string) => {
  const [r, g, b] = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
};
/** WCAG contrast ratio of two colours. */
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
};

/** The background and text colour tokens a tone's badge uses. */
const colours = (tone: BadgeTone) => {
  const html = renderToStaticMarkup(<Badge tone={tone}>Label</Badge>);
  const classes = /class="([^"]*)"/.exec(html)?.[1]?.split(' ') ?? [];
  // `text-xs` is a size, not a colour: only names the theme declares as colours count.
  const token = (prefix: string) =>
    classes
      .filter((c) => c.startsWith(prefix))
      .map((c) => c.slice(prefix.length))
      .find((name) => hexOf(name));
  return { bg: token('bg-'), text: token('text-') };
};

describe('Badge tones', () => {
  it('R55 I-N07: Scheduled teal and Canceled navy use their own fixed tokens', () => {
    expect(colours('teal')).toEqual({ bg: 'teal-soft', text: 'teal' });
    expect(colours('navy')).toEqual({ bg: 'navy', text: 'white' });
  });

  it('every tone reads at 4.5:1 or more, text on its background', () => {
    for (const tone of Object.keys(TONES) as BadgeTone[]) {
      const { bg, text } = colours(tone);
      expect(bg, tone).toBeDefined();
      expect(text, tone).toBeDefined();
      expect(contrast(hexOf(text!)!, hexOf(bg!)!), tone).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('the tones a pair of invoice statuses uses differ in both colours', () => {
    const pairs: [BadgeTone, BadgeTone][] = [
      ['danger', 'navy'], // Overdue, Canceled
      ['warning', 'purple'], // Due Today, Partially Paid
      ['teal', 'info'], // Scheduled, Sent
      ['neutral', 'navy'], // Draft, Canceled
    ];
    for (const [a, b] of pairs) {
      const [x, y] = [colours(a), colours(b)];
      expect(hexOf(x.bg!), `${a} / ${b}`).not.toBe(hexOf(y.bg!));
      expect(hexOf(x.text!), `${a} / ${b}`).not.toBe(hexOf(y.text!));
    }
  });
});
