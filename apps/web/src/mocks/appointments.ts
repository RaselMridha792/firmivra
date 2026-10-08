import {
  Appointment,
  type AppointmentAction,
  type AppointmentDetail,
  type AppointmentEvent,
  type AppointmentsClient,
  AppointmentsQuery,
  AppointmentType,
  type AppointmentTypesClient,
  AppointmentTypesQuery,
  ApiRequestError,
  type AvailabilityClient,
  type BlockedTime,
  BlockedTimesQuery,
  BookAppointmentRequest,
  BookMyAppointmentRequest,
  type CalendarAppointment,
  CancelAppointmentRequest,
  CancelMyAppointmentRequest,
  CreateAppointmentTypeRequest,
  CreateBlockedTimeRequest,
  type MemberRef,
  type MyAppointment,
  type MyAppointmentsClient,
  MyAppointmentsQuery,
  MySlotsQuery,
  parseInput,
  RescheduleAppointmentRequest,
  RescheduleMyAppointmentRequest,
  SetWorkingHoursRequest,
  type Slot,
  SlotsQuery,
  UpdateAppointmentTypeRequest,
  type WorkingHoursRange,
} from '@firmivra/types';
import { mockDelay } from '../lib/mock';
import { clientFixtures, firstClientId, type MockFirmRole, mockStaff } from './clients';

/**
 * Mock data for `api.appointmentTypes`, `api.availability`, `api.appointments` and
 * `api.myAppointments(slug)` (R12). Synthetic data only. Same input checks, rules and error codes
 * as the API: roles, 15-minute slots within working hours, SLOT_TAKEN on any overlap, the client's
 * cutoff (CHANGE_WINDOW_CLOSED), final statuses (APPOINTMENT_CLOSED) and the history of changes.
 * `role: 'STAFF'` is Sam Staff, as in mocks/clients.ts: Sam sees in full his own appointments and
 * those of clients 1 and 2 (assigned to him); Riley Example's appointment with Mock User is Busy.
 * The firm's timezone is America/New_York; the mock treats it as a fixed UTC-4 (EDT).
 */
const TIMEZONE = 'America/New_York';
const OFFSET_MS = -4 * 60 * 60_000;
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

/**
 * As the API for now: a type's cutoff can only be 24 hours until R0's column lands (409
 * CUTOFF_NOT_SUPPORTED). The seeded types keep their 48 and 0 hours, as the portal will show them
 * then.
 */
function onlyDayCutoff(hours: number | undefined): void {
  if (hours !== undefined && hours !== 24) throw errors.cutoffNotSupported();
}

/** The signed-in member in mock mode (mocks/me.ts) and Sam Staff (mocks/clients.ts). */
export const mockMe: MemberRef = {
  userId: '00000000-0000-4000-8000-000000000101',
  name: 'Mock User',
};
/** Who is signed in: Sam Staff in the STAFF role (as in mocks/clients.ts), else Mock User. */
const signedIn = (role?: MockFirmRole): MemberRef => (role === 'STAFF' ? mockStaff : mockMe);
const client = { id: firstClientId, displayName: 'Jamie Sample' };
/** Client 3 in mocks/clients.ts: not assigned to Sam Staff. */
const riley = { id: '0199b6a1-0000-7000-8000-000000000003', displayName: 'Riley Example' };
const id = (prefix: string, n: number) =>
  `0199b6c${prefix}-0000-7000-8000-${String(n).padStart(12, '0')}`;

/** Firm-local wall time to an ISO instant (fixed UTC-4). */
const localToIso = (dayStartUtc: number, hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  return new Date(dayStartUtc + (h * 60 + m) * MINUTE - OFFSET_MS).toISOString();
};
/** Midnight UTC of the firm-local calendar day that contains `ms`. */
const localDay = (ms: number) => Math.floor((ms + OFFSET_MS) / DAY) * DAY;
const weekdayOf = (dayStartUtc: number) => new Date(dayStartUtc).getUTCDay();
const overlaps = (
  a: { startsAt: string; endsAt: string },
  b: { startsAt: string; endsAt: string },
) => Date.parse(a.startsAt) < Date.parse(b.endsAt) && Date.parse(b.startsAt) < Date.parse(a.endsAt);
const plus = (iso: string, minutes: number) =>
  new Date(Date.parse(iso) + minutes * MINUTE).toISOString();
