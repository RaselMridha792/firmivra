import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import type { Database, TxClient } from '@firmivra/db';
import type {
  Appointment,
  AppointmentDetail,
  AppointmentsQuery,
  BookAppointmentRequest,
  CalendarAppointment,
  RescheduleAppointmentRequest,
  SlotList,
  SlotsQuery,
} from '@firmivra/types';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import { DATABASE } from '../database/database.module.js';
import { AppointmentHistory } from './appointment-history.service.js';
import { AppointmentNotices } from './appointment-notices.js';
import { inCalendarYears } from './appointments.input.js';
import { freeStarts, MINUTE } from './calendar.js';
import {
  activeMember,
  activeMembers,
  appointmentSelect,
  type AppointmentRow,
  busyTimes,
  dateSpan,
  type FirmActor,
  firmTimeZone,
  inFullWhere,
  memberBusy,
  seesInFull,
  toAppointment,
  toBusy,
  workingHours,
} from './calendar-data.js';
import { lockAppointment, lockForBooking, retryWhenBusy } from './calendar-locks.js';
import { errors, isSlotConflict } from './errors.js';

type ListQuery = z.output<typeof AppointmentsQuery>;
type SlotsQ = z.output<typeof SlotsQuery>;
type BookBody = z.output<typeof BookAppointmentRequest>;
type RescheduleBody = z.output<typeof RescheduleAppointmentRequest>;

const iso = (ms: number) => new Date(ms).toISOString();

/**
 * The firm's calendar (contract in packages/types/src/appointments). Owner and Admin see and
 * change every appointment. Staff see in full their own and their assigned clients'
 * appointments, every other one as Busy, and get 404 for anything else about those; they book
 * only for clients assigned to them. Firm users change appointments at any time (no client
 * cutoff). The database refuses double booking and blocked time (409 SLOT_TAKEN). Reads and
 * changes are audited; the changes are the appointment's history.
 */
/**
 * A start inside the calendar's years can still end after them (late on 2100-12-31): the end is
 * checked too, as 400 like the start (#108 review).
 */
export function endsInCalendar(endsAt: number): void {
  if (!inCalendarYears(new Date(endsAt).toISOString())) {
    throw new BadRequestException({
      code: 'VALIDATION_FAILED',
      message: 'Use a date from 2000 to 2100',
    });
  }
}

@Injectable()
export class AppointmentsService {
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
   * A calendar change in one transaction, tried again while a calendar lock is busy
   * (calendar-locks.ts). The database's refusals (double booking, blocked time) become 409
   * SLOT_TAKEN.
   */
  private async write<T>(businessId: string, fn: (tx: TxClient) => Promise<T>): Promise<T> {
    try {
      return await retryWhenBusy(() => this.inFirm(businessId, fn));
    } catch (e) {
      if (isSlotConflict(e)) throw errors.slotTaken();
      throw e;
    }
  }

  /**
   * The appointment to change, row locked, if this member sees it in full (else 404) and it is
   * still scheduled (else 409 APPOINTMENT_CLOSED).
   */
  private async openForChange(
    tx: TxClient,
    businessId: string,
    actor: FirmActor,
    id: string,
  ): Promise<AppointmentRow> {
    await lockAppointment(tx, businessId, id);
    const current = await this.findInFull(tx, businessId, actor, id);
    if (current.status !== 'SCHEDULED') throw errors.closed();
    return current;
  }

  /** The appointment if this member sees it in full; else 404 (Busy for Staff, or another firm's). */
  private async findInFull(
    tx: TxClient,
    businessId: string,
    actor: FirmActor,
    id: string,
  ): Promise<AppointmentRow> {
    const row = await tx.appointment.findFirst({
      where: { AND: [{ businessId, id }, inFullWhere(actor)] },
      select: appointmentSelect,
    });
    if (!row) throw errors.notFound();
    return row;
  }

