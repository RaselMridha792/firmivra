/**
 * The firm's motto from branding ("Plan | Prepare | Prosper") as its words; none when not set.
 * It is `branding.sidebarMotto` in the PortalInfo contract (Settings > Company Profile & Branding).
 */
export function taglineWords(branding: object): string[] {
  const tagline = 'sidebarMotto' in branding ? branding.sidebarMotto : null;
  return (typeof tagline === 'string' ? tagline : '')
    .split('|')
    .map((word) => word.trim())
    .filter(Boolean);
}
