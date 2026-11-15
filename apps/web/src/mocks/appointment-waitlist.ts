import {
  ApiRequestError,
  JoinWaitlistRequest,
  type MyWaitlist,
  type MyWaitlistClient,
  type MyWaitlistEntry,
  parseInput,
  WaitlistEntryId,
} from '@firmivra/types';
import { mockDelay } from '../lib/mock';
import { myAppointmentsMock } from './appointments';

// R55, Appointments A3: an in-memory `api.myWaitlist(slug)` over the portal appointments mock
// (mocks/appointments.ts). The waitlist is on, in AUTO_CONFIRM. On the first read the soonest
// upcoming appointment that can move is offered its first earlier free start (from the mock's
// own slots, so taking it reschedules it there). Module state per page load, built on first use.
// Synthetic data only.

const HOUR = 3_600_000;
const fail = (status: number, code: string, message: string) =>
  new ApiRequestError(status, code, message);
const errors = {
  notFound: () => fail(404, 'NOT_FOUND', 'Not found'),
  already: () => fail(409, 'ALREADY_WAITING', 'This appointment is already on the waitlist.'),
  closed: () =>
    fail(409, 'WAITLIST_ENTRY_CLOSED', 'This waitlist entry has changed. Refresh to see it.'),
};
const isLive = (status: string) =>
  status === 'WAITING' || status === 'OFFERED' || status === 'REQUESTED';
const dateOf = (iso: string) => iso.slice(0, 10);

interface State {
  seeded: boolean;
  entries: MyWaitlistEntry[];
  next: number;
}
let states: Map<string, State> | undefined;
const stateOf = (slug: string): State => {
  states ??= new Map();
  let s = states.get(slug);
  if (!s) {
    s = { seeded: false, entries: [], next: 1 };
    states.set(slug, s);
  }
  return s;
};
const newId = (s: State) => `0199d0a3-0000-7000-8000-${String(s.next++).padStart(12, '0')}`;

export function myWaitlistMock(firmSlug: string): MyWaitlistClient {
  const appointments = myAppointmentsMock(firmSlug);
  const s = stateOf(firmSlug);

  /** The first read offers the soonest movable appointment its first earlier free start. */
  async function seed(): Promise<void> {
    if (s.seeded) return;
    s.seeded = true;
    for (const a of await appointments.list({ when: 'upcoming' })) {
      if (!a.type || !a.changeableUntil || a.attending) continue;
      const free = await appointments.slots({
        typeId: a.type.id,
        from: dateOf(new Date().toISOString()),
        to: dateOf(a.startsAt),
        excludeAppointmentId: a.id,
      });
      // As the API: at least 2 hours ahead and an hour before the appointment's own time.
      const now = Date.now();
      const slot = free.slots.find(
        (x) =>
          Date.parse(x.startsAt) >= now + 2 * HOUR &&
          Date.parse(x.startsAt) <= Date.parse(a.startsAt) - HOUR,
      );
      if (!slot) continue;
      s.entries.push({
        id: newId(s),
        appointmentId: a.id,
        status: 'OFFERED',
        offer: {
          startsAt: slot.startsAt,
          endsAt: slot.endsAt,
          expiresAt: new Date(
            Math.min(now + 12 * HOUR, Date.parse(slot.startsAt) - HOUR),
          ).toISOString(),
        },
        createdAt: new Date(now - 24 * HOUR).toISOString(),
      });
      return;
    }
  }
  const find = (id: string) => {
    const e = s.entries.find((x) => x.id === parseInput(WaitlistEntryId, id));
    if (!e) throw errors.notFound();
    return e;
  };
  const copy = <T>(v: T): T => structuredClone(v);

  return {
    list: async (): Promise<MyWaitlist> => {
      await mockDelay();
      await seed();
      return { enabled: true, mode: 'AUTO_CONFIRM', items: copy(s.entries) };
    },
    join: async (body) => {
      await mockDelay();
      const { appointmentId } = parseInput(JoinWaitlistRequest, body);
      const mine = (await appointments.list({ when: 'upcoming' })).find(
        (a) => a.id === appointmentId && !a.attending,
      );
      if (!mine) throw errors.notFound();
      if (s.entries.some((e) => e.appointmentId === appointmentId && isLive(e.status)))
        throw errors.already();
      const e: MyWaitlistEntry = {
        id: newId(s),
        appointmentId,
        status: 'WAITING',
        offer: null,
        createdAt: new Date().toISOString(),
      };
      s.entries.push(e);
      return copy(e);
    },
    accept: async (id) => {
      await mockDelay();
      const e = find(id);
      if (e.status !== 'OFFERED' || !e.offer) throw errors.closed();
      // AUTO_CONFIRM: the appointment moves at once, through the appointments mock.
      await appointments.reschedule(e.appointmentId, { startsAt: e.offer.startsAt });
      e.status = 'MOVED';
      return copy(e);
    },
    decline: async (id) => {
      await mockDelay();
      const e = find(id);
      if (e.status !== 'OFFERED') throw errors.closed();
      e.status = 'DECLINED';
      return copy(e);
    },
    leave: async (id) => {
      await mockDelay();
      const e = find(id);
      if (e.status === 'WAITING') e.status = 'LEFT';
      else if (e.status === 'OFFERED') e.status = 'DECLINED';
      else throw errors.closed();
      return copy(e);
    },
  };
}
