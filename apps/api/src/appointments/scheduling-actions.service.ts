import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { Database, TxClient } from '@firmivra/db';
import type {
  AppointmentDraft,
  AppointmentRecord,
  RemindersSent,
  ReminderChannel,
} from '@firmivra/types';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import { DATABASE } from '../database/database.module.js';
import { AppointmentHistory } from './appointment-history.service.js';
import { AppointmentNotices } from './appointment-notices.js';
import { DAY, zonedDate } from './calendar.js';
import { type FirmActor, firmTimeZone, inFullWhere, memberNames } from './calendar-data.js';
import { lockAppointment, retryWhenBusy } from './calendar-locks.js';
import { errors } from './errors.js';
import { findSchedulingRow, toAgendaItem, toRecord } from './scheduling-data.js';
import { reminderFromOffset } from './scheduling-map.js';
import type { NoteBody, ReminderBody, RemindersBody } from './scheduling.input.js';

type ReminderReq = z.output<typeof ReminderBody>;
type RemindersReq = z.output<typeof RemindersBody>;
type NoteReq = z.output<typeof NoteBody>;

/** appointments_notes: up to 5,000 characters. */
const NOTES_LIMIT = 5000;
/** Bulk reminders go to at most this many appointments in one call. */
const BULK_LIMIT = 200;

/**
 * The row actions of the Appointments screens: Send Reminder (one, or every upcoming one),
 * Add Notes and Duplicate. Same visibility as R12: Staff reach only appointments they see in full.
 *
 * Reminders go out as email through the NotifyService (`appointment.reminder`), now, without
 * touching the automatic schedule (`reminder_sent_at`). Text and portal reminders have no sender
 * yet, so asking for them counts as skipped (and 400 SMS_UNAVAILABLE when the firm has no SMS
 * sender or the client no phone). Audit rows hold ids and channel names only.
 */
