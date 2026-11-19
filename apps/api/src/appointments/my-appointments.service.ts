import { Inject, Injectable } from '@nestjs/common';
import type { Database, TxClient } from '@firmivra/db';
import type {
  BookableType,
  BookMyAppointmentRequest,
  MemberRef,
  MyAppointment,
  MyAppointmentsQuery,
  MySlotList,
  MySlotsQuery,
  RescheduleMyAppointmentRequest,
} from '@firmivra/types';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import { IntakeSendService } from '../intake-workspace/intake-send.service.js';
import { DATABASE } from '../database/database.module.js';
import { AppointmentHistory } from './appointment-history.service.js';
import { AppointmentNotices } from './appointment-notices.js';
import { endsInCalendar } from './appointments.service.js';
import {
  BOOKING_RULES_SELECT,
  type BookingRules,
  bookingSpan,
  changeableUntil,
  DEFAULT_CUTOFF_HOURS,
  freeStarts,
  gridStarts,
  type Interval,
  MINUTE,
  overlaps,
  pickStaff,
  zonedDate,
} from './calendar.js';
import {
  activeMembers,
  appointmentSelect,
  type AppointmentRow,
  busyTimes,
  clientBusy,
  dateSpan,
  firmTimeZone,
  memberBusy,
  workingHours,
} from './calendar-data.js';
import { lockAppointment, lockForBooking, retryWhenBusy } from './calendar-locks.js';
import { errors, isSlotConflict, isStaffConflict } from './errors.js';
import { legacyKind, legacyMethods, typeMethods } from './scheduling-map.js';
import {
  detailsAfterStaffChange,
  linkOf,
  MEETING_LINKS,
  type MeetingLinkStore,
} from './meeting-links.js';
import { withClient } from './appointment-party.js';

type ListQuery = z.output<typeof MyAppointmentsQuery>;
type SlotsQ = z.output<typeof MySlotsQuery>;
type BookBody = z.output<typeof BookMyAppointmentRequest>;
type RescheduleBody = z.output<typeof RescheduleMyAppointmentRequest>;

/** The signed-in login's client record at this firm (none for a login not linked to one yet). */
interface Me {
  clientId: string;
  assignedUserId: string | null;
  archivedAt: Date | null;
}

/**
 * How many times a portal booking or new time is tried when the staff member it chose was just
 * booked by someone else (each try reads the calendar again and chooses again).
 */
const STAFF_ATTEMPTS = 3;

const iso = (ms: number) => new Date(ms).toISOString();

/** An appointment's length in ms. */
const lengthOf = (row: { startsAt: Date; endsAt: Date }) =>
  row.endsAt.getTime() - row.startsAt.getTime();

/**
 * What the client sees: never internal reasons, other clients or the staff member's id. A1: an
 * appointment the client attends (another client's group appointment) shows the same, never who
 * else attends, and only its own client changes it (`changeableUntil` null for the attendee).
 */
export function toMine(row: AppointmentRow, now: number, clientId: string): MyAppointment {
  const attending = withClient(row).clientId.toLowerCase() !== clientId.toLowerCase();
  return {
    id: row.id,
    type: row.type ? { id: row.type.id, name: row.type.name } : null,
    staffName: row.staff.user.name,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    status: row.status,
    locationKind: legacyKind(row.locationKind),
    locationDetails: row.locationDetails,
    changeableUntil: attending
      ? null
      : (changeableUntil(row, DEFAULT_CUTOFF_HOURS, now)?.toISOString() ?? null),
    // Review 2 (B9): the firm's instructions, when it shows them in the portal.
    instructions: row.instructionsInPortal ? row.clientInstructions : null,
    attending,
    needsConfirmation: !attending && needsConfirmation(row, now),
  };
}

/** A1: the people an appointment books, its client and each attendee. */
// P4-1: the portal reads only its clients' appointments, so each one here has a client.
const peopleOf = (row: AppointmentRow) => [
  withClient(row).clientId,
  ...row.attendees.map((a) => a.clientId),
];

/**
 * Review 2 (row 8): the firm booked it and it is not confirmed yet, still ahead: the client is
 * asked to confirm. One the client booked themselves never asks.
 */
export const needsConfirmation = (
  row: { status: string; confirmedAt: Date | null; bookedByClient: boolean; startsAt: Date },
  now: number,
) =>
  row.status === 'SCHEDULED' &&
  row.confirmedAt === null &&
  !row.bookedByClient &&
  row.startsAt.getTime() > now;

