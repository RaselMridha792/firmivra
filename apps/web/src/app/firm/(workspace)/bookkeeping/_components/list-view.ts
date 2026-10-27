// The Bookkeeping overview's view in its address (SH1): period, status tab, filters, search, sort
// and page. Plain values, so the server page reads them and Back restores the list exactly.
export const BOOKKEEPING_VIEW = {
  period: 'THIS_MONTH',
  tab: 'ALL',
  type: '',
  plan: '',
  software: '',
  status: '',
  due: '',
  dueFrom: '',
  dueTo: '',
  q: '',
  page: '1',
  size: '10',
  sort: 'name',
  desc: '0',
};
export type BookkeepingView = typeof BOOKKEEPING_VIEW;

/** The Report Due filter's dates; `CUSTOM` (BK-D03) takes both ends, included, start first. */
export const dueRange = (v: string, from = '', to = '') => {
  if (v === 'CUSTOM') {
    if (from && to && from > to) return null;
    return { ...(from ? { reportDueFrom: from } : {}), ...(to ? { reportDueTo: to } : {}) };
  }
  const today = new Date().toISOString().slice(0, 10);
  const add = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10);
  if (v === 'WEEK') return { reportDueFrom: today, reportDueTo: add(7) };
  if (v === 'MONTH') return { reportDueFrom: today, reportDueTo: add(31) };
  if (v === 'OVERDUE') return { reportDueTo: add(-1) };
  return {};
};
