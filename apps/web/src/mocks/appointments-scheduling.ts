import {
  AgendaQuery,
  type AgendaItem,
  type AppointmentDraft,
  type AppointmentNotice,
  AppointmentNoteRequest,
  type AppointmentNoticeSettings,
  type AppointmentRecord,
  AppointmentsSummaryQuery,
  type AppointmentTypeConfig,
  ApiRequestError,
  type AvailabilityBlock,
  type AvailabilityRules,
  ConflictCheckRequest,
  type ConflictResult,
  type ContactInput,
  ContactSearchQuery,
  type AppointmentContact,
  type MemberRef,
  parseInput,
  SaveAppointmentDraftRequest,
  ScheduleAppointmentRequest,
  type SchedulingClient,
  SendReminderRequest,
  SendRemindersRequest,
  SetAppointmentNoticeSettingsRequest,
  SetAppointmentTypeConfigRequest,
  SetAvailabilityRulesRequest,
  StaffDayQuery,
  UpdateAppointmentDetailsRequest,
} from '@firmivra/types';
import { mockDelay } from '../lib/mock';

/**
 * Mock data for `api.scheduling` (R42 contract, the Appointments workspace). Synthetic people
 * only. Appointments are placed around today (this week and next), so Calendar, List, Today and
 * Upcoming are always full. Owner and Admin see every appointment; STAFF (Daniel Okafor) sees
 * their own in full and the rest as Busy, and gets 403 on types and notice settings, as in R12.
 * Conflicts: an overlap with the staff member's other appointments or the 2 PM blocked hour is
 * 409 SCHEDULING_CONFLICT unless overridden. `empty: true` (NEXT_PUBLIC_API_MOCK_EMPTY=scheduling)
 * starts with no appointments or drafts.
 */

type MockRole = 'OWNER' | 'ADMIN' | 'STAFF';
interface Options {
  role?: MockRole;
  empty?: boolean;
}

const TZ = 'America/New_York';
/** Eastern daylight time; good enough for mock dates in October. */
const OFFSET = '-04:00';
const HOUR = 3_600_000;
const uuid = (block: string, n: number) =>
  `0199c0b0-${block}-7000-8000-${String(n).padStart(12, '0')}`;
const fail = (status: number, code: string, message: string) =>
  new ApiRequestError(status, code, message);
const copy = <T>(value: T): T => structuredClone(value);
const localDate = (ms: number) => new Date(ms - 4 * HOUR).toISOString().slice(0, 10);
const at = (date: string, hhmm: string) => new Date(`${date}T${hhmm}:00${OFFSET}`).toISOString();
const plusDays = (date: string, days: number) =>
  new Date(Date.parse(`${date}T12:00:00Z`) + days * 24 * HOUR).toISOString().slice(0, 10);
const overlaps = (
  a: { startsAt: string; endsAt: string },
  b: { startsAt: string; endsAt: string },
) => Date.parse(a.startsAt) < Date.parse(b.endsAt) && Date.parse(b.startsAt) < Date.parse(a.endsAt);

const staffRef = (n: number, name: string): MemberRef => ({
  userId: `0199c0a0-0b00-7000-8000-${String(n).padStart(12, '0')}`,
  name,
});

interface Store {
  records: AppointmentRecord[];
  drafts: AppointmentDraft[];
  rules: Map<string, AvailabilityRules>;
  typeConfigs: Map<string, AppointmentTypeConfig>;
  notice: AppointmentNoticeSettings;
  idempotent: Map<string, string>;
  next: number;
}

