/**
 * SM20: a member's first and last name: as kept on their staff profile while that still matches
 * users.name (the person may rename themselves), else users.name split at its first space.
 */
export function namesOf(
  name: string,
  kept: { firstName: string | null; lastName: string | null } | null | undefined,
): { firstName: string; lastName: string } {
  const full = name.trim().replace(/\s+/g, ' ');
  if (kept?.firstName && `${kept.firstName} ${kept.lastName ?? ''}`.trim() === full)
    return { firstName: kept.firstName, lastName: kept.lastName ?? '' };
  const [first = '', ...rest] = full.split(' ');
  return { firstName: first, lastName: rest.join(' ') };
}
