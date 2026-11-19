import { Inject, Injectable } from '@nestjs/common';
import type { Database, Prisma, TxClient } from '@firmivra/db';
import type { AppointmentRecord, MemberRef } from '@firmivra/types';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import { IntakeSendService } from '../intake-workspace/intake-send.service.js';
import { PermissionGrantsService } from '../roles/permission-grants.service.js';
import { returnReassignAuthority } from '../tax-returns/return-authority.js';
import { DATABASE } from '../database/database.module.js';
import { AppointmentHistory } from './appointment-history.service.js';
import { AppointmentNotices } from './appointment-notices.js';
import { endsInCalendar } from './appointments.service.js';
import { usableTimeZone } from './calendar.js';
import { activeMember, type FirmActor, firmTimeZone } from './calendar-data.js';
import { lockAppointment, lockEquipment, lockForBooking, retryWhenBusy } from './calendar-locks.js';
import {
  type Candidate,
  conflictSpan,
  loadConflictData,
  toResult,
} from './scheduling-conflicts.js';
import {
  attendeeClients,
  findSchedulingRow,
  type SchedulingRow,
  toRecord,
} from './scheduling-data.js';
import { errors, isEquipmentConflict, isSlotConflict, isUniqueViolation } from './errors.js';
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
  type StoredKind,
  typeMethods,
  versionOf,
} from './scheduling-map.js';
import { expandRecurrence } from './scheduling-recurrence.js';
import type { DetailsBody, ScheduleBody } from './scheduling.input.js';
import { MINUTE } from './calendar.js';
import { leadToBook } from './appointment-party.js';

type Schedule = z.output<typeof ScheduleBody>;
type Details = z.output<typeof DetailsBody>;
type Reminder = Schedule['reminders'][number];

/** The video integrations that count as "connected" (see SchedulingReadService.options). */
const VIDEO_PROVIDERS = ['zoom', 'microsoft_teams', 'teams', 'google_meet'];
const HOUR = 60 * MINUTE;
/** An inactive location (Settings > Locations) keeps its appointments but takes no new times. */
const inactiveOffice = () =>
  errors.unsupported('This location is inactive. Choose an active location.');

/** The form's method as a location kind (OTHER is an Other Video Meeting). */
const kindOf = (method: Schedule['method']): StoredKind => locationKindOf(method);

/**
 * Review 2 (P1 row 1): an Other Video Meeting's platform: the one sent, else `fallback` (the one
 * it has, or its type's); 400 at `otherVideoPlatform` with none. Null for any other method.
 */
function platformFor(
  kind: StoredKind,
  sent: string | null | undefined,
  fallback: string | null | undefined,
): string | null {
  if (kind !== 'OTHER_VIDEO') return null;
  const platform = sent || fallback || null;
  if (!platform) {
    throw errors.invalidField(
      'otherVideoPlatform',
      'Name the video platform of the Other Video Meeting, such as Google Meet',
    );
  }
  return platform;
}

/**
 * One request's last conflict check, kept to run again when the database refuses an item of
 * equipment a change outside these locks took meanwhile (Review 2, A2).
 */
