import type { TxClient } from '@firmivra/db';
import type { NotifyMessage } from '../notify/notify.types.js';
import { firmTimeZone } from './calendar-data.js';

const MINUTE = 60_000;
/** A7: the reminder job sends a configured reminder up to this early (one run). */
export const REMINDER_EARLY_MINUTES = 1;

/**
 * Review 2 (B7, B9): the firm's own words in an appointment's client notice. A scheduled/booked
 * notice carries the appointment's confirmation message, else its type's. A reminder carries the
 * note of the reminder of its channel now due (the one closest to the start whose time has come,
 * within REMINDER_EARLY_MINUTES: the job sends a reminder up to a minute early), else none, so the
 * generic reminder goes out. The client instructions go only when the appointment shows them in
 * that channel (email, or a text for A7's text reminder). Internal notes are never read here.
 */
export async function noticeWords(
  tx: TxClient,
  businessId: string,
  appointmentId: string,
  template: string,
  now: Date = new Date(),
  /** A7: the channel the notice goes out on (its reminder's note and its instructions). */
  channel: 'EMAIL' | 'SMS' = 'EMAIL',
): Promise<{ message: string | null; instructions: string | null; confirmAsk: boolean }> {
  const a = await tx.appointment.findFirst({
    where: { businessId, id: appointmentId },
    select: {
      startsAt: true,
      status: true,
      confirmedAt: true,
      bookedByClient: true,
      clientInstructions: true,
      instructionsInEmail: true,
      instructionsInSms: true,
      confirmationMessage: true,
      type: { select: { confirmationMessage: true } },
      reminders: { where: { channel }, select: { offsetMinutes: true, note: true } },
    },
  });
  if (!a) return { message: null, instructions: null, confirmAsk: false };
  const shown = channel === 'SMS' ? a.instructionsInSms : a.instructionsInEmail;
  const instructions = shown ? a.clientInstructions : null;
  // Review 2 (row 8): the firm booked it and the client has not confirmed it yet.
  const confirmAsk =
    a.status === 'SCHEDULED' &&
    a.confirmedAt === null &&
    !a.bookedByClient &&
    a.startsAt.getTime() > now.getTime();
  if (template === 'appointment.booked') {
    return {
      message: a.confirmationMessage ?? a.type?.confirmationMessage ?? null,
      instructions,
      confirmAsk,
    };
  }
  if (template === 'appointment.reminder') {
    const left = (a.startsAt.getTime() - now.getTime()) / MINUTE - REMINDER_EARLY_MINUTES;
    const due = a.reminders
      .filter((r) => r.offsetMinutes >= left)
      .sort((x, y) => x.offsetMinutes - y.offsetMinutes)[0];
    return { message: due?.note ?? null, instructions, confirmAsk };
  }
  return { message: null, instructions, confirmAsk };
}

/** P4-1: the lead's own notices: the booking's confirmation and its reminder, by email only. */
export type LeadNoticeTemplate = 'appointment.lead-booked' | 'appointment.lead-reminder';

/**
 * P4-1: the email to the lead of a lead's own appointment (no client yet), as the client's notice
 * without the portal: to the lead's own email, with the firm's words and the instructions shown
 * in email. Null when nothing goes: no such appointment, one with a client (its client is told),
 * one over or no longer scheduled, a notice other than the confirmation or the reminder (a lead
 * hears of nothing else), or a lead with no email. Never a text.
 */
export async function leadNotice(
  tx: TxClient,
  businessId: string,
  appointmentId: string,
  template: string,
  now: Date = new Date(),
): Promise<NotifyMessage<LeadNoticeTemplate> | null> {
  const kind: LeadNoticeTemplate | null =
    template === 'appointment.booked'
      ? 'appointment.lead-booked'
      : template === 'appointment.reminder'
        ? 'appointment.lead-reminder'
        : null;
  if (!kind) return null;
  const a = await tx.appointment.findFirst({
    where: { businessId, id: appointmentId },
    select: {
      clientId: true,
      startsAt: true,
      status: true,
      type: { select: { name: true } },
      lead: { select: { firstName: true, lastName: true, email: true } },
    },
  });
  if (!a || a.clientId || !a.lead || a.status !== 'SCHEDULED') return null;
  if (a.startsAt.getTime() <= now.getTime()) return null;
  const to = a.lead.email.trim();
  if (!to) return null;
  const words = await noticeWords(tx, businessId, appointmentId, template, now);
  return {
    template: kind,
    to,
    businessId,
    data: {
      name: `${a.lead.firstName} ${a.lead.lastName}`.trim(),
      title: a.type?.name ?? 'Appointment',
      startsAt: a.startsAt,
      timeZone: await firmTimeZone(tx, businessId),
      message: words.message,
      instructions: words.instructions,
    },
  };
}