const fail = (status: number, code: string, message: string) =>
  new ApiRequestError(status, code, message);
const errors = {
  forbidden: () => fail(403, 'FORBIDDEN', 'This action is not permitted'),
  notFound: () => fail(404, 'NOT_FOUND', 'Not found'),
  slotTaken: () => fail(409, 'SLOT_TAKEN', 'Someone else just took this time. Pick another.'),
  slotUnavailable: () => fail(409, 'SLOT_UNAVAILABLE', 'This time is not available'),
  windowClosed: () =>
    fail(
      409,
      'CHANGE_WINDOW_CLOSED',
      'It is too late to change this online. Please contact the firm.',
    ),
  closed: () => fail(409, 'APPOINTMENT_CLOSED', 'This appointment can no longer change'),
  typeArchived: () => fail(409, 'TYPE_ARCHIVED', 'This appointment type is archived'),
  clientArchived: () => fail(409, 'CLIENT_ARCHIVED', 'Restore the client first'),
  cutoffNotSupported: () =>
    fail(409, 'CUTOFF_NOT_SUPPORTED', 'For now every appointment type has a 24-hour cutoff'),
  blocks: () => fail(409, 'BLOCKS_APPOINTMENT', 'An appointment is scheduled in this time'),
  duplicate: () => fail(409, 'DUPLICATE_NAME', 'An appointment type with this name exists'),
};

type Store = {
  types: AppointmentType[];
  hours: Map<string, WorkingHoursRange[]>;
  blocks: BlockedTime[];
  appointments: Appointment[];
  history: Map<string, AppointmentEvent[]>;
  next: number;
};

const weekdays = (ranges: [string, string][]) =>
  [1, 2, 3, 4, 5].flatMap((weekday) =>
    ranges.map(([startsAt, endsAt]) => ({ weekday, startsAt, endsAt })),
  );