function seed(empty: boolean): Store {
  const owner = staffRef(1, 'Morgan Avery');
  const daniel = staffRef(3, 'Daniel Okafor');
  const theo = staffRef(7, 'Theo Grant');
  const hana = staffRef(6, 'Hana Kim');
  const types = TYPES();
  const services = SERVICES();
  const today = localDate(Date.now());
  const weekStart = plusDays(today, -new Date(`${today}T12:00:00Z`).getUTCDay());
  const contact = (
    n: number,
    name: string,
    kind: AppointmentContact['kind'] = 'CLIENT',
  ): AppointmentContact => ({
    kind,
    id: kind === 'CONTACT' ? null : uuid(kind === 'LEAD' ? '1e00' : '1c00', n),
    name,
    businessName: n % 4 === 0 ? `${name.split(' ')[1] ?? 'Sample'} Holdings LLC` : null,
    email: `${name.split(' ')[0]?.toLowerCase() ?? 'client'}@example.test`,
    phone: `(555) 020-${String(1000 + n)}`,
    clientType: n % 4 === 0 ? 'BUSINESS' : 'INDIVIDUAL',
  });
  // day offset from Sunday, start, end, contact, type index, service index, staff, status, method
  const rows: [
    number,
    string,
    string,
    AppointmentContact | null,
    number,
    number | null,
    MemberRef,
    AgendaItem['status'],
    AgendaItem['method'],
  ][] = [
    [1, '09:00', '10:00', contact(1, 'Avery Lawson'), 0, 0, owner, 'CONFIRMED', 'VIDEO'],
    [1, '11:00', '12:00', contact(2, 'Nina Fairbanks'), 1, 0, daniel, 'CONFIRMED', 'IN_PERSON'],
    [1, '14:00', '15:00', contact(3, 'Bruno Sandoval'), 2, 3, owner, 'PENDING', 'PHONE'],
    [1, '16:00', '17:00', null, 5, null, owner, 'CONFIRMED', 'IN_PERSON'],
    [2, '10:00', '11:00', contact(4, 'Selma Shields'), 3, 1, hana, 'CONFIRMED', 'VIDEO'],
    [2, '13:00', '14:00', contact(5, 'Ravi Greenwood'), 4, 2, hana, 'RESCHEDULED', 'VIDEO'],
    [2, '15:30', '16:30', contact(6, 'Mia Lattimore'), 2, 3, daniel, 'CONFIRMED', 'PHONE'],
    [3, '09:30', '10:30', contact(7, 'Shaw Bayliss'), 3, 1, theo, 'CONFIRMED', 'IN_PERSON'],
    [
      3,
      '12:00',
      '13:00',
      contact(1, 'Jonah Yates', 'LEAD'),
      6,
      null,
      theo,
      'CONFIRMED',
      'IN_PERSON',
    ],
    [4, '11:00', '12:00', contact(8, 'Kendra Gill'), 0, 4, owner, 'PENDING', 'VIDEO'],
    [
      4,
      '14:30',
      '15:30',
      contact(2, 'Amber Kessler', 'LEAD'),
      0,
      null,
      daniel,
      'CONFIRMED',
      'VIDEO',
    ],
    [5, '10:00', '11:00', contact(9, 'Jack Banfield'), 1, 0, daniel, 'CONFIRMED', 'IN_PERSON'],
    [5, '13:00', '14:00', contact(10, 'Clara Voss'), 3, 1, hana, 'CONFIRMED', 'PHONE'],
    [6, '09:00', '11:00', contact(11, 'Workshop Group'), 7, 3, owner, 'CONFIRMED', 'IN_PERSON'],
    [-6, '10:00', '11:00', contact(12, 'Elena Brooks'), 1, 0, daniel, 'COMPLETED', 'IN_PERSON'],
    [-5, '13:00', '14:00', contact(13, 'Owen Hartley'), 0, 4, owner, 'NO_SHOW', 'VIDEO'],
    [-4, '09:00', '10:00', contact(14, 'Lucia Moreno'), 3, 1, hana, 'CANCELED', 'PHONE'],
    [-3, '15:00', '16:00', contact(15, 'Felix Dunn'), 2, 3, daniel, 'COMPLETED', 'VIDEO'],
    [8, '10:00', '11:00', contact(16, 'Grace Pruitt'), 4, 2, hana, 'CONFIRMED', 'VIDEO'],
    [9, '13:00', '14:00', contact(3, 'Marco Diaz', 'CONTACT'), 0, null, theo, 'PENDING', 'PHONE'],
  ];
  const records = empty
    ? []
    : rows.map(([d, start, end, c, t, sv, staff, status, method], i): AppointmentRecord => {
        const date = plusDays(weekStart, d);
        const type = types[t] ?? null;
        const internal = c === null;
        const startsAt = at(date, start);
        return {
          restricted: false,
          id: uuid('0a10', i + 1),
          startsAt,
          endsAt: at(date, end),
          allDay: false,
          contact: c ?? {
            kind: 'CONTACT',
            id: null,
            name: 'Team Meeting',
            businessName: null,
            email: null,
            phone: null,
            clientType: null,
          },
          service: sv === null ? null : (services[sv] ?? null),
          type: type && { id: type.id, name: type.name },
          status,
          staff: [staff],
          method,
          place: {
            office: method === 'IN_PERSON' ? { id: uuid('0f10', 1), name: 'Main Office' } : null,
            room:
              method === 'IN_PERSON' ? { id: uuid('0f20', 1), name: 'Conference Room 1' } : null,
            details: method === 'PHONE' ? '(555) 010-0100' : null,
          },
          videoUrl: method === 'VIDEO' ? 'https://zoom.example.test/j/1234567890' : null,
          color: type?.color ?? null,
          internal,
          timezone: TZ,
          internalNotes: i === 0 ? "Bring last year's return and the new 1099s." : null,
          clientInstructions:
            method === 'VIDEO' ? 'Join from a quiet place; the link works in any browser.' : null,
          related: {
            taxReturn: t === 1 ? { id: uuid('1a00', i), name: '2025 Form 1040' } : null,
            bookkeepingEngagement: null,
            invoice: null,
            task: null,
            intakeForm:
              i === 1
                ? { id: uuid('1b00', 1), name: 'Individual Tax Organizer', completed: true }
                : null,
            documentRequest:
              i === 1 ? { id: uuid('1d00', 1), name: 'W-2 and 1099 forms', received: false } : null,
          },
          reminders: internal
            ? []
            : [
                { channel: 'EMAIL', amount: 1, unit: 'DAYS' },
                { channel: 'SMS', amount: 2, unit: 'HOURS' },
              ],
          recurrence: null,
          seriesId: null,
          history: [
            {
              at: new Date(Date.parse(startsAt) - 7 * 24 * HOUR).toISOString(),
              action: 'BOOKED',
              by: { kind: 'STAFF', name: 'Morgan Avery' },
              from: null,
              to: { startsAt, endsAt: at(date, end), staff },
              reason: null,
            },
          ],
          notices: internal
            ? []
            : [
                {
                  at: new Date(Date.parse(startsAt) - 7 * 24 * HOUR).toISOString(),
                  kind: 'CONFIRMATION',
                  channel: 'EMAIL',
                  recipient: `${c?.name[0]?.toLowerCase() ?? 'c'}***@example.test`,
                  status: 'DELIVERED',
                },
              ],
          createdAt: new Date(Date.parse(startsAt) - 7 * 24 * HOUR).toISOString(),
          version: 'v1',
        };
      });
  return {
    records,
    drafts: empty
      ? []
      : [
          {
            id: uuid('0d30', 1),
            data: { typeId: types[0]?.id, staffUserIds: [owner.userId] },
            createdBy: 'Morgan Avery',
            updatedAt: at(today, '08:30'),
          },
        ],
    rules: new Map(),
    typeConfigs: new Map(),
    notice: {
      masterEmail: empty ? null : 'admin@lvp.test',
      copyMasterOnChanges: true,
      copyMasterOnReminders: false,
      defaultReminders: [{ channel: 'EMAIL', amount: 1, unit: 'DAYS' }],
    },
    idempotent: new Map(),
    next: 100,
  };
}

