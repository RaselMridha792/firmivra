import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import type { Database, TxClient } from '@firmivra/db';
import {
  type Appointment,
  type AppointmentDetail,
  type AppointmentsQuery,
  type BookAppointmentRequest,
  type CalendarAppointment,
  LEAD_APPOINTMENT_OUTCOME_LABELS,
  type LeadAppointmentOutcome,
  type RescheduleAppointmentRequest,
  type SlotList,
  type SlotsQuery,
  type UpdateAppointmentRequest,
} from '@firmivra/types';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import { IntakeSendService } from '../intake-workspace/intake-send.service.js';
import { LeadFollowUpsService } from '../leads/lead-follow-ups.js';
import { Notifier } from '../notifications/notifier.js';
import { PermissionGrantsService } from '../roles/permission-grants.service.js';
import { returnReassignAuthority } from '../tax-returns/return-authority.js';
import { DATABASE } from '../database/database.module.js';
import { AppointmentHistory } from './appointment-history.service.js';
import { reachesLead } from './appointment-party.js';
import { AppointmentNotices } from './appointment-notices.js';
import { type CompleteBody as CompleteSchema, inCalendarYears } from './appointments.input.js';
import { freeStarts, MINUTE, zonedDate, zonedInstant } from './calendar.js';
import {
  activeMember,
  activeMembers,
  appointmentSelect,
  type AppointmentRow,
  busyTimes,
  clientBusy,
  clientsBusy,
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
import { appendInternalNote } from './scheduling-actions.service.js';
import { typeMethods } from './scheduling-map.js';
import {
  detailsAfterStaffChange,
  linkOf,
  MEETING_LINKS,
  type MeetingLinkStore,
} from './meeting-links.js';

type ListQuery = z.output<typeof AppointmentsQuery>;
type SlotsQ = z.output<typeof SlotsQuery>;
type BookBody = z.output<typeof BookAppointmentRequest>;
type RescheduleBody = z.output<typeof RescheduleAppointmentRequest>;
type UpdateBody = z.output<typeof UpdateAppointmentRequest>;
type CompleteBody = z.output<typeof CompleteSchema>;

/** P4-2: a follow-up from an appointment's outcome is due at 10:00 that day (as the Lead page). */
const FOLLOW_UP_MINUTES = 10 * 60;

const iso = (ms: number) => new Date(ms).toISOString();

/**
 * The firm's calendar (contract in packages/types/src/appointments). Owner and Admin see and
 * change every appointment. Staff see in full their own and their assigned clients'
 * appointments, every other one as Busy, and get 404 for anything else about those; they book
 * only for clients assigned to them. Firm users change appointments at any time (no client
 * cutoff). The database refuses double booking and blocked time (409 SLOT_TAKEN). An
 * appointment of a type meets in one of the type's meeting methods (A1): booking it or changing
 * its method takes one of them (400 at `locationKind`), and a method the type stopped offering
 * stays until it is changed. Reads and changes are audited; the changes are the appointment's
 * history.
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
    @Inject(MEETING_LINKS) private readonly links: MeetingLinkStore,
    private readonly grants: PermissionGrantsService,
    private readonly notifier: Notifier,
    private readonly leadFollowUps: LeadFollowUpsService,
    private readonly intakes: IntakeSendService,
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
    const items = rows.map((row): CalendarAppointment => {
      if (!seesInFull(actor, row)) return toBusy(row);
      const a = toAppointment(row);
      // P4-2: whether this member may convert the lead (Convert to New client when completing).
      const lead = a.lead && row.lead ? { ...a.lead, reach: reachesLead(actor, row.lead) } : a.lead;
      return { ...a, lead, restricted: false };
    });
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
      // Rescheduling: Staff may exclude only an appointment they see in full (else 404). The move
      // keeps its own length (reschedule does), and its client's other appointments are taken.
      const moving = q.excludeAppointmentId
        ? await this.findInFull(tx, businessId, actor, q.excludeAppointmentId)
        : null;
      // Booking for a client: Staff only for their own clients (else 404), as booking it.
      if (q.clientId && actor.role === 'STAFF') {
        const mine = await tx.client.findFirst({
          where: { businessId, id: q.clientId, assignedUserId: actor.userId },
          select: { id: true },
        });
        if (!mine) throw errors.notFound();
      }
      const clientId = moving?.clientId ?? q.clientId;
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
        minutes: moving
          ? (moving.endsAt.getTime() - moving.startsAt.getTime()) / MINUTE
          : type.durationMinutes,
        notBefore: Date.now(),
      };
      // A1: a new time for a group appointment suits each attendee too.
      const people = clientId
        ? [clientId, ...(moving?.attendees.map((x) => x.clientId) ?? [])]
        : [];
      const clients = people.flatMap((c) => clientBusy(busy, c, q.excludeAppointmentId));
      const slots = members.flatMap((staff) =>
        freeStarts(query, hours.get(staff.userId) ?? [], [
          ...memberBusy(busy, staff.userId, q.excludeAppointmentId),
          ...clients,
        ]).map((s) => ({ startsAt: iso(s.start), endsAt: iso(s.end), staff })),
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
            select: {
              id: true,
              durationMinutes: true,
              locationKind: true,
              meetingMethods: true,
              archivedAt: true,
            },
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
      // With a type: one of its meeting methods, its first when none is chosen (A1).
      const methods = type ? typeMethods(type) : null;
      const locationKind = body.locationKind ?? methods?.[0] ?? 'VIDEO';
      if (methods && !methods.includes(locationKind)) {
        throw errors.methodNotOffered('locationKind');
      }
      // A VIDEO appointment booked without details gets the staff member's link (R14).
      const locationDetails =
        body.locationDetails ??
        (locationKind === 'VIDEO'
          ? await linkOf(this.links, tx, businessId, body.staffUserId)
          : null);
      await lockForBooking(tx, businessId, body.staffUserId, client.id);
      // A1: not while the client attends another appointment (the database sees only their own).
      const span = { start: startsAt.getTime(), end: startsAt.getTime() + minutes * MINUTE };
      if (await clientsBusy(tx, businessId, [client.id], span)) throw errors.slotTaken();
      const created = await tx.appointment.create({
        data: {
          businessId,
          clientId: client.id,
          staffUserId: body.staffUserId,
          typeId: type?.id ?? null,
          engagementId: body.engagementId ?? null,
          startsAt,
          endsAt: new Date(startsAt.getTime() + minutes * MINUTE),
          locationKind,
          locationDetails,
          bookedByUserId: actor.userId,
          bookedByClient: false,
        },
        select: appointmentSelect,
      });
      await this.history.record(tx, 'BOOKED', created, { by: 'STAFF', from: null, to: created });
      return created;
    });
    await this.notices.send('appointment.booked', businessId, row.id);
    // A9: the type's required intake form goes to the client.
    await this.intakes.sendForAppointment(businessId, row.id, actor.userId);
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
      if (!sameStaff) {
        await activeMember(tx, businessId, staffUserId);
        // TX-F18: an appointment of a tax return's engagement moves to another member only by the
        // return's own people, or the Owner or Admin override (recorded).
        const authority = await returnReassignAuthority(
          tx,
          this.grants,
          businessId,
          actor,
          current.engagementId,
        );
        if (authority === 'override')
          await this.audit.logIn(
            tx,
            'appointment.reassigned_override',
            { type: 'appointment', id: current.id },
            { staffUserId },
          );
      }
      const startsAt = new Date(body.startsAt);
      if (startsAt.getTime() === current.startsAt.getTime() && sameStaff) {
        return { before: current, after: null };
      }
      const length = current.endsAt.getTime() - current.startsAt.getTime();
      endsInCalendar(startsAt.getTime() + length);
      const locationDetails = await detailsAfterStaffChange(
        this.links,
        tx,
        businessId,
        current,
        staffUserId,
      );
      const attendees = current.attendees.map((a) => a.clientId);
      await lockForBooking(tx, businessId, staffUserId, current.clientId, attendees);
      // A1: the new time suits the client and each attendee (the database sees only the client's
      // own appointments).
      const span = { start: startsAt.getTime(), end: startsAt.getTime() + length };
      if (await clientsBusy(tx, businessId, [current.clientId, ...attendees], span, current.id)) {
        throw errors.slotTaken();
      }
      const updated = await tx.appointment.update({
        where: { id: current.id },
        data: {
          startsAt,
          endsAt: new Date(startsAt.getTime() + length),
          staffUserId,
          locationDetails,
        },
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

  /**
   * Edit location (R14): the kind and details only; the times stay. Nothing changed writes
   * nothing. Audited with the names of the fields that changed, never the details (a link can
   * carry a passcode); the client gets the 'changed' notice, which never holds them either.
   */
  async update(
    businessId: string,
    actor: FirmActor,
    id: string,
    body: UpdateBody,
  ): Promise<Appointment> {
    const { before, after } = await this.write(businessId, async (tx) => {
      const current = await this.openForChange(tx, businessId, actor, id);
      const locationKind = body.locationKind ?? current.locationKind;
      // A new method is one its type offers (A1); the one it has may stay.
      if (locationKind !== current.locationKind && current.typeId) {
        const type = await tx.appointmentType.findFirst({
          where: { businessId, id: current.typeId },
          select: { locationKind: true, meetingMethods: true },
        });
        if (type && !typeMethods(type).includes(locationKind)) {
          throw errors.methodNotOffered('locationKind');
        }
      }
      // Details left out: VIDEO gets the staff member's link; another kind keeps its details
      // unless the kind changes. Sent: null (or '') clears.
      let locationDetails = body.locationDetails ?? null;
      if (body.locationDetails === undefined) {
        if (locationKind === 'VIDEO') {
          locationDetails = await linkOf(this.links, tx, businessId, current.staffUserId);
        } else if (locationKind === current.locationKind) {
          locationDetails = current.locationDetails;
        }
      }
      const data = { locationKind, locationDetails };
      const fields = (['locationKind', 'locationDetails'] as const).filter(
        (field) => data[field] !== current[field],
      );
      if (fields.length === 0) return { before: current, after: null };
      const updated = await tx.appointment.update({
        where: { id: current.id },
        data,
        select: appointmentSelect,
      });
      await this.audit.logIn(
        tx,
        'appointment.location_changed',
        { type: 'appointment', id: current.id },
        { clientId: current.clientId, fields, detailsSet: data.locationDetails !== null },
      );
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
    // Appointments Review 2 (P3): the client is told, as the Cancel dialog says: a bell item and an
    // email to their primary login, with the reason given. Not for a time already past.
    if (after.startsAt.getTime() > Date.now()) {
      await this.notifier.notify({
        businessId,
        event: 'appointment.cancelled',
        recordId: after.id,
        actorUserId: actor.userId,
        eventKey: `appointment.cancelled:${after.id}`,
      });
    }
    return toAppointment(after);
  }

  /**
   * Completed or a no-show: final, like a cancel. P4-2 (Clients Review 2 N8-18): completing a
   * lead's own appointment (a lead, no client yet) records what came of it (CompleteBody), which a
   * client's appointment never takes (400 at `outcome`).
   */
  async finish(
    businessId: string,
    actor: FirmActor,
    id: string,
    status: 'COMPLETED' | 'NO_SHOW',
    body: CompleteBody = {},
  ): Promise<Appointment> {
    const after = await this.write(businessId, async (tx) => {
      const current = await this.openForChange(tx, businessId, actor, id);
      // Only once it has started: before that, a mistaken tap would close the slot for good.
      if (Date.now() < current.startsAt.getTime()) throw errors.notStarted();
      const leadId = current.clientId === null ? current.leadId : null;
      if (status === 'COMPLETED' && leadId && !body.outcome) {
        throw errors.invalidField('outcome', 'Choose what came of the appointment with this lead');
      }
      if (body.outcome && (status !== 'COMPLETED' || !leadId)) {
        throw errors.invalidField('outcome', 'Only an appointment with a lead has an outcome');
      }
      // The lead's Convert flow is its owner's: the appointment's own staff member who does not
      // reach the lead records Keep as Lead and Follow Up only (the lead's answer, Nov 18).
      if (body.outcome === 'CONVERT_NEW' && current.lead && !reachesLead(actor, current.lead)) {
        throw errors.leadOwnerConverts();
      }
      const updated = await tx.appointment.update({
        where: { id: current.id },
        data: { status },
        select: appointmentSelect,
      });
      await this.history.record(tx, status, updated, { by: 'STAFF', from: current, to: null });
      if (leadId && body.outcome) {
        await this.leadOutcome(tx, businessId, actor, current.id, leadId, {
          outcome: body.outcome,
          notes: body.notes ?? '',
          followUpOn: body.followUpOn ?? null,
        });
      }
      return updated;
    });
    return toAppointment(after);
  }

  /**
   * P4-2: what came of a lead's own appointment. The outcome and notes go on the appointment's own
   * notes and on the lead's timeline (a meeting, titled with the outcome, the notes as its text);
   * Keep as Lead and Follow Up sets the lead's next follow-up through Leads' own follow-up rules,
   * that day at 10:00 in the firm's time zone (the Lead page's default time). Nothing converts or
   * activates anyone here: Convert to New client is the lead's Convert flow, which staff open next.
   * The lead's status never changes. The audit row has the outcome code and the lead's id only.
   */
  private async leadOutcome(
    tx: TxClient,
    businessId: string,
    actor: FirmActor,
    appointmentId: string,
    leadId: string,
    result: { outcome: LeadAppointmentOutcome; notes: string; followUpOn: string | null },
  ): Promise<void> {
    const timeZone = await firmTimeZone(tx, businessId);
    const label = LEAD_APPOINTMENT_OUTCOME_LABELS[result.outcome];
    let followUpAt: number | null = null;
    if (result.outcome === 'KEEP_LEAD_FOLLOW_UP') {
      const day = result.followUpOn;
      if (!day) throw errors.invalidField('followUpOn', 'Choose the follow-up date');
      if (day < zonedDate(timeZone, Date.now())) {
        throw errors.invalidField('followUpOn', 'Choose today or a later date');
      }
      followUpAt = zonedInstant(timeZone, day, FOLLOW_UP_MINUTES);
    }
    const row = await tx.appointment.findFirstOrThrow({
      where: { businessId, id: appointmentId },
      select: { id: true, internalNotes: true },
    });
    const title = `Outcome: ${label}${result.followUpOn ? ` (follow up on ${result.followUpOn})` : ''}`;
    await appendInternalNote(tx, businessId, actor, row, `${title}. ${result.notes}`, timeZone);
    await tx.leadActivity.create({
      data: {
        businessId,
        leadId,
        kind: 'MEETING',
        actorUserId: actor.userId,
        summary: `Appointment completed: ${label}`,
        body: result.notes,
        metadata: { appointmentId, outcome: result.outcome },
      },
    });
    if (followUpAt !== null) {
      await this.leadFollowUps.addWithin(tx, businessId, actor.userId, leadId, {
        type: 'FOLLOW_UP',
        dueAt: new Date(followUpAt).toISOString(),
        notes: null,
      });
    }
    await this.audit.logIn(
      tx,
      'appointment.outcome_recorded',
      { type: 'appointment', id: appointmentId },
      { leadId, outcome: result.outcome },
    );
  }
}