/**
 * The signed-in client's own appointments at one firm (portal; contract in
 * packages/types/src/appointments). The client comes from the session (TenantGuard's client
 * account), never from the URL. Clients book client-bookable types at free times; the staff
 * member is their assigned one when free, else the free member with the fewest appointments
 * that day. They meet in one of the type's meeting methods (A1; its first unless they choose
 * another). They reschedule or cancel until the type's cutoff (24 hours until R0 adds
 * appointment_types.cancel_cutoff_hours), then 409 CHANGE_WINDOW_CLOSED.
 */
@Injectable()
export class MyAppointmentsService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly audit: AuditService,
    private readonly history: AppointmentHistory,
    private readonly notices: AppointmentNotices,
    @Inject(MEETING_LINKS) private readonly links: MeetingLinkStore,
    private readonly intakes: IntakeSendService,
  ) {}

  private inFirm<T>(businessId: string, fn: (tx: TxClient) => Promise<T>): Promise<T> {
    return this.database.withScope({ kind: 'business', businessId }, fn);
  }

  /**
   * A change in one transaction, tried again while a calendar lock is busy. When the database
   * refuses the staff member the portal chose (someone booked them meanwhile), the whole change
   * runs again and chooses again (`retry` is then true). Other refusals: 409 SLOT_TAKEN.
   */
  private async change<T>(
    businessId: string,
    fn: (tx: TxClient, retry: boolean) => Promise<T>,
  ): Promise<T> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await retryWhenBusy(() => this.inFirm(businessId, (tx) => fn(tx, attempt > 1)));
      } catch (e) {
        if (isStaffConflict(e) && attempt < STAFF_ATTEMPTS) continue;
        if (isSlotConflict(e)) throw errors.slotTaken();
        throw e;
      }
    }
  }

  private async me(tx: TxClient, businessId: string, clientAccountId: string): Promise<Me | null> {
    const account = await tx.clientAccount.findFirst({
      where: { businessId, id: clientAccountId },
      select: { client: { select: { id: true, assignedUserId: true, archivedAt: true } } },
    });
    const client = account?.client;
    return client
      ? {
          clientId: client.id,
          assignedUserId: client.assignedUserId,
          archivedAt: client.archivedAt,
        }
      : null;
  }

  /**
   * One of the client's own appointments; anything else is 404. One the client only attends
   * (A1) is not theirs to change: 404 here too.
   */
  private async mine(
    tx: TxClient,
    businessId: string,
    me: Me | null,
    id: string,
  ): Promise<AppointmentRow> {
    const row = me
      ? await tx.appointment.findFirst({
          where: { businessId, id, clientId: me.clientId },
          select: appointmentSelect,
        })
      : null;
    if (!row) throw errors.notFound();
    return row;
  }

  /**
   * The client's own appointment, row locked for a change: final statuses are 409
   * APPOINTMENT_CLOSED; past the cutoff, 409 CHANGE_WINDOW_CLOSED.
   */
  private async changeable(
    tx: TxClient,
    businessId: string,
    me: Me | null,
    id: string,
  ): Promise<AppointmentRow> {
    if (me) await lockAppointment(tx, businessId, id, me.clientId);
    const row = await this.mine(tx, businessId, me, id);
    if (row.status !== 'SCHEDULED') throw errors.closed();
    if (!changeableUntil(row, DEFAULT_CUTOFF_HOURS, Date.now())) throw errors.windowClosed();
    return row;
  }

  async list(businessId: string, clientAccountId: string, q: ListQuery): Promise<MyAppointment[]> {
    const now = new Date();
    const { me, rows } = await this.inFirm(businessId, async (tx) => {
      const me = await this.me(tx, businessId, clientAccountId);
      if (!me) return { me, rows: [] };
      const upcoming = { status: 'SCHEDULED' as const, endsAt: { gt: now } };
      const rows = await tx.appointment.findMany({
        where: {
          businessId,
          // A1: their own and those they attend.
          OR: [
            { clientId: me.clientId },
            { attendees: { some: { businessId, clientId: me.clientId } } },
          ],
          ...(q.when === 'upcoming' ? upcoming : { NOT: upcoming }),
        },
        orderBy:
          q.when === 'upcoming'
            ? [{ startsAt: 'asc' }, { id: 'asc' }]
            : [{ startsAt: 'desc' }, { id: 'desc' }],
        select: appointmentSelect,
      });
      return { me, rows };
    });
    if (me) {
      await this.audit.log(
        'portal.appointments_viewed',
        { type: 'client', id: me.clientId },
        { when: q.when, count: rows.length },
      );
    }
    return me ? rows.map((r) => toMine(r, now.getTime(), me.clientId)) : [];
  }

  /** The firm's client-bookable types that are not archived, with their meeting methods. */
  async types(businessId: string): Promise<BookableType[]> {
    const rows = await this.database.forBusiness(businessId).appointmentType.findMany({
      where: { businessId, clientBookable: true, archivedAt: null },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        name: true,
        durationMinutes: true,
        locationKind: true,
        meetingMethods: true,
      },
    });
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      durationMinutes: r.durationMinutes,
      locationKind: legacyKind(r.locationKind),
      methods: legacyMethods(typeMethods(r)),
      cancelCutoffHours: DEFAULT_CUTOFF_HOURS,
    }));
  }

  /**
   * Free starts for a bookable type: times when some member is free and the client has nothing
   * else. With `excludeAppointmentId` (the client's own, else 404) its time counts as free, and
   * while the client may still move it (scheduled, before the cutoff) its own type may be asked
   * for even when clients cannot book that type. A cancelled, finished or past-cutoff appointment
   * never opens a type the client cannot book (404, as without it).
   */
  async slots(businessId: string, clientAccountId: string, q: SlotsQ): Promise<MySlotList> {
    return this.inFirm(businessId, async (tx) => {
      const me = await this.me(tx, businessId, clientAccountId);
      const moving = q.excludeAppointmentId
        ? await this.mine(tx, businessId, me, q.excludeAppointmentId)
        : null;
      const type = await tx.appointmentType.findFirst({
        where: { businessId, id: q.typeId },
        select: {
          durationMinutes: true,
          clientBookable: true,
          archivedAt: true,
          ...BOOKING_RULES_SELECT,
        },
      });
      const ownType =
        moving !== null &&
        moving.typeId === q.typeId &&
        changeableUntil(moving, DEFAULT_CUTOFF_HOURS, Date.now()) !== null;
      if (!type || (!ownType && (!type.clientBookable || type.archivedAt))) {
        throw errors.notFound();
      }
      const minutes = moving && ownType ? lengthOf(moving) / MINUTE : type.durationMinutes;
      const members = await activeMembers(tx, businessId);
      const timeZone = await firmTimeZone(tx, businessId);
      const hours = await workingHours(
        tx,
        businessId,
        members.map((m) => m.userId),
      );
      const busy = await busyTimes(tx, businessId, dateSpan(timeZone, q.from, q.to));
      // Review 2 row 2: only starts inside the type's Minimum Notice and Booking Window.
      const query = { timeZone, from: q.from, to: q.to, minutes, ...bookingSpan(type, Date.now()) };
      // A1: a new time for a group appointment suits each attendee too.
      const people = moving ? peopleOf(moving) : me ? [me.clientId] : [];
      const mineBusy = people.flatMap((c) => clientBusy(busy, c, moving?.id));
      const starts = new Map<number, number>();
      for (const m of members) {
        const taken = [...memberBusy(busy, m.userId, moving?.id), ...mineBusy];
        for (const s of freeStarts(query, hours.get(m.userId) ?? [], taken)) {
          starts.set(s.start, s.end);
        }
      }
      const slots = [...starts]
        .sort(([a], [b]) => a - b)
        .map(([start, end]) => ({ startsAt: iso(start), endsAt: iso(end) }));
      return { timezone: timeZone, slots };
    });
  }

  async book(businessId: string, clientAccountId: string, body: BookBody): Promise<MyAppointment> {
    const row = await this.change(businessId, async (tx, retry) => {
      const me = await this.me(tx, businessId, clientAccountId);
      if (!me) throw errors.notFound();
      // Only types the client can book (as `types()`); anything else is 404.
      const type = await tx.appointmentType.findFirst({
        where: { businessId, id: body.typeId, clientBookable: true, archivedAt: null },
        select: {
          id: true,
          durationMinutes: true,
          locationKind: true,
          meetingMethods: true,
          ...BOOKING_RULES_SELECT,
        },
      });
      if (!type) throw errors.notFound();
      // S12: booked from a package's page. A package that is not this firm's (or none at all)
      // is 404, as an unknown type is; one of the firm's that is hidden now, or no longer has
      // this Booking type, books as usual without naming it.
      const pkg = body.packageId
        ? await tx.servicePackage.findFirst({
            where: { businessId, id: body.packageId },
            select: {
              name: true,
              appointmentTypeId: true,
              status: true,
              archivedAt: true,
              visibleToClients: true,
              displayOnPortal: true,
            },
          })
        : null;
      if (body.packageId && !pkg) throw errors.notFound();
      const named =
        pkg &&
        pkg.appointmentTypeId === type.id &&
        pkg.status === 'ACTIVE' &&
        pkg.archivedAt === null &&
        pkg.visibleToClients &&
        pkg.displayOnPortal
          ? pkg.name
          : null;
      if (me.archivedAt) throw errors.clientArchivedPortal();
      // One of the type's meeting methods (A1); its first when the client chose none.
      const methods = typeMethods(type);
      const locationKind = body.locationKind ?? methods[0] ?? type.locationKind;
      if (!methods.includes(locationKind)) throw errors.methodNotOffered('locationKind');
      const start = Date.parse(body.startsAt);
      const slot = { start, end: start + type.durationMinutes * MINUTE };
      endsInCalendar(slot.end);
      const staff = await this.choose(tx, businessId, me, slot, retry, undefined, type);
      // A VIDEO meeting gets the chosen staff member's link (R14).
      const locationDetails =
        locationKind === 'VIDEO' ? await linkOf(this.links, tx, businessId, staff.userId) : null;
      await lockForBooking(tx, businessId, staff.userId, me.clientId);
      const created = await tx.appointment.create({
        data: {
          businessId,
          clientId: me.clientId,
          staffUserId: staff.userId,
          typeId: type.id,
          // S12: the firm sees the package named in its staff notes (never shown to the client).
          ...(named ? { internalNotes: `Booked from the package "${named}".` } : {}),
          startsAt: new Date(slot.start),
          endsAt: new Date(slot.end),
          locationKind,
          locationDetails,
          bookedByClient: true,
        },
        select: appointmentSelect,
      });
      // In the change's transaction, as the firm's routes (#108 review).
      await this.history.record(tx, 'BOOKED', created, { by: 'CLIENT', from: null, to: created });
      return created;
    });
    await this.notices.send('appointment.booked', businessId, row.id, { clientAccountId });
    // A9: the type's required intake form goes to the client's portal, linked to it.
    await this.intakes.sendForAppointment(businessId, row.id, null);
    return toMine(row, Date.now(), withClient(row).clientId);
  }

  /** A new start from the slots, same length, before the cutoff. Same staff member when free. */
  async reschedule(
    businessId: string,
    clientAccountId: string,
    id: string,
    body: RescheduleBody,
  ): Promise<MyAppointment> {
    const { before, after } = await this.change(businessId, async (tx, retry) => {
      const me = await this.me(tx, businessId, clientAccountId);
      const current = await this.changeable(tx, businessId, me, id);
      const start = Date.parse(body.startsAt);
      if (!me || start === current.startsAt.getTime()) return { before: current, after: null };
      const slot = { start, end: start + lengthOf(current) };
      endsInCalendar(slot.end);
      // The type's Minimum Notice and Booking Window apply to the new time too.
      const rules = current.typeId
        ? await tx.appointmentType.findFirst({
            where: { businessId, id: current.typeId },
            select: BOOKING_RULES_SELECT,
          })
        : null;
      const staff = await this.choose(tx, businessId, me, slot, retry, current, rules);
      const locationDetails = await detailsAfterStaffChange(
        this.links,
        tx,
        businessId,
        current,
        staff.userId,
      );
      const [, ...attendees] = peopleOf(current);
      await lockForBooking(tx, businessId, staff.userId, withClient(current).clientId, attendees);
      const updated = await tx.appointment.update({
        where: { id: current.id },
        data: {
          startsAt: new Date(slot.start),
          endsAt: new Date(slot.end),
          staffUserId: staff.userId,
          locationDetails,
        },
        select: appointmentSelect,
      });
      await this.history.record(tx, 'RESCHEDULED', updated, {
        by: 'CLIENT',
        from: current,
        to: updated,
      });
      return { before: current, after: updated };
    });
    if (!after) return toMine(before, Date.now(), withClient(before).clientId);
    await this.notices.send('appointment.changed', businessId, after.id, { clientAccountId });
    return toMine(after, Date.now(), withClient(after).clientId);
  }

  /**
   * Review 2 (row 8): the client confirms an appointment the firm booked. It is then confirmed
   * for the firm too (the calendar's Confirmed), and later reminders stop asking. Again changes
   * nothing. Audited with ids only.
   */
  async confirm(businessId: string, clientAccountId: string, id: string): Promise<MyAppointment> {
    const { row, changed } = await this.change(businessId, async (tx) => {
      const me = await this.me(tx, businessId, clientAccountId);
      if (me) await lockAppointment(tx, businessId, id, me.clientId);
      const current = await this.mine(tx, businessId, me, id);
      if (current.status !== 'SCHEDULED') throw errors.closed();
      if (current.startsAt.getTime() <= Date.now()) throw errors.windowClosed();
      if (current.confirmedAt) return { row: current, changed: false };
      const updated = await tx.appointment.update({
        where: { id: current.id },
        data: { confirmedAt: new Date() },
        select: appointmentSelect,
      });
      return { row: updated, changed: true };
    });
    if (changed) {
      await this.audit.log(
        'appointment.confirmed',
        { type: 'appointment', id: row.id },
        { by: 'CLIENT', clientId: row.clientId },
      );
    }
    return toMine(row, Date.now(), withClient(row).clientId);
  }

  async cancel(
    businessId: string,
    clientAccountId: string,
    id: string,
    reason: string | null | undefined,
  ): Promise<MyAppointment> {
    const after = await this.change(businessId, async (tx) => {
      const me = await this.me(tx, businessId, clientAccountId);
      const current = await this.changeable(tx, businessId, me, id);
      const updated = await tx.appointment.update({
        where: { id: current.id },
        data: { status: 'CANCELLED', cancelledAt: new Date(), cancelReason: reason ?? null },
        select: appointmentSelect,
      });
      await this.history.record(tx, 'CANCELLED', updated, {
        by: 'CLIENT',
        from: current,
        to: null,
        reason,
      });
      return updated;
    });
    return toMine(after, Date.now(), withClient(after).clientId);
  }

  /**
   * Who takes `slot` (R12 Decisions):
   * - not a start on the 15-minute grid of anyone's working hours that day, past, or outside
   *   the type's Minimum Notice and Booking Window (`rules`, Review 2 row 2): 409
   *   SLOT_UNAVAILABLE;
   * - on the grid, but no one is free then: 409 SLOT_UNAVAILABLE (SLOT_TAKEN when this is a
   *   second try: the time was free a moment ago and someone took it);
   * - the client has (or attends, A1) another appointment then, or for a new time of a group
   *   appointment one of its attendees does: 409 SLOT_TAKEN (the database agrees on the client's);
   * - otherwise the member who has it now (a reschedule) if free, else the client's assigned
   *   member if free, else the free member with the fewest appointments that firm-local day.
   */
  private async choose(
    tx: TxClient,
    businessId: string,
    me: Me,
    slot: Interval,
    retry: boolean,
    moving?: AppointmentRow,
    rules: BookingRules | null = null,
  ): Promise<MemberRef> {
    const timeZone = await firmTimeZone(tx, businessId);
    const date = zonedDate(timeZone, slot.start);
    const members = await activeMembers(tx, businessId);
    const hours = await workingHours(
      tx,
      businessId,
      members.map((m) => m.userId),
    );
    const query = {
      timeZone,
      from: date,
      to: date,
      minutes: (slot.end - slot.start) / MINUTE,
      ...bookingSpan(rules, Date.now()),
    };
    const onGrid = members.filter((m) =>
      gridStarts(query, hours.get(m.userId) ?? []).some((s) => s.start === slot.start),
    );
    if (onGrid.length === 0) throw errors.slotUnavailable();
    const busy = await busyTimes(tx, businessId, dateSpan(timeZone, date, date));
    const free = onGrid.filter(
      (m) => !memberBusy(busy, m.userId, moving?.id).some((b) => overlaps(b, slot)),
    );
    const load = (userId: string) =>
      busy.appointments.filter((a) => a.staffUserId === userId && a.id !== moving?.id).length;
    const picked =
      free.find((m) => m.userId === moving?.staffUserId) ??
      pickStaff(
        free.map((m) => ({ ...m, load: load(m.userId) })),
        me.assignedUserId,
      );
    if (!picked) throw retry ? errors.slotTaken() : errors.slotUnavailable();
    const people = moving ? peopleOf(moving) : [me.clientId];
    if (people.some((c) => clientBusy(busy, c, moving?.id).some((b) => overlaps(b, slot)))) {
      throw errors.slotTaken();
    }
    return { userId: picked.userId, name: picked.name };
  }
}