  async list(businessId: string, actor: FirmActor, q: ListQuery): Promise<CalendarAppointment[]> {
    const rows = await this.inFirm(businessId, async (tx) => {
      if (q.clientId && actor.role === 'STAFF') {
        // So a Busy entry can never be traced to a client.
        const assigned = await tx.client.findFirst({
          where: { businessId, id: q.clientId, assignedUserId: actor.userId },
          select: { id: true },
        });
        if (!assigned) throw errors.notFound();
      }
      return tx.appointment.findMany({
        where: {
          businessId,
          startsAt: { lt: new Date(q.to) },
          endsAt: { gt: new Date(q.from) },
          ...(q.staffUserId ? { staffUserId: q.staffUserId } : {}),
          ...(q.clientId ? { clientId: q.clientId } : {}),
          ...(q.status ? { status: q.status } : {}),
        },
        orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
        select: appointmentSelect,
      });
    });
    const items = rows.map((row): CalendarAppointment =>
      seesInFull(actor, row) ? { ...toAppointment(row), restricted: false } : toBusy(row),
    );
    await this.audit.log(
      'appointments.listed',
      { type: 'appointment' },
      { count: items.length, busy: items.filter((i) => i.restricted).length },
    );
    return items;
  }

  async get(businessId: string, actor: FirmActor, id: string): Promise<AppointmentDetail> {
    const detail = await this.inFirm(businessId, async (tx) => {
      const row = await this.findInFull(tx, businessId, actor, id);
      return { ...toAppointment(row), history: await this.history.events(tx, businessId, row) };
    });
    await this.audit.log('appointment.viewed', { type: 'appointment', id });
    return detail;
  }

  /** Free starts for one type: every active member's, or one member's (Staff see all). */
  async slots(businessId: string, actor: FirmActor, q: SlotsQ): Promise<SlotList> {
    return this.inFirm(businessId, async (tx) => {
      const type = await tx.appointmentType.findFirst({
        where: { businessId, id: q.typeId },
        select: { durationMinutes: true, archivedAt: true },
      });
      if (!type) throw errors.notFound();
      // As booking it: an archived type is 409, never an empty list (#108 review).
      if (type.archivedAt) throw errors.typeArchived();
      // Rescheduling: Staff may exclude only an appointment they see in full (else 404).
      if (q.excludeAppointmentId) {
        await this.findInFull(tx, businessId, actor, q.excludeAppointmentId);
      }
      const members = q.staffUserId
        ? [await activeMember(tx, businessId, q.staffUserId)]
        : await activeMembers(tx, businessId);
      const timeZone = await firmTimeZone(tx, businessId);
      const hours = await workingHours(
        tx,
        businessId,
        members.map((m) => m.userId),
      );
      const busy = await busyTimes(tx, businessId, dateSpan(timeZone, q.from, q.to));
      const query = {
        timeZone,
        from: q.from,
        to: q.to,
        minutes: type.durationMinutes,
        notBefore: Date.now(),
      };
      const slots = members.flatMap((staff) =>
        freeStarts(
          query,
          hours.get(staff.userId) ?? [],
          memberBusy(busy, staff.userId, q.excludeAppointmentId),
        ).map((s) => ({ startsAt: iso(s.start), endsAt: iso(s.end), staff })),
      );
      slots.sort(
        (a, b) => a.startsAt.localeCompare(b.startsAt) || a.staff.name.localeCompare(b.staff.name),
      );
      return { timezone: timeZone, slots };
    });
  }

