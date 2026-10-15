/**
 * The soft tile + strong icon pairs the firm workspace designs repeat (KPI tiles, link cards,
 * callouts, timelines, the permission grid's module icons). `navy` is the dark icon on a pale
 * blue tile (Settings' Billing and System cards, "Need Help?").
 */
export const tileTones = {
  blue: 'bg-info-soft text-info',
  amber: 'bg-warning-soft text-gold',
  green: 'bg-success-soft text-success',
  purple: 'bg-purple-soft text-purple',
  red: 'bg-danger-soft text-danger',
  grey: 'bg-disabled text-muted',
  navy: 'bg-folder-surface text-heading',
} as const;
export type TileTone = keyof typeof tileTones;

/** Solid discs: a white icon on a strong colour (Pro Tip's bulb, the activity timeline's dots). */
export const discTones = {
  blue: 'bg-action text-on-action',
  amber: 'bg-gold text-on-action',
  green: 'bg-success text-on-action',
  purple: 'bg-purple text-on-action',
  red: 'bg-danger text-on-action',
  grey: 'bg-control-border text-on-action',
  navy: 'bg-heading text-on-action',
} as const;

/** The icon colour alone, for icons that sit on a card without a tile. */
export const textTones = {
  blue: 'text-info',
  amber: 'text-gold',
  green: 'text-success',
  purple: 'text-purple',
  red: 'text-danger',
  grey: 'text-muted',
  navy: 'text-heading',
} as const;

/** A tile one step darker than a tinted card it sits on (Security Best Practices on mint). */
export const tintTones = {
  blue: 'bg-info/15 text-info',
  amber: 'bg-gold/15 text-gold',
  green: 'bg-success/15 text-success',
  purple: 'bg-purple/15 text-purple',
  red: 'bg-danger/15 text-danger',
  grey: 'bg-muted/15 text-muted',
  navy: 'bg-heading/15 text-heading',
} as const;