@Injectable()
export class SchedulingActionsService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly audit: AuditService,
    private readonly history: AppointmentHistory,
    private readonly notices: AppointmentNotices,
  ) {}

  private inFirm<T>(businessId: string, fn: (tx: TxClient) => Promise<T>): Promise<T> {
    return this.database.withScope({ kind: 'business', businessId }, fn);
  }

  // ---------- Reminders ----------

  async sendReminder(
    businessId: string,
    actor: FirmActor,
    id: string,
    body: ReminderReq,
  ): Promise<RemindersSent> {
    const channels = body.channels ?? ['EMAIL'];
    const target = await this.inFirm(businessId, async (tx) => {
      const row = await findSchedulingRow(tx, businessId, actor, id);
      if (!row) throw errors.notFound();
      if (channels.includes('SMS')) await this.requireSms(tx, businessId, row.clientId);
      return { id: row.id, clientId: row.clientId };
    });
    return this.remind(businessId, [target], channels);
  }

  async sendReminders(
    businessId: string,
    actor: FirmActor,
    body: RemindersReq,
  ): Promise<RemindersSent> {
    const now = new Date();
    const asked = await this.inFirm(businessId, async (tx) => {
      const rows = await tx.appointment.findMany({
        where: {
          AND: [
            { businessId },
            body.appointmentIds
              ? { id: { in: body.appointmentIds } }
              : {
                  status: 'SCHEDULED',
                  startsAt: { gt: now, lt: new Date(now.getTime() + (body.withinDays ?? 1) * DAY) },
                },
            // What this member does not see in full is not found, as everywhere else.
            inFullWhere(actor),
          ],
        },
        orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
        take: BULK_LIMIT,
        select: { id: true, clientId: true, status: true, startsAt: true },
      });
      if (body.appointmentIds && rows.length < new Set(body.appointmentIds).size) {
        throw errors.notFound();
      }
      return rows;
    });
    // Over or closed appointments are skipped, not an error.
    const open = asked.filter((a) => a.status === 'SCHEDULED' && a.startsAt > now);
    const result = await this.remind(businessId, open, ['EMAIL']);
    return { sent: result.sent, skipped: result.skipped + (asked.length - open.length) };
  }

  /** Emails each client now; the count of those who got one and of those who could not. */
  private async remind(
    businessId: string,
    targets: { id: string; clientId: string }[],
    channels: readonly ReminderChannel[],
  ): Promise<RemindersSent> {
    let sent = 0;
    let skipped = 0;
    for (const target of targets) {
      // Only email has a sender for this notice: other channels are skipped.
      const delivered = channels.includes('EMAIL')
        ? await this.notices.sendNow('appointment.reminder', businessId, target.id)
        : false;
      if (delivered) sent += 1;
      else skipped += 1;
      await this.audit.log(
        'appointment.reminder_sent',
        { type: 'appointment', id: target.id },
        { clientId: target.clientId, channels: [...channels].sort(), delivered },
      );
    }
    return { sent, skipped };
  }

  /** Text reminders need the firm's SMS sender and a phone number on the client (400). */
  private async requireSms(tx: TxClient, businessId: string, clientId: string): Promise<void> {
    const settings = await tx.messageSettings.findUnique({
      where: { businessId },
      select: { smsEnabled: true },
    });
    const client = await tx.client.findFirst({
      where: { businessId, id: clientId },
      select: { phone: true },
    });
    if (!settings?.smsEnabled || !client?.phone) throw errors.smsUnavailable();
  }

  // ---------- Notes ----------

  /**
   * Appends "date time · name: text" to the internal notes. Allowed on a closed appointment too
   * (notes after the meeting). The text never goes to the audit log.
   */
  async addNote(
    businessId: string,
    actor: FirmActor,
    id: string,
    body: NoteReq,
  ): Promise<AppointmentRecord> {
    return retryWhenBusy(() =>
      this.inFirm(businessId, async (tx) => {
        await lockAppointment(tx, businessId, id);
        const row = await findSchedulingRow(tx, businessId, actor, id);
        if (!row) throw errors.notFound();
        const timeZone = await firmTimeZone(tx, businessId);
        const who = (await memberNames(tx, businessId, [actor.userId])).get(actor.userId);
        const now = Date.now();
        const clock = new Date(now).toLocaleTimeString('en-GB', {
          timeZone,
          hour: '2-digit',
          minute: '2-digit',
          hourCycle: 'h23',
        });
        const entry = `${zonedDate(timeZone, now)} ${clock} · ${who ?? 'Staff member'}: ${body.text}`;
        const notes = row.internalNotes ? `${row.internalNotes}\n\n${entry}` : entry;
        if (notes.length > NOTES_LIMIT) {
          throw errors.unsupported('The notes are full. Shorten the note or an earlier one.');
        }
        await tx.appointment.update({
          where: { id: row.id },
          data: { internalNotes: notes, updatedAt: new Date() },
          select: { id: true },
        });
        await this.audit.logIn(
          tx,
          'appointment.note_added',
          { type: 'appointment', id: row.id },
          { clientId: row.clientId, length: body.text.length },
        );
        const updated = await findSchedulingRow(tx, businessId, actor, id);
        if (!updated) throw errors.notFound();
        return toRecord(updated, timeZone, await this.history.events(tx, businessId, updated));
      }),
    );
  }

  // ---------- Duplicate ----------

  /**
   * The form pre-filled from this appointment, without its time, notes or link: the contact,
   * type, service, place, staff, colour, client instructions and reminders. Drafts have no table
   * yet, so it is returned for the form to open and is not stored (its id is new).
   */
  async duplicate(businessId: string, actor: FirmActor, id: string): Promise<AppointmentDraft> {
    const draft = await this.inFirm(businessId, async (tx) => {
      const row = await findSchedulingRow(tx, businessId, actor, id);
      if (!row) throw errors.notFound();
      const item = toAgendaItem(row);
      const who = (await memberNames(tx, businessId, [actor.userId])).get(actor.userId) ?? null;
      const data: Record<string, unknown> = {
        contact: { kind: 'CLIENT', id: row.clientId },
        typeId: row.typeId,
        serviceId: row.serviceId,
        method: item.method,
        officeId: row.officeId,
        roomId: row.roomId,
        details: item.videoUrl ? null : row.locationDetails,
        allDay: row.allDay,
        staffUserIds: [row.staffUserId],
        status: 'PENDING',
        color: row.color ? item.color : null,
        clientInstructions: row.clientInstructions,
        reminders: row.reminders.map((r) => reminderFromOffset(r.channel, r.offsetMinutes)),
      };
      return { data, who };
    });
    await this.audit.log('appointment.duplicated', { type: 'appointment', id });
    return {
      id: randomUUID(),
      data: draft.data,
      createdBy: draft.who,
      updatedAt: new Date().toISOString(),
    };
  }
}
