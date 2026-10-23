// Tag names as the firm keeps them (L5): one tag per name ignoring case and outer spaces, the
// rule of the database's tags_live_name index. Plain functions for the picker and its unit test.

/** The name as compared: trimmed, lower case. */
export const tagKey = (name: string) => name.trim().toLowerCase();

/** The names once each (the first spelling kept), as the firm keeps them where it has them. */
export function uniqueTags(names: readonly string[], firm: readonly string[] = []): string[] {
  const out: string[] = [];
  for (const raw of names) {
    const name = firm.find((f) => tagKey(f) === tagKey(raw)) ?? raw.trim();
    if (name && !out.some((n) => tagKey(n) === tagKey(name))) out.push(name);
  }
  return out;
}
