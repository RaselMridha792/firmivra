import { Inject, Injectable } from '@nestjs/common';
import type { Database, Prisma, TxClient } from '@firmivra/db';
import type { AppointmentRecord, MemberRef } from '@firmivra/types';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import { DATABASE } from '../database/database.module.js';
import { AppointmentHistory } from './appointment-history.service.js';
import { AppointmentNotices } from './appointment-notices.js';
import { endsInCalendar } from './appointments.service.js';
import { usableTimeZone } from './calendar.js';
import { activeMember, type FirmActor, firmTimeZone } from './calendar-data.js';
import { lockAppointment, lockForBooking, retryWhenBusy } from './calendar-locks.js';
import {
  type Candidate,
  conflictSpan,
  loadConflictData,
  toResult,
} from './scheduling-conflicts.js';
import { findSchedulingRow, type SchedulingRow, toRecord } from './scheduling-data.js';
import { errors, isSlotConflict, isUniqueViolation } from './errors.js';
import {
  detailsAfterStaffChange,
  linkOf,
  MEETING_LINKS,
  type MeetingLinkStore,
} from './meeting-links.js';
import {
  colorFromHex,
  locationKindOf,
  MAX_REMINDER_OFFSET,
  reminderOffset,
  versionOf,
} from './scheduling-map.js';
import { expandRecurrence } from './scheduling-recurrence.js';
import type { DetailsBody, ScheduleBody } from './scheduling.input.js';
import { MINUTE } from './calendar.js';

type Schedule = z.output<typeof ScheduleBody>;
type Details = z.output<typeof DetailsBody>;
type Reminder = Schedule['reminders'][number];

/** The video integrations that count as "connected" (see SchedulingReadService.options). */
const VIDEO_PROVIDERS = ['zoom', 'microsoft_teams', 'teams', 'google_meet'];
const HOUR = 60 * MINUTE;
/** An inactive location (Settings > Locations) keeps its appointments but takes no new times. */
const inactiveOffice = () =>
  errors.unsupported('This location is inactive. Choose an active location.');

const placed = (a: { startsAt: Date; endsAt: Date; staffUserId: string }) => ({
  startsAt: a.startsAt,
  endsAt: a.endsAt,
  staffUserId: a.staffUserId,
});

/**
 * Schedule Appointment, Edit Existing and Confirm (contract in
 * packages/types/src/appointments/scheduling.ts). The same appointment records and history as
 * R12's calendar. Owner and Admin change every appointment; Staff only the ones they see in full
 * (404 otherwise) and book only for clients assigned to them. The conflict check runs first: hard
 * conflicts (a staff member, client or room already booked, blocked time) are always 409
 * SCHEDULING_CONFLICT; working hours and buffers can be overridden with a reason by Owner and
 * Admin (audited). The database refuses double booking whatever the check saw (409 SLOT_TAKEN).
 * Audit rows hold ids, times and field names only: never names, notes, instructions or links.
 */
