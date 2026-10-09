/**
 * The firm's motto from branding ("Plan | Prepare | Prosper") as its words; none when not set.
 * `branding.tagline` joins the PortalInfo contract in its own PR, so this reads it when present.
 */
export function taglineWords(branding: object): string[] {
  const tagline = 'tagline' in branding ? branding.tagline : null;
  return (typeof tagline === 'string' ? tagline : '')
    .split('|')
    .map((word) => word.trim())
    .filter(Boolean);
}
