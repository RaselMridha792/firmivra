// TP-Y03: the editor's tags box. A tag typed without Enter is added on Save, not lost.

/** The tags with the one typed in the box added: trimmed, once in any case, up to 20. */
export function withTyped(tags: readonly string[], typed: string): string[] {
  const t = typed.trim();
  return t && !tags.some((x) => x.toLowerCase() === t.toLowerCase()) && tags.length < 20
    ? [...tags, t]
    : [...tags];
}
