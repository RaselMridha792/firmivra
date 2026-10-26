// The Payroll overview's view in its address (SH1): period, view tab, search, sort, page and the
// filters. Plain values, so the server page reads them and Back restores the list exactly.
export const PAYROLL_VIEW = {
  period: 'THIS_MONTH',
  tab: 'ALL',
  q: '',
  page: '1',
  sort: 'clientName',
  dir: 'asc',
  clientType: '',
  providerKey: '',
  frequency: '',
  status: '',
  assignedUserId: '',
  syncStatus: '',
};
export type PayrollView = typeof PAYROLL_VIEW;