/** Types, hours, one block and a few appointments around next week. Built on first use. */
function seed(): Store {
  const at = new Date().toISOString();
  const type = (n: number, fields: Partial<AppointmentType> & { name: string }): AppointmentType =>
    // Parsed, so a fixture that breaks the contract fails on first use.
    AppointmentType.parse({
      id: id('2', n),
      durationMinutes: 30,
      locationKind: 'VIDEO',
      clientBookable: true,
      cancelCutoffHours: 24,
      sortOrder: n - 1,
      archivedAt: null,
      ...fields,
    });
  const types = [
    type(1, { name: 'Tax consultation' }),
    type(2, {
      name: 'Bookkeeping review',
      durationMinutes: 60,
      locationKind: 'IN_PERSON',
      cancelCutoffHours: 48,
    }),
    type(3, { name: 'Internal planning', clientBookable: false, cancelCutoffHours: 0 }),
    type(4, { name: 'Old intake call', archivedAt: at }),
  ];
  const hours = new Map<string, WorkingHoursRange[]>([
    [
      mockMe.userId,
      weekdays([
        ['09:00', '12:00'],
        ['13:00', '17:00'],
      ]),
    ],
    [mockStaff.userId, weekdays([['10:00', '16:00']])],
  ]);
  // Next Monday, firm-local.
  const today = localDay(Date.now());
  const monday = today + ((8 - weekdayOf(today)) % 7 || 7) * DAY;
  const appointment = (
    n: number,
    day: number,
    time: string,
    fields: Partial<Appointment> = {},
  ): Appointment => {
    const startsAt = localToIso(monday + day * DAY, time);
    return Appointment.parse({
      id: id('3', n),
      client,
      staff: mockStaff,
      type: { id: types[0]!.id, name: types[0]!.name },
      engagementId: null,
      startsAt,
      endsAt: plus(startsAt, 30),
      status: 'SCHEDULED',
      locationKind: 'VIDEO',
      locationDetails: 'https://meet.example.test/lvp-consult',
      bookedByClient: false,
      rescheduleCount: 0,
      cancelledAt: null,
      cancelReason: null,
      createdAt: at,
      ...fields,
    });
  };
  const appointments = [
    appointment(1, 0, '10:00', { bookedByClient: true }),
    appointment(2, 1, '14:00', { staff: mockMe }),
    appointment(3, 2, '11:00', {
      status: 'CANCELLED',
      cancelledAt: at,
      cancelReason: 'Client asked',
    }),
    // Riley is not Sam's client: Busy for Sam with Mock User, in full where Sam is the staff member.
    appointment(4, 0, '14:00', { client: riley, staff: mockMe }),
    appointment(5, 4, '11:00', { client: riley }),
  ];
  const booked = (a: Appointment): AppointmentEvent => ({
    at,
    action: 'BOOKED',
    by: a.bookedByClient
      ? { kind: 'CLIENT', name: client.displayName }
      : { kind: 'STAFF', name: mockMe.name },
    from: null,
    to: { startsAt: a.startsAt, endsAt: a.endsAt, staff: a.staff },
    reason: null,
  });
  const history = new Map(appointments.map((a) => [a.id, [booked(a)]]));
  const third = appointments[2]!;
  history.get(third.id)?.push({
    at,
    action: 'CANCELLED',
    by: { kind: 'STAFF', name: mockMe.name },
    from: { startsAt: third.startsAt, endsAt: third.endsAt, staff: third.staff },
    to: null,
    reason: 'Client asked',
  });
  const blocks: BlockedTime[] = [
    {
      id: id('4', 1),
      member: mockStaff,
      startsAt: localToIso(monday + 3 * DAY, '10:00'),
      endsAt: localToIso(monday + 3 * DAY, '16:00'),
      reason: 'Training',
      createdBy: mockMe,
    },
  ];
  return { types, hours, blocks, appointments, history, next: 100 };
}

const copy = <T>(value: T): T => structuredClone(value);

/** One shared store per page load, so the firm and portal mocks see the same calendar. */
let store: Store | undefined;
const db = () => (store ??= seed());

/** Free starts on a 15-minute grid for one member, within hours, outside blocks and appointments. */
function freeStarts(
  s: Store,
  member: MemberRef,
  minutes: number,
  fromDay: number,
  toDay: number,
  excludeAppointmentId?: string,
) {
  const slots: Slot[] = [];
  const now = Date.now();
  for (let day = fromDay; day <= toDay; day += DAY) {
    for (const range of (s.hours.get(member.userId) ?? []).filter(
      (h) => h.weekday === weekdayOf(day),
    )) {
      const end = Date.parse(localToIso(day, range.endsAt));
      for (
        let t = Date.parse(localToIso(day, range.startsAt));
        t + minutes * MINUTE <= end;
        t += 15 * MINUTE
      ) {
        const slot = {
          startsAt: new Date(t).toISOString(),
          endsAt: new Date(t + minutes * MINUTE).toISOString(),
        };
        if (t <= now) continue;
        const busy =
          s.appointments.some(
            (a) =>
              a.id !== excludeAppointmentId &&
              a.status === 'SCHEDULED' &&
              a.staff.userId === member.userId &&
              overlaps(a, slot),
          ) ||
          s.blocks.some(
            (b) => (b.member === null || b.member.userId === member.userId) && overlaps(b, slot),
          );
        if (!busy) slots.push({ ...slot, staff: member });
      }
    }
  }
  return slots;
}

