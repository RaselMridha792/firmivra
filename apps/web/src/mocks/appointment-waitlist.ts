import {
  type AppointmentWaitlistClient,
  ApiRequestError,
  JoinWaitlistRequest,
  type MyWaitlist,
  type MyWaitlistClient,
  type MyWaitlistEntry,
  parseInput,
  SaveWaitlistSettingsRequest,
  type WaitlistEntry,
  WaitlistEntryId,
  WaitlistQuery,
  type WaitlistSettings,
} from '@firmivra/types';
import { mockDelay } from '../lib/mock';
import { myAppointmentsMock } from './appointments';
import { createSchedulingMock } from './appointments-scheduling';

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

// ---------- The firm side ----------

interface FirmState {
  seeded: boolean;
  settings: WaitlistSettings;
  entries: WaitlistEntry[];
  next: number;
}
let firmStates: Map<string, FirmState> | undefined;

/**
 * `api.appointmentWaitlist` in mock mode, over the scheduling mock (mocks/appointments-scheduling.ts,
 * one store per page load): the waitlist is on in STAFF_APPROVAL, and one client has asked for an
 * earlier time for their next appointment (a free time the day before). Approve moves it there
 * through the scheduling mock (409 OFFER_TAKEN when that time is taken, and the entry waits
 * again); Reject keeps the time.
 */
export function createAppointmentWaitlistMock(
  options: { role?: 'OWNER' | 'ADMIN' | 'STAFF'; empty?: boolean } = {},
): AppointmentWaitlistClient {
  const scheduling = createSchedulingMock(options);
  firmStates ??= new Map();
  const key = options.empty ? 'empty' : 'full';
  let f = firmStates.get(key);
  if (!f) {
    f = {
      seeded: false,
      settings: { enabled: true, mode: 'STAFF_APPROVAL' },
      entries: [],
      next: 1,
    };
    firmStates.set(key, f);
  }
  const st = f;

  async function seed(): Promise<void> {
    if (st.seeded || options.empty) return;
    st.seeded = true;
    const now = Date.now();
    const page = await scheduling.agenda({
      from: new Date(now + 26 * HOUR).toISOString(),
      to: new Date(now + 14 * 24 * HOUR).toISOString(),
    });
    const items = page.items.flatMap((e) => (e.restricted ? [] : [e]));
    for (const a of items) {
      if (a.contact.kind !== 'CLIENT' || !a.contact.id || a.internal) continue;
      if (!['CONFIRMED', 'PENDING'].includes(a.status)) continue;
      const staffId = a.staff[0]?.userId;
      const length = Date.parse(a.endsAt) - Date.parse(a.startsAt);
      // The same time the day before, else the nearest half hour that day the staff member is free.
      const base = Date.parse(a.startsAt) - 24 * HOUR;
      const tries = [0, 1, -1, 2, -2, 3, -3, 4, -4].map((k) => base + k * 30 * 60_000);
      const start = tries.find((t) => {
        const hour = new Date(t - 4 * HOUR).getUTCHours();
        if (t < now + 2 * HOUR || hour < 8 || hour >= 17 || (hour >= 14 && hour < 15)) return false;
        return !items.some(
          (o) =>
            o.staff.some((m) => m.userId === staffId) &&
            Date.parse(o.startsAt) < t + length &&
            t < Date.parse(o.endsAt),
        );
      });
      if (start === undefined) continue;
      st.entries.push({
        id: `0199d0a4-0000-7000-8000-${String(st.next++).padStart(12, '0')}`,
        appointmentId: a.id,
        client: { id: a.contact.id, name: a.contact.name },
        staffName: a.staff[0]?.name ?? '',
        typeName: a.type?.name ?? null,
        startsAt: a.startsAt,
        endsAt: a.endsAt,
        status: 'REQUESTED',
        offer: {
          startsAt: new Date(start).toISOString(),
          endsAt: new Date(start + length).toISOString(),
          expiresAt: new Date(Math.min(now + 12 * HOUR, start - HOUR)).toISOString(),
        },
        requestedAt: new Date(now - HOUR).toISOString(),
        decidedAt: null,
        createdAt: new Date(now - 2 * 24 * HOUR).toISOString(),
      });
      return;
    }
  }
  const find = (id: string) => {
    const e = st.entries.find((x) => x.id === parseInput(WaitlistEntryId, id));
    if (!e) throw errors.notFound();
    return e;
  };
  const copy = <T>(v: T): T => structuredClone(v);

  return {
    list: async (query = {}) => {
      await mockDelay();
      const q = parseInput(WaitlistQuery, query);
      await seed();
      const items = st.entries.filter((e) => q.show === 'all' || isLive(e.status));
      return { ...st.settings, items: copy(items) };
    },
    settings: async () => {
      await mockDelay();
      return copy(st.settings);
    },
    saveSettings: async (body) => {
      await mockDelay();
      st.settings = parseInput(SaveWaitlistSettingsRequest, body);
      return copy(st.settings);
    },
    approve: async (id) => {
      await mockDelay();
      const e = find(id);
      if (e.status !== 'REQUESTED' || !e.offer) throw errors.closed();
      const record = await scheduling.record(e.appointmentId);
      try {
        await scheduling.updateDetails(e.appointmentId, {
          version: record.version,
          startsAt: e.offer.startsAt,
          endsAt: e.offer.endsAt,
        });
      } catch {
        e.status = 'WAITING';
        e.offer = null;
        e.requestedAt = null;
        throw fail(
          409,
          'OFFER_TAKEN',
          'That earlier time was just taken. The client stays on the waitlist for the next opening.',
        );
      }
      e.status = 'MOVED';
      e.decidedAt = new Date().toISOString();
      e.startsAt = e.offer.startsAt;
      e.endsAt = e.offer.endsAt;
      return copy(e);
    },
    reject: async (id) => {
      await mockDelay();
      const e = find(id);
      if (e.status !== 'REQUESTED') throw errors.closed();
      e.status = 'REJECTED';
      e.decidedAt = new Date().toISOString();
      return copy(e);
    },
  };
}
