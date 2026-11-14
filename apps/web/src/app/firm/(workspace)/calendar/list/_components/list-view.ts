/**
 * Review 2 (B3): the Appointments list's view in the address (`?q=&status=&period=`), so Back
 * from an appointment restores it. A plain module: the page (a server component) reads it too.
 */
export const LIST_VIEW = { q: '', status: '', period: 'next30' };
export type ListView = typeof LIST_VIEW;