/** The firm's buffers, notice and window, which Edit My Availability shows and cannot change. */
const FIRM_RULES = {
  bufferBeforeMinutes: 0,
  bufferAfterMinutes: 15,
  minNoticeHours: 24,
  maxWindowDays: 60,
};

function TYPES() {
  return [
    ['Consultation', 60, '#2563eb'],
    ['Tax Preparation', 60, '#e11d48'],
    ['Follow-Up', 30, '#16a34a'],
    ['Bookkeeping Review', 60, '#d97706'],
    ['Payroll Setup', 60, '#0891b2'],
    ['Internal / Staff Meeting', 60, '#7c3aed'],
    ['New Client Intake', 60, '#9333ea'],
    ['Client Workshop', 120, '#7c3aed'],
  ].map(([name, durationMinutes, color], i) => ({
    id: uuid('0e10', i + 1),
    name: String(name),
    durationMinutes: Number(durationMinutes),
    color: String(color),
    serviceId: null,
  }));
}

function SERVICES() {
  return [
    'Tax Preparation',
    'Bookkeeping',
    'Payroll Setup',
    'Business Tax',
    'Business Formation',
  ].map((name, i) => ({
    id: uuid('0e20', i + 1),
    name,
  }));
}

let stores: Map<string, Store> | undefined;
function storeFor(options: Options): Store {
  stores ??= new Map();
  const key = options.empty ? 'empty' : 'full';
  let s = stores.get(key);
  if (!s) {
    s = seed(options.empty ?? false);
    stores.set(key, s);
  }
  return s;
}

