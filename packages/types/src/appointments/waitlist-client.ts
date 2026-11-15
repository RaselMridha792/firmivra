import { type ApiRequest, parseInput, toQuery } from '../client.js';
import { portalMe } from '../clients/client.js';
import {
  JoinWaitlistRequest,
  MyWaitlist,
  MyWaitlistEntry,
  SaveWaitlistSettingsRequest,
  WaitlistEntry,
  WaitlistEntryId,
  WaitlistEntryList,
  WaitlistQuery,
  WaitlistSettings,
} from './waitlist.js';

// R55, Appointments A3: the waitlist's clients (contract in ./waitlist.ts).

const post = (body?: unknown) => ({ method: 'POST', ...(body === undefined ? {} : { body }) });
const put = (body: unknown) => ({ method: 'PUT', body });

/**
 * `api.myWaitlist(slug)`: the signed-in client's waitlist entries at one firm. Join waits for an
 * earlier time for one of their own scheduled appointments (409 WAITLIST_OFF, ALREADY_WAITING);
 * accept takes an open offer (the appointment moves, or staff are asked: the firm's mode; 409
 * OFFER_TAKEN when the time went meanwhile, and the entry waits again); decline turns it down;
 * leave ends a waiting entry (or turns an offer down).
 */
export function createMyWaitlistClient(request: ApiRequest, firmSlug: string) {
  const base = () => `${portalMe(firmSlug)}/appointment-waitlist`;
  const entry = (id: string) => `${base()}/${parseInput(WaitlistEntryId, id)}`;
  return {
    list: async (): Promise<MyWaitlist> => request(MyWaitlist, base()),
    join: async (body: JoinWaitlistRequest): Promise<MyWaitlistEntry> =>
      request(MyWaitlistEntry, base(), post(parseInput(JoinWaitlistRequest, body))),
    accept: async (id: string): Promise<MyWaitlistEntry> =>
      request(MyWaitlistEntry, `${entry(id)}/accept`, post()),
    decline: async (id: string): Promise<MyWaitlistEntry> =>
      request(MyWaitlistEntry, `${entry(id)}/decline`, post()),
    leave: async (id: string): Promise<MyWaitlistEntry> =>
      request(MyWaitlistEntry, `${entry(id)}/leave`, post()),
  };
}
export type MyWaitlistClient = ReturnType<typeof createMyWaitlistClient>;

const FIRM = '/business/appointment-waitlist';

/**
 * `api.appointmentWaitlist`: the firm's entries (Staff: of appointments they see in full), the
 * decision on a request (STAFF_APPROVAL), and the switch and mode (Owner and Admin).
 */
export function createAppointmentWaitlistClient(request: ApiRequest) {
  const entry = (id: string) => `${FIRM}/${parseInput(WaitlistEntryId, id)}`;
  return {
    list: async (query: WaitlistQuery = {}): Promise<WaitlistEntryList> =>
      request(WaitlistEntryList, `${FIRM}${toQuery(parseInput(WaitlistQuery, query))}`),
    settings: async (): Promise<WaitlistSettings> => request(WaitlistSettings, `${FIRM}/settings`),
    saveSettings: async (body: SaveWaitlistSettingsRequest): Promise<WaitlistSettings> =>
      request(
        WaitlistSettings,
        `${FIRM}/settings`,
        put(parseInput(SaveWaitlistSettingsRequest, body)),
      ),
    approve: async (id: string): Promise<WaitlistEntry> =>
      request(WaitlistEntry, `${entry(id)}/approve`, post()),
    reject: async (id: string): Promise<WaitlistEntry> =>
      request(WaitlistEntry, `${entry(id)}/reject`, post()),
  };
}
export type AppointmentWaitlistClient = ReturnType<typeof createAppointmentWaitlistClient>;
