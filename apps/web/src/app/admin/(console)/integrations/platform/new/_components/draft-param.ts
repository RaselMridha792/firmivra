/**
 * The draft a wizard step works on, from its `?draft=<id>` (setupHref in integrations-shell):
 * one id-shaped value, or null to start a new integration. Plain code, so the step's server
 * `page.tsx` can call it.
 */
export function draftParam(value: string | string[] | undefined): string | null {
  const text = Array.isArray(value) ? value[0] : value;
  return text && /^[\w-]{1,64}$/.test(text) ? text : null;
}