const members = () => [mockMe, mockStaff];
const member = (userId: string) => members().find((m) => m.userId === userId);
const dayRange = (from: string, to: string) =>
  [Date.parse(`${from}T00:00:00Z`), Date.parse(`${to}T00:00:00Z`)] as const;

/** Refuses a time that overlaps the staff member's or the client's other appointments, or a block. */
function assertFree(
  s: Store,
  range: { startsAt: string; endsAt: string },
  staffId: string,
  clientId: string,
  except?: string,
) {
  const clash =
    s.appointments.some(
      (a) =>
        a.id !== except &&
        a.status === 'SCHEDULED' &&
        (a.staff.userId === staffId || a.client.id === clientId) &&
        overlaps(a, range),
    ) ||
    s.blocks.some((b) => (b.member === null || b.member.userId === staffId) && overlaps(b, range));
  if (clash) throw errors.slotTaken();
}

function record(
  s: Store,
  a: Appointment,
  action: AppointmentAction,
  by: AppointmentEvent['by'],
  before: Appointment | null,
  reason: string | null,
) {
  const events = s.history.get(a.id) ?? [];
  events.push({
    at: new Date().toISOString(),
    action,
    by,
    from: before ? { startsAt: before.startsAt, endsAt: before.endsAt, staff: before.staff } : null,
    to:
      a.status === 'SCHEDULED' ? { startsAt: a.startsAt, endsAt: a.endsAt, staff: a.staff } : null,
    reason,
  });
  s.history.set(a.id, events);
}

/** An in-memory `api.appointmentTypes`; `role: 'STAFF'` gets 403 on changes. */
export function createAppointmentTypesMock(
  options: { role?: MockFirmRole } = {},
): AppointmentTypesClient {
  const manager = () => {
    if (options.role === 'STAFF') throw errors.forbidden();
  };
  const find = (typeId: string) => {
    const t = db().types.find((x) => x.id === typeId);
    if (!t) throw errors.notFound();
    return t;
  };
  return {
    list: async (query = {}) => {
      await mockDelay();
      const { status } = parseInput(AppointmentTypesQuery, query);
      return copy(
        db()
          .types.filter(
            (t) => status === 'all' || (status === 'archived') === (t.archivedAt !== null),
          )
          .sort((a, b) => a.sortOrder - b.sortOrder),
      );
    },
    create: async (body) => {
      await mockDelay();
      const input = parseInput(CreateAppointmentTypeRequest, body);
      manager();
      onlyDayCutoff(input.cancelCutoffHours);
      const s = db();
      if (s.types.some((t) => t.name.toLowerCase() === input.name.toLowerCase()))
        throw errors.duplicate();
      const created: AppointmentType = {
        id: id('2', s.next++),
        ...input,
        sortOrder: input.sortOrder ?? s.types.length,
        archivedAt: null,
      };
      s.types.push(created);
      return copy(created);
    },
    update: async (typeId, body) => {
      await mockDelay();
      const input = parseInput(UpdateAppointmentTypeRequest, body);
      manager();
      onlyDayCutoff(input.cancelCutoffHours);
      const t = find(typeId);
      if (
        input.name &&
        db().types.some((x) => x.id !== t.id && x.name.toLowerCase() === input.name?.toLowerCase())
      ) {
        throw errors.duplicate();
      }
      Object.assign(t, input);
      return copy(t);
    },
    archive: async (typeId) => {
      await mockDelay();
      manager();
      const t = find(typeId);
      t.archivedAt ??= new Date().toISOString();
      return copy(t);
    },
    restore: async (typeId) => {
      await mockDelay();
      manager();
      const t = find(typeId);
      t.archivedAt = null;
      return copy(t);
    },
  };
}

