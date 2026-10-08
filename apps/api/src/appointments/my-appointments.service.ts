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
import { DATABASE } from '../database/database.module.js';
import { AppointmentHistory } from './appointment-history.service.js';
import { AppointmentNotices } from './appointment-notices.js';
import { endsInCalendar } from './appointments.service.js';
import {
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

/** What the client sees: never internal reasons, other clients or the staff member's id. */
export function toMine(row: AppointmentRow, now: number): MyAppointment {
  return {
    id: row.id,
    type: row.type ? { id: row.type.id, name: row.type.name } : null,
    staffName: row.staff.user.name,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    status: row.status,
    locationKind: row.locationKind,
    locationDetails: row.locationDetails,
    changeableUntil: changeableUntil(row, DEFAULT_CUTOFF_HOURS, now)?.toISOString() ?? null,
  };
}

/**
 * The signed-in client's own appointments at one firm (portal; contract in
 * packages/types/src/appointments). The client comes from the session (TenantGuard's client
 * account), never from the URL. Clients book client-bookable types at free times; the staff
 * member is their assigned one when free, else the free member with the fewest appointments
 * that day. They reschedule or cancel until the type's cutoff (24 hours until R0 adds
 * appointment_types.cancel_cutoff_hours), then 409 CHANGE_WINDOW_CLOSED.
 */
@Injectable()
export class MyAppointmentsService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly audit: AuditService,
    private readonly history: AppointmentHistory,
    private readonly notices: AppointmentNotices,
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

  /** One of the client's own appointments; anything else is 404. */
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
          clientId: me.clientId,
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
    return rows.map((r) => toMine(r, now.getTime()));
  }

  /** The firm's client-bookable types that are not archived. */
  async types(businessId: string): Promise<BookableType[]> {
    const rows = await this.database.forBusiness(businessId).appointmentType.findMany({
      where: { businessId, clientBookable: true, archivedAt: null },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }, { id: 'asc' }],
      select: { id: true, name: true, durationMinutes: true, locationKind: true },
    });
    return rows.map((r) => ({ ...r, cancelCutoffHours: DEFAULT_CUTOFF_HOURS }));
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
        select: { durationMinutes: true, clientBookable: true, archivedAt: true },
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
      const query = { timeZone, from: q.from, to: q.to, minutes, notBefore: Date.now() };
      const mineBusy = me ? clientBusy(busy, me.clientId, moving?.id) : [];
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
        select: { id: true, durationMinutes: true, locationKind: true },
      });
      if (!type) throw errors.notFound();
      if (me.archivedAt) throw errors.clientArchivedPortal();
      const start = Date.parse(body.startsAt);
      const slot = { start, end: start + type.durationMinutes * MINUTE };
      endsInCalendar(slot.end);
      const staff = await this.choose(tx, businessId, me, slot, retry);
      await lockForBooking(tx, businessId, staff.userId);
      const created = await tx.appointment.create({
        data: {
          businessId,
          clientId: me.clientId,
          staffUserId: staff.userId,
          typeId: type.id,
          startsAt: new Date(slot.start),
          endsAt: new Date(slot.end),
          locationKind: type.locationKind,
          bookedByClient: true,
        },
        select: appointmentSelect,
      });
      // In the change's transaction, as the firm's routes (#108 review).
      await this.history.record(tx, 'BOOKED', created, { by: 'CLIENT', from: null, to: created });
      return created;
    });
    await this.notices.send('appointment.booked', businessId, row.id, { clientAccountId });
    return toMine(row, Date.now());
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
      const staff = await this.choose(tx, businessId, me, slot, retry, current);
      await lockForBooking(tx, businessId, staff.userId);
      const updated = await tx.appointment.update({
        where: { id: current.id },
        data: {
          startsAt: new Date(slot.start),
          endsAt: new Date(slot.end),
          staffUserId: staff.userId,
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
    if (!after) return toMine(before, Date.now());
    await this.notices.send('appointment.changed', businessId, after.id, { clientAccountId });
    return toMine(after, Date.now());
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
    return toMine(after, Date.now());
  }

  /**
   * Who takes `slot` (R12 Decisions):
   * - not a start on the 15-minute grid of anyone's working hours that day, or past: 409
   *   SLOT_UNAVAILABLE;
   * - on the grid, but no one is free then: 409 SLOT_UNAVAILABLE (SLOT_TAKEN when this is a
   *   second try: the time was free a moment ago and someone took it);
   * - the client has another appointment then: 409 SLOT_TAKEN (the database agrees);
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
      notBefore: Date.now(),
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
    if (clientBusy(busy, me.clientId, moving?.id).some((b) => overlaps(b, slot))) {
      throw errors.slotTaken();
    }
    return { userId: picked.userId, name: picked.name };
  }
}
