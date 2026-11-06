// A recurring schedule in words (the setup's summary and the Manage list), apart from the
// screens so it is unit-tested.

const WEEKDAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTH = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
const ordinal = (n: number) =>
  `${n}${n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th'}`;

/** "Monthly on the 15th", "Quarterly, 1 month after quarter end on the 30th"... */
export function frequencyText(r: {
  frequency: 'MONTHLY' | 'QUARTERLY' | 'ANNUAL' | 'CUSTOM' | 'AUTHORITY_DEFINED';
  interval: number | null;
  repeatRule: object;
}): string {
  const rule = r.repeatRule as Record<string, number | undefined>;
  const dayRule = rule['nth']
    ? `the ${ordinal(rule['nth'])} ${WEEKDAY[rule['weekday'] ?? 1]}`
    : `the ${ordinal(rule['dayOfMonth'] ?? 15)}`;
  if (r.frequency === 'MONTHLY') return `Monthly on ${dayRule}`;
  // CD-F11 (Octavia, Oct 28): no frequency is claimed until the interval is a whole number of
  // months, at least one (0 or empty is not "every 1 month").
  if (r.frequency === 'CUSTOM') {
    const n = r.interval;
    if (n === null || !Number.isInteger(n) || n < 1)
      return 'Not set yet: choose how many months apart';
    return `Every ${n === 1 ? 'month' : `${n} months`} on ${dayRule}`;
  }
  if (r.frequency === 'QUARTERLY') {
    const after = rule['monthsAfterQuarterEnd'] ?? 0;
    return `Quarterly, ${after === 0 ? 'in the quarter-end month' : `${after} month${after === 1 ? '' : 's'} after quarter end`}, on the ${ordinal(rule['dayOfMonth'] ?? 15)}`;
  }
  if (r.frequency === 'ANNUAL') {
    return `Annually on ${MONTH[(rule['month'] ?? 1) - 1]} ${rule['day'] ?? 1}`;
  }
  return 'Follows the authority’s calendar';
}
