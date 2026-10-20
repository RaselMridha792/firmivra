// The firm's theme colours (Settings > Company Profile & Branding): sidebar, headings and main
// text, secondary text, and primary buttons. A null colour leaves the token's default, the look
// derived from the primary colour (packages/ui styles.css). Text on the sidebar and on buttons is
// white or the dark navy token, whichever reads better (WCAG contrast), as the emails' `textOn`.

const HEX = /^#[0-9a-f]{6}$/i;

export interface FirmTheme {
  sidebarColor: string | null;
  textPrimaryColor: string | null;
  textSecondaryColor: string | null;
  buttonColor: string | null;
}

/** A colour's relative luminance (WCAG 2.x). */
function luminance(hex: string): number {
  const channel = (i: number) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

/** The text token that reads better on `hex`: white, or the dark navy. */
export function textOn(hex: string): string {
  const navy = 0.0103; // --color-platform-navy (#001b36)
  const onWhite = 1.05 / (luminance(hex) + 0.05);
  const onNavy = (luminance(hex) + 0.05) / (navy + 0.05);
  return onWhite >= onNavy ? 'var(--color-white)' : 'var(--color-platform-navy)';
}

const valid = (value: string | null | undefined): value is string =>
  typeof value === 'string' && HEX.test(value);

/**
 * The CSS variables a layout sets for the firm's theme: the portal's firm tokens and the semantic
 * tokens the firm workspace uses (navigation, heading, text, muted, action). Only valid
 * `#rrggbb` colours are set; anything else keeps the default.
 */
export function firmThemeVars(
  theme: Partial<FirmTheme> | null | undefined,
): Record<string, string> {
  const vars: Record<string, string> = {};
  if (!theme) return vars;
  const { sidebarColor, textPrimaryColor, textSecondaryColor, buttonColor } = theme;
  if (valid(sidebarColor)) {
    const on = textOn(sidebarColor);
    vars['--color-firm-sidebar'] = sidebarColor;
    vars['--color-on-firm-sidebar'] = on;
    vars['--color-navigation'] = sidebarColor;
    vars['--color-navigation-hover'] = `color-mix(in srgb, ${sidebarColor}, ${on} 10%)`;
    vars['--color-on-navigation'] = on;
  }
  if (valid(textPrimaryColor)) {
    vars['--color-firm-text'] = textPrimaryColor;
    vars['--color-heading'] = textPrimaryColor;
    vars['--color-text'] = textPrimaryColor;
  }
  if (valid(textSecondaryColor)) {
    vars['--color-firm-text-muted'] = textSecondaryColor;
    vars['--color-muted'] = textSecondaryColor;
  }
  if (valid(buttonColor)) {
    const on = textOn(buttonColor);
    vars['--color-firm-button'] = buttonColor;
    vars['--color-on-firm-button'] = on;
    vars['--color-action'] = buttonColor;
    vars['--color-action-hover'] =
      `color-mix(in srgb, ${buttonColor}, var(--color-platform-navy) 12%)`;
    vars['--color-action-pressed'] =
      `color-mix(in srgb, ${buttonColor}, var(--color-platform-navy) 24%)`;
    vars['--color-on-action'] = on;
  }
  return vars;
}

/** Sets the theme variables on an element's inline style, clearing the ones no longer set. */
export function applyFirmTheme(
  style: CSSStyleDeclaration,
  theme: Partial<FirmTheme> | null | undefined,
): () => void {
  const vars = firmThemeVars(theme);
  for (const [property, value] of Object.entries(vars)) style.setProperty(property, value);
  return () => {
    for (const property of Object.keys(vars)) style.removeProperty(property);
  };
}