interface Checked {
  actor: FirmActor;
  input?: { staff: MemberRef[]; candidate: Candidate };
}

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
 * conflicts (a staff member, client, room or item of equipment already booked, blocked time) are
 * always 409
 * SCHEDULING_CONFLICT; working hours and buffers can be overridden with a reason by Owner and
 * Admin (audited). The database refuses double booking whatever the check saw (409 SLOT_TAKEN).
 * The method is one of the type's meeting methods (A1) when booking and when the method or type
 * changes (400 at `method`); an appointment keeps a method its type stopped offering otherwise.
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
    private readonly grants: PermissionGrantsService,
    private readonly intakes: IntakeSendService,
  ) {}

  private inFirm<T>(businessId: string, fn: (tx: TxClient) => Promise<T>): Promise<T> {
    return this.database.withScope({ kind: 'business', businessId }, fn);
  }

  /**
   * A calendar change in one transaction, tried again while a calendar lock is busy. An item of
   * equipment the database refused runs the request's check again, so the 409 names it.
   */
  private async write<T>(
    businessId: string,
    fn: (tx: TxClient) => Promise<T>,
    checked?: Checked,
  ): Promise<T> {
    try {
      return await retryWhenBusy(() => this.inFirm(businessId, fn));
    } catch (e) {
      if (checked?.input && isEquipmentConflict(e)) {
        throw await this.recheck(businessId, checked.actor, checked.input);
      }
      if (isSlotConflict(e)) throw errors.slotTaken();
      throw e;
    }
  }

  /** The conflict check again, after the database refused the change: 409 with what it finds. */
  private async recheck(
    businessId: string,
    actor: FirmActor,
    input: { staff: MemberRef[]; candidate: Candidate },
  ): Promise<Error> {
    const result = await this.inFirm(businessId, async (tx) => {
      const data = await loadConflictData(
        tx,
        businessId,
        await firmTimeZone(tx, businessId),
        input.staff,
        conflictSpan(input.candidate),
        input.candidate.clientId,
        input.candidate.roomId,
        input.candidate.attendeeClientIds,
        input.candidate.equipmentIds,
        input.candidate.leadId ?? null,
      );
      return toResult(data, input.candidate, actor).result;
    });
    // A hard conflict now: nothing to override.
    return result.ok
      ? errors.slotTaken()
      : errors.schedulingConflict({ ...result, canOverride: false });
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
    const checked: Checked = { actor };
    try {
      created = await this.write(
        businessId,
        (tx) => this.createIn(tx, businessId, actor, body, checked),
        checked,
      );
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
    // A9: the intake form goes to the client (the first of a series only; the others would find
    // it open), and the record then shows it. Review 2 (row 9): the one the form chose, none when
    // it chose none (null), else the type's required form.
    const form = await this.intakes.sendForAppointment(
      businessId,
      created.firstId,
      actor.userId,
      body.related?.intakeFormId,
    );
    if (form && 'intakeId' in form) {
      return this.inFirm(businessId, (tx) => this.recordIn(tx, businessId, actor, created.firstId));
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
    checked: Checked,
  ): Promise<{ record: AppointmentRecord; firstId: string }> {
    // Review 2 (Save as Draft): the member's own draft goes with the booking (404 otherwise).
    if (body.draftId) {
      const gone = await tx.appointmentDraft.deleteMany({
        where: { businessId, id: body.draftId, createdByUserId: actor.userId },
      });
      if (!gone.count) throw errors.notFound();
    }
    const party = await this.partyFor(tx, businessId, actor, body.contact);
    // P4-1: a lead's own appointment (no client yet) is about the lead only.
    if (!party.clientId) this.requireLeadOnly(body);
    // A1: the other clients who attend (a group appointment), each booked as the client is.
    const attendees = await attendeeClients(
      tx,
      businessId,
      actor,
      party.clientId,
      body.attendeeClientIds,
    );
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
        name: true,
        archivedAt: true,
        bufferBeforeMinutes: true,
        bufferAfterMinutes: true,
        serviceId: true,
        locationKind: true,
        meetingMethods: true,
        otherVideoPlatform: true,
      },
    });
    if (!type) throw errors.notFound();
    if (type.archivedAt) throw errors.typeArchived();
    const serviceId = body.serviceId === undefined ? type.serviceId : body.serviceId;
    if (serviceId) await this.requireService(tx, businessId, serviceId);
    const kind = kindOf(body.method);
    if (!typeMethods(type).includes(kind)) throw errors.methodNotOffered('method');
    const otherVideoPlatform = platformFor(kind, body.otherVideoPlatform, type.otherVideoPlatform);
    this.requireSupported(body.related, body.recurrence, 'create');
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
    const equipment = await this.equipmentFor(
      tx,
      businessId,
      kind,
      place.officeId,
      body.equipmentIds ?? [],
    );
    const reminders = await this.remindersFor(
      tx,
      businessId,
      body.reminders,
      party.phone,
      !party.clientId,
    );

    await lockForBooking(tx, businessId, staff.userId, party.clientId, attendees);
    await lockEquipment(tx, businessId, equipment);
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
        clientId: party.clientId,
        leadId: party.leadId,
        attendeeClientIds: attendees,
        roomId: place.roomId,
        equipmentIds: equipment,
        bufferBeforeMinutes: type.bufferBeforeMinutes,
        bufferAfterMinutes: type.bufferAfterMinutes,
      },
      override: body.overrideConflicts?.reason,
      checked,
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

    // Review 2 (TX-F06): the tax return this appointment is for, as its engagement.
    const engagementId =
      body.related?.taxReturnId && party.clientId
        ? await this.returnEngagement(tx, businessId, party.clientId, body.related.taxReturnId)
        : null;
    // Review 2 (row 9): Send Intake Form Before Appointment names one of the firm's published
    // forms, checked before anything is booked; it goes to the client's portal after the booking.
    if (body.related?.intakeFormId) {
      await this.requireIntakeForm(tx, businessId, body.related.intakeFormId, party.clientId);
    }
    // C12 (Tax Planning Review 2): a planning discussion of one of the client's open plans.
    const taxPlanId = body.taxPlanId ?? null;
    if (taxPlanId && party.clientId) {
      const plan = await tx.taxPlan.findFirst({
        where: {
          businessId,
          id: taxPlanId,
          clientId: party.clientId,
          archivedAt: null,
          status: { not: 'CLOSED' },
        },
        select: { id: true, status: true },
      });
      if (!plan) throw errors.notFound();
      // Tax Planning Review 2 workflow: a Draft plan with its client discussion is Scheduled.
      if (plan.status === 'DRAFT') {
        await tx.taxPlan.update({
          where: { businessId_id: { businessId, id: plan.id } },
          data: { status: 'SCHEDULED' },
        });
        await tx.taxPlanEvent.create({
          data: {
            businessId,
            planId: plan.id,
            kind: 'STATUS',
            fromStatus: 'DRAFT',
            toStatus: 'SCHEDULED',
            actorUserId: actor.userId,
          },
        });
      }
    }
    const confirmedAt = body.status === 'CONFIRMED' ? new Date() : null;
    let firstId = '';
    for (const [index, slot] of expansion.occurrences.entries()) {
      const row = await tx.appointment.create({
        data: {
          businessId,
          clientId: party.clientId,
          // P4-1: a lead's own appointment (no client yet); a converted lead books as its client.
          leadId: party.leadId,
          staffUserId: staff.userId,
          typeId: type.id,
          serviceId,
          taxPlanId,
          engagementId,
          startsAt: new Date(slot.start),
          endsAt: new Date(slot.end),
          timeZone,
          allDay: body.allDay,
          locationKind: kind,
          otherVideoPlatform,
          locationDetails: location,
          officeId: place.officeId,
          roomId: place.roomId,
          color,
          internalNotes: body.internalNotes ?? null,
          clientInstructions: body.clientInstructions ?? null,
          // Review 2 (B9, B7): where the instructions show, and the confirmation's own words.
          instructionsInEmail: body.instructionsInEmail ?? true,
          instructionsInPortal: body.instructionsInPortal ?? true,
          instructionsInSms: body.instructionsInSms ?? false,
          confirmationMessage: body.confirmationMessage ?? null,
          confirmedAt,
          // Only the first carries the key (unique per firm): a retry returns it.
          idempotencyKey: index === 0 ? body.idempotencyKey : null,
          seriesId: series?.id ?? null,
          bufferBeforeMinutes: type.bufferBeforeMinutes,
          bufferAfterMinutes: type.bufferAfterMinutes,
          bookedByUserId: actor.userId,
          bookedByClient: false,
        },
        select: {
          id: true,
          clientId: true,
          leadId: true,
          startsAt: true,
          endsAt: true,
          staffUserId: true,
        },
      });
      if (index === 0) firstId = row.id;
      // Review 2 (A2): the trigger copies the appointment's time onto each hold.
      if (equipment.length > 0) {
        await tx.appointmentEquipment.createMany({
          data: equipment.map((equipmentId) => ({
            businessId,
            appointmentId: row.id,
            equipmentId,
          })),
        });
      }
      if (reminders.length > 0) {
        await tx.appointmentReminder.createMany({
          data: reminders.map((r) => ({
            businessId,
            appointmentId: row.id,
            channel: r.channel,
            offsetMinutes: r.offsetMinutes,
            note: r.note,
          })),
        });
      }
      await this.history.record(tx, 'BOOKED', row, { by: 'STAFF', from: null, to: placed(row) });
      await this.addAttendees(tx, businessId, actor, row, attendees);
    }
    if (series) {
      await this.audit.logIn(
        tx,
        'appointment.series_created',
        { type: 'appointment_series', id: series.id },
        {
          clientId: party.clientId,
          ...(party.leadId ? { leadId: party.leadId } : {}),
          occurrences: expansion.occurrences.length,
        },
      );
    }
    if (party.leadId) {
      // P4-1: the booking is in the lead's own timeline (its Activity and Last Contact), by the
      // type's name only, never the notes.
      await tx.leadActivity.create({
        data: {
          businessId,
          leadId: party.leadId,
          kind: 'APPOINTMENT_SCHEDULED',
          actorUserId: actor.userId,
          summary: type.name,
          metadata: { appointmentId: firstId },
        },
      });
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
    const checked: Checked = { actor };
    const outcome = await this.write(
      businessId,
      async (tx) => {
        const current = await this.openForChange(tx, businessId, actor, id);
        // P4-1: a lead's own appointment keeps its lead (the form sends it as the contact).
        const same = (a: string | null | undefined, b: string | null) =>
          !!a && !!b && a.toLowerCase() === b.toLowerCase();
        if (
          body.contact &&
          !(body.contact.kind === 'CLIENT' && same(body.contact.id, current.clientId)) &&
          !(
            body.contact.kind === 'LEAD' &&
            !current.clientId &&
            same(body.contact.id, current.leadId)
          )
        ) {
          throw errors.unsupported(
            'The client of an appointment cannot change. Cancel it and schedule a new one.',
          );
        }
        if (!current.clientId) this.requireLeadOnly(body);
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

        // Review 2 (TX-F06): Link to Tax Return set, changed or taken off.
        if (body.related?.taxReturnId !== undefined) {
          const engagementId =
            body.related.taxReturnId && current.clientId
              ? await this.returnEngagement(
                  tx,
                  businessId,
                  current.clientId,
                  body.related.taxReturnId,
                )
              : null;
          set('taxReturn', 'engagementId', engagementId, engagementId === current.engagementId);
        }

        let staffUserId = current.staffUserId;
        if (body.staffUserIds !== undefined) {
          if (body.staffUserIds.length > 1) {
            throw errors.unsupported('An appointment has one staff member for now. Choose one.');
          }
          const wanted = body.staffUserIds[0];
          if (!wanted) throw errors.unsupported('Choose a staff member');
          if (wanted !== current.staffUserId.toLowerCase()) {
            await activeMember(tx, businessId, wanted);
            // TX-F18: an appointment of a tax return's engagement, as Reschedule.
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
                { staffUserId: wanted },
              );
          }
          staffUserId = wanted;
        }
        const staff = await activeMember(tx, businessId, staffUserId);

        let buffers = {
          before: current.bufferBeforeMinutes,
          after: current.bufferAfterMinutes,
        };
        // The type's meeting methods, when the type or the method changes (A1).
        let offered: StoredKind[] | null = null;
        // Review 2 (P1 row 1): the platform of the type the appointment is (or becomes) of.
        let typePlatform: string | null = null;
        const typeChanged = body.typeId !== undefined && body.typeId !== current.typeId;
        if (typeChanged) {
          const type = await tx.appointmentType.findFirst({
            where: { businessId, id: body.typeId },
            select: {
              id: true,
              archivedAt: true,
              bufferBeforeMinutes: true,
              bufferAfterMinutes: true,
              locationKind: true,
              meetingMethods: true,
              otherVideoPlatform: true,
            },
          });
          if (!type) throw errors.notFound();
          if (type.archivedAt) throw errors.typeArchived();
          offered = typeMethods(type);
          typePlatform = type.otherVideoPlatform;
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
        const timeChanged =
          start !== current.startsAt.getTime() || end !== current.endsAt.getTime();
        if (timeChanged) {
          set('time', 'startsAt', new Date(start), false);
          set('time', 'endsAt', new Date(end), false);
        }
        set('allDay', 'allDay', allDay, allDay === current.allDay);
        if (body.timezone !== undefined) {
          const zone = await this.zoneFor(tx, businessId, body.timezone);
          set('timezone', 'timeZone', zone, zone === current.timeZone);
        }

        const kind = body.method ? kindOf(body.method) : current.locationKind;
        const kindChanged = kind !== current.locationKind;
        if (kindChanged && !typeChanged && current.typeId) {
          const type = await tx.appointmentType.findFirst({
            where: { businessId, id: current.typeId },
            select: { locationKind: true, meetingMethods: true, otherVideoPlatform: true },
          });
          offered = type ? typeMethods(type) : null;
          typePlatform = type?.otherVideoPlatform ?? null;
        }
        if (offered && !offered.includes(kind)) throw errors.methodNotOffered('method');
        set('method', 'locationKind', kind, !kindChanged);
        const platform = platformFor(
          kind,
          body.otherVideoPlatform,
          kindChanged ? typePlatform : current.otherVideoPlatform,
        );
        set('method', 'otherVideoPlatform', platform, platform === current.otherVideoPlatform);

        // The office and room only belong to an in-person appointment (the database checks it).
        let roomId = current.roomId;
        let officeId = current.officeId;
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
            current.roomId,
          );
          roomId = place.roomId;
          officeId = place.officeId;
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

        // Review 2 (A2): the equipment, kept unless sent, and checked again when the place changes.
        const held = current.equipment.map((e) => e.equipment.id.toLowerCase());
        const equipment =
          body.equipmentIds !== undefined || officeId !== current.officeId || kindChanged
            ? await this.equipmentFor(
                tx,
                businessId,
                kind,
                officeId,
                body.equipmentIds ?? held,
                held,
              )
            : held;
        const itemsAdded = equipment.filter((e) => !held.includes(e));
        const itemsReleased = held.filter((e) => !equipment.includes(e));
        if (itemsAdded.length > 0 || itemsReleased.length > 0) fields.add('equipment');

        const location = await this.locationAfter(
          tx,
          businessId,
          current,
          kind,
          staff.userId,
          body,
        );
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
        // Review 2 (B9): each channel on its own; (B7) the confirmation's own words.
        for (const [key, value] of [
          ['instructionsInEmail', body.instructionsInEmail],
          ['instructionsInPortal', body.instructionsInPortal],
          ['instructionsInSms', body.instructionsInSms],
        ] as const) {
          if (value !== undefined) set('instructionsIn', key, value, value === current[key]);
        }
        if (body.confirmationMessage !== undefined) {
          set(
            'confirmationMessage',
            'confirmationMessage',
            body.confirmationMessage,
            body.confirmationMessage === current.confirmationMessage,
          );
        }
        if (staffUserId !== current.staffUserId) set('staff', 'staffUserId', staffUserId, false);

        const remindersChanged =
          body.reminders !== undefined &&
          (await this.replaceReminders(tx, businessId, current, body.reminders));
        if (remindersChanged) fields.add('reminders');
        // A1: the other attendees as the form names them now. Only the new ones are checked as the
        // client is (one a Staff member does not see may stay on, as it was).
        const before = current.attendees.map((a) => a.clientId.toLowerCase());
        let attendees = before;
        let added: string[] = [];
        let removed: string[] = [];
        if (body.attendeeClientIds !== undefined) {
          // P4-1: other clients attend a client's appointment (a lead's own refused them above).
          const own = current.clientId?.toLowerCase();
          attendees = [...new Set(body.attendeeClientIds.map((c) => c.toLowerCase()))].filter(
            (c) => c !== own,
          );
          added = await attendeeClients(
            tx,
            businessId,
            actor,
            current.clientId,
            attendees.filter((c) => !before.includes(c)),
          );
          removed = before.filter((c) => !attendees.includes(c));
          if (added.length > 0 || removed.length > 0) fields.add('attendees');
        }
        // After the lookups above, so an id of another firm is 404 before a stale version is 409.
        if (body.version !== versionOf(current.updatedAt)) throw errors.saveConflict();
        if (fields.size === 0)
          return {
            record: await this.recordIn(tx, businessId, actor, id),
            notify: [] as string[],
            added: [] as string[],
          };

        const moved = timeChanged || staffUserId !== current.staffUserId;
        const roomOrPlaceMoved = roomId !== current.roomId;
        if (
          moved ||
          roomOrPlaceMoved ||
          kindChanged ||
          fields.has('buffers') ||
          added.length > 0 ||
          itemsAdded.length > 0
        ) {
          await lockForBooking(tx, businessId, staffUserId, current.clientId, attendees);
          await lockEquipment(tx, businessId, equipment);
          await this.checkConflicts(tx, businessId, actor, {
            staff: [staff],
            candidate: {
              staffUserIds: [staff.userId],
              occurrences: [{ start, end }],
              allDay,
              clientId: current.clientId,
              leadId: current.leadId,
              attendeeClientIds: attendees,
              roomId,
              equipmentIds: equipment,
              bufferBeforeMinutes: buffers.before,
              bufferAfterMinutes: buffers.after,
              exceptId: current.id,
            },
            override: body.overrideConflicts?.reason,
            checked,
          });
        }
        // Released first, so an item let go never blocks the new time; added after, at it.
        if (itemsReleased.length > 0) {
          await tx.appointmentEquipment.deleteMany({
            where: { businessId, appointmentId: current.id, equipmentId: { in: itemsReleased } },
          });
        }
        const updated = await tx.appointment.update({
          where: { id: current.id },
          data: { ...data, updatedAt: new Date() },
          select: {
            id: true,
            clientId: true,
            leadId: true,
            startsAt: true,
            endsAt: true,
            staffUserId: true,
          },
        });
        if (itemsAdded.length > 0) {
          await tx.appointmentEquipment.createMany({
            data: itemsAdded.map((equipmentId) => ({
              businessId,
              appointmentId: current.id,
              equipmentId,
            })),
          });
        }
        if (moved) {
          await this.history.record(tx, 'RESCHEDULED', updated, {
            by: 'STAFF',
            from: placed(current),
            to: placed(updated),
          });
        }
        if (removed.length > 0) {
          await tx.appointmentAttendee.deleteMany({
            where: { businessId, appointmentId: current.id, clientId: { in: removed } },
          });
          await this.audit.logIn(
            tx,
            'appointment.attendees_removed',
            { type: 'appointment', id: current.id },
            { clientId: current.clientId, attendeeClientIds: removed },
          );
        }
        await this.addAttendees(tx, businessId, actor, updated, added);
        await this.audit.logIn(
          tx,
          'appointment.details_updated',
          { type: 'appointment', id: current.id },
          {
            clientId: current.clientId,
            ...(current.clientId ? {} : { leadId: current.leadId }),
            fields: [...fields].sort(),
          },
        );
        // The client hears about a new time, staff member, place or link; not about notes or colour.
        const notify =
          moved || fields.has('place') || fields.has('location') || fields.has('method');
        // A1: a new attendee hears of the booking; the client and the others of the change.
        const kept = [current.clientId, ...attendees.filter((c) => !added.includes(c))].filter(
          (c): c is string => c !== null,
        );
        return {
          record: await this.recordIn(tx, businessId, actor, id),
          notify: notify ? kept : [],
          added,
        };
      },
      checked,
    );
    if (outcome.notify.length > 0) {
      await this.notices.send('appointment.changed', businessId, id, { clientIds: outcome.notify });
    }
    if (outcome.added.length > 0) {
      await this.notices.send('appointment.booked', businessId, id, { clientIds: outcome.added });
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
          {
            clientId: current.clientId,
            ...(current.clientId ? {} : { leadId: current.leadId }),
          },
        );
      }
      return this.recordIn(tx, businessId, actor, id);
    });
  }

  // ---------- Pieces ----------

  /**
   * Who the booking is for: an existing client the member may see, or (P4-1) a lead the member
   * reaches. A lead that became a client books as that client; one that has not books as itself
   * (no client yet). New contacts need a schema change.
   */
  private async partyFor(
    tx: TxClient,
    businessId: string,
    actor: FirmActor,
    contact: Schedule['contact'],
  ): Promise<{ clientId: string | null; leadId: string | null; phone: string | null }> {
    let clientId: string;
    if (contact.kind === 'CLIENT') {
      clientId = contact.id;
    } else if (contact.kind === 'LEAD') {
      const lead = await leadToBook(tx, businessId, actor, contact.id);
      if (!lead.clientId) return { clientId: null, leadId: lead.id, phone: lead.phone };
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
    return { clientId: row.id, leadId: null, phone: row.phone };
  }

  /**
   * P4-1: a lead's own appointment is about the lead only, until it converts: no tax return or
   * tax plan (a client's), and no other clients attending (400, naming the field).
   */
  private requireLeadOnly(body: {
    related?: { taxReturnId?: string | null | undefined } | null | undefined;
    taxPlanId?: string | null | undefined;
    attendeeClientIds?: readonly string[] | undefined;
  }): void {
    if (body.related?.taxReturnId) {
      throw errors.invalidField(
        'related.taxReturnId',
        "A lead's appointment cannot link a tax return. Convert the lead to a client first.",
      );
    }
    if (body.taxPlanId) {
      throw errors.invalidField(
        'taxPlanId',
        "A lead's appointment cannot link a tax plan. Convert the lead to a client first.",
      );
    }
    if (body.attendeeClientIds?.length) {
      throw errors.invalidField(
        'attendeeClientIds',
        "A lead's appointment has no other attendees. Convert the lead to a client first.",
      );
    }
  }

  private async requireService(tx: TxClient, businessId: string, serviceId: string): Promise<void> {
    const service = await tx.service.findFirst({
      where: { businessId, id: serviceId },
      select: { id: true },
    });
    if (!service) throw errors.notFound();
  }

  /**
   * What the form can send but the database cannot keep yet: refused, never dropped silently.
   * Review 2 (TX-F06): Link to Tax Return is kept (as the return's engagement). Review 2 (row 9):
   * an intake form is sent with a new appointment only (Edit: 400).
   */
  private requireSupported(
    related: Schedule['related'],
    recurrence: Schedule['recurrence'],
    on: 'create' | 'edit' = 'edit',
  ): void {
    const { taxReturnId: _kept, intakeFormId, ...rest } = related ?? {};
    if (Object.values(rest).some((v) => v !== null && v !== undefined)) {
      throw errors.unsupported('Related items (invoice, task, documents) cannot be saved yet.');
    }
    if (intakeFormId && on === 'edit') {
      throw errors.unsupported(
        "An intake form goes with a new appointment. Send one from the appointment's page.",
      );
    }
    if (recurrence?.frequency === 'CUSTOM') {
      throw errors.unsupported(
        'Custom repeats are not available yet. Choose daily, weekly or monthly.',
      );
    }
  }

  /**
   * Review 2 (row 9): the intake form chosen on a new appointment. One of the firm's live forms
   * (404 otherwise) with a published version, for a client (a lead has no portal): 400 at
   * `related.intakeFormId` otherwise.
   */
  private async requireIntakeForm(
    tx: TxClient,
    businessId: string,
    templateId: string,
    clientId: string | null,
  ): Promise<void> {
    const t = await tx.intakeTemplate.findFirst({
      where: { businessId, id: templateId, archivedAt: null },
      select: { forms: { where: { status: 'PUBLISHED' }, take: 1, select: { id: true } } },
    });
    if (!t) throw errors.notFound();
    if (t.forms.length === 0) {
      throw errors.invalidField('related.intakeFormId', 'Publish this form before sending it');
    }
    if (!clientId) {
      throw errors.invalidField(
        'related.intakeFormId',
        "A lead has no portal: send the lead's form by email from Intake",
      );
    }
  }

  /**
   * Review 2 (TX-F06): Link to Tax Return. One of the client's returns (404 otherwise), kept as
   * its engagement, which the appointment, the return and its reassignment rules share.
   */
  private async returnEngagement(
    tx: TxClient,
    businessId: string,
    clientId: string,
    taxReturnId: string,
  ): Promise<string> {
    const r = await tx.taxReturn.findFirst({
      where: { businessId, id: taxReturnId, clientId, archivedAt: null },
      select: { engagementId: true },
    });
    if (!r) throw errors.notFound();
    if (!r.engagementId) {
      throw errors.invalidField(
        'related.taxReturnId',
        "This return has no service yet: set it in the return's details first",
      );
    }
    return r.engagementId;
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
    kind: StoredKind,
    officeId: string | null | undefined,
    roomId: string | null | undefined,
    keepOfficeId: string | null = null,
    keepRoomId: string | null = null,
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
      // An archived room keeps an appointment that already holds it (A2: Archive).
      const room = await tx.firmRoom.findFirst({
        where: { businessId, officeId, id: roomId },
        select: { id: true, archivedAt: true },
      });
      if (!room || (room.archivedAt && room.id !== keepRoomId)) throw errors.notFound();
    }
    return { officeId, roomId: roomId ?? null };
  }

  /**
   * Review 2 (A2): the equipment to book, lower-case ids: live items of this firm (one the
   * appointment already holds may be archived since; else 404), an office's own only for an
   * in-person appointment at that office (400 at `equipmentIds`).
   */
  private async equipmentFor(
    tx: TxClient,
    businessId: string,
    kind: StoredKind,
    officeId: string | null,
    ids: readonly string[],
    held: readonly string[] = [],
  ): Promise<string[]> {
    const wanted = [...new Set(ids.map((i) => i.toLowerCase()))];
    if (wanted.length === 0) return [];
    const rows = await tx.firmEquipment.findMany({
      where: { businessId, id: { in: wanted } },
      select: { id: true, name: true, officeId: true, archivedAt: true },
    });
    const byId = new Map(rows.map((r) => [r.id.toLowerCase(), r]));
    for (const id of wanted) {
      const item = byId.get(id);
      if (!item || (item.archivedAt && !held.includes(id))) throw errors.notFound();
      const atItsOffice =
        kind === 'IN_PERSON' && officeId?.toLowerCase() === item.officeId?.toLowerCase();
      if (item.officeId && !atItsOffice) {
        throw errors.invalidField(
          'equipmentIds',
          `${item.name} belongs to one office. Choose it for an in-person appointment there.`,
        );
      }
    }
    return wanted;
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
    kind: StoredKind,
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
    const link =
      input.videoUrl ?? input.details ?? (await linkOf(this.links, tx, businessId, staffUserId));
    // Advisory B11: Generate on a staff member with no link is refused, never saved without one.
    if (input.generate && !link) throw errors.videoLinkMissing();
    return link;
  }

  /** The location details after an edit; unchanged unless the form sent something for them. */
  private async locationAfter(
    tx: TxClient,
    businessId: string,
    current: SchedulingRow,
    kind: StoredKind,
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
        generate: kind === 'VIDEO' && body.generateVideoLink === true,
      });
    }
    if (sent) {
      if (kind === 'VIDEO') {
        const typed = body.videoUrl !== undefined ? body.videoUrl : body.details;
        const link = typed ?? (await linkOf(this.links, tx, businessId, staffUserId));
        if (body.generateVideoLink && !link) throw errors.videoLinkMissing();
        return link;
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
    /** P4-1: a lead's own appointment: its lead gets email only, never a text. */
    forLead = false,
  ): Promise<{ channel: Reminder['channel']; offsetMinutes: number; note: string | null }[]> {
    const rows = new Map<
      string,
      { channel: Reminder['channel']; offsetMinutes: number; note: string | null }
    >();
    for (const r of reminders) {
      const offsetMinutes = reminderOffset(r);
      if (offsetMinutes === null) {
        throw errors.unsupported(
          `A reminder is sent at most ${MAX_REMINDER_OFFSET / 1440} days before`,
        );
      }
      // Review 2 (B7): each reminder's own note; none sends the generic reminder.
      rows.set(`${r.channel}:${offsetMinutes}`, {
        channel: r.channel,
        offsetMinutes,
        note: r.note ?? null,
      });
    }
    const list = [...rows.values()];
    if (forLead && list.some((r) => r.channel === 'SMS')) throw errors.leadSms();
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
    // P4-1: a lead's own appointment has no client phone here (a text reminder is then refused).
    const client = current.clientId
      ? await tx.client.findFirst({
          where: { businessId, id: current.clientId },
          select: { phone: true },
        })
      : null;
    const next = await this.remindersFor(
      tx,
      businessId,
      reminders,
      client?.phone ?? null,
      !current.clientId,
    );
    const key = (r: { channel: string; offsetMinutes: number; note: string | null }) =>
      `${r.channel}:${r.offsetMinutes}:${r.note ?? ''}`;
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

  /** A1: the other attendees of one appointment, added and audited (ids only). */
  private async addAttendees(
    tx: TxClient,
    businessId: string,
    actor: FirmActor,
    /** clientId null: a lead's own appointment (P4-1). */
    appointment: { id: string; clientId: string | null },
    clientIds: readonly string[],
  ): Promise<void> {
    if (clientIds.length === 0) return;
    await tx.appointmentAttendee.createMany({
      data: clientIds.map((clientId) => ({
        businessId,
        appointmentId: appointment.id,
        clientId,
        addedByUserId: actor.userId,
      })),
    });
    await this.audit.logIn(
      tx,
      'appointment.attendees_added',
      { type: 'appointment', id: appointment.id },
      { clientId: appointment.clientId, attendeeClientIds: [...clientIds] },
    );
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
    input: {
      staff: MemberRef[];
      candidate: Candidate;
      override: string | undefined;
      checked?: Checked;
    },
  ): Promise<void> {
    if (input.checked) input.checked.input = { staff: input.staff, candidate: input.candidate };
    const timeZone = await firmTimeZone(tx, businessId);
    const data = await loadConflictData(
      tx,
      businessId,
      timeZone,
      input.staff,
      conflictSpan(input.candidate),
      input.candidate.clientId,
      input.candidate.roomId,
      input.candidate.attendeeClientIds,
      input.candidate.equipmentIds,
      input.candidate.leadId ?? null,
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
