import type { TxClient } from '@firmivra/db';

const MINUTE = 60_000;

/**
 * Review 2 (B7, B9): the firm's own words in an appointment's client notice. A scheduled/booked
 * notice carries the appointment's confirmation message, else its type's. A reminder carries the
 * note of the email reminder now due (the one closest to the start whose time has come), else
 * none, so the generic reminder goes out. The client instructions go only when the appointment
 * shows them in email. Internal notes are never read here.
 */
export async function noticeWords(
  tx: TxClient,
  businessId: string,
  appointmentId: string,
  template: string,
  now: Date = new Date(),
): Promise<{ message: string | null; instructions: string | null }> {
  const a = await tx.appointment.findFirst({
    where: { businessId, id: appointmentId },
    select: {
      startsAt: true,
      clientInstructions: true,
      instructionsInEmail: true,
      confirmationMessage: true,
      type: { select: { confirmationMessage: true } },
      reminders: { where: { channel: 'EMAIL' }, select: { offsetMinutes: true, note: true } },
    },
  });
  if (!a) return { message: null, instructions: null };
  const instructions = a.instructionsInEmail ? a.clientInstructions : null;
  if (template === 'appointment.booked') {
    return { message: a.confirmationMessage ?? a.type?.confirmationMessage ?? null, instructions };
  }
  if (template === 'appointment.reminder') {
    const left = (a.startsAt.getTime() - now.getTime()) / MINUTE;
    const due = a.reminders
      .filter((r) => r.offsetMinutes >= left)
      .sort((x, y) => x.offsetMinutes - y.offsetMinutes)[0];
    return { message: due?.note ?? null, instructions };
  }
  return { message: null, instructions };
}
