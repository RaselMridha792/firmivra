// SA-APP-F11: the applications list's view in the address (tab, status, date range, search,
// page). A plain module, so the server page and the client list read the same defaults.

export const LIST_DEFAULTS = { tab: 'all', status: '', range: 'all', search: '', page: '1' };
export type ListView = typeof LIST_DEFAULTS;