  async book(businessId: string, actor: FirmActor, body: BookBody): Promise<Appointment> {
    const row = await this.write(businessId, async (tx) => {
      // FOR SHARE: an archive or a reassignment of the client waits for this booking, or this
      // reads theirs (#108 review), as tasks and reports lock the client first.
      const [client] = await tx.$queryRaw<
        { id: string; archived_at: Date | null; assigned_user_id: string | null }[]
      >`
        SELECT id::text AS id, archived_at, assigned_user_id::text AS assigned_user_id
        FROM clients WHERE business_id = ${businessId}::uuid AND id = ${body.clientId}::uuid
        FOR SHARE`;
      if (!client) throw errors.notFound();
      if (actor.role === 'STAFF' && client.assigned_user_id !== actor.userId.toLowerCase()) {
        throw errors.notFound();
      }
      await activeMember(tx, businessId, body.staffUserId);
      const type = body.typeId
        ? await tx.appointmentType.findFirst({
            where: { businessId, id: body.typeId },
            select: { id: true, durationMinutes: true, locationKind: true, archivedAt: true },
          })
        : null;
      if (body.typeId && !type) throw errors.notFound();
      if (body.engagementId) {
        const engagement = await tx.engagement.findFirst({
          where: { businessId, clientId: client.id, id: body.engagementId },
          select: { id: true },
        });
        if (!engagement) throw errors.notFound();
      }
      if (client.archived_at) throw errors.clientArchived();
      if (type?.archivedAt) throw errors.typeArchived();
      // The request needs a type or a duration (BookAppointmentRequest).
      const minutes = body.durationMinutes ?? type?.durationMinutes ?? 0;
      const startsAt = new Date(body.startsAt);
      endsInCalendar(startsAt.getTime() + minutes * MINUTE);
      await lockForBooking(tx, businessId, body.staffUserId);
      const created = await tx.appointment.create({
        data: {
          businessId,
          clientId: client.id,
          staffUserId: body.staffUserId,
          typeId: type?.id ?? null,
          engagementId: body.engagementId ?? null,
          startsAt,
          endsAt: new Date(startsAt.getTime() + minutes * MINUTE),
          locationKind: body.locationKind ?? type?.locationKind ?? 'VIDEO',
          locationDetails: body.locationDetails ?? null,
          bookedByUserId: actor.userId,
          bookedByClient: false,
        },
        select: appointmentSelect,
      });
      await this.history.record(tx, 'BOOKED', created, { by: 'STAFF', from: null, to: created });
      return created;
    });
    await this.notices.send('appointment.booked', businessId, row.id);
    return toAppointment(row);
  }

  /** A new start (same length), and optionally another staff member. */
  async reschedule(
    businessId: string,
    actor: FirmActor,
    id: string,
    body: RescheduleBody,
  ): Promise<Appointment> {
    const { before, after } = await this.write(businessId, async (tx) => {
      const current = await this.openForChange(tx, businessId, actor, id);
      const staffUserId = (body.staffUserId ?? current.staffUserId).toLowerCase();
      const sameStaff = staffUserId === current.staffUserId.toLowerCase();
      if (!sameStaff) await activeMember(tx, businessId, staffUserId);
      const startsAt = new Date(body.startsAt);
      if (startsAt.getTime() === current.startsAt.getTime() && sameStaff) {
        return { before: current, after: null };
      }
      const length = current.endsAt.getTime() - current.startsAt.getTime();
      endsInCalendar(startsAt.getTime() + length);
      await lockForBooking(tx, businessId, staffUserId);
      const updated = await tx.appointment.update({
        where: { id: current.id },
        data: { startsAt, endsAt: new Date(startsAt.getTime() + length), staffUserId },
        select: appointmentSelect,
      });
      await this.history.record(tx, 'RESCHEDULED', updated, {
        by: 'STAFF',
        from: current,
        to: updated,
      });
      return { before: current, after: updated };
    });
    if (!after) return toAppointment(before);
    await this.notices.send('appointment.changed', businessId, after.id);
    return toAppointment(after);
  }

  async cancel(
    businessId: string,
    actor: FirmActor,
    id: string,
    reason: string | null | undefined,
  ): Promise<Appointment> {
    const after = await this.write(businessId, async (tx) => {
      const current = await this.openForChange(tx, businessId, actor, id);
      const updated = await tx.appointment.update({
        where: { id: current.id },
        data: { status: 'CANCELLED', cancelledAt: new Date(), cancelReason: reason ?? null },
        select: appointmentSelect,
      });
      await this.history.record(tx, 'CANCELLED', updated, {
        by: 'STAFF',
        from: current,
        to: null,
        reason,
      });
      return updated;
    });
    return toAppointment(after);
  }

  /** Completed or a no-show: final, like a cancel. */
  async finish(
    businessId: string,
    actor: FirmActor,
    id: string,
    status: 'COMPLETED' | 'NO_SHOW',
  ): Promise<Appointment> {
    const after = await this.write(businessId, async (tx) => {
      const current = await this.openForChange(tx, businessId, actor, id);
      // Only once it has started: before that, a mistaken tap would close the slot for good.
      if (Date.now() < current.startsAt.getTime()) throw errors.notStarted();
      const updated = await tx.appointment.update({
        where: { id: current.id },
        data: { status },
        select: appointmentSelect,
      });
      await this.history.record(tx, status, updated, { by: 'STAFF', from: current, to: null });
      return updated;
    });
    return toAppointment(after);
  }
}