@Injectable()
export class SchedulingWriteService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly audit: AuditService,
    private readonly history: AppointmentHistory,
    private readonly notices: AppointmentNotices,
    @Inject(MEETING_LINKS) private readonly links: MeetingLinkStore,
  ) {}

  private inFirm<T>(businessId: string, fn: (tx: TxClient) => Promise<T>): Promise<T> {
    return this.database.withScope({ kind: 'business', businessId }, fn);
  }

  /** A calendar change in one transaction, tried again while a calendar lock is busy. */
  private async write<T>(businessId: string, fn: (tx: TxClient) => Promise<T>): Promise<T> {
    try {
      return await retryWhenBusy(() => this.inFirm(businessId, fn));
    } catch (e) {
      if (isSlotConflict(e)) throw errors.slotTaken();
      throw e;
    }
  }

  /** The record as the screens show it, read inside the caller's transaction. */
  private async recordIn(
    tx: TxClient,
    businessId: string,
    actor: FirmActor,
    id: string,
  ): Promise<AppointmentRecord> {
    const row = await findSchedulingRow(tx, businessId, actor, id);
    if (!row) throw errors.notFound();
    return toRecord(
      row,
      await firmTimeZone(tx, businessId),
      await this.history.events(tx, businessId, row),
    );
  }

  /** The appointment to change, row locked: in full for this member (else 404) and still open. */
  private async openForChange(
    tx: TxClient,
    businessId: string,
    actor: FirmActor,
    id: string,
  ): Promise<SchedulingRow> {
    await lockAppointment(tx, businessId, id);
    const row = await findSchedulingRow(tx, businessId, actor, id);
    if (!row) throw errors.notFound();
    if (row.status !== 'SCHEDULED') throw errors.closed();
    return row;
  }

  // ---------- Schedule ----------

  async schedule(businessId: string, actor: FirmActor, body: Schedule): Promise<AppointmentRecord> {
    const replay = await this.replay(businessId, actor, body.idempotencyKey);
    if (replay) return replay;
    let created: { record: AppointmentRecord; firstId: string };
    try {
      created = await this.write(businessId, (tx) => this.createIn(tx, businessId, actor, body));
    } catch (e) {
      // Two requests with one key at once: the loser reads the winner's appointment.
      if (isUniqueViolation(e)) {
        const again = await this.replay(businessId, actor, body.idempotencyKey);
        if (again) return again;
      }
      throw e;
    }
    if (body.sendConfirmation) {
      await this.notices.send('appointment.booked', businessId, created.firstId);
    }
    return created.record;
  }

  /** A retry of the same booking returns the first one (idempotencyKey); null when it is new. */
  private async replay(
    businessId: string,
    actor: FirmActor,
    key: string,
  ): Promise<AppointmentRecord | null> {
    return this.inFirm(businessId, async (tx) => {
      const first = await tx.appointment.findFirst({
        where: { businessId, idempotencyKey: key },
        select: { id: true },
      });
      return first ? this.recordIn(tx, businessId, actor, first.id) : null;
    });
  }

  private async createIn(
    tx: TxClient,
    businessId: string,
    actor: FirmActor,
    body: Schedule,
  ): Promise<{ record: AppointmentRecord; firstId: string }> {
    const client = await this.clientFor(tx, businessId, actor, body.contact);
    if (body.staffUserIds.length > 1) {
      throw errors.unsupported('An appointment has one staff member for now. Choose one.');
    }
    const staffUserId = body.staffUserIds[0];
    if (!staffUserId) throw errors.unsupported('Choose a staff member');
    const staff = await activeMember(tx, businessId, staffUserId);
    const type = await tx.appointmentType.findFirst({
      where: { businessId, id: body.typeId },
      select: {
        id: true,
        archivedAt: true,
        bufferBeforeMinutes: true,
        bufferAfterMinutes: true,
        serviceId: true,
      },
    });
    if (!type) throw errors.notFound();
    if (type.archivedAt) throw errors.typeArchived();
    const serviceId = body.serviceId === undefined ? type.serviceId : body.serviceId;
    if (serviceId) await this.requireService(tx, businessId, serviceId);
    const kind = locationKindOf(body.method);
    if (!kind) {
      throw errors.unsupported('The "Other" meeting method is not available yet. Choose another.');
    }
    this.requireSupported(body.related, body.recurrence);
    const timeZone = await this.zoneFor(tx, businessId, body.timezone);
    const first = { start: Date.parse(body.startsAt), end: Date.parse(body.endsAt) };
    this.requireLength(first, body.allDay);
    endsInCalendar(first.end);
    const expansion = expandRecurrence(
      timeZone ?? (await firmTimeZone(tx, businessId)),
      first,
      body.recurrence,
    );
    if (!expansion.ok) throw errors.unsupported(expansion.message);
    for (const o of expansion.occurrences) endsInCalendar(o.end);
    const color = body.color ? this.colorOf(body.color) : null;
    const place = await this.placeFor(tx, businessId, kind, body.officeId, body.roomId);
    const reminders = await this.remindersFor(tx, businessId, body.reminders, client.phone);

    await lockForBooking(tx, businessId, staff.userId, client.id);
    const location = await this.locationOf(tx, businessId, kind, staff.userId, {
      details: body.details,
      videoUrl: body.videoUrl,
      generate: body.generateVideoLink,
    });
    await this.checkConflicts(tx, businessId, actor, {
      staff: [staff],
      candidate: {
        staffUserIds: [staff.userId],
        occurrences: expansion.occurrences,
        allDay: body.allDay,
        clientId: client.id,
        roomId: place.roomId,
        bufferBeforeMinutes: type.bufferBeforeMinutes,
        bufferAfterMinutes: type.bufferAfterMinutes,
      },
      override: body.overrideConflicts?.reason,
    });

    const repeats = expansion.occurrences.length > 1;
    const series =
      repeats &&
      body.recurrence &&
      body.recurrence.frequency !== 'NONE' &&
      body.recurrence.frequency !== 'CUSTOM'
        ? await tx.appointmentSeries.create({
            data: {
              businessId,
              frequency: body.recurrence.frequency,
              intervalCount: body.recurrence.interval ?? 1,
              byWeekdays:
                body.recurrence.frequency === 'WEEKLY' ? (body.recurrence.weekdays ?? []) : [],
              untilDate: body.recurrence.until
                ? new Date(`${body.recurrence.until}T00:00:00Z`)
                : null,
              occurrenceCount: body.recurrence.count ?? null,
              timeZone: timeZone ?? (await firmTimeZone(tx, businessId)),
              createdByUserId: actor.userId,
            },
            select: { id: true },
          })
        : null;

    const confirmedAt = body.status === 'CONFIRMED' ? new Date() : null;
    let firstId = '';
    for (const [index, slot] of expansion.occurrences.entries()) {
      const row = await tx.appointment.create({
        data: {
          businessId,
          clientId: client.id,
          staffUserId: staff.userId,
          typeId: type.id,
          serviceId,
          startsAt: new Date(slot.start),
          endsAt: new Date(slot.end),
          timeZone,
          allDay: body.allDay,
          locationKind: kind,
          locationDetails: location,
          officeId: place.officeId,
          roomId: place.roomId,
          color,
          internalNotes: body.internalNotes ?? null,
          clientInstructions: body.clientInstructions ?? null,
          confirmedAt,
          // Only the first carries the key (unique per firm): a retry returns it.
          idempotencyKey: index === 0 ? body.idempotencyKey : null,
          seriesId: series?.id ?? null,
          bufferBeforeMinutes: type.bufferBeforeMinutes,
          bufferAfterMinutes: type.bufferAfterMinutes,
          bookedByUserId: actor.userId,
          bookedByClient: false,
        },
        select: { id: true, clientId: true, startsAt: true, endsAt: true, staffUserId: true },
      });
      if (index === 0) firstId = row.id;
      if (reminders.length > 0) {
        await tx.appointmentReminder.createMany({
          data: reminders.map((r) => ({
            businessId,
            appointmentId: row.id,
            channel: r.channel,
            offsetMinutes: r.offsetMinutes,
          })),
        });
      }
      await this.history.record(tx, 'BOOKED', row, { by: 'STAFF', from: null, to: placed(row) });
    }
    if (series) {
      await this.audit.logIn(
        tx,
        'appointment.series_created',
        { type: 'appointment_series', id: series.id },
        { clientId: client.id, occurrences: expansion.occurrences.length },
      );
    }
    return { record: await this.recordIn(tx, businessId, actor, firstId), firstId };
  }

  // ---------- Edit Existing ----------

  async updateDetails(
    businessId: string,
    actor: FirmActor,
    id: string,
    body: Details,
  ): Promise<AppointmentRecord> {
    const outcome = await this.write(businessId, async (tx) => {
      const current = await this.openForChange(tx, businessId, actor, id);
      if (
        body.contact &&
        !(body.contact.kind === 'CLIENT' && body.contact.id === current.clientId)
      ) {
        throw errors.unsupported(
          'The client of an appointment cannot change. Cancel it and schedule a new one.',
        );
      }
      this.requireSupported(body.related, body.recurrence);

      const data: Prisma.AppointmentUncheckedUpdateInput = {};
      const fields = new Set<string>();
      const set = <K extends keyof Prisma.AppointmentUncheckedUpdateInput>(
        field: string,
        key: K,
        value: Prisma.AppointmentUncheckedUpdateInput[K],
        same: boolean,
      ) => {
        if (same) return;
        data[key] = value;
        fields.add(field);
      };

      let staffUserId = current.staffUserId;
      if (body.staffUserIds !== undefined) {
        if (body.staffUserIds.length > 1) {
          throw errors.unsupported('An appointment has one staff member for now. Choose one.');
        }
        const wanted = body.staffUserIds[0];
        if (!wanted) throw errors.unsupported('Choose a staff member');
        if (wanted !== current.staffUserId.toLowerCase())
          await activeMember(tx, businessId, wanted);
        staffUserId = wanted;
      }
      const staff = await activeMember(tx, businessId, staffUserId);

      let buffers = {
        before: current.bufferBeforeMinutes,
        after: current.bufferAfterMinutes,
      };
      if (body.typeId !== undefined && body.typeId !== current.typeId) {
        const type = await tx.appointmentType.findFirst({
          where: { businessId, id: body.typeId },
          select: {
            id: true,
            archivedAt: true,
            bufferBeforeMinutes: true,
            bufferAfterMinutes: true,
          },
        });
        if (!type) throw errors.notFound();
        if (type.archivedAt) throw errors.typeArchived();
        buffers = { before: type.bufferBeforeMinutes, after: type.bufferAfterMinutes };
        set('type', 'typeId', type.id, false);
        set('buffers', 'bufferBeforeMinutes', buffers.before, false);
        set('buffers', 'bufferAfterMinutes', buffers.after, false);
      }
      if (body.serviceId !== undefined) {
        if (body.serviceId) await this.requireService(tx, businessId, body.serviceId);
        set('service', 'serviceId', body.serviceId, body.serviceId === current.serviceId);
      }

      const start = body.startsAt ? Date.parse(body.startsAt) : current.startsAt.getTime();
      const end = body.endsAt ? Date.parse(body.endsAt) : current.endsAt.getTime();
      const allDay = body.allDay ?? current.allDay;
      if (end <= start) throw errors.unsupported('End time must be after the start');
      this.requireLength({ start, end }, allDay);
      endsInCalendar(end);
      const timeChanged = start !== current.startsAt.getTime() || end !== current.endsAt.getTime();
      if (timeChanged) {
        set('time', 'startsAt', new Date(start), false);
        set('time', 'endsAt', new Date(end), false);
      }
      set('allDay', 'allDay', allDay, allDay === current.allDay);
      if (body.timezone !== undefined) {
        const zone = await this.zoneFor(tx, businessId, body.timezone);
        set('timezone', 'timeZone', zone, zone === current.timeZone);
      }

      const kind = body.method ? locationKindOf(body.method) : current.locationKind;
      if (!kind) {
        throw errors.unsupported(
          'The "Other" meeting method is not available yet. Choose another.',
        );
      }
      const kindChanged = kind !== current.locationKind;
      set('method', 'locationKind', kind, !kindChanged);

      // The office and room only belong to an in-person appointment (the database checks it).
      let roomId = current.roomId;
      if (body.officeId !== undefined || body.roomId !== undefined || kind !== 'IN_PERSON') {
        const wantedOffice =
          kind !== 'IN_PERSON'
            ? null
            : body.officeId === undefined
              ? current.officeId
              : body.officeId;
        const wantedRoom =
          kind !== 'IN_PERSON'
            ? null
            : body.roomId === undefined
              ? body.officeId === undefined
                ? current.roomId
                : null
              : body.roomId;
        const place = await this.placeFor(
          tx,
          businessId,
          kind,
          wantedOffice,
          wantedRoom,
          timeChanged ? null : current.officeId,
        );
        roomId = place.roomId;
        set('place', 'officeId', place.officeId, place.officeId === current.officeId);
        set('place', 'roomId', roomId, roomId === current.roomId);
      } else if (timeChanged && current.officeId) {
        // Moved to another time at its own office: an inactive location takes no new times.
        const office = await tx.firmOffice.findFirst({
          where: { businessId, id: current.officeId },
          select: { status: true },
        });
        if (office?.status === 'INACTIVE') throw inactiveOffice();
      }

      const location = await this.locationAfter(tx, businessId, current, kind, staff.userId, body);
      set('location', 'locationDetails', location, location === current.locationDetails);

      if (body.status !== undefined) {
        const confirmed = body.status === 'CONFIRMED';
        set(
          'status',
          'confirmedAt',
          confirmed ? (current.confirmedAt ?? new Date()) : null,
          confirmed === (current.confirmedAt !== null),
        );
      }
      if (body.color !== undefined) {
        const color = body.color ? this.colorOf(body.color) : null;
        set('color', 'color', color, color === current.color);
      }
      if (body.internalNotes !== undefined) {
        set(
          'internalNotes',
          'internalNotes',
          body.internalNotes,
          body.internalNotes === current.internalNotes,
        );
      }
      if (body.clientInstructions !== undefined) {
        set(
          'clientInstructions',
          'clientInstructions',
          body.clientInstructions,
          body.clientInstructions === current.clientInstructions,
        );
      }
      if (staffUserId !== current.staffUserId) set('staff', 'staffUserId', staffUserId, false);

      const remindersChanged =
        body.reminders !== undefined &&
        (await this.replaceReminders(tx, businessId, current, body.reminders));
      if (remindersChanged) fields.add('reminders');
      // After the lookups above, so an id of another firm is 404 before a stale version is 409.
      if (body.version !== versionOf(current.updatedAt)) throw errors.saveConflict();
      if (fields.size === 0)
        return { record: await this.recordIn(tx, businessId, actor, id), notify: false };

      const moved = timeChanged || staffUserId !== current.staffUserId;
      const roomOrPlaceMoved = roomId !== current.roomId;
      if (moved || roomOrPlaceMoved || kindChanged || fields.has('buffers')) {
        await lockForBooking(tx, businessId, staffUserId, current.clientId);
        await this.checkConflicts(tx, businessId, actor, {
          staff: [staff],
          candidate: {
            staffUserIds: [staff.userId],
            occurrences: [{ start, end }],
            allDay,
            clientId: current.clientId,
            roomId,
            bufferBeforeMinutes: buffers.before,
            bufferAfterMinutes: buffers.after,
            exceptId: current.id,
          },
          override: body.overrideConflicts?.reason,
        });
      }
      const updated = await tx.appointment.update({
        where: { id: current.id },
        data: { ...data, updatedAt: new Date() },
        select: { id: true, clientId: true, startsAt: true, endsAt: true, staffUserId: true },
      });
      if (moved) {
        await this.history.record(tx, 'RESCHEDULED', updated, {
          by: 'STAFF',
          from: placed(current),
          to: placed(updated),
        });
      }
      await this.audit.logIn(
        tx,
        'appointment.details_updated',
        { type: 'appointment', id: current.id },
        { clientId: current.clientId, fields: [...fields].sort() },
      );
      // The client hears about a new time, staff member, place or link; not about notes or colour.
      const notify = moved || fields.has('place') || fields.has('location') || fields.has('method');
      return { record: await this.recordIn(tx, businessId, actor, id), notify };
    });
    if (outcome.notify) {
      await this.notices.send('appointment.changed', businessId, id);
    }
    return outcome.record;
  }

  // ---------- Confirm ----------

  async confirm(businessId: string, actor: FirmActor, id: string): Promise<AppointmentRecord> {
    return this.write(businessId, async (tx) => {
      const current = await this.openForChange(tx, businessId, actor, id);
      if (!current.confirmedAt) {
        await tx.appointment.update({
          where: { id: current.id },
          data: { confirmedAt: new Date(), updatedAt: new Date() },
          select: { id: true },
        });
        await this.audit.logIn(
          tx,
          'appointment.confirmed',
          { type: 'appointment', id: current.id },
          { clientId: current.clientId },
        );
      }
      return this.recordIn(tx, businessId, actor, id);
    });
  }

  // ---------- Pieces ----------

  /** The client to book: an existing one the member may see; leads and new contacts need a schema change. */
  private async clientFor(
    tx: TxClient,
    businessId: string,
    actor: FirmActor,
    contact: Schedule['contact'],
  ): Promise<{ id: string; phone: string | null }> {
    let clientId: string;
    if (contact.kind === 'CLIENT') {
      clientId = contact.id;
    } else if (contact.kind === 'LEAD') {
      // A lead that became a client books as that client; any other has no client to book for.
      const lead = await tx.lead.findFirst({
        where: { businessId, id: contact.id },
        select: { clientId: true },
      });
      if (!lead) throw errors.notFound();
      if (!lead.clientId) {
        throw errors.unsupported(
          'Appointments for leads are not available yet. Convert the lead to a client first.',
        );
      }
      clientId = lead.clientId;
    } else {
      throw errors.unsupported(
        'Appointments for a new contact are not available yet. Create the client first.',
      );
    }
    // FOR SHARE: an archive or a reassignment of the client waits for this booking (as R12's book()).
    const [row] = await tx.$queryRaw<
      {
        id: string;
        archived_at: Date | null;
        assigned_user_id: string | null;
        phone: string | null;
      }[]
    >`
      SELECT id::text AS id, archived_at, assigned_user_id::text AS assigned_user_id, phone
      FROM clients WHERE business_id = ${businessId}::uuid AND id = ${clientId}::uuid
      FOR SHARE`;
    if (!row) throw errors.notFound();
    if (actor.role === 'STAFF' && row.assigned_user_id !== actor.userId.toLowerCase()) {
      throw errors.notFound();
    }
    if (row.archived_at) throw errors.clientArchived();
    return { id: row.id, phone: row.phone };
  }

  private async requireService(tx: TxClient, businessId: string, serviceId: string): Promise<void> {
    const service = await tx.service.findFirst({
      where: { businessId, id: serviceId },
      select: { id: true },
    });
    if (!service) throw errors.notFound();
  }

  /** What the form can send but the database cannot keep yet: refused, never dropped silently. */
  private requireSupported(related: Schedule['related'], recurrence: Schedule['recurrence']): void {
    if (related && Object.values(related).some((v) => v !== null && v !== undefined)) {
      throw errors.unsupported(
        'Related items (tax return, invoice, task, intake form, documents) cannot be saved yet.',
      );
    }
    if (recurrence?.frequency === 'CUSTOM') {
      throw errors.unsupported(
        'Custom repeats are not available yet. Choose daily, weekly or monthly.',
      );
    }
  }

  /** An IANA name the database accepts, else 400; null leaves the firm's time zone. */
  private async zoneFor(
    tx: TxClient,
    businessId: string,
    timezone: string | undefined,
  ): Promise<string | null> {
    if (timezone === undefined) return null;
    if (
      !/^[A-Za-z_]+(\/[A-Za-z0-9_+-]+){1,2}$/.test(timezone) ||
      usableTimeZone(timezone) !== timezone
    ) {
      throw errors.unsupported('Choose a valid time zone');
    }
    // Same as the firm's: keep it empty, so a later change of the firm's zone applies.
    return timezone === (await firmTimeZone(tx, businessId)) ? null : timezone;
  }

  private colorOf(hex: string): NonNullable<ReturnType<typeof colorFromHex>> {
    const color = colorFromHex(hex);
    if (!color) throw errors.unsupported('Choose one of the calendar colours');
    return color;
  }

  /** The database's range rule: 12 hours, or up to 25 for an all-day entry. */
  private requireLength(span: { start: number; end: number }, allDay: boolean): void {
    const limit = allDay ? 25 * HOUR : 12 * HOUR;
    if (span.end - span.start > limit) {
      throw errors.unsupported(
        allDay ? 'An all-day entry is at most 25 hours' : 'An appointment is at most 12 hours',
      );
    }
  }

  /**
   * The office and room, from this firm and not archived; only for an in-person meeting. An
   * INACTIVE location (Settings > Locations) takes no new or moved booking: only `keepOfficeId`,
   * the appointment's own office when neither it nor the time changes, may stay inactive.
   */
  private async placeFor(
    tx: TxClient,
    businessId: string,
    kind: 'IN_PERSON' | 'PHONE' | 'VIDEO',
    officeId: string | null | undefined,
    roomId: string | null | undefined,
    keepOfficeId: string | null = null,
  ): Promise<{ officeId: string | null; roomId: string | null }> {
    if (!officeId && !roomId) return { officeId: null, roomId: null };
    if (kind !== 'IN_PERSON') {
      throw errors.unsupported('An office and room are for in-person appointments');
    }
    if (!officeId) throw errors.unsupported('Choose the office of the room');
    const office = await tx.firmOffice.findFirst({
      where: { businessId, id: officeId, archivedAt: null },
      select: { id: true, status: true },
    });
    if (!office) throw errors.notFound();
    if (office.status !== 'ACTIVE' && office.id !== keepOfficeId) throw inactiveOffice();
    if (roomId) {
      const room = await tx.firmRoom.findFirst({
        where: { businessId, officeId, id: roomId, archivedAt: null },
        select: { id: true },
      });
      if (!room) throw errors.notFound();
    }
    return { officeId, roomId: roomId ?? null };
  }

  private async hasVideoIntegration(tx: TxClient, businessId: string): Promise<boolean> {
    const found = await tx.integrationConnection.findFirst({
      where: {
        businessId,
        provider: { in: VIDEO_PROVIDERS },
        status: 'CONNECTED',
        disconnectedAt: null,
      },
      select: { id: true },
    });
    return found !== null;
  }

  /**
   * The location details of a new appointment. VIDEO: the typed address, else (Generate Link) the
   * staff member's own link when a video integration is connected, else the staff member's link
   * as R12 gives it. No video integration connected: Generate Link is 409 VIDEO_NOT_CONNECTED.
   */
  private async locationOf(
    tx: TxClient,
    businessId: string,
    kind: 'IN_PERSON' | 'PHONE' | 'VIDEO',
    staffUserId: string,
    input: {
      details: string | null | undefined;
      videoUrl: string | null | undefined;
      generate: boolean;
    },
  ): Promise<string | null> {
    if (kind !== 'VIDEO') return input.details ?? null;
    if (input.generate && !(await this.hasVideoIntegration(tx, businessId))) {
      throw errors.videoNotConnected();
    }
    return (
      input.videoUrl ?? input.details ?? (await linkOf(this.links, tx, businessId, staffUserId))
    );
  }

  /** The location details after an edit; unchanged unless the form sent something for them. */
  private async locationAfter(
    tx: TxClient,
    businessId: string,
    current: SchedulingRow,
    kind: 'IN_PERSON' | 'PHONE' | 'VIDEO',
    staffUserId: string,
    body: Details,
  ): Promise<string | null> {
    const sent =
      body.videoUrl !== undefined || body.details !== undefined || body.generateVideoLink === true;
    if (
      kind === 'VIDEO' &&
      body.generateVideoLink &&
      !(await this.hasVideoIntegration(tx, businessId))
    ) {
      throw errors.videoNotConnected();
    }
    if (kind !== current.locationKind) {
      return this.locationOf(tx, businessId, kind, staffUserId, {
        details: body.details,
        videoUrl: body.videoUrl,
        generate: false,
      });
    }
    if (sent) {
      if (kind === 'VIDEO') {
        const typed = body.videoUrl !== undefined ? body.videoUrl : body.details;
        return typed ?? (await linkOf(this.links, tx, businessId, staffUserId));
      }
      return body.details ?? null;
    }
    // Another staff member: their link when the details were the previous member's.
    return detailsAfterStaffChange(this.links, tx, businessId, current, staffUserId);
  }

  /** Reminders as rows: offsets in range, no repeats, and SMS only when it can be sent. */
  private async remindersFor(
    tx: TxClient,
    businessId: string,
    reminders: readonly Reminder[],
    phone: string | null,
  ): Promise<{ channel: Reminder['channel']; offsetMinutes: number }[]> {
    const rows = new Map<string, { channel: Reminder['channel']; offsetMinutes: number }>();
    for (const r of reminders) {
      const offsetMinutes = reminderOffset(r);
      if (offsetMinutes === null) {
        throw errors.unsupported(
          `A reminder is sent at most ${MAX_REMINDER_OFFSET / 1440} days before`,
        );
      }
      rows.set(`${r.channel}:${offsetMinutes}`, { channel: r.channel, offsetMinutes });
    }
    const list = [...rows.values()];
    if (list.some((r) => r.channel === 'SMS')) {
      const settings = await tx.messageSettings.findUnique({
        where: { businessId },
        select: { smsEnabled: true },
      });
      if (!settings?.smsEnabled || !phone) throw errors.smsUnavailable();
    }
    return list;
  }

  /** Replaces the appointment's reminders; true when the set really changed. */
  private async replaceReminders(
    tx: TxClient,
    businessId: string,
    current: SchedulingRow,
    reminders: readonly Reminder[],
  ): Promise<boolean> {
    const client = await tx.client.findFirst({
      where: { businessId, id: current.clientId },
      select: { phone: true },
    });
    const next = await this.remindersFor(tx, businessId, reminders, client?.phone ?? null);
    const key = (r: { channel: string; offsetMinutes: number }) =>
      `${r.channel}:${r.offsetMinutes}`;
    const before = new Set(current.reminders.map(key));
    const after = new Set(next.map(key));
    if (before.size === after.size && [...before].every((k) => after.has(k))) return false;
    await tx.appointmentReminder.deleteMany({ where: { businessId, appointmentId: current.id } });
    if (next.length > 0) {
      await tx.appointmentReminder.createMany({
        data: next.map((r) => ({ businessId, appointmentId: current.id, ...r })),
      });
    }
    return true;
  }

  /**
   * The conflict check in the caller's transaction. Hard conflicts stop the change (409). Soft
   * ones (working hours, buffers) stop it unless an Owner or Admin gave a reason, which is
   * audited (the reason's text stays out of the log).
   */
  private async checkConflicts(
    tx: TxClient,
    businessId: string,
    actor: FirmActor,
    input: { staff: MemberRef[]; candidate: Candidate; override: string | undefined },
  ): Promise<void> {
    const timeZone = await firmTimeZone(tx, businessId);
    const data = await loadConflictData(
      tx,
      businessId,
      timeZone,
      input.staff,
      conflictSpan(input.candidate),
      input.candidate.clientId,
      input.candidate.roomId,
    );
    const { result, found } = toResult(data, input.candidate, actor);
    if (result.ok) return;
    if (!result.canOverride) throw errors.schedulingConflict(result);
    if (input.override === undefined) throw errors.schedulingConflict(result);
    await this.audit.logIn(
      tx,
      'appointment.conflict_overridden',
      { type: 'appointment' },
      { kinds: [...new Set(found.map((f) => f.kind))].sort(), reasonGiven: true },
    );
  }
}