/** An in-memory `api.availability`; Staff change only their own hours and blocks. */
export function createAvailabilityMock(options: { role?: MockFirmRole } = {}): AvailabilityClient {
  const me = signedIn(options.role);
  const mayChange = (userId: string | null) => {
    if (options.role === 'STAFF' && userId !== me.userId) throw errors.forbidden();
  };
  return {
    get: async () => {
      await mockDelay();
      const s = db();
      return copy({
        timezone: TIMEZONE,
        members: members().map((m) => ({ member: m, hours: s.hours.get(m.userId) ?? [] })),
      });
    },
    setWorkingHours: async (userId, body) => {
      await mockDelay();
      const input = parseInput(SetWorkingHoursRequest, body);
      const m = member(userId);
      if (!m) throw errors.notFound();
      mayChange(userId);
      db().hours.set(userId, input.hours);
      return copy({ member: m, hours: input.hours });
    },
    blockedTimes: async (query) => {
      await mockDelay();
      const q = parseInput(BlockedTimesQuery, query);
      return copy(
        db().blocks.filter(
          (b) =>
            overlaps(b, { startsAt: q.from, endsAt: q.to }) &&
            (!q.userId || b.member?.userId === q.userId || b.member === null),
        ),
      );
    },
    block: async (body) => {
      await mockDelay();
      const input = parseInput(CreateBlockedTimeRequest, body);
      mayChange(input.userId);
      const s = db();
      const m = input.userId === null ? null : member(input.userId);
      if (m === undefined) throw errors.notFound();
      if (
        s.appointments.some(
          (a) =>
            a.status === 'SCHEDULED' &&
            (m === null || a.staff.userId === m.userId) &&
            overlaps(a, input),
        )
      ) {
        throw errors.blocks();
      }
      const created: BlockedTime = {
        id: id('4', s.next++),
        member: m,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        reason: input.reason ?? null,
        createdBy: me,
      };
      s.blocks.push(created);
      return copy(created);
    },
    unblock: async (blockId) => {
      await mockDelay();
      const s = db();
      const b = s.blocks.find((x) => x.id === blockId);
      if (!b) throw errors.notFound();
      mayChange(b.member?.userId ?? null);
      s.blocks = s.blocks.filter((x) => x !== b);
      return { ok: true };
    },
  };
}

/**
 * An in-memory `api.appointments` (the firm's calendar). Firm users change appointments at any
 * time; `role: 'STAFF'` sees and changes in full only Sam's own and his clients' (Busy otherwise).
 */
