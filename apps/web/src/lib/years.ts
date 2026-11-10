// Advisory B34 (Octavia, Oct 25): year choices roll with the calendar: this year, six years back
// and three ahead, plus a custom year. A year already stored on a record is always offered, so
// rolling the choices forward never changes what a record says.

/** Years a custom entry may name. */
export const YEAR_MIN = 1900;
export const YEAR_MAX = 2100;

/** The rolling choices, newest first, with every stored year outside them kept in order. */
export function yearChoices(
  stored: readonly (number | string | null | undefined)[] = [],
  now: Date = new Date(),
): string[] {
  const current = now.getFullYear();
  const years = new Set<number>();
  for (let y = current + 3; y >= current - 6; y -= 1) years.add(y);
  for (const s of stored) {
    const y = Number(s);
    if (s !== null && s !== undefined && s !== '' && Number.isInteger(y)) years.add(y);
  }
  return [...years].sort((a, b) => b - a).map(String);
}

/** A typed custom year: four digits within YEAR_MIN and YEAR_MAX, else null. */
export function customYear(value: string): string | null {
  const v = value.trim();
  if (!/^\d{4}$/.test(v)) return null;
  const y = Number(v);
  return y >= YEAR_MIN && y <= YEAR_MAX ? v : null;
}
