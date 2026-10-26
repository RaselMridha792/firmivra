// Where a person is in the Clients list (Octavia's E7): filters, search, page and page size, kept
// in the list's address so Back and Return to Clients bring the same list back, while a new
// visit to /clients starts fresh. Plain values, so the server page reads them too.

/** The list's filters as the address keeps them; '' is "any". */
export interface ClientsPlace {
  search: string;
  serviceId: string;
  clientStatus: string;
  assignedUserId: string;
  from: string;
  to: string;
  records: 'active' | 'archived' | 'all';
  owes: '' | 'DOCUMENTS' | 'BALANCE';
  page: number;
  limit: number;
}

export const CLIENT_PAGE_SIZES = [8, 25, 50, 100];
const STAGES = ['NEW', 'PENDING_DOCUMENTS', 'IN_PROGRESS', 'ACTIVE', 'ON_HOLD', 'INACTIVE'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** The session key that remembers the last list address, for Return to Clients. */
export const LAST_CLIENTS_LIST = 'firmivra:clients:last-list';

type Param = string | string[] | undefined;
const one = (v: Param) => (typeof v === 'string' ? v : '');

/** The place an address names; anything unknown or malformed is left at its default. */
export function clientsPlaceFrom(params: Record<string, Param>): ClientsPlace {
  const pick = (key: string, ok: (v: string) => boolean) => {
    const v = one(params[key]);
    return ok(v) ? v : '';
  };
  const records = one(params['records']);
  const owes = one(params['owes']);
  const page = Number(one(params['page']));
  const limit = Number(one(params['limit']));
  return {
    search: one(params['search']).slice(0, 100),
    serviceId: pick('service', (v) => UUID.test(v)),
    clientStatus: pick('stage', (v) => STAGES.includes(v)),
    assignedUserId: pick('staff', (v) => UUID.test(v)),
    from: pick('from', (v) => DAY.test(v)),
    to: pick('to', (v) => DAY.test(v)),
    records: records === 'archived' || records === 'all' ? records : 'active',
    owes: owes === 'DOCUMENTS' || owes === 'BALANCE' ? owes : '',
    page: Number.isInteger(page) && page > 1 && page <= 10_000 ? page : 1,
    limit: CLIENT_PAGE_SIZES.includes(limit) ? limit : (CLIENT_PAGE_SIZES[0] ?? 8),
  };
}

/** The address's query for a place, without the defaults ('' for the plain list). */
export function clientsPlaceQuery(place: ClientsPlace): string {
  const q = new URLSearchParams();
  const set = (key: string, value: string) => value && q.set(key, value);
  set('search', place.search);
  set('service', place.serviceId);
  set('stage', place.clientStatus);
  set('staff', place.assignedUserId);
  set('from', place.from);
  set('to', place.to);
  if (place.records !== 'active') q.set('records', place.records);
  set('owes', place.owes);
  if (place.page > 1) q.set('page', String(place.page));
  if (place.limit !== CLIENT_PAGE_SIZES[0]) q.set('limit', String(place.limit));
  return q.toString();
}
