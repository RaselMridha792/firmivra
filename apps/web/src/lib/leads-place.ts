// Where a person is in the Leads list (Octavia's Leads Review Two, R2 1): search, every filter,
// the page and its size, kept in the list's address so Back and Back to Leads bring the same list
// back, while a plain visit to /leads starts fresh. Plain values, so the server page reads them.

export interface LeadsPlace {
  search: string;
  source: string;
  serviceId: string;
  stage: string;
  assignedUserId: string;
  from: string;
  to: string;
  priority: string;
  campaignId: string;
  tag: string;
  overdue: boolean;
  archived: boolean;
  page: number;
  pageSize: number;
}

export const LEAD_PAGE_SIZES = [8, 16, 24];
/** The session key that remembers the last list address, for Back to Leads. */
export const LAST_LEADS_LIST = 'firmivra:leads:last-list';

const SOURCES = [
  'BEGIN_ONLINE',
  'WEBSITE_FORM',
  'FACEBOOK_AD',
  'INSTAGRAM',
  'GOOGLE_AD',
  'REFERRAL',
  'PHONE_CALL',
  'WALK_IN',
  'EMAIL',
  'EVENT',
  'OTHER',
];
const STAGES = [
  'SUBMITTED',
  'IN_REVIEW',
  'CONTACTED',
  'IN_FOLLOW_UP',
  'APPOINTMENT_SCHEDULED',
  'QUALIFIED',
  'CONVERTED',
  'DECLINED',
  'LOST',
];
const PRIORITIES = ['HOT', 'WARM', 'COLD'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

type Param = string | string[] | undefined;
const one = (v: Param) => (typeof v === 'string' ? v : '');

/** The place an address names; anything unknown or malformed is left at its default. */
export function leadsPlaceFrom(params: Record<string, Param>): LeadsPlace {
  const pick = (key: string, ok: (v: string) => boolean) => {
    const v = one(params[key]);
    return ok(v) ? v : '';
  };
  const page = Number(one(params['page']));
  const pageSize = Number(one(params['size']));
  return {
    search: one(params['search']).slice(0, 100),
    source: pick('source', (v) => SOURCES.includes(v)),
    serviceId: pick('service', (v) => UUID.test(v)),
    stage: pick('stage', (v) => STAGES.includes(v)),
    assignedUserId: pick('staff', (v) => UUID.test(v)),
    from: pick('from', (v) => DAY.test(v)),
    to: pick('to', (v) => DAY.test(v)),
    priority: pick('priority', (v) => PRIORITIES.includes(v)),
    campaignId: pick('campaign', (v) => UUID.test(v)),
    tag: one(params['tag']).slice(0, 40),
    overdue: one(params['overdue']) === '1',
    archived: one(params['archived']) === '1',
    page: Number.isInteger(page) && page > 1 && page <= 10_000 ? page : 1,
    pageSize: LEAD_PAGE_SIZES.includes(pageSize) ? pageSize : (LEAD_PAGE_SIZES[0] ?? 8),
  };
}

/** The address's query for a place, without the defaults ('' for the plain list). */
export function leadsPlaceQuery(place: LeadsPlace): string {
  const q = new URLSearchParams();
  const set = (key: string, value: string) => value && q.set(key, value);
  set('search', place.search);
  set('source', place.source);
  set('service', place.serviceId);
  set('stage', place.stage);
  set('staff', place.assignedUserId);
  set('from', place.from);
  set('to', place.to);
  set('priority', place.priority);
  set('campaign', place.campaignId);
  set('tag', place.tag);
  if (place.overdue) q.set('overdue', '1');
  if (place.archived) q.set('archived', '1');
  if (place.page > 1) q.set('page', String(place.page));
  if (place.pageSize !== LEAD_PAGE_SIZES[0]) q.set('size', String(place.pageSize));
  return q.toString();
}
