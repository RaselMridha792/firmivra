// Advisory B19 (Octavia, Oct 25): after Create Appointment Type (opened in a new tab), Check again
// reads the types once more; the one type that was not there before is the one just made.

/** The id of the single type added since `before`, or null (none, or more than one). */
export function addedType(
  before: ReadonlySet<string> | null,
  types: readonly { id: string }[],
): string | null {
  if (!before) return null;
  const added = types.filter((t) => !before.has(t.id));
  return added.length === 1 ? added[0]!.id : null;
}
