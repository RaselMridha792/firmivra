// TP-F01: the Templates overview's and a library's view kept in the page's address (SH1's
// `lib/list-query`), so the editor's Cancel and breadcrumb, browser Back and a Use handoff's Back
// open the list exactly as it was: view, search, category, status, owner, tag, sort and page.

import { readListQuery } from '../../../../../lib/list-query';

/** A library's view: `/templates/library/[kind]?category=&q=&status=&owner=&tag=&sort=&page=`. */
export const LIBRARY_VIEW = {
  category: '',
  q: '',
  status: '',
  owner: '',
  tag: '',
  sort: 'updated',
  page: '1',
};
export type LibraryView = typeof LIBRARY_VIEW;

/** A category id from the address: only an id is sent on to the API. */
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The overview's view: `/templates?view=&category=&q=&all=&page=`. */
export const OVERVIEW_VIEW = { view: 'all', category: '', q: '', all: '', page: '1' };
export type OverviewView = typeof OVERVIEW_VIEW;

/**
 * The view in the address the page opened with. Read in the browser, not by the server page: a
 * browser Back shows the address the list last wrote, which the server never saw.
 */
export function viewOf<T extends Record<string, string>>(
  params: URLSearchParams | null,
  defaults: T,
): T {
  return readListQuery(params ? Object.fromEntries(params.entries()) : {}, defaults);
}
