// SA-APP-F11: the applications list's view in the address (tab, status, date range, search,
// page). A plain module, so the server page and the client list read the same defaults.

export const LIST_DEFAULTS = {
  tab: 'all',
  status: '',
  range: 'all',
  search: '',
  page: '1',
  /** SA-APP-F07: newest, oldest, or by last activity. */
  order: 'newest',
};
export type ListView = typeof LIST_DEFAULTS;

/** The Date Range choices; SA-DSH-F12: the dashboard's Recent Applications uses them too. */
export type DateRange = 'all' | '7' | '30' | 'month';
export const RANGES: readonly DateRange[] = ['all', '7', '30', 'month'];
export const RANGE_LABELS: Record<DateRange, string> = {
  all: 'All Time',
  '7': 'Last 7 days',
  '30': 'Last 30 days',
  month: 'This month',
};

/** A Date Range as the list query's bounds, in the viewer's days; All Time has none. */
export function rangeBounds(value: DateRange): { from?: string; to?: string } {
  if (value === 'all') return {};
  const today = new Date();
  const start =
    value === 'month'
      ? new Date(today.getFullYear(), today.getMonth(), 1)
      : new Date(today.getFullYear(), today.getMonth(), today.getDate() - Number(value) + 1);
  const end = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
  return { from: start.toISOString(), to: end.toISOString() };
}