export function createAppointmentsMock(options: { role?: MockFirmRole } = {}): AppointmentsClient {
  const staffOnly = options.role === 'STAFF';
  const me = signedIn(options.role);
  const staffBy = { kind: 'STAFF' as const, name: me.name };
  const assigned = (clientId: string) =>
    clientFixtures().some((c) => c.id === clientId && c.assignedTo?.userId === me.userId);
  const inFull = (a: Appointment) =>
    !staffOnly || a.staff.userId === me.userId || assigned(a.client.id);
  const entry = (a: Appointment): CalendarAppointment =>
    inFull(a)
      ? { ...a, restricted: false }
      : {
          restricted: true,
          id: a.id,
          staff: a.staff,
          startsAt: a.startsAt,
          endsAt: a.endsAt,
          status: a.status,
        };
  /** Staff: a Busy appointment is 404, like a client record that is not theirs. */
  const find = (appointmentId: string) => {
    const a = db().appointments.find((x) => x.id === appointmentId && inFull(x));
    if (!a) throw errors.notFound();
    return a;
  };
  const open = (a: Appointment) => {
    if (a.status !== 'SCHEDULED') throw errors.closed();
  };
  const finish = async (appointmentId: string, status: 'COMPLETED' | 'NO_SHOW') => {
    await mockDelay();
    const a = find(appointmentId);
    open(a);
    const before = copy(a);
    a.status = status;
    record(db(), a, status, staffBy, before, null);
    return copy(a);
  };
  return {
    list: async (query) => {
      await mockDelay();
      const q = parseInput(AppointmentsQuery, query);
      if (staffOnly && q.clientId && !assigned(q.clientId)) throw errors.notFound();
      return copy(
        db()
          .appointments.filter(
            (a) =>
              overlaps(a, { startsAt: q.from, endsAt: q.to }) &&
              (!q.staffUserId || a.staff.userId === q.staffUserId) &&
              (!q.clientId || a.client.id === q.clientId) &&
              (!q.status || a.status === q.status),
          )
          .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
          .map(entry),
      );
    },
    get: async (appointmentId) => {
      await mockDelay();
      const a = find(appointmentId);
      const detail: AppointmentDetail = { ...a, history: db().history.get(a.id) ?? [] };
      return copy(detail);
    },
    slots: async (query) => {
      await mockDelay();
      const q = parseInput(SlotsQuery, query);
      const s = db();
      const t = s.types.find((x) => x.id === q.typeId);
      if (!t) throw errors.notFound();
      const [from, to] = dayRange(q.from, q.to);
      const who = q.staffUserId
        ? [member(q.staffUserId)].filter((m) => m !== undefined)
        : members();
      const slots = who.flatMap((m) =>
        freeStarts(s, m, t.durationMinutes, from, to, q.excludeAppointmentId),
      );
      return copy({
        timezone: TIMEZONE,
        slots: slots.sort((a, b) => a.startsAt.localeCompare(b.startsAt)),
      });
    },
    book: async (body) => {
      await mockDelay();
      const input = parseInput(BookAppointmentRequest, body);
      const s = db();
      const booked = clientFixtures().find((c) => c.id === input.clientId);
      if (!booked || (staffOnly && !assigned(booked.id))) throw errors.notFound();
      if (booked.archivedAt) throw errors.clientArchived();
      const staff = member(input.staffUserId);
      const t = input.typeId ? s.types.find((x) => x.id === input.typeId) : undefined;
      if (!staff || (input.typeId && !t)) throw errors.notFound();
      if (t?.archivedAt) throw errors.typeArchived();
      const endsAt = plus(input.startsAt, input.durationMinutes ?? t?.durationMinutes ?? 30);
      assertFree(s, { startsAt: input.startsAt, endsAt }, staff.userId, input.clientId);
      const created: Appointment = {
        id: id('3', s.next++),
        client: { id: booked.id, displayName: booked.displayName },
        staff,
        type: t ? { id: t.id, name: t.name } : null,
        engagementId: input.engagementId ?? null,
        startsAt: new Date(input.startsAt).toISOString(),
        endsAt,
        status: 'SCHEDULED',
        locationKind: input.locationKind ?? t?.locationKind ?? 'VIDEO',
        locationDetails: input.locationDetails ?? null,
        bookedByClient: false,
        rescheduleCount: 0,
        cancelledAt: null,
        cancelReason: null,
        createdAt: new Date().toISOString(),
      };
      s.appointments.push(created);
      record(s, created, 'BOOKED', staffBy, null, null);
      return copy(created);
    },
    reschedule: async (appointmentId, body) => {
      await mockDelay();
      const input = parseInput(RescheduleAppointmentRequest, body);
      const s = db();
      const a = find(appointmentId);
      open(a);
      const staff = input.staffUserId ? member(input.staffUserId) : a.staff;
      if (!staff) throw errors.notFound();
      const minutes = (Date.parse(a.endsAt) - Date.parse(a.startsAt)) / MINUTE;
      const startsAt = new Date(input.startsAt).toISOString();
      const range = { startsAt, endsAt: plus(startsAt, minutes) };
      assertFree(s, range, staff.userId, a.client.id, a.id);
      const before = copy(a);
      Object.assign(a, range, { staff, rescheduleCount: a.rescheduleCount + 1 });
      record(s, a, 'RESCHEDULED', staffBy, before, null);
      return copy(a);
    },
    cancel: async (appointmentId, body = {}) => {
      await mockDelay();
      const { reason } = parseInput(CancelAppointmentRequest, body);
      const a = find(appointmentId);
      open(a);
      const before = copy(a);
      Object.assign(a, {
        status: 'CANCELLED',
        cancelledAt: new Date().toISOString(),
        cancelReason: reason ?? null,
      });
      record(db(), a, 'CANCELLED', staffBy, before, reason ?? null);
      return copy(a);
    },
    complete: (appointmentId) => finish(appointmentId, 'COMPLETED'),
    noShow: (appointmentId) => finish(appointmentId, 'NO_SHOW'),
  };
}

