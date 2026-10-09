/** The firm's motto from branding ("Plan | Prepare | Prosper") as its words; none when not set. */
export function taglineWords(tagline: string | null | undefined): string[] {
  return (tagline ?? '')
    .split('|')
    .map((word) => word.trim())
    .filter(Boolean);
}
