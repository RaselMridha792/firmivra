// Where a person is in Client Sign-ups (Octavia's spec, section 14): the tab, search, sort,
// filters, page and the open request, kept in the page's address so Back and a reload bring the
// same view back. Plain values, so the server page reads them too.
import type { SignUpListStatus, SignUpMatch } from '@firmivra/types';

export interface SignUpsPlace {
  status: SignUpListStatus;
  search: string;
  sort: 'newest' | 'oldest';
  /** Submitted on or after / on or before (the firm's days, YYYY-MM-DD); '' is any. */
  from: string;
  to: string;
  match: SignUpMatch | '';
  page: number;
  /** The request open in the panel, or ''. */
  request: string;
}

export const SIGN_UP_PAGE_SIZE = 10;
const TABS: Record<string, SignUpListStatus> = {
  waiting: 'PENDING_APPROVAL',
  approved: 'APPROVED',
  declined: 'DECLINED',
};
const TAB_OF: Record<SignUpListStatus, string> = {
  PENDING_APPROVAL: 'waiting',
  APPROVED: 'approved',
  DECLINED: 'declined',
};
const MATCHES: Record<string, SignUpMatch> = { potential: 'POTENTIAL_MATCH', none: 'NO_MATCH' };
const MATCH_OF: Record<SignUpMatch, string> = { POTENTIAL_MATCH: 'potential', NO_MATCH: 'none' };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

type Param = string | string[] | undefined;
const one = (v: Param) => (typeof v === 'string' ? v : '');

export const FRESH: SignUpsPlace = {
  status: 'PENDING_APPROVAL',
  search: '',
  sort: 'newest',
  from: '',
  to: '',
  match: '',
  page: 1,
  request: '',
};

/** The place an address names; anything unknown or malformed is left at its default. */
export function signUpsPlaceFrom(params: Record<string, Param>): SignUpsPlace {
  const day = (key: string) => (DAY.test(one(params[key])) ? one(params[key]) : '');
  const page = Number(one(params['page']));
  const from = day('from');
  const to = day('to');
  const status = TABS[one(params['tab'])] ?? FRESH.status;
  return {
    status,
    search: one(params['search']).slice(0, 100),
    sort: one(params['sort']) === 'oldest' ? 'oldest' : 'newest',
    // A range that ends before it starts is dropped whole.
    ...(from && to && from > to ? { from: '', to: '' } : { from, to }),
    match: status === 'PENDING_APPROVAL' ? (MATCHES[one(params['match'])] ?? '') : '',
    page: Number.isInteger(page) && page > 1 && page <= 10_000 ? page : 1,
    request: UUID.test(one(params['request'])) ? one(params['request']) : '',
  };
}

/** The address's query for a place, without the defaults ('' for a fresh list). */
export function signUpsPlaceQuery(place: SignUpsPlace): string {
  const q = new URLSearchParams();
  if (place.status !== FRESH.status) q.set('tab', TAB_OF[place.status]);
  if (place.search) q.set('search', place.search);
  if (place.sort !== FRESH.sort) q.set('sort', place.sort);
  if (place.from) q.set('from', place.from);
  if (place.to) q.set('to', place.to);
  if (place.match) q.set('match', MATCH_OF[place.match]);
  if (place.page > 1) q.set('page', String(place.page));
  if (place.request) q.set('request', place.request);
  return q.toString();
}