/**
 * An in-memory `api.myAppointments(slug)` for the signed-in client (Jamie Sample). Bookable types
 * only; the staff member is the client's (Sam Staff) when free, else the free member with the
 * fewest appointments that day. After a type's cutoff: 409 CHANGE_WINDOW_CLOSED.
 */
export function createMyAppointmentsMock(): MyAppointmentsClient {
  const clientBy = { kind: 'CLIENT' as const, name: client.displayName };
  const bookable = (typeId: string) => {
    const t = db().types.find((x) => x.id === typeId && x.clientBookable && !x.archivedAt);
    if (!t) throw errors.notFound();
    return t;
  };
  const cutoffOf = (a: Appointment) =>
    db().types.find((t) => t.id === a.type?.id)?.cancelCutoffHours ?? 24;
  const until = (a: Appointment) => {
    if (a.status !== 'SCHEDULED') return null;
    const last = Date.parse(a.startsAt) - cutoffOf(a) * 60 * MINUTE;
    return last > Date.now() ? new Date(last).toISOString() : null;
  };
  const view = (a: Appointment): MyAppointment => ({
    id: a.id,
    type: a.type,
    staffName: a.staff.name,
    startsAt: a.startsAt,
    endsAt: a.endsAt,
    status: a.status,
    locationKind: a.locationKind,
    locationDetails: a.locationDetails,
    changeableUntil: until(a),
  });
  const mine = (appointmentId: string) => {
    const a = db().appointments.find((x) => x.id === appointmentId && x.client.id === client.id);
    if (!a) throw errors.notFound();
    return a;
  };
  /** The client's staff member if free, else the free member with the fewest appointments that day. */
  const pick = (minutes: number, startsAt: string) => {
    const s = db();
    const day = localDay(Date.parse(startsAt));
    const free = members().filter((m) =>
      freeStarts(s, m, minutes, day, day).some(
        (slot) => slot.startsAt === new Date(startsAt).toISOString(),
      ),
    );
    if (free.length === 0) throw errors.slotUnavailable();
    const preferred = free.find((m) => m.userId === mockStaff.userId);
    if (preferred) return preferred;
    const load = (m: MemberRef) =>
      s.appointments.filter(
        (a) =>
          a.staff.userId === m.userId &&
          a.status === 'SCHEDULED' &&
          localDay(Date.parse(a.startsAt)) === day,
      ).length;
    return free.sort((a, b) => load(a) - load(b))[0]!;
  };
  const changeable = (a: Appointment) => {
    if (a.status !== 'SCHEDULED') throw errors.closed();
    if (until(a) === null) throw errors.windowClosed();
  };
  return {
    list: async (query = {}) => {
      await mockDelay();
      const { when } = parseInput(MyAppointmentsQuery, query);
      const now = Date.now();
      const all = db().appointments.filter((a) => a.client.id === client.id);
      const upcoming = (a: Appointment) => a.status === 'SCHEDULED' && Date.parse(a.endsAt) > now;
      const items =
        when === 'upcoming'
          ? all.filter(upcoming).sort((a, b) => a.startsAt.localeCompare(b.startsAt))
          : all.filter((a) => !upcoming(a)).sort((a, b) => b.startsAt.localeCompare(a.startsAt));
      return copy(items.map(view));
    },
    types: async () => {
      await mockDelay();
      return copy(
        db()
          .types.filter((t) => t.clientBookable && !t.archivedAt)
          .map(({ id: typeId, name, durationMinutes, locationKind, cancelCutoffHours }) => ({
            id: typeId,
            name,
            durationMinutes,
            locationKind,
            cancelCutoffHours,
          })),
      );
    },
    slots: async (query) => {
      await mockDelay();
      const q = parseInput(MySlotsQuery, query);
      const t = bookable(q.typeId);
      const [from, to] = dayRange(q.from, q.to);
      const starts = new Map<string, string>();
      for (const m of members()) {
        for (const slot of freeStarts(db(), m, t.durationMinutes, from, to, q.excludeAppointmentId))
          starts.set(slot.startsAt, slot.endsAt);
      }
      const slots = [...starts]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([startsAt, endsAt]) => ({ startsAt, endsAt }));
      return copy({ timezone: TIMEZONE, slots });
    },
    book: async (body) => {
      await mockDelay();
      const input = parseInput(BookMyAppointmentRequest, body);
      const s = db();
      const t = bookable(input.typeId);
      const staff = pick(t.durationMinutes, input.startsAt);
      const startsAt = new Date(input.startsAt).toISOString();
      const range = { startsAt, endsAt: plus(startsAt, t.durationMinutes) };
      assertFree(s, range, staff.userId, client.id);
      const created: Appointment = {
        id: id('3', s.next++),
        client,
        staff,
        type: { id: t.id, name: t.name },
        engagementId: null,
        ...range,
        status: 'SCHEDULED',
        locationKind: t.locationKind,
        locationDetails: null,
        bookedByClient: true,
        rescheduleCount: 0,
        cancelledAt: null,
        cancelReason: null,
        createdAt: new Date().toISOString(),
      };
      s.appointments.push(created);
      record(s, created, 'BOOKED', clientBy, null, null);
      return copy(view(created));
    },
    reschedule: async (appointmentId, body) => {
      await mockDelay();
      const input = parseInput(RescheduleMyAppointmentRequest, body);
      const s = db();
      const a = mine(appointmentId);
      changeable(a);
      const minutes = (Date.parse(a.endsAt) - Date.parse(a.startsAt)) / MINUTE;
      const startsAt = new Date(input.startsAt).toISOString();
      const range = { startsAt, endsAt: plus(startsAt, minutes) };
      // Keep the same staff member when free; otherwise pick again.
      const sameFree = freeStarts(
        s,
        a.staff,
        minutes,
        localDay(Date.parse(startsAt)),
        localDay(Date.parse(startsAt)),
      ).some((slot) => slot.startsAt === startsAt);
      const staff = sameFree ? a.staff : pick(minutes, startsAt);
      assertFree(s, range, staff.userId, client.id, a.id);
      const before = copy(a);
      Object.assign(a, range, { staff, rescheduleCount: a.rescheduleCount + 1 });
      record(s, a, 'RESCHEDULED', clientBy, before, null);
      return copy(view(a));
    },
    cancel: async (appointmentId, body = {}) => {
      await mockDelay();
      const { reason } = parseInput(CancelMyAppointmentRequest, body);
      const a = mine(appointmentId);
      changeable(a);
      const before = copy(a);
      Object.assign(a, {
        status: 'CANCELLED',
        cancelledAt: new Date().toISOString(),
        cancelReason: reason ?? null,
      });
      record(db(), a, 'CANCELLED', clientBy, before, reason ?? null);
      return copy(view(a));
    },
  };
}

let myAppointmentsMocks: Map<string, MyAppointmentsClient> | undefined;

/** `api.myAppointments(slug)` in mock mode: one mock per firm (by lower-cased slug), kept for the page. */
export function myAppointmentsMock(firmSlug: string): MyAppointmentsClient {
  myAppointmentsMocks ??= new Map();
  const key = firmSlug.toLowerCase();
  const found = myAppointmentsMocks.get(key);
  if (found) return found;
  const created = createMyAppointmentsMock();
  myAppointmentsMocks.set(key, created);
  return created;
}
