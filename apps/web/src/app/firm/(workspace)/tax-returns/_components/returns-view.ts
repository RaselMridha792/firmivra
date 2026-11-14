// Review 2 (TX-F03): the Tax Returns list's tab, filters, search and page live in the address,
// so a row's action (Request Client Information, Send Message, ...) comes Back to the list as it
// was. A plain module: the server page reads the address with it and the screen writes it.
export const RETURNS_VIEW = {
  tab: 'all',
  year: '',
  formType: '',
  clientType: '',
  assigned: '',
  q: '',
  archived: '',
  page: '1',
};
