// IN-F02 (Octavia's Oct 28 review): the overview's and the Marketplace's view, kept in the page
// address so Cancel and Back return to it as it was. Plain data: the server pages read the address
// with these defaults (readListQuery) and the screens write their changes back (writeListQuery).

export const OVERVIEW_VIEW = { tab: 'all', search: '', category: '', environment: 'LIVE' };
export const MARKETPLACE_VIEW = { search: '', category: '', sort: 'popular', view: 'grid' };