/** `api.scheduling` in mock mode. */
export function createSchedulingMock(options: Options = {}): SchedulingClient {
  const role = options.role ?? 'OWNER';
  const s = storeFor(options);
  const me =
    role === 'STAFF'
      ? staffRef(3, 'Daniel Okafor')
      : role === 'ADMIN'
        ? staffRef(2, 'Priya Ramos')
        : staffRef(1, 'Morgan Avery');
  const sees = (r: AppointmentRecord) =>
    role !== 'STAFF' || r.staff.some((x) => x.userId === me.userId);
  const find = (id: string) => {
    const r = s.records.find((x) => x.id === id);
    if (!r || !sees(r)) throw fail(404, 'NOT_FOUND', 'Not found');
    return r;
  };
  const managers = () => {
    if (role === 'STAFF') throw fail(403, 'FORBIDDEN', 'This action is not permitted');
  };
  const staffList = [
    staffRef(1, 'Morgan Avery'),
    staffRef(2, 'Priya Ramos'),
    staffRef(3, 'Daniel Okafor'),
    staffRef(6, 'Hana Kim'),
    staffRef(7, 'Theo Grant'),
  ];
  const staffByIds = (ids: readonly string[]) =>
    ids.map((id) => {
      const m = staffList.find((x) => x.userId === id);
      if (!m) throw fail(404, 'NOT_FOUND', 'Staff member not found');
      return m;
    });
  const blockedAt = (date: string) => ({ startsAt: at(date, '14:00'), endsAt: at(date, '15:00') });

  function conflicts(input: {
    staffUserIds: readonly string[];
    startsAt: string;
    endsAt: string;
    excludeAppointmentId?: string;
  }): ConflictResult {
    const found: ConflictResult['conflicts'] = [];
    const date = localDate(Date.parse(input.startsAt));
    for (const staff of staffByIds(input.staffUserIds)) {
      for (const r of s.records) {
        if (r.id === input.excludeAppointmentId || r.status === 'CANCELED' || r.status === 'DRAFT')
          continue;
        if (r.staff.some((x) => x.userId === staff.userId) && overlaps(r, input)) {
          found.push({
            kind: 'STAFF_BOOKED',
            staff,
            startsAt: r.startsAt,
            endsAt: r.endsAt,
            message: `${staff.name} already has an appointment then`,
          });
        }
      }
      const block = blockedAt(date);
      if (overlaps(block, input)) {
        found.push({
          kind: 'BLOCKED_TIME',
          staff,
          ...block,
          message: `${staff.name} has blocked this time`,
        });
      }
    }
    const length = Date.parse(input.endsAt) - Date.parse(input.startsAt);
    const alternatives: ConflictResult['alternatives'] = [];
    if (found.length) {
      for (let h = 9; h < 17 && alternatives.length < 3; h += 1) {
        const startsAt = at(date, `${String(h).padStart(2, '0')}:00`);
        const slot = { startsAt, endsAt: new Date(Date.parse(startsAt) + length).toISOString() };
        const busy = s.records.some(
          (r) =>
            r.status !== 'CANCELED' &&
            r.staff.some((x) => input.staffUserIds.includes(x.userId)) &&
            overlaps(r, slot),
        );
        if (!busy && !overlaps(blockedAt(date), slot)) alternatives.push(slot);
      }
    }
    return {
      ok: found.length === 0,
      conflicts: found,
      alternatives,
      canOverride: role !== 'STAFF',
    };
  }

  const contactOf = (c: ContactInput): AppointmentContact => {
    if (c.kind === 'CONTACT') {
      return {
        kind: 'CONTACT',
        id: null,
        name: c.name,
        businessName: c.businessName ?? null,
        email: c.email,
        phone: c.phone ?? null,
        clientType: c.clientType ?? 'INDIVIDUAL',
      };
    }
    const known = s.records.find((r) => r.contact.id === c.id)?.contact;
    return known
      ? copy(known)
      : {
          kind: c.kind,
          id: c.id,
          name: 'Selected contact',
          businessName: null,
          email: null,
          phone: null,
          clientType: 'INDIVIDUAL',
        };
  };
  const notice = (
    kind: AppointmentNotice['kind'],
    channel: AppointmentNotice['channel'] = 'EMAIL',
  ): AppointmentNotice => ({
    at: new Date().toISOString(),
    kind,
    channel,
    recipient: 'c***@example.test',
    status: 'SENT',
  });
  const bump = (r: AppointmentRecord) => {
    r.version = `v${Number(r.version.slice(1)) + 1}`;
  };

  return {
    summary: async (query = {}) => {
      await mockDelay();
      const q = parseInput(AppointmentsSummaryQuery, query);
      const month = q.month ?? localDate(Date.now()).slice(0, 7);
      const inMonth = s.records.filter(
        (r) => sees(r) && localDate(Date.parse(r.startsAt)).startsWith(month),
      );
      const count = (status: AgendaItem['status']) =>
        inMonth.filter((r) => r.status === status).length;
      const nowMs = Date.now();
      return {
        month,
        total: { value: inMonth.length, previous: s.records.length ? 20 : null },
        upcoming: s.records.filter(
          (r) =>
            sees(r) &&
            r.status !== 'CANCELED' &&
            Date.parse(r.startsAt) > nowMs &&
            Date.parse(r.startsAt) < nowMs + 7 * 24 * HOUR,
        ).length,
        completed: { value: count('COMPLETED'), previous: s.records.length ? 7 : null },
        noShows: { value: count('NO_SHOW'), previous: s.records.length ? 4 : null },
        canceled: { value: count('CANCELED'), previous: s.records.length ? 2 : null },
      };
    },
    agenda: async (query) => {
      await mockDelay();
      const q = parseInput(AgendaQuery, query);
      const search = q.search?.toLowerCase() ?? '';
      const items = s.records
        .filter((r) => r.status !== 'DRAFT' && overlaps(r, { startsAt: q.from, endsAt: q.to }))
        .filter((r) => !q.status || r.status === q.status)
        .filter((r) => !q.staffUserId || r.staff.some((x) => x.userId === q.staffUserId))
        .filter((r) => !q.clientId || r.contact.id === q.clientId)
        .filter(
          (r) =>
            !search ||
            [
              r.contact.name,
              r.contact.email ?? '',
              r.contact.phone ?? '',
              r.contact.businessName ?? '',
              r.service?.name ?? '',
              r.type?.name ?? '',
              ...r.staff.map((x) => x.name),
            ].some((t) => t.toLowerCase().includes(search)),
        )
        .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))
        .slice(0, q.limit)
        .map((r) => {
          if (!sees(r)) {
            return {
              restricted: true as const,
              id: r.id,
              startsAt: r.startsAt,
              endsAt: r.endsAt,
              staff: copy(r.staff),
              status: r.status,
            };
          }
          const {
            timezone: _tz,
            internalNotes: _n,
            clientInstructions: _c,
            related: _r,
            reminders: _m,
            recurrence: _rc,
            seriesId: _s,
            history: _h,
            notices: _no,
            createdAt: _ca,
            version: _v,
            ...item
          } = r;
          return copy(item);
        });
      return { timezone: TZ, items, nextCursor: null };
    },
    options: async () => {
      await mockDelay();
      return {
        timezone: TZ,
        types: TYPES(),
        services: SERVICES(),
        staff: staffList,
        offices: [
          { id: uuid('0f10', 1), name: 'Main Office' },
          { id: uuid('0f10', 2), name: 'Riverside Office' },
        ],
        rooms: [
          { id: uuid('0f20', 1), name: 'Conference Room 1', officeId: uuid('0f10', 1) },
          { id: uuid('0f20', 2), name: 'Conference Room 2', officeId: uuid('0f10', 1) },
        ],
        smsEnabled: true,
        portalEnabled: true,
        videoProvider: 'ZOOM',
      };
    },
    contacts: async (query) => {
      await mockDelay();
      const q = parseInput(ContactSearchQuery, query);
      const search = q.search.toLowerCase();
      const seen = new Map<string, AppointmentContact>();
      for (const r of s.records) {
        if (
          r.contact.id &&
          !seen.has(r.contact.id) &&
          [r.contact.name, r.contact.email ?? '', r.contact.phone ?? ''].some((t) =>
            t.toLowerCase().includes(search),
          )
        ) {
          seen.set(r.contact.id, copy(r.contact));
        }
      }
      return [...seen.values()].slice(0, q.limit);
    },

    record: async (id) => {
      await mockDelay();
      return copy(find(id));
    },
    schedule: async (body) => {
      await mockDelay();
      const input = parseInput(ScheduleAppointmentRequest, body);
      const again = s.idempotent.get(input.idempotencyKey);
      if (again) return copy(find(again));
      const check = conflicts({
        staffUserIds: input.staffUserIds,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
      });
      if (!check.ok && !(input.overrideConflicts && check.canOverride)) {
        throw fail(409, 'SCHEDULING_CONFLICT', check.conflicts[0]?.message ?? 'This time is taken');
      }
      if (input.generateVideoLink && input.method !== 'VIDEO')
        throw fail(400, 'VALIDATION_FAILED', 'Video links are for Zoom / Video');
      const type = TYPES().find((t) => t.id === input.typeId);
      if (!type) throw fail(404, 'NOT_FOUND', 'Appointment type not found');
      const staff = staffByIds(input.staffUserIds);
      const createdAt = new Date().toISOString();
      const r: AppointmentRecord = {
        restricted: false,
        id: uuid('0a10', s.next++),
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        allDay: input.allDay,
        contact: contactOf(input.contact),
        service: SERVICES().find((x) => x.id === input.serviceId) ?? null,
        type: { id: type.id, name: type.name },
        status: input.status,
        staff,
        method: input.method,
        place: { office: null, room: null, details: input.details ?? null },
        videoUrl: input.generateVideoLink
          ? `https://zoom.example.test/j/${s.next}000`
          : (input.videoUrl ?? null),
        color: input.color ?? type.color,
        internal: false,
        timezone: input.timezone ?? TZ,
        internalNotes: input.internalNotes ?? null,
        clientInstructions: input.clientInstructions ?? null,
        related: {
          taxReturn: null,
          bookkeepingEngagement: null,
          invoice: null,
          task: null,
          intakeForm: null,
          documentRequest: null,
        },
        reminders: input.reminders,
        recurrence: input.recurrence ?? null,
        seriesId:
          input.recurrence && input.recurrence.frequency !== 'NONE' ? uuid('0a20', s.next) : null,
        history: [
          {
            at: createdAt,
            action: 'BOOKED',
            by: { kind: 'STAFF', name: me.name },
            from: null,
            to: { startsAt: input.startsAt, endsAt: input.endsAt, staff: staff[0] ?? me },
            reason: input.overrideConflicts?.reason ?? null,
          },
        ],
        notices: input.sendConfirmation ? [notice('CONFIRMATION')] : [],
        createdAt,
        version: 'v1',
      };
      s.records.push(r);
      s.idempotent.set(input.idempotencyKey, r.id);
      return copy(r);
    },
    updateDetails: async (id, body) => {
      await mockDelay();
      const input = parseInput(UpdateAppointmentDetailsRequest, body);
      const r = find(id);
      if (input.version !== r.version)
        throw fail(409, 'SAVE_CONFLICT', 'Someone saved this appointment first');
      const startsAt = input.startsAt ?? r.startsAt;
      const endsAt = input.endsAt ?? r.endsAt;
      const staffIds = input.staffUserIds ?? r.staff.map((x) => x.userId);
      const moved = startsAt !== r.startsAt || endsAt !== r.endsAt;
      if (moved || input.staffUserIds) {
        const check = conflicts({
          staffUserIds: staffIds,
          startsAt,
          endsAt,
          excludeAppointmentId: id,
        });
        if (!check.ok && !(input.overrideConflicts && check.canOverride)) {
          throw fail(
            409,
            'SCHEDULING_CONFLICT',
            check.conflicts[0]?.message ?? 'This time is taken',
          );
        }
      }
      const before = { startsAt: r.startsAt, endsAt: r.endsAt, staff: r.staff[0] ?? me };
      Object.assign(r, {
        startsAt,
        endsAt,
        staff: staffByIds(staffIds),
        ...(input.contact ? { contact: contactOf(input.contact) } : {}),
        ...(input.allDay !== undefined ? { allDay: input.allDay } : {}),
        ...(input.method ? { method: input.method } : {}),
        ...(input.status ? { status: input.status } : {}),
        ...(input.color !== undefined ? { color: input.color } : {}),
        ...(input.internalNotes !== undefined ? { internalNotes: input.internalNotes } : {}),
        ...(input.clientInstructions !== undefined
          ? { clientInstructions: input.clientInstructions }
          : {}),
        ...(input.reminders ? { reminders: input.reminders } : {}),
        ...(input.videoUrl !== undefined ? { videoUrl: input.videoUrl } : {}),
      });
      if (moved) {
        r.status = 'RESCHEDULED';
        r.history.push({
          at: new Date().toISOString(),
          action: 'RESCHEDULED',
          by: { kind: 'STAFF', name: me.name },
          from: before,
          to: { startsAt, endsAt, staff: r.staff[0] ?? me },
          reason: null,
        });
        r.notices.push(notice('RESCHEDULE'));
      } else {
        r.notices.push(notice('UPDATE'));
      }
      bump(r);
      return copy(r);
    },
    confirm: async (id) => {
      await mockDelay();
      const r = find(id);
      if (['CANCELED', 'COMPLETED', 'NO_SHOW'].includes(r.status))
        throw fail(409, 'NOT_SCHEDULED', 'This appointment is closed');
      r.status = 'CONFIRMED';
      bump(r);
      return copy(r);
    },
    sendReminder: async (id, body = {}) => {
      await mockDelay();
      const input = parseInput(SendReminderRequest, body);
      const r = find(id);
      const channels = input.channels ?? ['EMAIL'];
      for (const c of channels) r.notices.push(notice('REMINDER', c));
      return {
        sent: r.contact.email ? channels.length : 0,
        skipped: r.contact.email ? 0 : channels.length,
      };
    },
    sendReminders: async (body) => {
      await mockDelay();
      const input = parseInput(SendRemindersRequest, body);
      const until = Date.now() + (input.withinDays ?? 0) * 24 * HOUR;
      const targets = s.records.filter(
        (r) =>
          sees(r) &&
          (input.appointmentIds
            ? input.appointmentIds.includes(r.id)
            : Date.parse(r.startsAt) > Date.now() &&
              Date.parse(r.startsAt) < until &&
              ['PENDING', 'CONFIRMED', 'RESCHEDULED'].includes(r.status)),
      );
      for (const r of targets) if (r.contact.email) r.notices.push(notice('REMINDER'));
      const sent = targets.filter((r) => r.contact.email).length;
      return { sent, skipped: targets.length - sent };
    },
    addNote: async (id, body) => {
      await mockDelay();
      const { text } = parseInput(AppointmentNoteRequest, body);
      const r = find(id);
      r.internalNotes = [r.internalNotes, `${me.name}: ${text}`].filter(Boolean).join('\n');
      bump(r);
      return copy(r);
    },
    duplicate: async (id) => {
      await mockDelay();
      const r = find(id);
      const d: AppointmentDraft = {
        id: uuid('0d30', s.next++),
        data: {
          typeId: r.type?.id,
          serviceId: r.service?.id,
          staffUserIds: r.staff.map((x) => x.userId),
          method: r.method,
          contact: r.contact.id ? { kind: r.contact.kind, id: r.contact.id } : undefined,
        },
        createdBy: me.name,
        updatedAt: new Date().toISOString(),
      };
      s.drafts.push(d);
      return copy(d);
    },

    drafts: async () => {
      await mockDelay();
      return copy(s.drafts);
    },
    createDraft: async (body) => {
      await mockDelay();
      const data = parseInput(SaveAppointmentDraftRequest, body);
      const d: AppointmentDraft = {
        id: uuid('0d30', s.next++),
        data: copy(data) as Record<string, unknown>,
        createdBy: me.name,
        updatedAt: new Date().toISOString(),
      };
      s.drafts.push(d);
      return copy(d);
    },
    saveDraft: async (id, body) => {
      await mockDelay();
      const data = parseInput(SaveAppointmentDraftRequest, body);
      const d = s.drafts.find((x) => x.id === id);
      if (!d) throw fail(404, 'NOT_FOUND', 'Not found');
      d.data = copy(data) as Record<string, unknown>;
      d.updatedAt = new Date().toISOString();
      return copy(d);
    },
    deleteDraft: async (id) => {
      await mockDelay();
      s.drafts = s.drafts.filter((d) => d.id !== id);
      return { ok: true };
    },

    staffDay: async (query) => {
      await mockDelay();
      const q = parseInput(StaffDayQuery, query);
      const [staff] = staffByIds([q.staffUserId]);
      if (!staff) throw fail(404, 'NOT_FOUND', 'Staff member not found');
      const blocks: AvailabilityBlock[] = [];
      for (let h = 8; h < 18; h += 1) {
        const slot = {
          startsAt: at(q.date, `${String(h).padStart(2, '0')}:00`),
          endsAt: at(q.date, `${String(h + 1).padStart(2, '0')}:00`),
        };
        const appt = s.records.find(
          (r) =>
            r.id !== q.excludeAppointmentId &&
            r.status !== 'CANCELED' &&
            r.staff.some((x) => x.userId === staff.userId) &&
            overlaps(r, slot),
        );
        if (appt)
          blocks.push({
            ...slot,
            kind: 'APPOINTMENT',
            label: sees(appt) ? `${appt.type?.name ?? 'Appointment'}` : null,
          });
        else if (h === 14) blocks.push({ ...slot, kind: 'BLOCKED', label: 'Blocked (Admin)' });
        else if (h === 12) blocks.push({ ...slot, kind: 'BUFFER', label: 'Lunch' });
        else blocks.push({ ...slot, kind: 'AVAILABLE', label: null });
      }
      const conflict =
        q.startsAt && q.endsAt
          ? conflicts({
              staffUserIds: [staff.userId],
              startsAt: q.startsAt,
              endsAt: q.endsAt,
              excludeAppointmentId: q.excludeAppointmentId,
            })
          : null;
      return { staff, date: q.date, timezone: TZ, blocks, conflict };
    },
    checkConflicts: async (body) => {
      await mockDelay();
      const input = parseInput(ConflictCheckRequest, body);
      return conflicts(input);
    },
    rules: async (userId) => {
      await mockDelay();
      if (role === 'STAFF' && userId !== me.userId)
        throw fail(403, 'FORBIDDEN', 'You can change only your own availability');
      return copy(
        s.rules.get(userId) ?? {
          userId,
          dateOverrides: [],
          timeOff: options.empty
            ? []
            : [
                {
                  id: uuid('0f30', 1),
                  from: plusDays(localDate(Date.now()), 21),
                  to: plusDays(localDate(Date.now()), 25),
                  reason: 'Vacation',
                },
              ],
          ...FIRM_RULES,
          busyCalendarIds: [],
          effectiveFrom: null,
          updatedAt: null,
        },
      );
    },
    setRules: async (userId, body) => {
      await mockDelay();
      if (role === 'STAFF' && userId !== me.userId)
        throw fail(403, 'FORBIDDEN', 'You can change only your own availability');
      const input = parseInput(SetAvailabilityRulesRequest, body);
      const current = s.rules.get(userId) ?? {
        userId,
        dateOverrides: [],
        timeOff: [],
        ...FIRM_RULES,
        busyCalendarIds: [],
        effectiveFrom: null,
        updatedAt: null,
      };
      // As the API: these are the firm's, with no per-person value; a changed one is refused.
      const same =
        (input.bufferBeforeMinutes ?? current.bufferBeforeMinutes) ===
          current.bufferBeforeMinutes &&
        (input.bufferAfterMinutes ?? current.bufferAfterMinutes) === current.bufferAfterMinutes &&
        (input.minNoticeHours ?? current.minNoticeHours) === current.minNoticeHours &&
        (input.maxWindowDays ?? current.maxWindowDays) === current.maxWindowDays &&
        (input.busyCalendarIds ?? []).length === 0 &&
        (input.effectiveFrom ?? null) === null;
      if (!same) {
        throw fail(
          400,
          'VALIDATION_FAILED',
          'Buffers, notice, booking window, busy calendars and the effective date cannot be saved per person yet.',
        );
      }
      const next: AvailabilityRules = {
        ...current,
        ...(input.dateOverrides ? { dateOverrides: input.dateOverrides } : {}),
        ...(input.timeOff
          ? {
              timeOff: input.timeOff.map((t, i) => ({
                id: uuid('0f30', 100 + i),
                from: t.from,
                to: t.to,
                reason: t.reason ?? null,
              })),
            }
          : {}),
        updatedAt: new Date().toISOString(),
      };
      s.rules.set(userId, next);
      return copy(next);
    },

    typeConfig: async (typeId) => {
      await mockDelay();
      // The types list is the appointment types mock's, with its own ids: any id has settings.
      const type = TYPES().find((t) => t.id === typeId);
      return copy(
        s.typeConfigs.get(typeId) ?? {
          typeId,
          description: null,
          serviceId: null,
          eligibleStaffUserIds: [],
          methods: ['IN_PERSON'],
          officeIds: [],
          bufferBeforeMinutes: 0,
          bufferAfterMinutes: 15,
          minNoticeHours: 24,
          maxWindowDays: 60,
          requiredIntakeFormId: null,
          requiredDocuments: [],
          defaultReminders: [{ channel: 'EMAIL', amount: 1, unit: 'DAYS' }],
          color: type?.color ?? null,
        },
      );
    },
    setTypeConfig: async (typeId, body) => {
      await mockDelay();
      managers();
      const input = parseInput(SetAppointmentTypeConfigRequest, body);
      // The types list is the appointment types mock's, with its own ids: any id has settings.
      const type = TYPES().find((t) => t.id === typeId);
      if (input.methods && (input.methods.length !== 1 || input.methods[0] === 'OTHER')) {
        throw fail(
          400,
          'VALIDATION_FAILED',
          'An appointment type has one meeting method for now (in person, phone or video).',
        );
      }
      const base = s.typeConfigs.get(typeId) ?? {
        typeId,
        description: null,
        serviceId: null,
        eligibleStaffUserIds: [],
        methods: ['IN_PERSON'] as AppointmentTypeConfig['methods'],
        officeIds: [],
        bufferBeforeMinutes: 0,
        bufferAfterMinutes: 0,
        minNoticeHours: 0,
        maxWindowDays: 60,
        requiredIntakeFormId: null,
        requiredDocuments: [],
        defaultReminders: [],
        color: type?.color ?? null,
      };
      const next = { ...base };
      for (const [k, v] of Object.entries(input))
        if (v !== undefined) Object.assign(next, { [k]: v });
      s.typeConfigs.set(typeId, next);
      return copy(next);
    },

    noticeSettings: async () => {
      await mockDelay();
      managers();
      return copy(s.notice);
    },
    setNoticeSettings: async (body) => {
      await mockDelay();
      managers();
      const input = parseInput(SetAppointmentNoticeSettingsRequest, body);
      for (const [k, v] of Object.entries(input))
        if (v !== undefined) Object.assign(s.notice, { [k]: v });
      return copy(s.notice);
    },
  };
}
