/**
 * Intake Review 2 23-g: a lead's link (`/{slug}/form`) or a public share link (`/{slug}/start/...`)
 * while the firm's Use this branding on client-facing forms is off: the firm's name only, with no
 * logo or colours. The portal's own pages keep the firm's branding.
 */
export function plainForm(
  pathname: string | null,
  slug: string,
  branding: { formBranding?: boolean } | undefined,
): boolean {
  if (!branding || branding.formBranding !== false || !pathname) return false;
  return pathname.startsWith(`/${slug}/form`) || pathname.startsWith(`/${slug}/start/`);
}

/**
 * Every page of one firm's portal (/{firm}/...). The firm's colours are the tokens
 * --color-firm-primary and --color-firm-accent, and its theme colours (sidebar, text, secondary
 * text, buttons: lib/theme.ts), with defaults in packages/ui. R3's public
 * GET /api/v1/portal/{slug}/info lets this layout load the firm and set those colours from it
 * and shows not-found for an unknown slug. Nahid polishes it (N01).
 */
