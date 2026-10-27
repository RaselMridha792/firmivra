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
  q: '',
  page: '1',
  size: '10',
  sort: 'name',
  desc: '0',
};
export type BookkeepingView = typeof BOOKKEEPING_VIEW;
